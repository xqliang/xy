// 统一「刷新续玩」全状态持久化（PvP / PvE 共用）。
//
// 与旧的 ./battle-save（仅 PvE 波次检查点、仅 status==='ready' 落档）不同，本模块：
//   1) 序列化「全量」核心状态（直接复用 Battle.serialize()，含 monsters/units/status/waveActive
//      以及 4 条 RNG 内部态），因此 status==='playing'（波次进行中）也能续玩；
//   2) PvP / PvE 走同一份存档结构（kind 区分，PvP 另带一段对局元信息 pvp）；
//   3) 写入采用「输入触发 + 节流」策略（见 sessionSaveCheckpoint），把落盘抖动压到最低。
//
// 本模块只负责「读 / 写 / 重建」这三件事，不含任何主循环接线与开机恢复逻辑——
// 那些由后续任务（Task 2/3）在本模块之上搭建。
//
// 说明：类型 BattleSaveConfig / BattleCoreState / Status 实际定义并导出在 ./battle
//       （./battle-save 只是把它们再 import 进去、并不 re-export），故此处从 ./battle 取。
import { Battle } from './battle';
import type { BattleSaveConfig, BattleCoreState } from './battle';
import { mapById } from './board';

/** localStorage 键名（PvP/PvE 共用同一槽位，同一时刻只有一局在进行）。 */
export const SESSION_KEY = 'dasheng.session';
/** 存档结构版本；结构不兼容时 +1，readSession 遇到旧版本直接判废。 */
export const SESSION_VERSION = 1;

/**
 * 节流下限：两次「脏触发」写入之间至少间隔这么久（毫秒）。
 * 高频输入（连续摆放/出招）在窗口内只落一次，避免每帧 stringify+写抖动。
 */
export const SESSION_SAVE_MIN_INTERVAL_MS = 500;
/**
 * 节流上限：距上次写入超过这么久（毫秒）则无条件补写一次（保底心跳）。
 * 即便玩家长时间无输入，也能把「怪物推进 / 血量」等被动变化定期落盘。
 */
export const SESSION_SAVE_MAX_INTERVAL_MS = 2000;

/** 存档类型：在线 PvP 或本地 PvE（AI 对战 / 无尽）。 */
export type SessionKind = 'pvp' | 'pve';

/** PvP 专属对局元信息：用于开机恢复时校验「续的是同一局」并对齐服务端权威时钟。 */
export interface PvpSessionMeta {
  /** 对局 ID（服务端下发，唯一）。 */
  matchId: string;
  /** 本方玩家 ID。 */
  uid: string;
  /** 本方在对局中的座位（a=先手半场 / b=后手半场）。 */
  side: 'a' | 'b';
  /** 服务端权威开局时刻（epoch ms），用于恢复后重算波次排程基准。 */
  startAtServerMs: number;
  /** 落档时本地已推进的 sim tick 数，用于恢复后对齐本地时钟。 */
  localSimTick: number;
}

/** v1 全状态存档结构（PvP/PvE 共用）。 */
export interface SessionSaveV1 {
  /** 结构版本，须等于 SESSION_VERSION。 */
  v: number;
  /** 落档时的游戏版本；跨版本不续玩（结构可能漂移）。 */
  gameVersion: string;
  /** 落档时刻（epoch ms），预留陈旧度判断。 */
  savedAt: number;
  /** 对局类型。 */
  kind: SessionKind;
  /** 仅 PvP 携带；PvE 恒为 undefined（不写该字段）。 */
  pvp?: PvpSessionMeta;
  /** 构造种子（RNG 会被 core 覆盖，此处仅供重建时播种）。 */
  seed: number;
  /** 地图 ID（重建时 mapById 用）。 */
  mapId: string;
  /** 重建对局几何/骨架所需的构造参数。 */
  config: BattleSaveConfig;
  /** 全量核心可变状态（Battle.serialize() 产物）。 */
  core: BattleCoreState;
}

/** buildSessionSave / sessionSaveCheckpoint 的公共入参：种子 + 地图 + 可选 PvP 元信息。 */
export interface SessionSaveOpts {
  seed: number;
  mapId: string;
  pvp?: PvpSessionMeta;
}

/** sessionSaveCheckpoint 的注入项（便于测试注入时钟；生产环境全部走默认）。 */
export interface SessionSaveCheckpointIo {
  /** 当前时刻（epoch ms）；缺省取 Date.now()。 */
  now?: number;
  /** 本帧发生了「玩家输入类」变更（摆放/出招/加桃…），触发下限节流写入。 */
  dirty?: boolean;
  /** 强制写入（忽略节流），用于关键节点（如页面隐藏/波次切换）。 */
  force?: boolean;
}

/**
 * 取当前游戏版本。构建期由 Vite 注入 globalThis.__APP_VERSION__；
 * 测试等未注入场景回退 'dev'。buildSessionSave 与 readSession 都走本函数，
 * 保证同一环境下「写入版本」与「校验版本」一致，round-trip 可通过。
 */
function appVersion(): string {
  try {
    return (globalThis as any).__APP_VERSION__ ?? 'dev';
  } catch {
    return 'dev';
  }
}

/**
 * 由当前 Battle 构造一份 v1 存档（纯函数，不触碰 localStorage）。
 * pvp 仅在 opts.pvp 存在时才落入结构（PvE 不写该字段）。
 */
