// 埋点队列：失败短重试，满则丢最旧。
import { apiFetch } from './api/client';

export type TelemetryType =
  | 'login'
  | 'game_start'
  | 'game_end'
  | 'shop_buy'
  | 'equip'
  | 'ad_click'
  | 'ad_reward'
  | 'share_click'
  | 'share_success'
  | 'share_fail'
  | 'stamina'
  | 'merit'
  | 'fragment';

interface Queued {
  type: TelemetryType;
  payload: Record<string, unknown>;
  ts: number;
}

const MAX = 80;
const queue: Queued[] = [];
let flushing = false;

export function track(type: TelemetryType, payload: Record<string, unknown> = {}): void {
  queue.push({ type, payload, ts: Date.now() });
  while (queue.length > MAX) queue.shift();
  void flushTelemetry();
}

export async function flushTelemetry(): Promise<void> {
  if (flushing || queue.length === 0) return;
  flushing = true;
  const batch = queue.splice(0, 40);
  const res = await apiFetch('/api/events', {
    method: 'POST',
    body: JSON.stringify({ events: batch }),
  });
  if (!res.ok) {
    // put back
    queue.unshift(...batch);
    while (queue.length > MAX) queue.pop();
  }
  flushing = false;
}
