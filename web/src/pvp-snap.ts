// web/src/pvp-snap.ts
// Plan C Task 4/7.5：本方半场快照序列化 + 对手渲染平滑三件套。
//
// 背景：在线 PvP 的 Model C 模型下，对手半场不再由确定性重放的 oppBattle 提供，而是由对手
// 每 100ms 经 WS 推来的「本方半场渲染态快照」重建。本文件提供三件事：
//   1. PvpSnap schema —— 本方侧渲染态的纯 JSON 序列化（字段面 = 现 bridgeOpponentFrom 的消费面）；
//   2. Battle.pvpOwnSnapshot(t) —— 读本方 private 字段构快照（方法必须挂在 Battle 上才能读 private）；
//   3. PvpOppView —— 接收端快照平滑渲染（自适应缓冲 + 断流外推 + 误差慢纠偏）+ 特效老化。
// 渲染桥 bridgeOpponentFromSnap 挂在 Battle 上（见 battle.ts），把插值后的视图映射进 battle.ai*。
//
// —— 为什么需要「渲染平滑三件套」（Task 7.5）——
// 对手 dist 是唯一连续运动量，但对手本机均匀推进的 dist 流，经网络到达接收端后已被扭曲：
//   - normalizeSnapClock 把快照时刻 t 重打成「本机接收时刻」——收发延迟的抖动会把发送端均匀的
//     100ms 步进压缩/拉长（肉眼可见的「忽快忽慢」速度抖动）。
//   - 网络抖动/突发/丢包 → 快照到达间隔忽大忽小：晚到的快照让旧的固定滞后插值在 alpha=1 处
//     冻结、下一帧又猛跳一段（「一顿一顿」的前向跳动）。
//   - 更致命：晚到的快照携带的是「对手更早时刻」的 dist（因为它是更早发出的），按接收时刻重打戳后
//     会造成一种错觉——对手怪「被拉回一段路程」。网络造成的回退/卡顿必须消除；只有真实游戏事件
//     （对手用如来神掌把自己的怪击退：dist 真实下降）才允许显示回退。
// 三件套按层次各治一端：
//   A. 自适应缓冲：插值滞后窗口不固定 120ms，而是按实测到达间隔自适应加宽（120~400ms），
//      吸收抖动突发，避免晚到快照导致冻结→猛跳。
//   B. 断流外推（dead reckoning）：渲染时刻越过最新快照时不再钳制冻结，而是按最近一对快照推出的
//      逐怪速度继续匀速前进（限速 + 限时），填平两帧之间的断流空隙、消除前向跳动。
//   C. 误差慢纠偏：维护逐怪渲染态，对「单调不减」的 dist 流做单调棘轮（只前进不回退，并以略高于
//      实时速的速率追赶目标，「走慢一点补」误差）；检测到 dist 真实下降（神掌击退）才切到
//      双向平滑跟随——从而把网络造成的回退彻底消灭，同时让真实回退平滑呈现。
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
/** 渲染滞后窗口下限(ms)：自适应缓冲的 floor。renderTime = nowMs - adaptiveDelay，delay≥此值。 */
export const INTERP_DELAY_MS = 120;

// —— Task 7.5：渲染平滑三件套参数 ——
// 取值依据（见文件头「为什么需要渲染平滑三件套」）：
// 怪物移速 = dist 为沿路格数、TUNING.monsterSpd=0.6 格/秒；骑兵 ×1.25=0.75；疾风 ×1.25；
// 故单怪真实最大移速 ≈ 0.94 格/秒。外推限速须明显高于真实速（避免正常推进被外推拖慢表现为卡顿），
// 又不能太高（避免断流时失控前冲）。
/** 外推硬限速(格/秒)：单怪外推前进速度上限（≈2.5× 真实最快怪速）。 */
const EXTRAP_HARD_CAP = 2.0;
/** 外推窄窗(ms)：仅在越过 cur.t 后此窗口内做前冲外推（dead reckoning），超过则冻结（防长断流失控）。
 *  取 ≈100ms：宽到能填补常见断流首帧、消除前向跳动，窄到 overshoot  settling 停滞可忽略。 */
