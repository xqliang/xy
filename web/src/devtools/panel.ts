import { formatDiffValue } from './clone';
import {
  TUNABLE_BAGS,
  TUNING_ATTACK_KEYS,
  TUNING_MONSTER_KEYS,
  TUNING_SYSTEM_KEYS,
  allDiffs,
  exportChangedConfig,
  exportDefaultsConfig,
  exportLiveConfig,
  resetAllBags,
  resetBag,
  type TunableBagId,
} from './bags';
import {
  computeActiveDps,
  computeHeroDps,
  computeUnitDps,
  computeWeaponDps,
  normalizeDpsByKind,
  type DpsKind,
  type DpsRow,
} from './dps';
import {
  applyUserSnapshot,
  fillUserTestLoadout,
  readUserSnapshot,
  resetUserProgress,
  type ApplyUserResult,
} from './user';
import { paramLabel, paramZh } from './labels';
import { TUNING, type SkillFxKind } from '../battle';
import { ECONOMY } from '@core';
import { BOARD_POWER } from '../board-power';
import { PLACE_TIMING, PEACH_TREE } from '../battle';
import { AI_TIMING } from '../autoplace';
import { GENERAL_TUNING, GENERALS } from '../generals';
import { WEAPON_TUNING, WEAPONS, weaponBonusLabel } from '../weapons';
import { ACTIVE_SKILLS } from '../actives';
import { PASSIVE_SKILLS } from '../passives';
import { UNITS } from '@core';
import type { UnitType } from '@core';
import { LADDER_LEN, STARS_PER_TIER } from '../rank';
import { STAMINA_MAX } from '../stamina';
import { MERIT_MAX } from '../merit';
import { playDevFxPreview, type DevFxPreviewSpec } from '../render';
import {
  AI_TARGET_WINRATE,
  DEFAULT_AI_SKILL,
  runVersusSessionAsync,
  type SimProgress,
} from './sim-runner';
import {
  drawAiSkillSeries,
  drawOutcomeChart,
  drawWaveHistogram,
  drawWinRateSeries,
  summarizeProgress,
  summarizeReport,
} from './sim-charts';
import type { VersusSessionReport } from '../versus-user-agent';
import { formatVersusSessionReport } from '../versus-user-agent';

export type DevTab =
  | 'user'
  | 'preview'
  | 'attack'
  | 'monster'
  | 'system'
  | 'dps'
  | 'sim'
  | 'diff';

export interface DevToolsHost {
  onUserApplied: (result: ApplyUserResult) => void;
  onClose?: () => void;
}

const STYLE_ID = 'xy-devtools-style';
const ROOT_ID = 'xy-devtools-root';

const TABS: { id: DevTab; label: string }[] = [
  { id: 'user', label: '用户' },
  { id: 'preview', label: '预览' },
  { id: 'attack', label: '攻击' },
  { id: 'monster', label: '怪物' },
  { id: 'system', label: '系统' },
  { id: 'dps', label: '输出对比' },
  { id: 'sim', label: '胜率模拟' },
  { id: 'diff', label: 'Diff' },
];

function ensureStyle(): void {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = `
#${ROOT_ID} {
  position: fixed; inset: 0; z-index: 99999;
  display: flex; align-items: stretch; justify-content: center;
  background: rgba(20, 14, 8, 0.55);
  font-family: "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif;
  color: #2a2218;
  touch-action: auto;
  -webkit-user-select: text;
  user-select: text;
}
#${ROOT_ID} * { box-sizing: border-box; }
#${ROOT_ID} .xy-dt-panel {
  margin: 12px; width: min(960px, 100% - 24px); max-height: calc(100% - 24px);
  background: linear-gradient(180deg, #f6ecd7 0%, #e8d4b0 100%);
  border: 2px solid #8a6a3a; border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.35);
  display: flex; flex-direction: column; overflow: hidden;
}
#${ROOT_ID} .xy-dt-head {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; border-bottom: 1px solid #c9b083;
  background: rgba(255,255,255,0.35);
}
#${ROOT_ID} .xy-dt-head h1 {
  margin: 0; font-size: 16px; font-weight: 700; flex: 1;
}
#${ROOT_ID} .xy-dt-tabs {
  display: flex; flex-wrap: wrap; gap: 6px;
  padding: 8px 12px; border-bottom: 1px solid #c9b083;
  background: rgba(255,255,255,0.2);
}
#${ROOT_ID} .xy-dt-tab {
  border: 1px solid #a8844a; background: #f3e6c8; color: #3a2e1c;
  border-radius: 999px; padding: 4px 12px; font-size: 12px; cursor: pointer;
}
#${ROOT_ID} .xy-dt-tab.active {
  background: #6b4a22; color: #f8efd8; border-color: #6b4a22;
}
#${ROOT_ID} .xy-dt-body {
  flex: 1; overflow: auto; padding: 12px 14px 18px;
}
#${ROOT_ID} .xy-dt-btn {
  border: 1px solid #8a6a3a; background: #dfc48a; color: #2a2218;
  border-radius: 8px; padding: 6px 10px; font-size: 12px; cursor: pointer;
}
#${ROOT_ID} .xy-dt-btn.danger { background: #e8b0a0; }
#${ROOT_ID} .xy-dt-btn.primary { background: #6b4a22; color: #f8efd8; border-color: #6b4a22; }
#${ROOT_ID} .xy-dt-row {
  display: grid;
  grid-template-columns: 9.5rem 7.5rem 4.5rem;
  gap: 10px;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px dashed rgba(138,106,58,0.25);
}
#${ROOT_ID} .xy-dt-row label {
  font-size: 12px; line-height: 1.35; word-break: break-all;
}
#${ROOT_ID} .xy-dt-row label .xy-dt-key {
  display: block; font-size: 10px; color: #7a6848; font-family: ui-monospace, Menlo, monospace;
}
#${ROOT_ID} .xy-dt-row input[type="number"],
#${ROOT_ID} .xy-dt-row input[type="text"],
#${ROOT_ID} .xy-dt-row select {
  width: 100%; box-sizing: border-box;
  padding: 4px 6px; border: 1px solid #b8945c; border-radius: 6px;
  background: #fffaf0; font-size: 12px;
}
#${ROOT_ID} .xy-dt-row .xy-dt-muted {
  font-size: 11px; color: #6a5a40; opacity: 1; white-space: nowrap;
}
#${ROOT_ID} .xy-dt-section {
  margin: 12px 0 8px; font-size: 13px; font-weight: 700; color: #5a4020;
}
#${ROOT_ID} .xy-dt-hint { font-size: 11px; color: #6a5a40; margin: 0 0 8px; }
#${ROOT_ID} .xy-dt-card {
  background: rgba(255,255,255,0.4); border: 1px solid #d2bc8e;
  border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; font-size: 12px;
}
#${ROOT_ID} .xy-dt-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 12px; align-items: center; }
#${ROOT_ID} .xy-dt-chart {
  width: 100%; height: 320px; background: #fffaf0;
  border: 1px solid #d2bc8e; border-radius: 8px;
}
#${ROOT_ID} .xy-dt-fx-canvas {
  width: 100%; height: 280px; background: #1a1510;
  border: 1px solid #d2bc8e; border-radius: 8px; display: block;
  position: sticky; top: 0; z-index: 5;
  box-shadow: 0 6px 14px rgba(0,0,0,0.35);
}
@media (max-width: 700px) {
  #${ROOT_ID} .xy-dt-fx-canvas { height: 200px; }
}
#${ROOT_ID} .xy-dt-sim-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 8px;
}
@media (max-width: 700px) {
  #${ROOT_ID} .xy-dt-sim-grid { grid-template-columns: 1fr; }
}
#${ROOT_ID} .xy-dt-sim-canvas {
  width: 100%; height: 200px; background: #fffaf0;
  border: 1px solid #d2bc8e; border-radius: 8px; display: block;
}
#${ROOT_ID} .xy-dt-sim-status {
  font-size: 12px; padding: 8px 10px; background: rgba(255,255,255,0.45);
  border: 1px solid #d2bc8e; border-radius: 8px; margin: 8px 0;
}
#${ROOT_ID} .xy-dt-progress {
  height: 8px; background: #e0d0b0; border-radius: 999px; overflow: hidden; margin: 6px 0 10px;
}
#${ROOT_ID} .xy-dt-progress > i {
  display: block; height: 100%; background: #6b4a22; width: 0%;
}
#${ROOT_ID} .xy-dt-diff {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; white-space: pre-wrap; background: #1e1e1e; color: #d4d4d4;
  border: 1px solid #d2bc8e; border-radius: 8px; padding: 8px; overflow: auto;
  max-height: 480px; line-height: 1.45;
}
#${ROOT_ID} .xy-dt-diff .del { color: #ff8a8a; background: rgba(255,80,80,0.12); display: block; }
#${ROOT_ID} .xy-dt-diff .add { color: #8dff9a; background: rgba(80,200,100,0.12); display: block; }
#${ROOT_ID} .xy-dt-diff .meta { color: #9cdcfe; }
#${ROOT_ID} .xy-dt-diff .path { color: #ce9178; }
#${ROOT_ID} .xy-dt-diff .hunk { margin: 8px 0 4px; color: #c586c0; font-weight: 700; }
#${ROOT_ID} .xy-dt-check {
  display: inline-flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer;
}
#${ROOT_ID} .xy-dt-muted { opacity: 0.55; font-size: 11px; }
#${ROOT_ID} .xy-dt-grid2 {
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
}
@media (max-width: 700px) {
  #${ROOT_ID} .xy-dt-grid2 { grid-template-columns: 1fr; }
  #${ROOT_ID} .xy-dt-row {
    grid-template-columns: 6.5rem minmax(5.5rem, 1fr) 3.5rem;
  }
}
`;
}

