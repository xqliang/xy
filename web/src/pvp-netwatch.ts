// web/src/pvp-netwatch.ts
// PvP 断线看门狗的纯判定（无副作用，便于单测）：连接已建立且距上次入站超过阈值 → 判死。
//
// 为何抽成纯函数：main.ts 里 frame() 每帧都要判一次「>10s 无入站」，阈值决策与重绘/弹窗解耦后，
// 单测可直接覆盖边界（恰 10000ms 不判死、10001ms 判死、尚未 open 不判死），不用起画布。
//
// lastInboundAt===0 表示连接尚未 open（无基线时间戳）：此时返回 false，避免刚建连被误判为断线。

/** 断线看门狗阈值（ms）：超过该时长无任意入站消息即判网络断开。 */
export const NET_DEAD_THRESHOLD_MS = 10_000;

/**
 * 判定当前是否应触发断线弹窗。
 * @param nowMs 当前墙钟 ms（Date.now()）
 * @param lastInboundAt 最近一次收到下行消息的墙钟 ms（PvpSocket.lastInboundAt；0=尚未 open）
 * @param thresholdMs 阈值 ms（默认 10000）
 * @returns true=应判死并弹「网络已断开」
 */
export function netDead(nowMs: number, lastInboundAt: number, thresholdMs = NET_DEAD_THRESHOLD_MS): boolean {
  return lastInboundAt > 0 && nowMs - lastInboundAt > thresholdMs;
}

/**
 * 判定断线判死后连接是否已恢复（入站在阈值内且已有过入站基线）→ 应清 pvpNetDead 解冻续打。
 * 与 netDead 对称：lastInboundAt===0（尚未 open）不算恢复，返回 false。
 * @param thresholdMs 阈值 ms（默认 10000，与 netDead 同）
 */
export function netRecovered(nowMs: number, lastInboundAt: number, thresholdMs = NET_DEAD_THRESHOLD_MS): boolean {
  return lastInboundAt > 0 && nowMs - lastInboundAt <= thresholdMs;
}
