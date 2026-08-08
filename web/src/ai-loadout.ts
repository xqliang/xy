// AI 对手的主动/被动技能"开局购买"：与玩家共用同一套技能池(actives.ts/passives.ts)，
// 但 AI 没有跨局功德账户——用 aiSkill(跨局强度)换算出一份"本局虚拟功德预算"，
// 用注入的 aiRng 洗牌技能池后按预算贪心购入，购到的越多/越贵，AI 越强。
// 纯逻辑：不依赖 Battle，方便单测；实际效果生效在 battle.ts 里按 id 分派（镜像玩家 applyItem）。
import { enabledActives, MAX_EQUIPPED_ACTIVES } from './actives';
import { enabledPassives, MAX_EQUIPPED_PASSIVES } from './passives';
import { AI_SKILL_MIN, AI_SKILL_MAX } from './ai-skill';

export interface AiLoadout {
  actives: string[];
  passives: string[];
}

// 虚拟预算区间：弱 AI(AI_SKILL_MIN，即自适应控制器判定"AI 太强、多次调到地板"时)
// 预算为 0——完全买不起任何技能，等同于"关闭本功能"，与旧版(无技能)行为对齐，
// 保证自适应控制器始终能把 AI 压回可被打败的强度，不会永久卷进单向增益的死锁。
// 强 AI(AI_SKILL_MAX) 预算逐步放开到能装备 1~2 个主动、若干被动。
const ACTIVE_BUDGET_MIN = 0;
const ACTIVE_BUDGET_MAX = 100;
const PASSIVE_BUDGET_MIN = 0;
const PASSIVE_BUDGET_MAX = 250;

/** aiSkill 归一化到 [0,1]（越强越接近 1） */
function skillT(aiSkill: number): number {
  const span = AI_SKILL_MAX - AI_SKILL_MIN;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(1, (aiSkill - AI_SKILL_MIN) / span));
}

/** 用注入 rng 洗牌技能池（Fisher-Yates，确定性可测），再按预算贪心购入直到超上限或买不起 */
function buyGreedy(
  pool: readonly { id: string; cost: number }[],
  budget: number,
  maxCount: number,
  rng: () => number,
): string[] {
  const order = pool.slice();
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = order[i]!;
    order[i] = order[j]!;
    order[j] = tmp;
  }
  const bought: string[] = [];
  let remain = budget;
  for (const item of order) {
    if (bought.length >= maxCount) break;
    if (item.cost <= remain) {
      bought.push(item.id);
      remain -= item.cost;
    }
  }
  return bought;
}

/**
 * 按 AI 强度虚拟购买本局装备的主动/被动技能（各自受 MAX_EQUIPPED_ACTIVES/PASSIVES 上限约束）。
 * @param aiSkill 跨局自适应强度（ai-skill.ts 的 aiSkill，取值范围 [AI_SKILL_MIN, AI_SKILL_MAX]）
 * @param rng 注入的随机源 [0,1)（战斗侧应传入独立的 aiRng，避免扰动玩家侧随机流）
 */
export function pickAiLoadout(aiSkill: number, rng: () => number): AiLoadout {
  const t = skillT(aiSkill);
  const activeBudget = ACTIVE_BUDGET_MIN + (ACTIVE_BUDGET_MAX - ACTIVE_BUDGET_MIN) * t;
  const passiveBudget = PASSIVE_BUDGET_MIN + (PASSIVE_BUDGET_MAX - PASSIVE_BUDGET_MIN) * t;
  const actives = buyGreedy(enabledActives(), activeBudget, MAX_EQUIPPED_ACTIVES, rng);
  const passives = buyGreedy(enabledPassives(), passiveBudget, MAX_EQUIPPED_PASSIVES, rng);
  return { actives, passives };
}
