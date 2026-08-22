// web/tests/battle.pvp-wave.test.ts
// Plan C Task 9：先清者定波次——PvP 关本地自动开波、手动 startNextWave 可清波且不自动续波。
//
// 在线 PvP 下波次由服务端权威排程（nextWave 的绝对纪元 startAtServerMs），两端各在自己时钟到点开波。
// 因此本机两个确定性 Battle（battle/oppBattle）都必须「关闭本地自动开波」——否则本地墙钟会与服务端纪元抢跑，
// 破坏「两端在同一 tick 索引开波」的确定性。本测试锁死这道门控。
import { describe, it, expect } from 'vitest';
import { Battle, NO_META } from '../src/battle';
import { MAPS } from '../src/board';

// 与 battle.pvp-input.test.ts / pvp-bridge.test.ts 的 mkPvp 同构：同 seed、difficulty=1、pvpInit.enabled=true。
// meta 传 NO_META（全 0）而非 {}：{} 会让 bonusHp/bonusSlots 变 undefined → tangsengHP/初始阵位变 NaN。
const mkPvp = () =>
  new Battle(1, 1, MAPS[0]!, NO_META, {}, [], [], false, undefined, 1, undefined, { enabled: true });
// 对照：非 pvp 的标准对战实例（单人/伪竞技走本地自动开波）。
const mkSolo = () =>
  new Battle(1, 1, MAPS[0]!, NO_META, {}, [], [], false, undefined, 1, undefined);

describe('pvp 关本地自动开波', () => {
  it('pvp 下 step 很久也不本地开波（wave 恒 0、status 恒 ready）', () => {
    const b = mkPvp();
    // INTRO_DUR=6s + waveGapSec=5s：单人下这段时间足以 intro 结束并自动开第 1 波。
    for (let i = 0; i < 400; i++) b.step(1 / 30); // 400/30 ≈ 13.3s
    expect(b.wave).toBe(0);              // 本地没自动开波
    expect(b.status).toBe('ready');      // 仍停在备战
  });

  it('对照：非 pvp 同样 step 后会自动开波（wave≥1）——证明门控只影响 pvp', () => {
    const b = mkSolo();
    for (let i = 0; i < 400; i++) b.step(1 / 30);
    expect(b.wave).toBeGreaterThanOrEqual(1); // 单人 intro(6s) 结束自动开第 1 波
  });
});

describe('pvp 手动开波 → 清波 → 不再自动续波', () => {
  it('startNextWave 开波后可清波，清波后 PvP 不自动开下一波', () => {
    const b = mkPvp();
    const opened = b.startNextWave();
    expect(opened).toBe(true);
    expect(b.wave).toBe(1);
    expect(b.waveActive).toBe(true);  // 门控后由只读 getter 暴露给 main.ts 波驱动
    expect(b.introDone).toBe(true);   // startNextWave 顶部置 introDone（PvP 下收尾 intro 视觉）

    // 立即清空当前波（测试辅助，确定性驱动清波判定）：waveActive→false、status→ready。
    b.forceClearWaveForTest();
    expect(b.status).toBe('ready');

    // 再 step 很久：PvP 下波间块被整体门控，不会本地倒计时开下一波 → wave 停在 1、status 仍 ready。
    const w1 = b.wave;
    for (let i = 0; i < 200; i++) b.step(1 / 30);
    expect(b.wave).toBe(w1);
    expect(b.status).toBe('ready');
  });
});

describe('pvp 波次硬同步：上一波未清也能强制开下一波（旧怪存活）', () => {
  it('pvp 下 waveActive=true（仍在打上一波）→ startNextWave 仍返回 true、wave+1、旧怪保留', () => {
    const b = mkPvp();
    // 手动开第 1 波并放进若干活怪，模拟「还在打上一波」。
    expect(b.startNextWave()).toBe(true);
    expect(b.wave).toBe(1);
    // 直接塞几只活怪当「上一波残留」（测试辅助，确定性）：不从 spawn 系统走，避免数量依赖。
    b.monsters.push(
      { dist: 5, hp: 9999, maxHp: 9999, kind: 'test', slow: 0, burn: 0, poison: 0, stun: 0, shield: 0, speed: 1 } as any,
      { dist: 6, hp: 9999, maxHp: 9999, kind: 'test', slow: 0, burn: 0, poison: 0, stun: 0, shield: 0, speed: 1 } as any,
    );
    const leftoverBefore = b.monsters.length;
    expect(leftoverBefore).toBeGreaterThan(0);

    // 硬同步：waveActive 仍为 true（旧怪没清），但 pvp 下 startNextWave 放行 → 强制切到第 2 波。
    expect(b.waveActive).toBe(true);
    const opened = b.startNextWave();
    expect(opened).toBe(true);
    expect(b.wave).toBe(2);
    expect(b.waveActive).toBe(true);
    // 旧怪必须存活（硬同步不清场）：数量不降；本波新怪也开始陆续出场（spawnRemaining>0）。
    expect(b.monsters.length).toBe(leftoverBefore);
    expect(b.spawnRemaining).toBeGreaterThan(0);
  });

  it('旧怪留存下仍可正常清波：spawnRemaining 归零 + 全部怪死 → waveActive 才转 false', () => {
    const b = mkPvp();
    b.startNextWave(); // wave 1
    b.monsters.push({ dist: 5, hp: 9999, maxHp: 9999, kind: 'test', slow: 0, burn: 0, poison: 0, stun: 0, shield: 0, speed: 1 } as any);
    b.startNextWave(); // wave 2（旧怪留存，硬同步）
    expect(b.monsters.length).toBe(1);
    // 本波新怪要生成：手动把 spawnRemaining 置 0 模拟本波已刷完，再清掉所有怪 → 触发清波判定。
    b.spawnRemaining = 0;
    b.forceClearWaveForTest();
    expect(b.status).toBe('ready');
    expect(b.waveActive).toBe(false);
  });

  it('单人零回归：waveActive=true → startNextWave 仍返回 false（单人保持「清完再开」）', () => {
    const b = mkSolo();
    // 单人：手动开第 1 波进入活动态。
    expect(b.startNextWave()).toBe(true);
    expect(b.waveActive).toBe(true);
    // 未清波时再开 → 被 waveActive 闸门挡回（非 pvp 不放行）。
    expect(b.startNextWave()).toBe(false);
    expect(b.wave).toBe(1); // 波次没动
  });
});

describe('pvp 第 1 波等唐僧归位（introDone 闸门）', () => {
  it('PvP 下 intro 期间 introDone=false；step 到归位后 introDone 才转 true', () => {
    const b = mkPvp();
    expect(b.introDone).toBe(false);
    // INTRO_DUR=6s @30Hz；step 到归位前 introDone 仍 false（少 1 步确保严格未到阈值）。
    for (let i = 0; i < 179; i++) b.step(1 / 30);
    expect(b.introDone).toBe(false);
    // 多走几步（180 步 × 1/30 浮点累计可能微欠 6.0，多走几步兜底）→ introT 达 INTRO_DUR → PvP intro 分支置 introDone。
    for (let i = 0; i < 5; i++) b.step(1 / 30);
    expect(b.introDone).toBe(true);
  });
});