const EXTRAP_WINDOW_MS = 100;
/** 外推距离上限(格)：窄窗外推绝不超出 cur.dist + 此值（ overshoot 上限 → settling 停滞 ≤ ~100ms）。 */
const EXTRAP_DIST_CAP = 0.1;
/** 自适应缓冲上限(ms)：实测到达间隔很大时缓冲加宽的上限（吸收突发）。 */
const ADAPTIVE_DELAY_MAX = 400;
/** 自适应缓冲：在 gap 估计之上加的固定余量(ms)（吸收单次抖动）。delay = clamp(gapEma+MARGIN, 120, 400)。 */
const ADAPTIVE_DELAY_MARGIN = 50;
/**
 * 自适应缓冲用「到达间隔 EWMA」(gapEma，α=0.3)而非高水位：高水位会在一次 400ms 突发后长期维持
 * ~400ms 缓冲，导致之后正常的 100ms 到达也冻结近 400ms（一顿一顿）。EWMA 对单次突发平滑、快速回落，
 * 让缓冲贴着「典型到达间隔」，稳定时 ≈ gap + 余量（100ms→150ms），既吸收抖动又不长冻结。
 */
const ADAPTIVE_GAP_ALPHA = 0.3;
/** 误差纠偏：棘轮追赶目标的「catch-up」加成（格/秒），保证低速怪也能稳步追上、不留永久滞后。 */
const CATCHUP_MIN = 0.5;
/** 误差纠偏：棘轮相对实时速的追赶倍率（>1 允许超实时速追赶，逐步吃掉累积误差）。 */
const CATCHUP_MUL = 1.25;
/** 真实回退（神掌击退）判定余量：target 低于渲染值超过此量才认定是真实下降而非网络抖动。 */
const BACKWARD_EPS = 1e-4;
/** 真实回退平滑跟随的时间常数(ms)：越小跟随越紧（≈150ms 内贴近目标，无瞬移）。 */
const BACKWARD_TC_MS = 150;
/** 单次 interpAt 的 dtRender 上限(ms)：防标签页后台恢复后巨大 dt 让棘轮疯狂追赶。 */
const MAX_DT_RENDER = 100;

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
/**
 * 武将大招专属特效（render drawHeroUlt 读 heroId/c/r/dur/tier/rge/crit/fromC/fromR/biteC/biteR）。
 * 格坐标在本方坐标系，桥内镜像到 AI 半场；ttl 由桥按出生至今递减（与玩家侧 maxTtl−age 同构）。
 */
export interface PvpSnapFxUlt {
  kind: 'ult';
  t: number; // 出生时刻(ms)
  heroId: string;
  c: number; r: number;        // 爆心（待桥内镜像）
  dur: number;                 // 秒（= maxTtl，光束/爆发时长）
  tier: number;
  rge: number;
  crit: boolean;
  fromC?: number; fromR?: number;   // 施法起点（待镜像；大圣飞棒/二郎·牛郎射线）
  biteC?: number; biteR?: number;   // 二郎咬点（待镜像）
  biteMid?: number;                 // 被咬怪物 id（不镜像；桥内判存活）
}
/**
 * 二郎神哮天犬 lingering 跟随特效：固定咬点格 + 3s（独立于大招光束时长）。
 * render 读 mid/c/r/ttl/maxTtl/tier/ang；格坐标待桥内镜像，ang 待桥内 +π（180° 旋转翻转向量角）。
 */
export interface PvpSnapFxDog {
  kind: 'dog';
  t: number; // 出生时刻(ms)
  mid: number;      // 被咬怪物 id（桥内查对手怪判存活）
  dur: number;      // 秒（= maxTtl，3s）
  c: number; r: number;   // 咬点格（待镜像）
  tier: number;
  ang: number;      // 光束角（待桥内 +π）
}
export type PvpSnapFx = PvpSnapFxSkill | PvpSnapFxPalm | PvpSnapFxFlash | PvpSnapFxUlt | PvpSnapFxDog;

