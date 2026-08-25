import { describe, it, expect } from 'vitest';
import {
  GENERALS,
  matchGeneral,
  partnerChars,
  generalsWithChar,
  hintGeneralForChar,
  primaryGeneralForChar,
  sortedPartnerChars,
  inactivePartnerHint,
  mainGeneralForVariantChar,
  variantChar,
} from '../src/generals';
import { Battle } from '../src/battle';
import { WEAPONS } from '../src/weapons';

function placePair(b: Battle, left: string, right: string, leftTier: number, rightTier: number) {
  const cells = b.unlockedCells();
  const a = cells[0]!;
  const rightCell = cells.find((c) => c.r === a.r && c.c === a.c + 1) ?? { c: a.c + 1, r: a.r };
  b.unlocked.add(`${rightCell.c},${rightCell.r}`);
  b.words.set(`${a.c},${a.r}`, {
    char: left,
    general: hintGeneralForChar(left),
    tier: leftTier,
    cell: { c: a.c, r: a.r },
  });
  b.words.set(`${rightCell.c},${rightCell.r}`, {
    char: right,
    general: hintGeneralForChar(right),
    tier: rightTier,
    cell: { c: rightCell.c, r: rightCell.r },
  });
  return { a, right: rightCell };
}

describe('门派配置', () => {
  it('24 武将、12 门派、每门派一满5一满3', () => {
    expect(GENERALS).toHaveLength(24);
    const families = new Set(GENERALS.map((g) => g.family));
    expect(families.size).toBe(12);
    for (const f of families) {
      const gs = GENERALS.filter((g) => g.family === f);
      expect(gs.map((g) => g.maxTier).sort()).toEqual([3, 5]);
    }
  });

  it('按左右字序匹配；共享字可组成不同武将', () => {
    expect(matchGeneral('大', '圣')?.id).toBe('dasheng');
    expect(matchGeneral('大', '蟒')?.id).toBe('damang');
    expect(matchGeneral('圣', '大')).toBeUndefined();
    expect(partnerChars('白').sort()).toEqual(['太', '龙'].sort());
    expect(sortedPartnerChars('白')).toEqual(['龙', '太']);
    expect(primaryGeneralForChar('白')?.id).toBe('bailong');
    expect(inactivePartnerHint('白')).toBe('未激活：需与「龙」或「太」字左右相邻');
    expect(inactivePartnerHint('白', true)).toBe('候选区：需与「龙」或「太」字左右相邻');
    expect(generalsWithChar('牛').map((g) => g.id).sort()).toEqual(['niumowang', 'niulang', 'qingniu'].sort());
    expect(sortedPartnerChars('牛')[0]).toBe('魔');
  });

  it('神兵与武将一一对应', () => {
    expect(WEAPONS).toHaveLength(GENERALS.length);
    for (const g of GENERALS) {
      expect(WEAPONS.some((w) => w.general === g.id)).toBe(true);
    }
  });

  it('门派共享字与满5侧字识别', () => {
    expect(variantChar(GENERALS.find((g) => g.id === 'jinzha')!)).toBe('金');
    expect(variantChar(GENERALS.find((g) => g.id === 'nezha')!)).toBe('哪');
    expect(mainGeneralForVariantChar('哪')?.id).toBe('nezha');
    expect(mainGeneralForVariantChar('金')).toBeUndefined();
  });
});

describe('激活继承与满级', () => {
  it('高阶字激活满3武将时低阶对齐且不超3；高阶字本身不降', () => {
    const b = new Battle(1);
    // 太=5（来自太白线练度）+ 白=1 → 太白满3，白升到3，太保持5
    const { a, right } = placePair(b, '太', '白', 5, 1);
    const g = b.activeGenerals()[0]!;
    expect(g.def.id).toBe('taibai');
    expect(g.def.maxTier).toBe(3);
    expect(b.words.get(`${a.c},${a.r}`)?.tier).toBe(5);
    expect(b.words.get(`${right.c},${right.r}`)?.tier).toBe(3);
    expect(g.tier).toBe(3);
  });

  it('同门派低高对齐：白2+龙1 → 龙升2', () => {
    const b = new Battle(1);
    const { a, right } = placePair(b, '白', '龙', 2, 1);
    const g = b.activeGenerals()[0]!;
    expect(g.def.id).toBe('bailong');
    expect(b.words.get(`${a.c},${a.r}`)?.tier).toBe(2);
    expect(b.words.get(`${right.c},${right.r}`)?.tier).toBe(2);
    expect(g.tier).toBe(2);
  });

  it('满3武将战斗升阶不超过3', () => {
    const b = new Battle(1);
    const { a, right } = placePair(b, '太', '白', 3, 3);
    const g = b.activeGenerals()[0]!;
    b.addGeneralCombatExp(g, 9999);
    expect(b.words.get(`${a.c},${a.r}`)?.tier).toBe(3);
    expect(b.words.get(`${right.c},${right.r}`)?.tier).toBe(3);
  });
});

describe('禁止单字合并', () => {
  it('候选区同字不可合并', () => {
    const b = new Battle(1);
    b.tray = [
      { kind: 'word', char: '二', general: 'erlang', tier: 1 },
      { kind: 'word', char: '二', general: 'erlang', tier: 1 },
    ];
    expect(b.mergeTrayTokens(0, 1)).toBe(false);
    expect(b.tray).toHaveLength(2);
  });

  it('棋盘同字同阶拖拽不可合并', () => {
    const b = new Battle(1);
    const cells = b.unlockedCells();
    const a = cells[0]!;
    const c2 = cells.find((c) => c.c !== a.c || c.r !== a.r)!;
    b.words.set(`${a.c},${a.r}`, { char: '二', general: 'erlang', tier: 1, cell: a });
    b.words.set(`${c2.c},${c2.r}`, { char: '二', general: 'erlang', tier: 1, cell: c2 });
    expect(b.dragWord(a, c2)).toBe(false);
    expect(b.words.get(`${a.c},${a.r}`)?.tier).toBe(1);
    expect(b.words.get(`${c2.c},${c2.r}`)?.tier).toBe(1);
  });

  it('棋盘同字异阶拖拽可交换', () => {
    const b = new Battle(1);
    const cells = b.unlockedCells();
    const a = cells[0]!;
    const c2 = cells.find((c) => c.c !== a.c || c.r !== a.r)!;
    b.words.set(`${a.c},${a.r}`, { char: '八', general: 'bajie', tier: 5, cell: a });
    b.words.set(`${c2.c},${c2.r}`, { char: '八', general: 'bajie', tier: 1, cell: c2 });
    expect(b.dragWord(a, c2)).toBe(true);
    expect(b.words.get(`${a.c},${a.r}`)?.tier).toBe(1);
    expect(b.words.get(`${c2.c},${c2.r}`)?.tier).toBe(5);
  });
});
