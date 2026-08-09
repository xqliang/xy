import { Battle } from '../src/battle';
import { isEitherPathCell, mapById } from '../src/board';
import { BAILONG_DOT_CELLS, setupBailongScreenshot } from '../tests/fixtures/bailong-screenshot-board';

const cellKey = (c: number, r: number) => `${c},${r}`;
const dotKeys = new Set(BAILONG_DOT_CELLS.map(({ c, r }) => cellKey(c, r)));

function label(b: Battle, c: number, r: number): string {
  const k = cellKey(c, r);
  const w = b.words.get(k);
  const u = b.units.get(k);
  if (w) return w.char + (w.tier > 1 ? String(w.tier) : ' ');
  if (u) {
    const names = { spear: '枪', archer: '弓', cavalry: '骑', dao: '刀' } as const;
    return (names[u.type as keyof typeof names] ?? u.type[0]!) + String(u.tier);
  }
  if (c === 7 && r === 5) return '唐 ';
  if (dotKeys.has(k) || isEitherPathCell(b.map, c, r)) return '路 ';
  return '空 ';
}

function printGrid(b: Battle, title: string) {
  console.log(`\n=== ${title} ===`);
  console.log('     c0   c1   c2   c3   c4   c5   c6   c7');
  for (let r = 5; r <= 9; r++) {
    let row = `r${r} `;
    for (let c = 0; c < 8; c++) row += label(b, c, r).padStart(4, ' ');
    console.log(row);
  }
  console.log('tray:', b.tray.map((t) => (t.kind === 'word' ? t.char : t.kind)).join(', ') || '(空)');
  console.log('激活将:', b.activeGenerals().map((g) => g.def.name).join(', ') || '(无)');
}

const b = new Battle(20260809, 3, mapById('huoyanshan'));
setupBailongScreenshot(b);
printGrid(b, '布阵前（用户盘面）');
b.autoPlaceTray();
printGrid(b, '布阵后（一键布阵）');
