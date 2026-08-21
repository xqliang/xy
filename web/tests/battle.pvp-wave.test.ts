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
