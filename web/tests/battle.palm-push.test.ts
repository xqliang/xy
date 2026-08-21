// 如来神掌击退回归：验证「把怪推回出口（路径起点）怪不会消失」。
// 行为契约（排查结论，非 bug）：神掌回推把 m.dist clamp 在路径起点（Math.max(0,...)），
// 怪停留在入口格——可见、可被攻击、继续朝唐僧前进；只有两种途径移除怪：
//   1) 被击杀（hp<=0，见 step 的 survivors 过滤）；2) 走到终点撞唐僧（dist>=pathLen，扣血后移除）。
// 回推本身绝不删怪 → 波次也绝不会因回推而「清空」。
// 注：startNextWave 后怪经 spawnRemaining 队列分批进场（非同步 push），需先步进等怪在场。
import { describe, it, expect } from 'vitest';
import { Battle, NO_META, TUNING } from '../src/battle';
import { MAPS } from '../src/board';

const mk = (mapIdx: number) =>
  new Battle(4242, 1, MAPS[mapIdx]!, NO_META, {}, [], [], false, undefined, 1, undefined, undefined);

describe('如来神掌击退不删怪（推回出口不消失）', () => {
  it('神掌把贴入口的怪推到路径起点后：怪仍在场、dist>=0、hp>0', () => {
    for (let mapIdx = 0; mapIdx < MAPS.length; mapIdx++) {
      const b = mk(mapIdx);
      b.introT = Battle.INTRO_DUR + 1;
      b.introDone = true;
      expect(b.startNextWave()).toBe(true);
      // 等怪从 spawnRemaining 队列进场（上限 10s 防死循环）。
      for (let s = 0; s < 300 && b.monsters.length === 0; s++) b.step(1 / 30);
      expect(b.monsters.length).toBeGreaterThan(0);
      const before = b.monsters.length;
      // 把在场怪摆到贴着入口的位置（dist=1），确保 7 格（TUNING.palmPushCells）回推必触底 clamp。
      for (const m of b.monsters) m.dist = 1;
      (b as unknown as { startPalmPush: (cells: number, ai?: boolean) => void }).startPalmPush(TUNING.palmPushCells);
      // 推进刚好覆盖神掌动画 + 渐隐时长（0.8+0.2s，留裕量取 1.2s）——回推后的 clamp 已落地。
      // （不长跑：怪多走几秒会自己到终点撞唐僧被正常移除，那是另一条合法移除路径，与本回归无关。）
      for (let s = 0; s < 36; s++) b.step(1 / 30);
      // 核心断言：推到底的怪没消失——数量不减（新怪可能还在进场，只多不少），个体没死。
      expect(b.monsters.length).toBeGreaterThanOrEqual(before);
      for (const m of b.monsters) {
        expect(m.dist).toBeGreaterThanOrEqual(0); // 击退钳制在路径起点，不为负
        expect(m.hp).toBeGreaterThan(0);          // 没被回推「杀死」
      }
    }
  });
});
