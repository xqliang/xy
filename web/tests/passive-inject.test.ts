import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';

// map/meta/weapons 传 undefined 走构造函数默认值；actives 空，passives 为被测项
const make = (passives: string[]) => new Battle(1, 1, undefined, undefined, undefined, [], passives);

describe('被动技能开局注入', () => {
  it('仙丹：全体攻击 +15%', () => {
    expect(make(['xiandan']).mods.atkMul).toBeCloseTo(1.15, 5);
  });

  it('疾风咒：我方攻速 +50%，AI 对手 +25%', () => {
    const b = make(['jifeng']);
    expect(b.mods.frqMul).toBeCloseTo(1.5, 5);
    expect(b.aiFrqMul).toBeCloseTo(1.25, 5);
  });

  it('同心咒：我方唐僧 +3、对手唐僧 +2', () => {
    const base = make([]);
    const b = make(['tongxin']);
    expect(b.tangsengMaxHP).toBe(base.tangsengMaxHP + 3);
    expect(b.aiTangsengHP).toBe(base.aiTangsengHP + 2);
  });

  it('自动定海针：额外解锁 1 阵位', () => {
    const base = make([]);
    const b = make(['dinghai']);
    expect(b.unlocked.size).toBe(base.unlocked.size + 1);
  });

  it('蟠桃园：走桃树系统(gardenOn)，并进入 pickedItems 以在被动栏展示', () => {
    const b = make(['pas_pantao']);
    expect(b.gardenOn).toBe(true);
    expect(b.pickedItems).toContain('pas_pantao');
  });

  it('防御性上限：传入第7个被动不生效(slice)', () => {
    const six = ['fenghuolun', 'fabaofu', 'zhaoxian', 'mojin', 'yunshi', 'yuni'];
    const b = make([...six, 'xiandan']);
    expect(b.mods.atkMul).toBeCloseTo(1, 5);
  });

  it('法宝符：记录武将初始等级 +1（惰性）', () => {
    expect(make(['fabaofu']).mods.generalLevelDelta).toBe(1);
    expect(make([]).mods.generalLevelDelta).toBe(0);
  });
});
