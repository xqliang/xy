import type { UnitType } from '@core';
import type { RNG } from './rng';

export type SummonToken =
  | { kind: 'unit'; type: UnitType; tier: 1 }
  | { kind: 'shovel' };

export function drawSummonTray(opts: {
  rng: RNG;
  unitTypes: readonly UnitType[];
  draws: number;
  shovelChance: number;
  maxPerKey: number;
  firstSummon: boolean;
  forceShovel?: boolean;
  /** 本盘铲子硬上限（如前期累计配额剩余）；未设则只受 maxPerKey */
  maxShovels?: number;
}): SummonToken[] {
  const { rng, unitTypes, draws, shovelChance, maxPerKey, firstSummon, forceShovel } = opts;
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

  // 铲子保底：要求强制出铲但本盘一把都没出 → 把最后一个兵槽替换为铲子
  if (
    forceShovel
    && maxShovels > 0
    && out.filter((t) => t.kind === 'shovel').length < maxShovels
    && !out.some((t) => t.kind === 'shovel')
  ) {
    const lastUnit = out.map((t) => t.kind).lastIndexOf('unit');
    if (lastUnit >= 0) out[lastUnit] = { kind: 'shovel' };
  }
  return out;
}