/** 本方半场渲染态快照（纯 JSON，字段面 = bridgeOpponentFrom 消费面）。 */
export interface PvpSnap {
  t: number; // 发送端序列化时刻(ms)：插值时基 + 特效老化时基
  /**
   * 发送端本机测得的应用层 RTT(ms)（T9.4）：由发送端 pvpSock.rttMs 写入，随快照透传给接收端。
   * 接收端据此在 HUD 境界右侧显示「对手延迟」。首个 pong 前发送端 rttMs=null → 透传 null，
   * 接收端读到 null 显示 "--"。非连接态字段，故 optional（旧快照/测试手搓快照可省，桥不消费它）。
   */
  rtt?: number | null;
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
 * flash 为被动短闪 → 0.7s；ult 为武将大招光束 dur∈{0.6..0.9}s → 1.5s；dog 为二郎 lingering 3s → 3.2s。
 * 均为瞬态视觉，略宽松无害。
 */
const FX_LIFE_MS: Record<PvpSnapFx['kind'], number> = {
  skill: 1500,
  palm: 1300,
  flash: 700,
  ult: 1500,
  dog: 3200,
};

/** 瞬态特效是否仍存活：按发送端时刻 t 老化（nowMs - t < 该 kind 寿命）。 */
export function fxAlive(fx: PvpSnapFx, nowMs: number): boolean {
  return nowMs - fx.t < FX_LIFE_MS[fx.kind];
}

/**
 * 把一份刚收到的对手快照的「发送端时钟」归一化到「本机时钟」（in-place，返回同一引用）。
 *
 * 背景：PvpSnap.t 与各 fx.t 原是发送端（对手本机）Date.now() 戳；而接收端 PvpOppView.interpAt
 * 用本机 Date.now() 作 nowMs 与 snap.t 比较、按 (nowMs - fx.t) 老化特效——跨机物理时钟不可混用
 * （两端设备钟差会让插值 alpha 乱跳、特效早夭或永存）。故收到快照的瞬间，按「收发时刻差 d」
 * 把 t 与各 fx.t 整体平移到本机时基，使插值/老化与本机 nowMs 同源、单调。
 *
 * 纯函数语义：原地改写入参 s（收到即归一，无需保留原始发送端戳），返回 s 便于链式调用。
 * recvMs 取本机 Date.now()（消息到达时刻）；d 单调为正（收发总有延迟），平移后时序不变量保持。
 */
export function normalizeSnapClock(s: PvpSnap, recvMs: number): PvpSnap {
  const d = recvMs - s.t; // 本机接收时刻 − 发送端序列化时刻（收发延迟估计，单调为正）
  s.t = recvMs;
  for (const fx of s.fx) fx.t += d; // 瞬态特效时刻同步平移，老化时基一致
  return s;
}

// —— 平滑渲染视图：双缓冲 + 自适应缓冲 + 断流外推 + 误差慢纠偏 ——
/**
 * 平滑渲染后的快照视图（供桥 bridgeOpponentFromSnap 消费）。
 * - snap：当前快照 cur（非怪物字段的权威源）；
 * - monsters：怪物数组，dist 经「自适应缓冲插值 + 断流外推 + 误差棘轮」平滑后的渲染值，其余字段取 cur；
 * - renderTime：渲染时刻 = nowMs - adaptiveDelay（插值/外推的时基；delay 随到达抖动自适应）；
 * - nowMs：传入的当前时刻（特效老化用真实时间，与 renderTime 解耦）。
 */
export interface PvpSnapView {
  snap: PvpSnap;
  monsters: PvpSnapMonster[];
  renderTime: number;
  nowMs: number;
}

/**
 * 逐怪渲染态（误差慢纠偏的内部棘轮缓冲）。按【怪物 id】键控（Map 键，见 interpAt）：
 * 成员变化（死亡/新生）绝不串位——死怪 id 被 prune、新怪 id 惰性初始化。
 * - renderDist：当前渲染 dist（棘轮只前进，除非判定真实回退）；
 * - renderVel：本段外推用的逐怪速度(格/ms)，= 最近一对快照推出的逐怪速度（限速后）；棘轮公式也复用它。
 */
interface RenderState {
  renderDist: number;
  renderVel: number;
}

/**
 * 对手半场快照平滑渲染视图（Task 7.5 三件套）。
 * 维护 prev/cur 两份快照；ingest 推新快照（乱序忽略）；interpAt 做平滑渲染。
 *
 * 内部状态（局内可变，每局新建一份，无需显式 reset）：
 * - 自适应缓冲：gapEma（到达间隔 EWMA）、interpDelayMs（当前缓冲，随 ingest 更新）；
 * - 逐怪棘轮：render[].renderDist/renderVel（见 RenderState）；
 * - dtRender：lastInterpAtMs（相邻 interpAt 间隔，钳到 [0, MAX_DT_RENDER]）。
 */
export class PvpOppView {
  private prev: PvpSnap | null = null;
  private cur: PvpSnap | null = null;
  private ingested = 0; // 累计被 ingest 接受的快照份数（乱序/重复丢弃的不计）；供上层探针观测「是否在收快照」
  private lastArrivalMs: number | null = null; // 上一份被接受快照的归一化到达时刻(cur.t)；算到达间隔
  private gapEma = INTERP_DELAY_MS; // 到达间隔 EWMA(ms)：自适应缓冲的输入（单次突发平滑、快速回落）
  private interpDelayMs = INTERP_DELAY_MS; // 当前自适应缓冲(ms)∈[INTERP_DELAY_MS, ADAPTIVE_DELAY_MAX]
  private render = new Map<number, RenderState>(); // 逐怪棘轮渲染态，按【怪物 id】键控（见 interpAt 注释）
  private lastInterpAtMs: number | null = null; // 上次 interpAt 的 nowMs（算 dtRender）
  private velEst = 0; // 实时速 EWMA(格/ms)：平滑瞬时尖峰；外推限速用它 → 外推不 overshoot 确认数据
  /** 已 ingest 接受的快照份数（0=尚未收到任何对手快照）。供探针/日志观测连接健康度。 */
  get count(): number {
    return this.ingested;
  }

