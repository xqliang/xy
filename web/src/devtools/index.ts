import { DevToolsPanel, type DevToolsHost } from './panel';
import type { ApplyUserResult } from './user';

export type { ApplyUserResult, DevUserSnapshot } from './user';
export type { DevTab } from './panel';
export { allDiffs, resetAllBags, resetBag, TUNABLE_BAGS, exportLiveConfig, exportChangedConfig, exportDefaultsConfig } from './bags';
export { computeAllDps } from './dps';
export { PARAM_ZH, paramLabel } from './labels';
export { runVersusSessionAsync } from './sim-runner';

let panel: DevToolsPanel | null = null;

export function openDevTools(host: DevToolsHost, tab?: import('./panel').DevTab): void {
  if (!panel) panel = new DevToolsPanel(host);
  panel.show(tab ?? 'user');
}

export function closeDevTools(): void {
  panel?.hide();
}

export function isDevToolsOpen(): boolean {
  return !!panel?.open;
}