export function buildSessionSave(kind: SessionKind, b: Battle, opts: SessionSaveOpts): SessionSaveV1 {
  const { config, core } = b.serialize();
  const save: SessionSaveV1 = {
    v: SESSION_VERSION,
    gameVersion: appVersion(),
    savedAt: Date.now(),
    kind,
    seed: opts.seed,
    mapId: opts.mapId,
    config,
    core,
  };
  if (opts.pvp) save.pvp = opts.pvp; // 仅 PvP 携带对局元信息
  return save;
}

/**
 * 读取并校验存档；任何不合法情形（缺失 / 损坏 JSON / 版本不符 / 跨游戏版本 /
 * 缺 core / kind 非法 / PvP 缺 pvp 元信息）一律返回 null，绝不抛出。
 */
export function readSession(): SessionSaveV1 | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(SESSION_KEY);
  } catch {
    return null; // localStorage 不可用（隐私模式等）
  }
  if (!raw) return null;

  let save: SessionSaveV1;
  try {
    save = JSON.parse(raw) as SessionSaveV1;
  } catch {
    return null; // JSON 损坏
  }

  if (!save || typeof save !== 'object') return null;
  if (save.v !== SESSION_VERSION) return null;         // 结构版本不符
  if (save.gameVersion !== appVersion()) return null;  // 跨游戏版本不续
  if (!save.core) return null;                          // 缺核心状态
  if (save.kind !== 'pvp' && save.kind !== 'pve') return null; // kind 非法
  if (save.kind === 'pvp' && !save.pvp) return null;    // PvP 必须带对局元信息
  return save;
}

/** 节流时钟：上次成功写入的时刻（epoch ms）。0 表示「从未写过」。 */
let lastWriteMs = 0;

/** 清除存档并重置节流时钟（下次 checkpoint 视为首写）。 */
export function clearSessionSave(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // localStorage 不可用时忽略
  }
  lastWriteMs = 0;
}

/**
 * 主循环检查点：按「输入触发 + 节流」决定是否落档。返回是否实际写入。
 *
 * 规则：
 *   - 终局（won/lost）绝不写：无续玩语义，且 serialize 在飞行中实体上会别名，续玩不安全；
 *   - 写入条件（满足其一）：
 *       · io.force            —— 强制写（关键节点）；
 *       · io.dirty 且 距上次写入 ≥ MIN —— 有输入变更且过了下限节流；
 *       · 距上次写入 ≥ MAX    —— 保底心跳（即便无输入也定期落被动变化）。
 *   - 仅在「实际写入成功」时推进 lastWriteMs；setItem 失败（配额/存储不可用）吞错返回 false，
 *     且不推进 lastWriteMs，以便下次尽快重试。
 */
export function sessionSaveCheckpoint(
  kind: SessionKind,
  b: Battle,
  opts: SessionSaveOpts,
  io: SessionSaveCheckpointIo = {},
): boolean {
  if (b.status === 'won' || b.status === 'lost') return false; // 终局不落档

  const now = io.now ?? Date.now();
  const since = now - lastWriteMs;
  const shouldWrite =
    !!io.force ||
    (!!io.dirty && since >= SESSION_SAVE_MIN_INTERVAL_MS) ||
    since >= SESSION_SAVE_MAX_INTERVAL_MS;
  if (!shouldWrite) return false;

  try {
    const save = buildSessionSave(kind, b, opts);
    localStorage.setItem(SESSION_KEY, JSON.stringify(save));
  } catch {
    return false; // 配额超限/存储不可用：本次放弃，lastWriteMs 不推进
  }
  lastWriteMs = now;
  return true;
}

/**
 * 由有效存档重建本地 Battle 实例：先用中性构造参数搭骨架，再 applyCoreState 覆盖全量状态。
 *
 * 构造参数取舍（与 ./battle-save#loadResumeBattle 同思路）：
 *   - seed 供构造播种（RNG 随后被 core 覆盖，值不敏感）；
 *   - difficultyMul / aiAdjustIntervalScale 从 config 还原：二者只存在于 config、不在 core 中，
 *     applyCoreState 不会覆盖，故必须在此按原值构造，否则续玩会退回默认 1（怪物强度/AI 节奏走样）；
 *   - meta/weapons/actives/passives/aiSkill 传 undefined 走构造默认，避免二次叠加；
 *   - PvP 传 { enabled: true } 打开 isPvp（影响 rubber-band/对手侧处理），PvE 传 undefined。
 *
 * 同步实现：本模块是叶子（无人 import 它），且 ./board 不 import ./battle，
 * 因此静态 import { Battle } 不产生循环依赖，restoreBattle 保持同步。
 */
export function restoreBattle(save: SessionSaveV1): Battle {
  const b = new Battle(
    save.seed,
    save.config.difficultyMul,          // 从 config 还原（core 不含此字段）
    mapById(save.mapId),
    undefined, undefined, undefined, undefined, // meta / weapons / actives / passives 用默认
    save.config.endless,
    undefined,                          // aiSkill 用默认
    save.config.aiAdjustIntervalScale,  // 从 config 还原（core 不含此字段）
    undefined,                          // heroMatch
    save.kind === 'pvp' ? { enabled: true } : undefined, // pvpInit
  );
  b.applyCoreState(save.core);
  return b;
}
