import { describe, it, expect } from 'vitest';
import {
  INITIAL_PEACH, PEACH_PER_KILL, PEACH_PER_BLEED, PEACH_PER_BOSS, TANGSENG_INITIAL_HP,
} from '../src/config/economy';
import {
  monstersInWave, dropInWave, peachAfterWave, firstDeficitWave, sellBloodReward,
} from '../src/domain/economy';

describe('蟠桃经济常量（照搬原作）', () => {
  it('开局20 / 杀怪1 / 掉血10 / BOSS10 / 唐僧初始3滴血', () => {
    expect(INITIAL_PEACH).toBe(20);
    expect(PEACH_PER_KILL).toBe(1);
    expect(PEACH_PER_BLEED).toBe(10);
    expect(PEACH_PER_BOSS).toBe(10);
    expect(TANGSENG_INITIAL_HP).toBe(3);
  });
});

describe('波次产耗曲线（照搬原作表格）', () => {
  it('第 n 波怪物数 = 9 + n', () => {
    expect(monstersInWave(1)).toBe(10);
    expect(monstersInWave(2)).toBe(11);
    expect(monstersInWave(10)).toBe(19);
  });

  it('第 n 波掉落蟠桃 = 怪物数', () => {
    expect(dropInWave(1)).toBe(10);
    expect(dropInWave(10)).toBe(19);
  });

  it('剩余蟠桃逐波还原原文表格：10,8,5,1,-4,-10 与 wave10=-44', () => {
    expect(peachAfterWave(1)).toBe(10);
    expect(peachAfterWave(2)).toBe(8);
    expect(peachAfterWave(3)).toBe(5);
    expect(peachAfterWave(4)).toBe(1);
    expect(peachAfterWave(5)).toBe(-4);
    expect(peachAfterWave(6)).toBe(-10);
    expect(peachAfterWave(10)).toBe(-44);
  });

  it('蟠桃在第 5 波首次转负（第5波危机）', () => {
    expect(firstDeficitWave()).toBe(5);
  });
});

describe('舍身饲魔（卖血经济）', () => {
  it('每掉 1 滴血补偿 10 蟠桃', () => {
    expect(sellBloodReward(1)).toBe(10);
    expect(sellBloodReward(3)).toBe(30);
  });
});
