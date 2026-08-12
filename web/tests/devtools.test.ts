import { describe, expect, it } from 'vitest';
import { ECONOMY } from '@core';
import { TUNING } from '../src/battle';
import {
  ECONOMY_LIVE_PEACH_KEYS,
  ECONOMY_REFERENCE_KEYS,
  ECONOMY_START_KEYS,
  TUNING_AI_KEYS,
  TUNING_MONSTER_KEYS,
  TUNING_SKILL_KEYS,
  TUNING_SUMMON_KEYS,
  allDiffs,
  allTuningFilterKeys,
  exportChangedConfig,
  exportLiveConfig,
  resetAllBags,
  resetBag,
} from '../src/devtools/bags';
import { collectDiffs, deepClone } from '../src/devtools/clone';
import { computeHeroDps, computeUnitDps, computeWeaponDps } from '../src/devtools/dps';
import { paramLabel, PARAM_ZH } from '../src/devtools/labels';

describe('devtools bags', () => {
  it('deepClone + collectDiffs 能发现改动', () => {
    const a = { x: 1, nested: { y: 2 } };
    const b = deepClone(a);
    b.nested.y = 3;
    const diffs = collectDiffs(b, a);
    expect(diffs).toEqual([{ path: 'nested.y', from: 2, to: 3 }]);
  });

  it('resetBag 能还原 TUNING / ECONOMY', () => {
    const old = TUNING.monsterHpBase;
    TUNING.monsterHpBase = old + 99;
    expect(allDiffs().some((d) => d.path === 'monsterHpBase')).toBe(true);
    resetBag('tuning');
    expect(TUNING.monsterHpBase).toBe(old);

    const peach = ECONOMY.PEACH_PER_KILL;
    ECONOMY.PEACH_PER_KILL = peach + 7;
    resetBag('economy');
    expect(ECONOMY.PEACH_PER_KILL).toBe(peach);
  });

  it('resetAllBags 不抛错', () => {
    TUNING.waveGapSec = 9;
    resetAllBags();
    expect(TUNING.waveGapSec).toBe(5);
  });

  it('DPS 估算返回武将与兵器行；神兵为增益量而非总伤', () => {
    const heroes = computeHeroDps(5);
    const units = computeUnitDps(5);
    const weapons = computeWeaponDps();
    expect(heroes.length).toBeGreaterThan(5);
    expect(units.length).toBe(4);
    expect(heroes[0]!.dps).toBeGreaterThan(0);
    // 枪/骑/弓 POW 设计相等
    const spear = units.find((u) => u.id === 'spear')!;
    const cavalry = units.find((u) => u.id === 'cavalry')!;
    const archer = units.find((u) => u.id === 'archer')!;
    expect(spear.dps).toBeCloseTo(cavalry.dps, 5);
    expect(spear.dps).toBeCloseTo(archer.dps, 5);
    // 神兵增益应明显小于同专属武将总秒伤
    const dasheng = heroes.find((h) => h.id === 'dasheng')!;
    const jingubang = weapons.find((w) => w.id === 'jingubang')!;
    expect(jingubang.dps).toBeLessThan(dasheng.dps);
  });

  it('导出 JSON 含 tuning，变动导出仅含 diff', () => {
    resetAllBags();
    const full = exportLiveConfig();
    expect(full.tuning).toBeTruthy();
    expect(Object.keys(exportChangedConfig())).toHaveLength(0);
    const before = TUNING.monsterHpBase;
    TUNING.monsterHpBase += 1;
    const changed = exportChangedConfig();
    expect(changed.tuning?.monsterHpBase).toEqual({ from: before, to: TUNING.monsterHpBase });
    resetBag('tuning');
  });

  it('中文说明覆盖常用键', () => {
    expect(PARAM_ZH.monsterHpBase).toBeTruthy();
    expect(paramLabel('monsterHpBase')).toContain('怪物血量');
    expect(paramLabel('monsterHpBase')).toContain('monsterHpBase');
  });

  it('TUNING 功能分组互斥且覆盖全部字段', () => {
    const groups = [TUNING_MONSTER_KEYS, TUNING_SKILL_KEYS, TUNING_SUMMON_KEYS, TUNING_AI_KEYS];
    const seen = new Set<string>();
    for (const g of groups) {
      for (const k of g) {
        expect(seen.has(k), `重复键 ${k}`).toBe(false);
        seen.add(k);
      }
    }
    const liveKeys = Object.keys(TUNING);
    const filtered = allTuningFilterKeys();
    for (const k of liveKeys) {
      expect(filtered.has(k), `TUNING.${k} 未进任何分组`).toBe(true);
    }
    for (const k of filtered) {
      expect(liveKeys.includes(k), `分组含未知键 ${k}`).toBe(true);
    }
  });

  it('ECONOMY 实战/开局/参考键互斥且覆盖全部', () => {
    const all = new Set([...ECONOMY_LIVE_PEACH_KEYS, ...ECONOMY_START_KEYS, ...ECONOMY_REFERENCE_KEYS]);
    expect(all.size).toBe(
      ECONOMY_LIVE_PEACH_KEYS.size + ECONOMY_START_KEYS.size + ECONOMY_REFERENCE_KEYS.size,
    );
    for (const k of Object.keys(ECONOMY)) {
      expect(all.has(k), `ECONOMY.${k} 未分类`).toBe(true);
    }
  });
});