function numInput(value: number, onChange: (n: number) => void, step = 'any'): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.step = step;
  input.value = String(value);
  input.addEventListener('change', () => {
    const n = Number(input.value);
    if (!Number.isFinite(n)) {
      input.value = String(value);
      return;
    }
    onChange(n);
  });
  return input;
}

function fieldRow(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'xy-dt-row';
  const lab = document.createElement('label');
  const zh = paramZh(label);
  if (zh) {
    lab.appendChild(document.createTextNode(zh));
    const key = document.createElement('span');
    key.className = 'xy-dt-key';
    key.textContent = label;
    lab.appendChild(key);
  } else {
    lab.textContent = paramLabel(label);
  }
  row.appendChild(lab);
  row.appendChild(control);
  const right = document.createElement('span');
  right.className = 'xy-dt-muted';
  right.textContent = hint ?? '';
  row.appendChild(right);
  return row;
}

function objectFields(
  obj: Record<string, unknown>,
  filter?: (key: string) => boolean,
  onEdited?: () => void,
): HTMLElement {
  const wrap = document.createElement('div');
  const keys = Object.keys(obj).filter((k) => (filter ? filter(k) : true));
  keys.sort();
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === 'number') {
      wrap.appendChild(fieldRow(key, numInput(val, (n) => {
        obj[key] = n;
        onEdited?.();
      }), String(val)));
    } else if (typeof val === 'boolean') {
      const sel = document.createElement('select');
      sel.innerHTML = `<option value="true">true</option><option value="false">false</option>`;
      sel.value = val ? 'true' : 'false';
      sel.addEventListener('change', () => {
        obj[key] = sel.value === 'true';
        onEdited?.();
      });
      wrap.appendChild(fieldRow(key, sel));
    } else if (typeof val === 'string') {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = val;
      input.addEventListener('change', () => {
        obj[key] = input.value;
        onEdited?.();
      });
      wrap.appendChild(fieldRow(key, input));
    }
  }
  return wrap;
}

function section(title: string): HTMLElement {
  const h = document.createElement('div');
  h.className = 'xy-dt-section';
  h.textContent = title;
  return h;
}

