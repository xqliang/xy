// PvP「暂停改退出」的纯决策逻辑（Task 9.5）：把「输入模态」与「仿真暂停」两件事拆开，供单测。
//
// 背景：真人对战时右上角按钮由「暂停」改为「退出」。点它弹出一个对局弹窗（继续/认输），
// 但**仿真照常跑**（怪照走、WS 照发），弹窗只是浮在上层、模态拦截输入的「退出确认」。
// 单人则维持旧语义：暂停=仿真同步冻结。
//
// 这里刻意把两类状态分清楚，避免以后有人「顺手」在步进门控里加 pvpExitPopup 判定又把仿真停掉：
//   - ui.paused       ：单人暂停（仿真停 + 弹窗模态）
//   - pvpExitPopup    ：PvP 退出弹窗（仅弹窗模态，仿真不停）
// 两者都会让 isPausePopupOpen()=true（指针锁进弹窗），但只有 ui.paused 会让 shouldStepSim()=false。

/** 弹窗是否开启（任一路径）：单人暂停 或 PvP 退出弹窗。供指针路由 / 绘制共用。 */
export function isPausePopupOpen(paused: boolean, pvpExitPopup: boolean): boolean {
  return paused || pvpExitPopup;
}

/** 仿真是否该步进。
 *  - tutorial：新手引导展示期间冻结（引导指向归位点等，不能边讲边打）。
 *  - settleOpen：结算动画期间冻结（定格播放星级动画）。
 *  - netDead：PvP 断线判死后冻结（定格画面 + 断线弹窗）。
 *  - paused：单人暂停冻结。
 *  注意：**不**含 pvpExitPopup——这是 T9.5 的核心，PvP 退出弹窗开着时仿真照常步进。
 */
export function shouldStepSim(opts: {
  paused: boolean;
  tutorial: boolean;
  settleOpen: boolean;
  netDead: boolean;
}): boolean {
  return !opts.paused && !opts.tutorial && !opts.settleOpen && !opts.netDead;
}

/** 退出弹窗对应的 popup context：PvP（有 WS 连接）= match（继续/认输），否则单人 = battle（继续/终止）。 */
export function pausePopupContext(hasPvpSock: boolean): 'match' | 'battle' {
  return hasPvpSock ? 'match' : 'battle';
}
