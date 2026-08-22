// 对局历史（持久化）：记录玩家是否「玩过一局单人关卡」。
// 用途——Task 10 首局体验之 PvP 入口门槛：
//   「真人对战 / 邀请好友」两个菜单按钮，需玩家先至少完成一局单人关卡（到达 won/lost 终局）才解锁。
//   未解锁时点击只飘字提示，不进入匹配——避免首次玩家直接进 PvP 一脸懵。
// 存储形态与 clear-count.ts 完全一致：localStorage 字符串键（微信端经 storage.ts 同构到 wx storage，Web 端零行为变化）。
import { storeGet, storeSet } from './storage';

const KEY = 'dasheng.playedOnce';

/** 是否已至少完成一局单人关卡（到达 won/lost 终局） */
export function hasFinishedGame(): boolean {
  return storeGet(KEY) === '1';
}

/**
 * PvP 入口是否解锁（纯谓词，便于单测门槛决策、与「如何读取标记」解耦）。
 * 当前判据 = 已玩过一局单人关卡；未来若要叠加其它条件（如段位门槛），只改这一处。
 */
export function pvpUnlocked(): boolean {
  return hasFinishedGame();
}

/**
 * 标记「已玩过一局」。幂等：重复调用只写一次，无副作用。
 * 由 main.ts 在单人战斗到达终局（won/lost）的结算块调用——该块已用 `&& !pvpSock` 排除 PvP，
 * 故 PvP 终局不会污染此标记（PvP 不算「熟悉单人玩法」）。
 */
export function markGameFinished(): void {
  if (!hasFinishedGame()) storeSet(KEY, '1');
}

/** 测试 / DevTools 重置用：清掉「已玩过」标记，回到首次玩家状态 */
export function resetFinishedGame(): void {
  storeSet(KEY, '0');
}