  /** 是否已有至少一份快照可渲染（cur 非空）。interpAt 内部对 cur 非空断言，调用前须先判此。 */
  get hasSnap(): boolean {
    return this.cur !== null;
  }

  /** 当前快照(cur)的归一化时刻 t（本机时基）；无快照返回 null。供探针暴露最新快照时间。 */
  get latestT(): number | null {
    return this.cur ? this.cur.t : null;
  }

  /** 当前快照(cur)携带的本方场上单位数；无快照返回 0。供探针观测「对手是否放了单位」。 */
  get latestUnits(): number {
    return this.cur ? this.cur.units.length : 0;
  }

  /**
   * 当前快照(cur)携带的发送端 RTT(ms)（T9.4）：对手本机测得的延迟，随快照透传过来。
   * 无快照或对手首个 pong 前（快照里 rtt 为 null/缺失）→ 返回 null，HUD 显示 "--"。
   * 供 drawHud 在境界右侧画「对 Nms」。注意：这是【对手】的延迟，不是本侧 pvpSock.rttMs。
   */
  get latestRtt(): number | null {
    return this.cur ? (this.cur.rtt ?? null) : null;
  }

  /** 自适应缓冲(ms)：当前插值滞后窗口，随到达抖动在 [INTERP_DELAY_MS, ADAPTIVE_DELAY_MAX] 间自适应。 */
  get adaptiveDelay(): number {
    return this.interpDelayMs;
  }

  /**
   * 自适应缓冲：clamp(gapEma + ADAPTIVE_DELAY_MARGIN, INTERP_DELAY_MS, ADAPTIVE_DELAY_MAX)。
   * gapEma 是到达间隔 EWMA（单次突发平滑、快速回落），加固定余量吸收抖动。
   * 稳定 100ms 到达 → gapEma≈100 → 150ms（接近旧 120 手感）；300ms 持续到达 → gapEma≈300 → 350ms；
   * 单次 400ms 突发 → gapEma 短暂抬升后回落（不像高水位长期维持 400ms 导致后续长冻结）。
   */
  private recomputeDelay(): void {
    this.interpDelayMs = Math.max(
      INTERP_DELAY_MS,
      Math.min(ADAPTIVE_DELAY_MAX, this.gapEma + ADAPTIVE_DELAY_MARGIN),
    );
  }

  /** 吃入一份快照：prev=cur, cur=s。忽略乱序/重复（t 不新于 cur.t 的快照丢弃）。 */
  ingest(s: PvpSnap): void {
    // 乱序或重复：发送端时刻不比当前新 → 丢弃，避免破坏 prev/cur 的时序不变量。
    if (this.cur && s.t < this.cur.t) return;
    // 自适应缓冲：用本机归一化到达时刻(s.t)算到达间隔（recv 抖动已含在 s.t 内，正是要吸收的抖动源）。
    if (this.lastArrivalMs !== null) {
      const gap = Math.max(0, s.t - this.lastArrivalMs);
      // gapEma：到达间隔 EWMA（α=0.3），单次突发平滑、快速回落，缓冲贴着「典型到达间隔」。
      this.gapEma = this.gapEma * (1 - ADAPTIVE_GAP_ALPHA) + gap * ADAPTIVE_GAP_ALPHA;
      this.recomputeDelay();
    }
    this.lastArrivalMs = s.t;
    this.ingested++;
    this.prev = this.cur;
    this.cur = s;
    // 实时速 EWMA：用本段（prev→cur）各怪速度的均值更新 velEst（α=0.5，较快收敛到真实速），
    // 平滑突发压缩（50ms 内两帧）造成的瞬时尖峰。外推限速用 velEst 而非瞬时值：突发会瞬时抬高
    // measured 速度，若用它外推会 overshoot 确认数据 → 新段目标低于渲染值 → 网络性回退 dip。
    if (this.prev && this.cur.t > this.prev.t) {
      const span = this.cur.t - this.prev.t;
      // 按怪 id 配对取段速：成员变化（死亡致数组左移/新怪进场）下按 index 配对会把
      // 死怪的大 dist 与幸存怪错配出负速度，污染 velEst（外推限速被压低 → 整组后移感）。
      const prevById = new Map(this.prev.monsters.map((m) => [m.id, m] as const));
      let sum = 0;
      let cnt = 0;
      for (const m of this.cur.monsters) {
        const p = prevById.get(m.id);
        if (!p) continue;
        sum += (m.dist - p.dist) / span;
        cnt++;
      }
      if (cnt > 0) this.velEst = this.velEst * 0.5 + (sum / cnt) * 0.5;
    }
  }

