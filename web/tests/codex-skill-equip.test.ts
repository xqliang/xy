import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetCodex,
  codexSkillActionAt,
  drawCodex,
} from '../src/codex';
import type { LoadoutState } from '../src/loadout';
import { enabledActives } from '../src/actives';
import { VIEW_W } from '../src/render';

function emptyLoadout(partial: Partial<LoadoutState> = {}): LoadoutState {
  return {
    day: 0,
    ownedActives: [],
    ownedPassives: [],
    equipped: [],
    passives: [],
    ...partial,
  };
}

function makeCtx(): CanvasRenderingContext2D {
  const calls: unknown[] = [];
  return {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    textAlign: 'left',
    textBaseline: 'top',
    globalAlpha: 1,
    measureText: (text: string) => ({ width: String(text).length * 8 }),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    createRadialGradient: () => ({ addColorStop: () => undefined }),
    beginPath: () => undefined,
    closePath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    arc: () => undefined,
    arcTo: () => undefined,
    rect: () => undefined,
    fill: () => undefined,
    stroke: () => undefined,
    strokeText: () => undefined,
    fillRect: () => undefined,
    fillText: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    clip: () => undefined,
    translate: () => undefined,
    scale: () => undefined,
    drawImage: () => undefined,
    _calls: calls,
  } as unknown as CanvasRenderingContext2D;
}

describe('图鉴技能页装配', () => {
  beforeEach(() => {
    resetCodex('skill');
  });

  it('已装备技能可命中卸下', () => {
    const active = enabledActives()[0]!;
    const loadout = emptyLoadout({
      ownedActives: [active.id],
      equipped: [active.id],
    });
    // 首张主动卡按钮：卡片加高含风味行后，按钮约在 contentY≈129（屏幕 y≈265）；按钮靠右
    const hit = codexSkillActionAt(VIEW_W - 80, 265, loadout);
    expect(hit).toEqual({ kind: 'unequip', skillKind: 'active', id: active.id });
  });

  it('今日已购未装备可命中装备', () => {
    const active = enabledActives()[0]!;
    const loadout = emptyLoadout({
      ownedActives: [active.id],
      equipped: [],
    });
    const hit = codexSkillActionAt(VIEW_W - 80, 265, loadout);
    expect(hit).toEqual({ kind: 'equip', skillKind: 'active', id: active.id });
  });

  it('未购买技能没有可点操作', () => {
    const loadout = emptyLoadout();
    const hit = codexSkillActionAt(VIEW_W - 80, 265, loadout);
    expect(hit).toBeNull();
  });

  it('drawCodex 接受 loadout 不抛错', () => {
    const ctx = makeCtx();
    expect(() => drawCodex(ctx, emptyLoadout())).not.toThrow();
  });
});
