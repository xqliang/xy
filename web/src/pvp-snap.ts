// web/src/pvp-snap.ts
// Plan C Task 4：本方半场快照序列化 + 对手双缓冲插值视图。
//
// 背景：在线 PvP 的 Model C 模型下，对手半场不再由确定性重放的 oppBattle 提供，而是由对手
// 每 100ms 经 WS 推来的「本方半场渲染态快照」重建。本文件提供三件事：
//   1. PvpSnap schema —— 本方侧渲染态的纯 JSON 序列化（字段面 = 现 bridgeOpponentFrom 的消费面）；
//   2. Battle.pvpOwnSnapshot(t) —— 读本方 private 字段构快照（方法必须挂在 Battle 上才能读 private）；
//   3. PvpOppView —— 接收端双缓冲（prev/cur）+ 怪物 dist 线性插值（滞后 INTERP_DELAY_MS）+ 特效老化。
// 渲染桥 bridgeOpponentFromSnap 挂在 Battle 上（见 battle.ts），把插值后的视图映射进 battle.ai*。
//
// 关键不变量（逐一 grep render.ts / battle.ts 的 bridgeOpponentFrom 核对）：
//   - 怪物 dist 是唯一连续运动量 → 双缓冲线性插值；其余（单位/字牌/武将组/道具）取最新快照
//     （100ms 步进可接受，见 spec §12 不做落子过渡动画）。
//   - 含 cell 坐标的实体（units/words/bombs/digFx/unlocked/generalStates/lastActivePairKeys）
//     在快照里存本方原始坐标，镜像（mirrorCell / fireDir+π / heroPairKey 重排）全部交给桥，
//     与旧桥 bridgeOpponentFrom 规则逐字一致。
//   - 瞬态特效（playerSkillFx/palmPushFx/passiveFlash）带发送端时刻 t(ms)，接收端按 (nowMs - t) 老化。
//
// 依赖方向：本文件只从 board.ts 取运行值 mirrorCell，从 battle.ts 取「类型」（import type，编译期擦除，
// 不构成运行期循环）；PvpOppView/fxAlive 等运行值由 battle.ts 反向引用。

import type {
  SkillFxKind,
  Monster,
  PlacedUnit,
  PlacedWord,
  GeneralState,
} from './battle';
import { mirrorCell } from './board';

// —— 插值参数 ——
/** 渲染滞后窗口(ms)：渲染时刻 = nowMs - INTERP_DELAY_MS，保证渲染时总有 prev+cur 两份快照可插值。 */
export const INTERP_DELAY_MS = 120;

// —— 快照字段面（= bridgeOpponentFrom 消费面）——
// 说明：spec 初稿把怪物字段写成 {dist,hp,type,tier,slowT,freeze}，但真实 Monster 接口并没有
// type/tier/freeze（render 实读的是 dist/hp/maxHp/spd/isBoss/isMiniBoss/miniBossKind/isCavalry/
// hitFlash/skill/skillCd/castFlash/spawnT/stunT/slowT/hasteT/healFlash/burnT/burnDps/id）。
// 旧桥把整怪数组直引（aiMonsters = opp.monsters），render 读全字段，故整怪快照最安全（宁多勿缺）。
// 单位/字牌/武将态/Mods 同理整结构快照（桥内 {...u, cell: 镜像, fireDir:+π} 展开全字段）。

/** 怪物快照 = 整 Monster（dist 会被插值覆盖，其余全字段原样保留供渲染）。 */
export type PvpSnapMonster = Monster;
/** 单位快照 = 整 PlacedUnit（cell 待桥内镜像，fireDir 待桥内 +π）。 */
export type PvpSnapUnit = PlacedUnit;
/** 字牌快照 = 整 PlacedWord（cell 待桥内镜像，Map 键待桥内重建）。 */
export type PvpSnapWord = PlacedWord;
/** 武将持续态快照 = 整 GeneralState（键 heroPairKey 待桥内按镜像两格重排）。 */
export type PvpSnapGeneralState = GeneralState;
/**
 * 局内加成快照。Modifiers 在 battle.ts 内未导出，故在此复刻同构字段面（与桥设 aiMods 结构一致，
 * 供 aiActiveGenerals 的 generalTierDelta；其余字段渲染不直接读，冗余无害）。
 */
