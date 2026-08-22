// PvP 终局结算（纯逻辑）：把服务端裁决的结局映射成「段位变化 + 功德增量」。
// 与单人对战的差别（见需求确认）：
//   1) 段位仍用 recordWin/recordLose，但**冻结单人 AI 难度系数**——PvP 胜负不污染单人对战平衡；
//   2) 平局(draw)不动段位（rankChange=null），功德给「参与档」；
//   3) 功德沿用单人 meritReward(是否胜, 波数)：胜=20+波×2，负/平=5+波×2（上限在 addMerit 处封顶）。
// 本模块无 DOM/画布依赖、可纯单测；落地（写功德、更新 rank、弹商人、云同步）由 main.ts 负责。
import { recordWin, recordLose, type RankChange, type RankState } from './rank';
import { meritReward } from './merit';

export type PvpOutcome = 'win' | 'lose' | 'draw';

export interface PvpSettleOutcome {
  rankChange: RankChange | null; // 平局为 null（不加减星、不动段位）
  meritGain: number;             // 本局应得功德（未封顶；封顶在 addMerit 内做）
}

// outcome：服务端 result.outcome；rank：结算前段位态；wave：本局抵达波数（进度近似）。
export function pvpSettle(outcome: PvpOutcome, rank: RankState, wave: number): PvpSettleOutcome {
  const meritGain = meritReward(outcome === 'win', wave);
  let rankChange: RankChange | null = null;
  if (outcome === 'win') rankChange = recordWin(rank, { freezeDifficulty: true });
  else if (outcome === 'lose') rankChange = recordLose(rank, { freezeDifficulty: true });
  return { rankChange, meritGain };
}
