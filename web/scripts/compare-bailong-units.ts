import { Battle } from '../src/battle';
import { mapById } from '../src/board';
import { setupBailongScreenshot } from '../tests/fixtures/bailong-screenshot-board';

const names = { spear: '枪', archer: '弓', cavalry: '骑', dao: '刀' } as const;

type UnitSnap = { label: string; c: number; r: number; type: string; tier: number };

function listUnits(b: Battle): UnitSnap[] {
  return [...b.units.values()]
    .map((u) => ({
      label: `${names[u.type as keyof typeof names]}${u.tier}`,
      c: u.cell.c,
      r: u.cell.r,
      type: u.type,
      tier: u.tier,
    }))
    .sort((a, b) => a.r - b.r || a.c - b.c);
}

function listTrayUnits(b: Battle): string[] {
  return b.tray
    .filter((t) => t.kind === 'unit')
    .map((t) => `${names[t.type]}${t.tier}`);
}

function multiset(units: UnitSnap[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const u of units) {
    const k = `${u.type}${u.tier}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

const b = new Battle(20260809, 3, mapById('huoyanshan'));
setupBailongScreenshot(b);
const beforeUnits = listUnits(b);
const beforeTray = listTrayUnits(b);

b.autoPlaceTray();

const afterUnits = listUnits(b);
const afterTray = listTrayUnits(b);

console.log('布阵前 棋盘武器 (%d):', beforeUnits.length, beforeUnits.map((u) => `${u.label}@(${u.c},${u.r})`).join(', '));
console.log('布阵前 tray:', b.tray.length ? '(有字龙，无兵)' : '');
console.log('布阵后 棋盘武器 (%d):', afterUnits.length, afterUnits.map((u) => `${u.label}@(${u.c},${u.r})`).join(', '));
console.log('布阵后 tray武器:', afterTray.length ? afterTray.join(', ') : '(空)');

const bc = multiset(beforeUnits);
const ac = multiset(afterUnits);
console.log('\n按类型计数 diff (after - before):');
for (const k of new Set([...bc.keys(), ...ac.keys()])) {
  const d = (ac.get(k) ?? 0) - (bc.get(k) ?? 0);
  if (d !== 0) console.log(`  ${k}: ${d > 0 ? '+' : ''}${d}`);
}

console.log('\n布阵前各武器位置:');
for (const u of beforeUnits) console.log(`  ${u.label} @ (${u.c},${u.r})`);
console.log('布阵后各武器位置:');
for (const u of afterUnits) console.log(`  ${u.label} @ (${u.c},${u.r})`);

// 找「同样类型但像是多出来」—— 用位置追踪
console.log('\n--- 追踪 ---');
console.log('tray 原 [龙] → 龙落到棋盘 (6,5)，不占武器槽');
console.log('总武器数 前', beforeUnits.length, '后', afterUnits.length, 'tray兵后', afterTray.length);