  /** 取平滑渲染视图：monsters.dist 经自适应缓冲插值 + 断流外推 + 误差棘轮，其余（含 fx）取 cur。
   *  怪物全链路按【monster.id】配对（prev↔cur 插值对、棘轮渲染态 Map）：cur 的成员列表是权威——
   *  死怪（cur 中消失的 id）立即不渲染（不残留）；新怪（cur 新增 id）无前值则从 cur.dist 起步；
   *  幸存怪只在【同一只怪】的 prev/cur dist 间插值。曾按 index 配对：对手杀掉队首怪后数组左移，
   *  每个索引都错配（index0 = 死怪大 dist ↔ 幸存怪小 dist → 误判真实回退平滑倒退 = 用户实测
   *  「杀一只怪整组后移」+ 棘轮态串位残留），id 配对从根上消除成员变化造成的错位。 */
  interpAt(nowMs: number): PvpSnapView {
    const cur = this.cur!;
    const prev = this.prev;
    const delay = this.interpDelayMs;
    const renderTime = nowMs - delay;

    // dtRender：相邻 interpAt 间隔（钳到 [0, MAX_DT_RENDER]），供棘轮推进；首帧/倒退 nowMs → 0（保持）。
    let dt = 0;
    if (this.lastInterpAtMs !== null && nowMs >= this.lastInterpAtMs) {
      dt = Math.min(MAX_DT_RENDER, nowMs - this.lastInterpAtMs);
    }
    this.lastInterpAtMs = nowMs;

    const n = cur.monsters.length;
    const prevById = prev ? new Map(prev.monsters.map((m) => [m.id, m] as const)) : null;

    let monsters: PvpSnapMonster[];
    if (!prev || cur.t <= prev.t) {
      // 单快照或时间戳未推进：目标=cur.dist，不外推（span=0 无速度）。逐怪初始化棘轮并贴近目标。
      monsters = new Array(n);
      for (let i = 0; i < n; i++) {
        const m = cur.monsters[i]!;
        const target = m.dist;
        const r = this.render.get(m.id);
        if (!r) this.render.set(m.id, { renderDist: target, renderVel: 0 });
        else r.renderDist = this.advance(r.renderDist, target, 0, dt, false);
        monsters[i] = { ...m, dist: this.render.get(m.id)!.renderDist };
      }
    } else {
      const span = cur.t - prev.t; // >0（已排除 cur.t<=prev.t）
      // beyondMs：renderTime 越过 cur.t 的量(ms)；≤0 表示渲染时刻未超过最新快照（正常插值/冷启动 hold）。
      const beyondMs = renderTime - cur.t;
      // 外推限速(格/ms)：实时速 EWMA(velEst) 与硬上限取小。
      // 用 velEst（平滑突发压缩的瞬时尖峰）：突发（50ms 内两帧）会瞬时抬高 measured 速度，若用它外推
      // 会 overshoot 确认数据 → 新段目标低于渲染值 → 网络性回退 dip。velEst 贴近平稳真实速，外推不 overshoot。
      const extrapCap = Math.min(this.velEst, EXTRAP_HARD_CAP / 1000);
      const monstersArr: PvpSnapMonster[] = new Array(n);
      for (let i = 0; i < n; i++) {
        const m = cur.monsters[i]!;
        const p = prevById!.get(m.id);
        let target: number;
        let vel: number; // 本段实时速(格/ms)：可负（真实回退），棘轮据此区分回退/前进
        let realBackward = false; // 真实回退（dist 真实下降）→ 平滑跟随；否则单调棘轮
        if (!p) {
          // 新进场怪（cur 新增 id，无前值）：目标=cur.dist，不外推（无前值定速度）。
          target = m.dist;
          vel = 0;
        } else {
          const realtimeV = (m.dist - p.dist) / span; // 本段诚实实时速（同 id 配对，成员变化不再污染）
          realBackward = realtimeV < -1e-9; // dist 真实下降 → 真实回退（如来神掌击退）
          if (realBackward) {
            // 真实回退：目标=最后已知 dist，平滑跟随下降（不臆测未来后退幅度）。
            target = m.dist;
            vel = realtimeV;
          } else if (beyondMs <= 0) {
            // 渲染时刻未超过 cur.t：在 [prev.t, cur.t] 内线性插值（renderTime<prev.t 时钳到 0 → hold 在 prev）。
            const lagRatio = (renderTime - prev.t) / span;
            target = lerp(p.dist, m.dist, clamp01(lagRatio));
            vel = realtimeV;
          } else if (beyondMs <= EXTRAP_WINDOW_MS) {
            // 窄窗外推（dead reckoning）：仅在越过 cur.t 后一个短窗口内按实时速前冲，填补断流首帧。
            // 限速 extrapCap + 距离上限 EXTRAP_DIST_CAP（overshoot ≤ 此值 → settling 停滞 ≤ ~100ms）。
            vel = Math.min(realtimeV, extrapCap);
            const extrapDist = Math.min(vel * beyondMs, EXTRAP_DIST_CAP);
            target = m.dist + extrapDist;
          } else {
            // 超窗外推冻结：越过窄窗后不再前冲（避免长断流失控），钳到 cur.dist + EXTRAP_DIST_CAP。
            vel = realtimeV;
            target = m.dist + EXTRAP_DIST_CAP;
          }
        }
        // 误差棘轮：从逐怪渲染态（按 id）向 target 平滑推进（单调棘轮 / 真实回退跟随）。
        const r = this.render.get(m.id);
        if (!r) {
          this.render.set(m.id, { renderDist: target, renderVel: vel });
        } else {
          r.renderVel = vel;
          r.renderDist = this.advance(r.renderDist, target, vel, dt, realBackward);
        }
        monstersArr[i] = { ...m, dist: this.render.get(m.id)!.renderDist };
      }
      monsters = monstersArr;
    }
    // cur 成员权威：清掉已死怪的棘轮态（cur 中消失的 id 不再渲染，也不留陈旧状态）。
    const aliveIds = new Set(cur.monsters.map((m) => m.id));
    for (const id of this.render.keys()) {
      if (!aliveIds.has(id)) this.render.delete(id);
    }
    return { snap: cur, monsters, renderTime, nowMs };
  }