export interface PvpSnapMods {
  atkMul: number;
  frqMul: number;
  killBonus: number;
  monsterSpdMul: number;
  summonCostDelta: number;
  wordRateBonus: number;
  shovelPeach: number;
  autoShovel: boolean;
  meteor: boolean;
  mud: boolean;
  generalTierDelta: number;
}

/** 主动技能槽快照（drawAiItemsHud 读 id/cd/cdMax/ready/flash）。 */
export interface PvpSnapActiveSlot {
  id: string;
  cd: number;
  cdMax: number;
  ready: boolean;
  flash: number;
}
/** 炸药/挖坑特效快照：{c,r,t}，桥内镜像 c/r 保留 t。 */
export interface PvpSnapBomb {
  c: number;
  r: number;
  t: number;
}
/** @alias 挖坑特效与炸药同构（{c,r,t}），单列类型便于语义区分。 */
export type PvpSnapDigFx = PvpSnapBomb;

// —— 瞬态特效：t = 发送端序列化时刻(ms)，接收端按 (nowMs - t) 老化 ——
// 每种 kind 额外带该特效渲染重建所需字段（与 playerSkillFx/PalmPushFx/passiveFlash 同构）。
// 说明：fx.t 是「出生时刻」而非播放进度；桥内据 (nowMs - t) 重建播放进度（playT），
// 与老化共用同一时基，避免「存活但已播完/未播却已老化」的不一致。
/** 主动技能爆发特效（render drawSkillFx 读 kind/t/dur/c/r）。 */
export interface PvpSnapFxSkill {
  kind: 'skill';
  t: number; // 出生时刻(ms)
  skillKind: SkillFxKind;
  dur: number; // 秒
  c: number;
  r: number;
}
/** 如来神掌沿路回推（render drawAiPalmPushFx 读 t/dur/fadeT/frontStartDist）。 */
export interface PvpSnapFxPalm {
  kind: 'palm';
  t: number; // 出生时刻(ms)
  dur: number; // 秒
  fadeT: number; // 秒
  cells: number;
  frontStartDist: number;
}
/** 被动激活闪光（render 读 aiPassiveFlash.get(id) → 剩余秒数作 alpha）。 */
export interface PvpSnapFxFlash {
  kind: 'flash';
  t: number; // 出生时刻(ms)
  id: string;
  value: number; // 剩余秒数
}
export type PvpSnapFx = PvpSnapFxSkill | PvpSnapFxPalm | PvpSnapFxFlash;

/** 本方半场渲染态快照（纯 JSON，字段面 = bridgeOpponentFrom 消费面）。 */
export interface PvpSnap {
  t: number; // 发送端序列化时刻(ms)：插值时基 + 特效老化时基
  wave: number;
  waveActive: boolean;
  spawnRemaining: number;
  tangsengHP: number;
  /** 仅 'lost' 让桥置 aiDefeated=true；其余('playing'/'won'/'ready')一律按 'playing'（未败）。 */
  status: 'playing' | 'lost';
  peach: number;
  kills: number;
  spawnGateT: number; // 出怪口开合动画计时
  introT: number; // 入场进度计时(秒)
  introDone: boolean; // 冗余：桥不桥接（aiTangsengRenderPos 读接收端自身 introDone），留作未来对时/一致性校验
  monsters: PvpSnapMonster[];
  units: PvpSnapUnit[];
  words: PvpSnapWord[];
  /** 已解锁阵位的内部 cellKey "c,r"（逗号、c,r 顺序；桥内逐元素镜像重建）。 */
  unlocked: string[];
  /** heroPairKey("c1,r1|c2,r2") → 武将持续态（桥内键按镜像两格重排）。 */
  generalStates: Array<[string, PvpSnapGeneralState]>;
  /** 上一帧已激活对集合（桥内同步镜像，防首帧误判新激活重置大招 CD）。 */
  lastActivePairKeys: string[];
  activeSlots: PvpSnapActiveSlot[];
  pickedItems: string[]; // HUD 右上角道具 id
  bombs: PvpSnapBomb[];
  digFx: PvpSnapDigFx[];
  fx: PvpSnapFx[]; // 瞬态特效（带发送端时刻，接收端老化）
  mods: PvpSnapMods;
}