function btn(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `xy-dt-btn${cls ? ` ${cls}` : ''}`;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

export class DevToolsPanel {
  private root: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private tab: DevTab = 'user';
  private host: DevToolsHost;
  private dpsFilter: DpsKind | 'all' = 'hero';
  private heroTier = 5;
  private unitTier = 5;
  private fxStop: (() => void) | null = null;
  private fxCanvas: HTMLCanvasElement | null = null;
  private diffMode: 'git' | 'json-full' | 'json-changed' = 'git';
  private diffOnlyChanged = true;
  private simGames = 20;
  private simSeed = 42000;
  private simAiSkill = DEFAULT_AI_SKILL;
  private simWaveCap = 0;
  private simPersist = false;
  private simRunning = false;
  private simAbort: AbortController | null = null;
  private simProgress: SimProgress | null = null;
  private simReport: VersusSessionReport | null = null;
  private simStatusEl: HTMLElement | null = null;
  private simProgressBar: HTMLElement | null = null;
  private simOutcomeCanvas: HTMLCanvasElement | null = null;
  private simWinRateCanvas: HTMLCanvasElement | null = null;
  private simWaveCanvas: HTMLCanvasElement | null = null;
  private simSkillCanvas: HTMLCanvasElement | null = null;
  private simLogEl: HTMLElement | null = null;

  constructor(host: DevToolsHost) {
    this.host = host;
  }

  get open(): boolean {
    return !!this.root;
  }

  show(tab: DevTab = 'user'): void {
    ensureStyle();
    this.tab = tab;
    if (this.root) {
      this.renderBody();
      return;
    }
    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.addEventListener('pointerdown', (e) => e.stopPropagation());
    root.addEventListener('click', (e) => {
      if (e.target === root) this.hide();
    });

    const panel = document.createElement('div');
    panel.className = 'xy-dt-panel';

    const head = document.createElement('div');
    head.className = 'xy-dt-head';
    const title = document.createElement('h1');
    title.textContent = 'DevTools · 参数调试';
    head.appendChild(title);
    head.appendChild(btn('重置全部数值', () => {
      resetAllBags();
      this.renderBody();
    }, 'danger'));
    head.appendChild(btn('关闭', () => this.hide()));
    panel.appendChild(head);

    const tabs = document.createElement('div');
    tabs.className = 'xy-dt-tabs';
    for (const t of TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'xy-dt-tab' + (t.id === this.tab ? ' active' : '');
      b.textContent = t.label;
      b.dataset.tab = t.id;
      b.addEventListener('click', () => {
        this.tab = t.id;
        for (const el of tabs.querySelectorAll('.xy-dt-tab')) {
          el.classList.toggle('active', (el as HTMLElement).dataset.tab === this.tab);
        }
        this.renderBody();
      });
      tabs.appendChild(b);
    }
    panel.appendChild(tabs);

    const body = document.createElement('div');
    body.className = 'xy-dt-body';
    panel.appendChild(body);
    root.appendChild(panel);
    document.body.appendChild(root);
    this.root = root;
    this.body = body;
    this.renderBody();
  }

  hide(): void {
    this.fxStop?.();
    this.fxStop = null;
    this.fxCanvas = null;
    this.simAbort?.abort();
    this.simAbort = null;
    this.simRunning = false;
    this.root?.remove();
    this.root = null;
    this.body = null;
    this.host.onClose?.();
  }

  private renderBody(): void {
    if (!this.body) return;
    if (this.tab !== 'preview') {
      this.fxStop?.();
      this.fxStop = null;
      this.fxCanvas = null;
    }
    this.body.replaceChildren();
    switch (this.tab) {
      case 'user': this.renderUser(this.body); break;
      case 'preview': this.renderPreview(this.body); break;
      case 'attack': this.renderAttack(this.body); break;
      case 'monster': this.renderMonster(this.body); break;
      case 'system': this.renderSystem(this.body); break;
      case 'dps': this.renderDps(this.body); break;
      case 'sim': this.renderSim(this.body); break;
      case 'diff': this.renderDiff(this.body); break;
      default: {
        const _exhaustive: never = this.tab;
        return _exhaustive;
      }
    }
  }

  private renderUser(body: HTMLElement): void {
    const snap = readUserSnapshot();
    const hint = document.createElement('p');
    hint.className = 'xy-dt-hint';
    hint.textContent = '修改本地持久化进度（引导 / 体力 / 功德 / 段位 / 装备技能 / 神兵碎片）。不改战斗公式。';
    body.appendChild(hint);

    const actions = document.createElement('div');
    actions.className = 'xy-dt-actions';
    actions.appendChild(btn('重置用户进度', () => {
      const r = resetUserProgress();
      this.host.onUserApplied(r);
      this.renderBody();
    }, 'danger'));
    actions.appendChild(btn('一键测试档（全技能+金神兵）', () => {
      const r = fillUserTestLoadout();
      this.host.onUserApplied(r);
      this.renderBody();
    }, 'primary'));
    body.appendChild(actions);

    body.appendChild(section('基础'));
    body.appendChild(fieldRow('体力', numInput(snap.stamina, (n) => {
      this.host.onUserApplied(applyUserSnapshot({ stamina: n }));
    }, '1'), `0–${STAMINA_MAX}`));
    body.appendChild(fieldRow('功德', numInput(snap.merit, (n) => {
      this.host.onUserApplied(applyUserSnapshot({ merit: n }));
    }, '1'), `0–${MERIT_MAX}`));
    body.appendChild(fieldRow('段位 level', numInput(snap.rankLevel, (n) => {
      this.host.onUserApplied(applyUserSnapshot({ rankLevel: Math.max(0, Math.min(LADDER_LEN - 1, Math.floor(n))) }));
      this.renderBody();
    }, '1'), `0–${LADDER_LEN - 1}`));
    body.appendChild(fieldRow('星数', numInput(snap.rankStars, (n) => {
      this.host.onUserApplied(applyUserSnapshot({ rankStars: Math.max(0, Math.min(STARS_PER_TIER, Math.floor(n))) }));
    }, '1'), `0–${STARS_PER_TIER}`));
    body.appendChild(fieldRow('难度 difficulty', numInput(snap.difficulty, (n) => {
      this.host.onUserApplied(applyUserSnapshot({ difficulty: Math.max(0.6, n) }));
    })));

    body.appendChild(section('引导'));
    const seenKeys = Object.keys(snap.tutorialSeen);
    if (seenKeys.length) {
      const hint2 = document.createElement('p');
      hint2.className = 'xy-dt-hint';
      hint2.textContent = '已看过（点击单项可单独清除，该引导会在下次触发时机重新弹出）：';
      body.appendChild(hint2);
      const list = document.createElement('div');
      list.className = 'xy-dt-actions';
      for (const key of seenKeys) {
        list.appendChild(btn(`${key} ✕`, () => {
          const next = { ...snap.tutorialSeen };
          delete next[key];
          this.host.onUserApplied(applyUserSnapshot({ tutorialSeen: next }));
          this.renderBody();
        }));
      }
      body.appendChild(list);
    } else {
      const seenCard = document.createElement('div');
      seenCard.className = 'xy-dt-card';
      seenCard.textContent = '尚未看过任何引导';
      body.appendChild(seenCard);
    }
    body.appendChild(btn('清空全部引导记录', () => {
      this.host.onUserApplied(applyUserSnapshot({ tutorialSeen: {} }));
      this.renderBody();
    }, 'danger'));

    body.appendChild(section('装配主动（最多 2）'));
    body.appendChild(this.skillChecklist(
      ACTIVE_SKILLS.filter((a) => !a.disabled).map((a) => ({ id: a.id, name: a.name })),
      snap.equippedActives,
      snap.ownedActives,
      (equipped, owned) => {
        this.host.onUserApplied(applyUserSnapshot({
          equippedActives: equipped,
          ownedActives: owned,
        }));
      },
      2,
    ));

    body.appendChild(section('装配被动（最多 6）'));
    body.appendChild(this.skillChecklist(
      PASSIVE_SKILLS.filter((p) => !p.disabled).map((p) => ({ id: p.id, name: p.name })),
      snap.equippedPassives,
      snap.ownedPassives,
      (equipped, owned) => {
        this.host.onUserApplied(applyUserSnapshot({
          equippedPassives: equipped,
          ownedPassives: owned,
        }));
      },
      6,
    ));

    body.appendChild(section('神兵碎片 / 激活 / 装备'));
    for (const w of WEAPONS) {
      const owned = snap.bagOwned[w.id] ?? 0;
      const frag = snap.bagFragments[w.id] ?? 0;
      const eq = snap.bagEquipped.includes(w.id);
      const card = document.createElement('div');
      card.className = 'xy-dt-card';
      card.textContent = `${w.name}（${w.general}）`;
      const row = document.createElement('div');
      row.className = 'xy-dt-actions';
      row.appendChild(fieldRow('品质阶', numInput(owned, (n) => {
        const bagOwned = { ...snap.bagOwned };
        const v = Math.max(0, Math.min(5, Math.floor(n)));
        if (v <= 0) delete bagOwned[w.id];
        else bagOwned[w.id] = v;
        const bagEquipped = snap.bagEquipped.filter((id) => id in bagOwned || (bagOwned[id] ?? 0) > 0);
        this.host.onUserApplied(applyUserSnapshot({ bagOwned, bagEquipped }));
        this.renderBody();
      }, '1')));
      row.appendChild(fieldRow('碎片', numInput(frag, (n) => {
        const bagFragments = { ...snap.bagFragments, [w.id]: Math.max(0, Math.floor(n)) };
        this.host.onUserApplied(applyUserSnapshot({ bagFragments }));
      }, '1')));
      const eqBtn = btn(eq ? '卸下' : '装备', () => {
        let bagEquipped = [...snap.bagEquipped];
        if (eq) bagEquipped = bagEquipped.filter((id) => id !== w.id);
        else if (owned > 0 && bagEquipped.length < 3) bagEquipped.push(w.id);
        this.host.onUserApplied(applyUserSnapshot({ bagEquipped }));
        this.renderBody();
      });
      row.appendChild(eqBtn);
      card.appendChild(row);
      body.appendChild(card);
    }
  }

  private skillChecklist(
    all: { id: string; name: string }[],
    equipped: string[],
    owned: string[],
    onChange: (equipped: string[], owned: string[]) => void,
    maxEquip: number,
  ): HTMLElement {
    const wrap = document.createElement('div');
    for (const s of all) {
      const row = document.createElement('div');
      row.className = 'xy-dt-card';
      const ownedOn = owned.includes(s.id);
      const eqOn = equipped.includes(s.id);
      row.textContent = `${s.name} (${s.id})`;
      const actions = document.createElement('div');
      actions.className = 'xy-dt-actions';
      actions.appendChild(btn(ownedOn ? '取消拥有' : '拥有', () => {
        let nextOwned = [...owned];
        let nextEq = [...equipped];
        if (ownedOn) {
          nextOwned = nextOwned.filter((id) => id !== s.id);
          nextEq = nextEq.filter((id) => id !== s.id);
        } else {
          nextOwned.push(s.id);
        }
        onChange(nextEq, nextOwned);
        this.renderBody();
      }));
      actions.appendChild(btn(eqOn ? '卸下' : '装备', () => {
        let nextOwned = owned.includes(s.id) ? [...owned] : [...owned, s.id];
        let nextEq = [...equipped];
        if (eqOn) nextEq = nextEq.filter((id) => id !== s.id);
        else if (nextEq.length < maxEquip) nextEq.push(s.id);
        onChange(nextEq, nextOwned);
        this.renderBody();
      }));
      row.appendChild(actions);
      wrap.appendChild(row);
    }
    return wrap;
  }

  private renderPreview(body: HTMLElement): void {
    const hint = document.createElement('p');
    hint.className = 'xy-dt-hint';
    hint.textContent = '数值速览 + 战斗特效试播（画布内播放，不进入对局）。';
    body.appendChild(hint);

    body.appendChild(section('特效试播'));
    const canvas = document.createElement('canvas');
    canvas.className = 'xy-dt-fx-canvas';
    body.appendChild(canvas);
    this.fxCanvas = canvas;
    const play = (spec: DevFxPreviewSpec) => {
      if (!this.fxCanvas) return;
      this.fxStop?.();
      this.fxStop = playDevFxPreview(this.fxCanvas, spec);
    };

    const fxActions = document.createElement('div');
    fxActions.className = 'xy-dt-actions';
    const unitTypes = Object.keys(UNITS) as UnitType[];
    for (const u of unitTypes) {
      fxActions.appendChild(btn(`${UNITS[u].name}攻击`, () => play({ kind: 'unitAttack', unit: u, tier: 5 })));
    }
    for (const sk of ['jinggu', 'meteor', 'freeze', 'atkBuff', 'frqBuff'] as SkillFxKind[]) {
      const names: Record<SkillFxKind, string> = {
        jinggu: '紧箍咒', meteor: '陨石', freeze: '冰封', atkBuff: '仙丹', frqBuff: '风火轮',
      };
      fxActions.appendChild(btn(names[sk], () => play({ kind: 'activeSkill', skill: sk })));
    }
    for (const b of ['hit', 'death', 'merge'] as const) {
      const names = { hit: '命中爆发', death: '击杀散落', merge: '合成星爆' };
      fxActions.appendChild(btn(names[b], () => play({ kind: 'burst', burst: b })));
    }
    body.appendChild(fxActions);

    body.appendChild(section('武将普攻 / 大招'));
    const heroFx = document.createElement('div');
    heroFx.className = 'xy-dt-actions';
    for (const g of GENERALS) {
      const card = document.createElement('div');
      card.className = 'xy-dt-card';
      card.style.marginBottom = '4px';
      card.textContent = `${g.name} · ${g.skillName}`;
      const row = document.createElement('div');
      row.className = 'xy-dt-actions';
      row.appendChild(btn('普攻', () => play({ kind: 'heroAttack', heroId: g.id, tier: g.maxTier })));
      if (g.skill !== 'none') {
        row.appendChild(btn('大招', () => play({ kind: 'heroUlt', heroId: g.id, tier: g.maxTier }), 'primary'));
      }
      card.appendChild(row);
      heroFx.appendChild(card);
    }
    body.appendChild(heroFx);

    body.appendChild(section('神兵加成预览（品质 1–5）'));
    for (const w of WEAPONS) {
      const card = document.createElement('div');
      card.className = 'xy-dt-card';
      const tiers = [1, 2, 3, 4, 5].map((t) => `T${t}:${weaponBonusLabel(w.stat, t)}`).join(' · ');
      card.textContent = `${w.name} → ${tiers}`;
      body.appendChild(card);
    }

    body.appendChild(section('武将基础（白阶）'));
    for (const g of GENERALS) {
      const card = document.createElement('div');
      card.className = 'xy-dt-card';
      card.textContent = `${g.name} ATK ${g.atk} / FRQ ${g.frq} / RGE ${g.rge} / 目标 ${g.targets} / CD ${g.skillCd}s · ${g.skillName}`;
      body.appendChild(card);
    }

    body.appendChild(section('主动技能'));
    for (const a of ACTIVE_SKILLS) {
      const card = document.createElement('div');
      card.className = 'xy-dt-card';
      card.textContent = `${a.name} CD ${a.cd}s · ${a.desc}${a.disabled ? '（下架）' : ''}`;
      body.appendChild(card);
    }

    body.appendChild(section('兵器 base'));
    for (const type of Object.keys(UNITS) as UnitType[]) {
      const u = UNITS[type];
      const card = document.createElement('div');
      card.className = 'xy-dt-card';
      card.textContent = `${u.name} baseAtk ${u.baseAtk} / baseFrq ${u.baseFrq.toFixed(3)} / rge ${u.rge} / targets ${u.targets}`;
      body.appendChild(card);
    }

    body.appendChild(section('经济速览'));
    const eco = document.createElement('div');
    eco.className = 'xy-dt-card';
    eco.textContent = `开局桃 ${ECONOMY.INITIAL_PEACH} · 击杀 ${ECONOMY.PEACH_PER_KILL}/${ECONOMY.PEACH_PER_ELITE}/${ECONOMY.PEACH_PER_MINI_BOSS}/${ECONOMY.PEACH_PER_BOSS} · 怪基 ${ECONOMY.MONSTER_BASE}+n · 唐僧血 ${ECONOMY.TANGSENG_INITIAL_HP}`;
    body.appendChild(eco);
  }

  private renderAttack(body: HTMLElement): void {
    const hint = document.createElement('p');
    hint.className = 'xy-dt-hint';
    hint.textContent = '攻击相关：武将属性 / 大招倍率 / 主动 CD / 神兵加成 / 兵器基础。改完即时生效（已开对局需重开或等下一波公式读取）。';
    body.appendChild(hint);
    const actions = document.createElement('div');
    actions.className = 'xy-dt-actions';
    for (const id of ['generalTuning', 'weaponTuning', 'generals', 'actives', 'units', 'tuning'] as TunableBagId[]) {
      actions.appendChild(btn(`重置 ${id}`, () => { resetBag(id); this.renderBody(); }));
    }
    body.appendChild(actions);

    body.appendChild(section('GENERAL_TUNING'));
    body.appendChild(objectFields(GENERAL_TUNING as unknown as Record<string, unknown>));

    body.appendChild(section('WEAPON_TUNING'));
    body.appendChild(objectFields(WEAPON_TUNING as unknown as Record<string, unknown>));

    body.appendChild(section('TUNING · 攻击/控制倍率'));
    body.appendChild(objectFields(TUNING as unknown as Record<string, unknown>, (k) => TUNING_ATTACK_KEYS.has(k)));

    body.appendChild(section('GENERALS（逐将）'));
    for (let i = 0; i < GENERALS.length; i++) {
      const g = GENERALS[i]!;
      body.appendChild(section(`${g.name} (${g.id})`));
      body.appendChild(objectFields(g as unknown as Record<string, unknown>, (k) => (
        ['atk', 'frq', 'rge', 'targets', 'skillCd', 'weight', 'expCostMul'].includes(k)
      )));
    }

    body.appendChild(section('ACTIVE_SKILLS CD / cost'));
    for (const a of ACTIVE_SKILLS) {
      body.appendChild(section(`${a.name} (${a.id})`));
      body.appendChild(objectFields(a as unknown as Record<string, unknown>, (k) => (
        ['cd', 'cost', 'disabled'].includes(k)
      )));
    }

    body.appendChild(section('UNITS'));
    for (const type of Object.keys(UNITS) as UnitType[]) {
      body.appendChild(section(`${UNITS[type].name} (${type})`));
      body.appendChild(objectFields(UNITS[type] as unknown as Record<string, unknown>, (k) => (
        ['baseAtk', 'baseFrq', 'rge', 'targets'].includes(k)
      )));
    }
  }

  private renderMonster(body: HTMLElement): void {
    const hint = document.createElement('p');
    hint.className = 'xy-dt-hint';
    hint.textContent = '怪物血量 / 前几波数量 / 承压比 / 精英 / 掉桃。';
    body.appendChild(hint);
    const actions = document.createElement('div');
    actions.className = 'xy-dt-actions';
    actions.appendChild(btn('重置 TUNING', () => { resetBag('tuning'); this.renderBody(); }));
    actions.appendChild(btn('重置 BOARD_POWER', () => { resetBag('boardPower'); this.renderBody(); }));
    actions.appendChild(btn('重置 ECONOMY 掉桃', () => { resetBag('economy'); this.renderBody(); }));
    body.appendChild(actions);

    body.appendChild(section('掉桃 ECONOMY'));
    body.appendChild(objectFields(ECONOMY as unknown as Record<string, unknown>, (k) => k.startsWith('PEACH_') || k === 'MONSTER_BASE'));

    body.appendChild(section('承压 BOARD_POWER'));
    body.appendChild(objectFields(BOARD_POWER as unknown as Record<string, unknown>));

    body.appendChild(section('TUNING · 怪物'));
    body.appendChild(objectFields(TUNING as unknown as Record<string, unknown>, (k) => TUNING_MONSTER_KEYS.has(k)));
  }

  private renderSystem(body: HTMLElement): void {
    const hint = document.createElement('p');
    hint.className = 'xy-dt-hint';
    hint.textContent = '波次间隔、征兵保底、布阵间隔、蟠桃园、经济开局等。';
    body.appendChild(hint);
    const actions = document.createElement('div');
    actions.className = 'xy-dt-actions';
    for (const id of ['tuning', 'economy', 'placeTiming', 'peachTree', 'aiTiming', 'passives'] as TunableBagId[]) {
      actions.appendChild(btn(`重置 ${id}`, () => { resetBag(id); this.renderBody(); }));
    }
    body.appendChild(actions);

    body.appendChild(section('ECONOMY'));
    body.appendChild(objectFields(ECONOMY as unknown as Record<string, unknown>));

    body.appendChild(section('PLACE_TIMING（自动布置间隔）'));
    body.appendChild(objectFields(PLACE_TIMING as unknown as Record<string, unknown>));

    body.appendChild(section('AI_TIMING'));
    body.appendChild(objectFields(AI_TIMING as unknown as Record<string, unknown>));

    body.appendChild(section('PEACH_TREE'));
    body.appendChild(fieldRow('maxLevel', numInput(PEACH_TREE.maxLevel, (n) => { PEACH_TREE.maxLevel = Math.max(1, Math.floor(n)); })));
    body.appendChild(fieldRow('plantInterval', numInput(PEACH_TREE.plantInterval, (n) => { PEACH_TREE.plantInterval = Math.max(1, n); })));
    PEACH_TREE.intervals.forEach((iv, i) => {
      body.appendChild(fieldRow(`intervals[${i}] (Lv${i + 1})`, numInput(iv, (n) => { PEACH_TREE.intervals[i] = n; })));
    });

    body.appendChild(section('TUNING · 系统'));
    body.appendChild(objectFields(TUNING as unknown as Record<string, unknown>, (k) => TUNING_SYSTEM_KEYS.has(k)));

    body.appendChild(section('PASSIVE_SKILLS cost'));
    for (const p of PASSIVE_SKILLS) {
      body.appendChild(section(`${p.name} (${p.id})`));
      body.appendChild(objectFields(p as unknown as Record<string, unknown>, (k) => (
        ['cost', 'disabled'].includes(k)
      )));
    }
  }

  private renderDps(body: HTMLElement): void {
    const hint = document.createElement('p');
    hint.className = 'xy-dt-hint';
    hint.innerHTML = [
      '同类型内才可直接比柱高。口径：',
      '武将=普攻秒伤+大招专注秒伤；',
      '兵器=POW(ATK×FRQ×RGE×目标，枪/骑/弓设计上 POW 相同)；',
      '神兵=对专属武将普攻的<strong>增益量</strong>（非加成后总伤）；',
      '主动=波血标尺近似。',
      '选「全部」时柱高为<strong>类内相对分 0–100</strong>，避免跨口径误导。',
    ].join('');
    body.appendChild(hint);

    const controls = document.createElement('div');
    controls.className = 'xy-dt-actions';
    const filterSel = document.createElement('select');
    const filterLabels: Record<DpsKind | 'all', string> = {
      all: '全部（类内相对）',
      hero: '武将',
      unit: '兵器',
      weapon: '神兵增益',
      active: '主动技能',
    };
    for (const k of ['hero', 'unit', 'weapon', 'active', 'all'] as const) {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = filterLabels[k];
      if (k === this.dpsFilter) opt.selected = true;
      filterSel.appendChild(opt);
    }
    filterSel.addEventListener('change', () => {
      this.dpsFilter = filterSel.value as DpsKind | 'all';
      this.renderBody();
    });
    controls.appendChild(fieldRow('类型', filterSel));
    controls.appendChild(fieldRow('武将阶', numInput(this.heroTier, (n) => {
      this.heroTier = Math.max(1, Math.min(5, Math.floor(n)));
      this.renderBody();
    }, '1')));
    controls.appendChild(fieldRow('兵器阶', numInput(this.unitTier, (n) => {
      this.unitTier = Math.max(1, Math.min(5, Math.floor(n)));
      this.renderBody();
    }, '1')));
    controls.appendChild(btn('刷新', () => this.renderBody(), 'primary'));
    body.appendChild(controls);

    let rows: DpsRow[] = [];
    if (this.dpsFilter === 'all' || this.dpsFilter === 'hero') rows = rows.concat(computeHeroDps(this.heroTier));
    if (this.dpsFilter === 'all' || this.dpsFilter === 'unit') rows = rows.concat(computeUnitDps(this.unitTier));
    if (this.dpsFilter === 'all' || this.dpsFilter === 'weapon') rows = rows.concat(computeWeaponDps());
    if (this.dpsFilter === 'all' || this.dpsFilter === 'active') rows = rows.concat(computeActiveDps());
    rows.sort((a, b) => b.dps - a.dps);

    const chartRows = this.dpsFilter === 'all' ? normalizeDpsByKind(rows) : rows;
    const listRows = rows; // 列表始终用绝对值

    const canvas = document.createElement('canvas');
    canvas.className = 'xy-dt-chart';
    body.appendChild(canvas);
    requestAnimationFrame(() => drawBarChart(canvas, chartRows.slice(0, 24)));

    const list = document.createElement('div');
    for (const r of listRows) {
      const card = document.createElement('div');
      card.className = 'xy-dt-card';
      card.textContent = `[${filterLabels[r.kind] ?? r.kind}] ${r.name} = ${r.dps.toFixed(2)} · ${r.group} · ${r.detail}`;
      list.appendChild(card);
    }
    body.appendChild(list);
  }

  private renderSim(body: HTMLElement): void {
    const hint = document.createElement('p');
    hint.className = 'xy-dt-hint';
    hint.textContent = '用对战用户代理批量跑局测胜率（征兵→布阵→主动）。默认不写持久化 AI/连胜。局数多时会较慢，可先 10–20 局试跑。';
    body.appendChild(hint);

    body.appendChild(section('参数'));
    body.appendChild(fieldRow('模拟次数', numInput(this.simGames, (n) => {
      this.simGames = Math.max(1, Math.min(500, Math.floor(n)));
    }, '1'), '1–500'));
    body.appendChild(fieldRow('种子 seedBase', numInput(this.simSeed, (n) => {
      this.simSeed = Math.floor(n);
    }, '1'), '第 i 局 seed=base+i'));
    body.appendChild(fieldRow('初始 AI skill', numInput(this.simAiSkill, (n) => {
      this.simAiSkill = Math.max(0.72, Math.min(1.8, n));
    }), '0.72–1.8'));
    body.appendChild(fieldRow('波次上限', numInput(this.simWaveCap, (n) => {
      this.simWaveCap = Math.max(0, Math.floor(n));
    }, '1'), '0=不限制'));

    const persistLabel = document.createElement('label');
    persistLabel.className = 'xy-dt-check';
    const persistCb = document.createElement('input');
    persistCb.type = 'checkbox';
    persistCb.checked = this.simPersist;
    persistCb.addEventListener('change', () => { this.simPersist = persistCb.checked; });
    persistLabel.appendChild(persistCb);
    persistLabel.appendChild(document.createTextNode('写入持久化（AI skill / 连胜连败）'));
    body.appendChild(persistLabel);

    const actions = document.createElement('div');
    actions.className = 'xy-dt-actions';
    const runBtn = btn(this.simRunning ? '模拟中…' : '开始模拟', () => {
      void this.startSim();
    }, 'primary');
    runBtn.disabled = this.simRunning;
    actions.appendChild(runBtn);
    actions.appendChild(btn('停止', () => {
      this.simAbort?.abort();
    }, 'danger'));
    actions.appendChild(btn('导出报告', () => {
      if (!this.simReport) return;
      downloadJson('xy-versus-sim-report.json', this.simReport);
    }));
    actions.appendChild(btn('复制摘要', () => {
      if (!this.simReport) return;
      void navigator.clipboard?.writeText(formatVersusSessionReport(this.simReport));
    }));
    body.appendChild(actions);

    const status = document.createElement('div');
    status.className = 'xy-dt-sim-status';
    status.textContent = this.simReport
      ? summarizeReport(this.simReport)
      : this.simProgress
        ? summarizeProgress(this.simProgress, AI_TARGET_WINRATE)
        : `就绪 · 目标胜率约 ${(AI_TARGET_WINRATE * 100).toFixed(0)}% · 默认 AI ${DEFAULT_AI_SKILL}`;
    body.appendChild(status);
    this.simStatusEl = status;

    const bar = document.createElement('div');
    bar.className = 'xy-dt-progress';
    const fill = document.createElement('i');
    const pct = this.simProgress
      ? (100 * this.simProgress.done) / Math.max(1, this.simProgress.total)
      : this.simReport ? 100 : 0;
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);
    body.appendChild(bar);
    this.simProgressBar = fill;

    const grid = document.createElement('div');
    grid.className = 'xy-dt-sim-grid';
    const c1 = document.createElement('canvas');
    c1.className = 'xy-dt-sim-canvas';
    const c2 = document.createElement('canvas');
    c2.className = 'xy-dt-sim-canvas';
    const c3 = document.createElement('canvas');
    c3.className = 'xy-dt-sim-canvas';
    const c4 = document.createElement('canvas');
    c4.className = 'xy-dt-sim-canvas';
    grid.appendChild(c1);
    grid.appendChild(c2);
    grid.appendChild(c3);
    grid.appendChild(c4);
    body.appendChild(grid);
    this.simOutcomeCanvas = c1;
    this.simWinRateCanvas = c2;
    this.simWaveCanvas = c3;
    this.simSkillCanvas = c4;

    const log = document.createElement('div');
    log.className = 'xy-dt-diff';
    log.style.maxHeight = '220px';
    this.simLogEl = log;
    body.appendChild(log);

    requestAnimationFrame(() => this.paintSimCharts());
  }

  private paintSimCharts(): void {
    const results = this.simProgress?.results ?? this.simReport?.results ?? [];
    const wins = this.simProgress?.wins ?? this.simReport?.wins ?? 0;
    const losses = this.simProgress?.losses ?? this.simReport?.losses ?? 0;
    const timeouts = this.simProgress?.timeouts ?? this.simReport?.timeouts ?? 0;
    const target = this.simReport?.targetWinRate ?? AI_TARGET_WINRATE;
    const skillStart = this.simReport?.aiSkillStart ?? this.simAiSkill;
    if (this.simOutcomeCanvas) drawOutcomeChart(this.simOutcomeCanvas, wins, losses, timeouts);
    if (this.simWinRateCanvas) drawWinRateSeries(this.simWinRateCanvas, results, target);
    if (this.simWaveCanvas) drawWaveHistogram(this.simWaveCanvas, results);
    if (this.simSkillCanvas) drawAiSkillSeries(this.simSkillCanvas, results, skillStart);
    if (this.simLogEl) {
      if (results.length === 0) {
        this.simLogEl.textContent = '（尚无逐局结果）';
      } else {
        const lines = results.slice(-40).map((r, idx) => {
          const i = results.length - Math.min(40, results.length) + idx + 1;
          const tag = r.outcome === 'won' ? '胜' : r.outcome === 'lost' ? '负' : '超时';
          return `#${i} seed=${r.seed} ${tag} 波=${r.wave} AI=${r.matchAiSkill.toFixed(2)} (${r.simSeconds.toFixed(0)}s)`;
        });
        this.simLogEl.textContent = lines.join('\n');
        this.simLogEl.scrollTop = this.simLogEl.scrollHeight;
      }
    }
  }

  private async startSim(): Promise<void> {
    if (this.simRunning) return;
    this.simRunning = true;
    this.simReport = null;
    this.simProgress = null;
    this.simAbort?.abort();
    this.simAbort = new AbortController();
    if (this.tab === 'sim') this.renderBody();

    try {
      const report = await runVersusSessionAsync({
        games: this.simGames,
        seedBase: this.simSeed,
        initialAiSkill: this.simAiSkill,
        waveCap: this.simWaveCap,
        persist: this.simPersist,
        signal: this.simAbort.signal,
        batchSize: 1,
        onProgress: (p) => {
          this.simProgress = p;
          if (this.simStatusEl) {
            this.simStatusEl.textContent = summarizeProgress(p, AI_TARGET_WINRATE);
          }
          if (this.simProgressBar) {
            this.simProgressBar.style.width = `${(100 * p.done) / Math.max(1, p.total)}%`;
          }
          this.paintSimCharts();
        },
      });
      this.simReport = report;
      this.simProgress = {
        done: report.games,
        total: report.games,
        wins: report.wins,
        losses: report.losses,
        timeouts: report.timeouts,
        runningWinRate: report.playerWinRate,
        aiSkill: report.aiSkillEnd,
        results: report.results,
      };
      if (this.simStatusEl) this.simStatusEl.textContent = summarizeReport(report);
      this.paintSimCharts();
    } finally {
      this.simRunning = false;
      this.simAbort = null;
      if (this.tab === 'sim' && this.body) this.renderBody();
    }
  }

  private renderDiff(body: HTMLElement): void {
    const hint = document.createElement('p');
    hint.className = 'xy-dt-hint';
    hint.textContent = '相对模块加载默认值的差异。支持 git 风格红绿对照、格式化 JSON、导出完整/变动配置。';
    body.appendChild(hint);

    const actions = document.createElement('div');
    actions.className = 'xy-dt-actions';
    actions.appendChild(btn('重置全部数值为默认', () => {
      resetAllBags();
      this.renderBody();
    }, 'danger'));

    const modeSel = document.createElement('select');
    for (const [v, label] of [
      ['git', 'Git Diff 红绿'],
      ['json-full', '完整 JSON'],
      ['json-changed', '变动 JSON'],
    ] as const) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = label;
      if (v === this.diffMode) opt.selected = true;
      modeSel.appendChild(opt);
    }
    modeSel.addEventListener('change', () => {
      this.diffMode = modeSel.value as typeof this.diffMode;
      this.renderBody();
    });
    actions.appendChild(fieldRow('展示', modeSel));

    const onlyLabel = document.createElement('label');
    onlyLabel.className = 'xy-dt-check';
    const onlyCb = document.createElement('input');
    onlyCb.type = 'checkbox';
    onlyCb.checked = this.diffOnlyChanged;
    onlyCb.addEventListener('change', () => {
      this.diffOnlyChanged = onlyCb.checked;
      this.renderBody();
    });
    onlyLabel.appendChild(onlyCb);
    onlyLabel.appendChild(document.createTextNode('仅显示有变动'));
    actions.appendChild(onlyLabel);

    actions.appendChild(btn('导出完整 JSON', () => {
      downloadJson('xy-tuning-full.json', exportLiveConfig());
    }, 'primary'));
    actions.appendChild(btn('导出变动 JSON', () => {
      downloadJson('xy-tuning-changed.json', exportChangedConfig());
    }));
    actions.appendChild(btn('导出默认 JSON', () => {
      downloadJson('xy-tuning-defaults.json', exportDefaultsConfig());
    }));
    actions.appendChild(btn('复制当前视图', () => {
      const text = this.diffViewText();
      void navigator.clipboard?.writeText(text);
    }));
    body.appendChild(actions);

    const resetRow = document.createElement('div');
    resetRow.className = 'xy-dt-actions';
    for (const b of TUNABLE_BAGS) {
      resetRow.appendChild(btn(`重置 ${b.id}`, () => { resetBag(b.id); this.renderBody(); }));
    }
    body.appendChild(resetRow);

    const pre = document.createElement('div');
    pre.className = 'xy-dt-diff';
    this.fillDiffView(pre);
    body.appendChild(pre);
  }

  private diffViewText(): string {
    if (this.diffMode === 'json-full') {
      return JSON.stringify(this.diffOnlyChanged ? exportChangedConfig() : exportLiveConfig(), null, 2);
    }
    if (this.diffMode === 'json-changed') {
      return JSON.stringify(exportChangedConfig(), null, 2);
    }
    const diffs = allDiffs();
    if (diffs.length === 0) return '（无差异，全部为默认值）';
    return diffs.map((d) => {
      const leaf = d.path.split('.').pop() ?? d.path;
      const zh = paramZh(leaf);
      const title = zh ? `${d.bag} / ${zh} (${d.path})` : `${d.bag} / ${d.path}`;
      return `@@ ${title}\n- ${formatDiffValue(d.from)}\n+ ${formatDiffValue(d.to)}`;
    }).join('\n\n');
  }

  private fillDiffView(pre: HTMLElement): void {
    pre.replaceChildren();
    if (this.diffMode === 'json-full' || this.diffMode === 'json-changed') {
      const payload = this.diffMode === 'json-full' && !this.diffOnlyChanged
        ? exportLiveConfig()
        : exportChangedConfig();
      if (Object.keys(payload).length === 0) {
        pre.textContent = '（无差异）';
        return;
      }
      pre.textContent = JSON.stringify(payload, null, 2);
      return;
    }

    const diffs = allDiffs();
    if (diffs.length === 0) {
      pre.textContent = '（无差异，全部为默认值）';
      return;
    }
    for (const d of diffs) {
      const leaf = d.path.split('.').pop() ?? d.path;
      const zh = paramZh(leaf);
      const hunk = document.createElement('div');
      hunk.className = 'hunk';
      hunk.textContent = zh
        ? `@@ [${d.bag}] ${zh} · ${d.path}`
        : `@@ [${d.bag}] ${d.path}`;
      pre.appendChild(hunk);
      const del = document.createElement('span');
      del.className = 'del';
      del.textContent = `- ${formatDiffValue(d.from)}`;
      pre.appendChild(del);
      const add = document.createElement('span');
      add.className = 'add';
      add.textContent = `+ ${formatDiffValue(d.to)}`;
      pre.appendChild(add);
    }
  }
}

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function drawBarChart(canvas: HTMLCanvasElement, rows: DpsRow[]): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || 600;
  const cssH = canvas.clientHeight || 320;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = '#fffaf0';
  ctx.fillRect(0, 0, cssW, cssH);
  if (rows.length === 0) {
    ctx.fillStyle = '#6a5a40';
    ctx.font = '12px "PingFang SC", sans-serif';
    ctx.fillText('暂无数据', 12, 24);
    return;
  }

  const labelAngle = -Math.PI / 3.2; // ≈ -56°，斜向左下可读
  const font = '11px "PingFang SC", sans-serif';
  ctx.font = font;
  let maxLabelW = 0;
  for (const r of rows) maxLabelW = Math.max(maxLabelW, ctx.measureText(r.name).width);

  const padL = 8;
  const padR = 8;
  const padT = 10;
  // 斜标签占用高度 ≈ 字宽×sin(|θ|)；再留 6px 边距，避免裁切
  const padB = Math.ceil(maxLabelW * Math.sin(Math.abs(labelAngle)) + 14);
  const plotH = Math.max(40, cssH - padT - padB);
  const max = Math.max(...rows.map((r) => r.dps), 1e-6);
  const barW = (cssW - padL - padR) / rows.length;
  const baseline = padT + plotH; // 柱底紧贴标签区顶
  const colors: Record<DpsKind, string> = {
    hero: '#6b4a22',
    unit: '#3a6b4a',
    weapon: '#4a5a8a',
    active: '#8a4a3a',
  };

  rows.forEach((r, i) => {
    const h = (plotH * r.dps) / max;
    const x = padL + i * barW;
    const y = baseline - h;
    ctx.fillStyle = colors[r.kind];
    ctx.fillRect(x + 2, y, Math.max(2, barW - 4), h);

    ctx.save();
    // 锚点贴柱底，斜向画出；textBaseline=top 让笔画落在 padB 内而不裁切
    ctx.translate(x + barW / 2, baseline + 3);
    ctx.rotate(labelAngle);
    ctx.fillStyle = '#3a2e1c';
    ctx.font = font;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(r.name, 0, 0);
    ctx.restore();
  });
}
