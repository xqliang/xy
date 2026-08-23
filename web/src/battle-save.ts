// 本地对局续玩存档（AI 对战 / 无尽 · 波次检查点）。
// 仅在 status==='ready'（两波之间）落档；在线 PvP（isPvp）永不落档。
// 跨平台 KV 走 storage.ts（Web=localStorage / 微信=wx），本存档不进云同步。
import { Battle, type BattleCoreState, type BattleSaveConfig } from './battle';
import { mapById } from './board';
import { storeGet, storeSet, storeRemove } from './storage';
import { APP_VERSION } from './version';

export const SAVE_KEY = 'dasheng.battleSave';
const SAVE_VERSION = 1;

export interface BattleSaveV1 {
  v: 1;
  gameVersion: string;
  savedAt: number; // 预留：陈旧度元数据，当前未做过期校验
  mode: 'versus' | 'endless';
  config: BattleSaveConfig;
  core: BattleCoreState;
}

// 写入去重：同一 (mode, wave) 的 ready 窗只写一次。clear 时重置。
let lastKey = '';

/** 无条件写入（调用方保证 !isPvp）。 */
export function writeBattleSave(b: Battle): void {
  if (b.isPvp) return; // 双保险：PvP 绝不落档
  const { config, core } = b.serialize();
  const save: BattleSaveV1 = {
    v: SAVE_VERSION,
    gameVersion: APP_VERSION,
    savedAt: Date.now(),
    mode: config.endless ? 'endless' : 'versus',
    config,
    core,
  };
  storeSet(SAVE_KEY, JSON.stringify(save));
  // 乐观置位——storeSet 已吞错(配额/wx)，本窗不重试，避免每帧 stringify+写抖动（best-effort）
  lastKey = `${save.mode}:${core.wave}`;
}

/** 主循环每帧调用：仅本地局、仅 ready、去重后落档。 */
export function saveResumeCheckpoint(b: Battle): void {
  // 每个 ready 窗仅首帧落档；刷新回到该波开头，丢弃 ready 窗内至多 waveGapSec 的临时布置——符合波次检查点语义
  if (b.isPvp) return;
  if (b.status !== 'ready') return; // 波次检查点：只在两波之间
  const key = `${b.endless ? 'endless' : 'versus'}:${b.wave}`;
  if (key === lastKey) return;
  writeBattleSave(b);
}

/** 读取并校验；无效（缺失/损坏/版本不符/已终局）返回 null。 */
export function readBattleSave(): BattleSaveV1 | null {
  const raw = storeGet(SAVE_KEY);
  if (!raw) return null;
  let save: BattleSaveV1;
  try {
    save = JSON.parse(raw) as BattleSaveV1;
  } catch {
    return null;
  }
  if (!save || save.v !== SAVE_VERSION || save.gameVersion !== APP_VERSION) return null;
  if (!save.core || save.core.status !== 'ready') return null; // 仅接受波次检查点(ready)存档；playing/won/lost 皆不可续（serialize 在非 ready 时别名飞行中实体，续玩不安全）
  return save;
}

/** 清除存档并重置去重键。 */
export function clearBattleSave(): void {
  storeRemove(SAVE_KEY);
  lastKey = '';
}

/** 读有效存档并重建本地 Battle。构造传中性参数避免二次叠加，再 applyCoreState 覆盖。 */
export function loadResumeBattle(): { battle: Battle; mapId: string } | null {
  const save = readBattleSave();
  if (!save) return null;
  const battle = new Battle(
    1,                              // seed：RNG 会被 core 覆盖，此处仅供构造
    save.config.difficultyMul,
    mapById(save.config.mapId),
    undefined, undefined, undefined, undefined, // meta/weapons/actives/passives 用默认（NO_META/空）
    save.config.endless,
    undefined,                      // aiSkill 用默认，随后被 core.aiSkill 覆盖
    save.config.aiAdjustIntervalScale,
    // heroMatch、pvpInit 省略 → isPvp=false
  );
  battle.applyCoreState(save.core);
  lastKey = `${save.mode}:${save.core.wave}`; // 避免恢复后首帧重复写同一存档
  return { battle, mapId: save.config.mapId };
}