// —— 插值/老化小工具 ——
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * 各特效 kind 的存活寿命(ms)：超过则桥不再重建该特效（视为已播完）。
 * 取值依据：skill dur∈{0.8,1.25}s → 留余量到 1.5s；palm dur 0.8 + fade 0.2 = 1.0s → 1.3s；
 * flash 为被动短闪 → 0.7s。均为瞬态视觉，略宽松无害。
 */
const FX_LIFE_MS: Record<PvpSnapFx['kind'], number> = {
  skill: 1500,
  palm: 1300,
  flash: 700,
};

/** 瞬态特效是否仍存活：按发送端时刻 t 老化（nowMs - t < 该 kind 寿命）。 */
export function fxAlive(fx: PvpSnapFx, nowMs: number): boolean {
  return nowMs - fx.t < FX_LIFE_MS[fx.kind];
}

// —— 插值视图：双缓冲 + 怪物 dist 插值 ——
/**
 * 插值后的快照视图（供桥 bridgeOpponentFromSnap 消费）。
 * - snap：当前快照 cur（非怪物字段的权威源）；
 * - monsters：怪物数组，dist 已在 prev/cur 间线性插值，其余字段取 cur；
 * - renderTime：渲染时刻 = nowMs - INTERP_DELAY_MS（插值时基）；
 * - nowMs：传入的当前时刻（特效老化用真实时间，与 renderTime 解耦）。
 */
export interface PvpSnapView {
  snap: PvpSnap;
  monsters: PvpSnapMonster[];
  renderTime: number;
  nowMs: number;
}

/**
 * 对手半场双缓冲快照视图。
 * 维护 prev/cur 两份快照；ingest 推新快照（乱序忽略）；interpAt 按 index 对怪物 dist 线性插值。
 */
export class PvpOppView {
  private prev: PvpSnap | null = null;
  private cur: PvpSnap | null = null;

  /** 吃入一份快照：prev=cur, cur=s。忽略乱序/重复（t 不新于 cur.t 的快照丢弃）。 */
  ingest(s: PvpSnap): void {
    // 乱序或重复：发送端时刻不比当前新 → 丢弃，避免破坏 prev/cur 的时序不变量。
    if (this.cur && s.t < this.cur.t) return;
    this.prev = this.cur;
    this.cur = s;
  }

  /** 取插值视图。monsters.dist 在 prev/cur 间按 index 线性插值；其余（含 fx）取 cur。 */
  interpAt(nowMs: number): PvpSnapView {
    const cur = this.cur!;
    const prev = this.prev;
    const renderTime = nowMs - INTERP_DELAY_MS;
    let monsters: PvpSnapMonster[];
    if (!prev || cur.t <= prev.t) {
      // 单快照，或时间戳未推进（cur.t<=prev.t，含乱序被 ingest 挡住后的相等时刻）：
      // 无法插值，直取 cur（逐条浅拷贝，避免桥改写污染内部缓冲）。
      monsters = cur.monsters.map((m) => ({ ...m }));
    } else {
      const span = cur.t - prev.t;
      const alpha = clamp01((renderTime - prev.t) / span);
      monsters = cur.monsters.map((m, i) => {
        const p = prev.monsters[i];
        // 按 index 对齐：prev 无对应怪（数量变少或后到）→ 取 cur 值，不外推。
        const dist = p ? lerp(p.dist, m.dist, alpha) : m.dist;
        return { ...m, dist };
      });
    }
    return { snap: cur, monsters, renderTime, nowMs };
  }
}