  /**
   * 误差慢纠偏：把当前渲染值 curRender 向 target 推进 dt(ms)。
   * - realBackward（dist 真实下降，如来神掌击退）：双向平滑跟随（时间常数 BACKWARD_TC_MS 的
   *   指数趋近），允许下降但无瞬移——这是唯一允许渲染倒退的情形。
   * - 否则（单调不减流，含网络抖动/外推 overshoot  settling）：单调棘轮——只前进不回退。
   *   target ≥ curRender 时以 max(实时速×CATCHUP_MUL, CATCHUP_MIN/秒) 的速率追赶（逐步吃误差）；
   *   target < curRender 时（外推 overshoot  settling）→ 保持不回退（外推 overshoot 会随时间被
   *   真实目标追平，绝不用一次后退修正，避免网络造成回退的错觉）。
   * vel 为「实时速」(格/ms，可负)；dt 已钳到 [0, MAX_DT_RENDER]。
   */
  private advance(
    curRender: number,
    target: number,
    vel: number,
    dt: number,
    realBackward: boolean,
  ): number {
    if (realBackward) {
      // 真实回退：指数趋近 target（dt 越大贴得越紧，单步 ≤ MAX_DT_RENDER 防瞬移感）。
      const k = 1 - Math.exp(-dt / BACKWARD_TC_MS);
      return curRender + (target - curRender) * k;
    }
    // 单调棘轮：实时速(格/ms) 取非负（外推段 vel 已非负；插值段 realtimeV 非负）。
    const rate = Math.max(vel * CATCHUP_MUL, CATCHUP_MIN / 1000); // 格/ms
    const step = rate * dt;
    if (target >= curRender) return Math.min(target, curRender + step); // 前进追赶，绝不超目标
    return curRender; // target<curRender（外推 overshoot settling）→ 保持，不回退
  }
}
