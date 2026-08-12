import type { UnitType } from '@core';
import type { RNG } from './rng';

export type SummonToken =
  | { kind: 'unit'; type: UnitType; tier: 1 }
  | { kind: 'shovel' };

/**
 * 强制出铲：只替换剩余 `unit` 槽，绝不改写字牌等其它保底结果。
 * @returns 是否成功写入一把铲
 */
export function applyForceShovel<T extends { kind: string }>(
  tokens: T[],
  opts?: { maxShovels?: number; minUnits?: number },
): boolean {
  const maxShovels = opts?.maxShovels ?? Number.POSITIVE_INFINITY;
  const minUnits = opts?.minUnits ?? 0;
  const shovelN = tokens.filter((t) => t.kind === 'shovel').length;
  if (shovelN >= 1 || maxShovels <= shovelN) return false;
  const unitN = tokens.filter((t) => t.kind === 'unit').length;
  if (unitN <= minUnits) return false;
  const lastUnit = tokens.map((t) => t.kind).lastIndexOf('unit');
  if (lastUnit < 0) return false;
  tokens[lastUnit] = { kind: 'shovel' } as T;
  return true;
}

export function drawSummonTray(opts: {
  rng: RNG;
  unitTypes: readonly UnitType[];
  draws: number;
  shovelChance: number;
  maxPerKey: number;
  firstSummon: boolean;
  /** @deprecated 强制出铲改由征兵流程在字/半对保底之后调用 applyForceShovel */
  forceShovel?: boolean;
  /** 本盘铲子硬上限（如前期累计配额剩余）；未设则只受 maxPerKey */
  maxShovels?: number;
}): SummonToken[] {
  const { rng, unitTypes, draws, shovelChance, maxPerKey, firstSummon } = opts;
  const maxShovels = opts.maxShovels ?? maxPerKey;
  const counts = new Map<string, number>();
  const out: SummonToken[] = [];
  const bump = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);
  const under = (k: string) => (counts.get(k) ?? 0) < maxPerKey;

  for (let i = 0; i < draws; i++) {
    const slotsLeft = draws - i;
    const unitsSoFar = out.filter((t) => t.kind === 'unit').length;
    const shovelsSoFar = out.filter((t) => t.kind === 'shovel').length;
    // 首次：已有 1 铲，或再出铲会导致兵种 < 4 → 禁铲
    const needUnits = firstSummon ? Math.max(0, 4 - unitsSoFar) : 0;
    const allowShovel =
      under('shovel') &&
      shovelsSoFar < maxShovels &&
      (!firstSummon || (shovelsSoFar < 1 && slotsLeft - 1 >= needUnits && unitsSoFar + (slotsLeft - 1) >= 4));

    let pickShovel = allowShovel && rng.next() < shovelChance;
    if (firstSummon && slotsLeft <= needUnits) pickShovel = false;

    if (pickShovel) {
      out.push({ kind: 'shovel' });
      bump('shovel');
      continue;
    }

    const eligible = unitTypes.filter((t) => under(`unit:${t}`));
    const pool = eligible.length > 0 ? eligible : [...unitTypes]; // 理论上 4 种×3≥5，eligible 不应空
    const type = rng.pick(pool);
    out.push({ kind: 'unit', type, tier: 1 });
    bump(`unit:${type}`);
  }

  return out;
}
