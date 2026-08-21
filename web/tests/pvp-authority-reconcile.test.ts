// 在线 PvP Bug1·因3 修复：用服务端权威 digest/status 纠正「对手半场」唐僧存活显示，
// 兜底本地 oppBattle 重放的发散假象（防「唐僧被吃、实际没被吃」）。
// reconcileOppAlive 是纯函数：给定权威 digest+status，返回该覆盖的 {tangsengHP, defeated}（null=保留本地重放值）。
import { describe, it, expect } from 'vitest';
import { reconcileOppAlive } from '../src/pvp-battle';
import type { PvpDigest } from '../src/api/pvp-client';

// 造一个只关心 tangsengHP 的 digest（其余字段对本函数无影响）。
const dig = (tangsengHP: number): PvpDigest => ({ wave: 1, power: 0, kills: 0, tangsengHP, peach: 0, units: 0 });

describe('reconcileOppAlive：服务端权威纠正对手半场存活', () => {
  it('opponentStatus=tangsengDead → 判死（血归零、defeated=true），status 权威优先', () => {
    // 即便 digest 仍显示血>0（延迟），对手自报唐僧死且服务端确认即判死。
    expect(reconcileOppAlive(dig(500), 'tangsengDead')).toEqual({ tangsengHP: 0, defeated: true });
  });

  it('有 digest 且 tangsengHP>0 → 存活（禁止本地重放的假死显示）', () => {
    // 这是核心修复：本地 oppBattle 可能因丢命令误判对手唐僧死，但权威血>0 时必须显示存活。
    expect(reconcileOppAlive(dig(300), 'playing')).toEqual({ tangsengHP: 300, defeated: false });
  });

  it('有 digest 且 tangsengHP<=0 → 判死', () => {
    expect(reconcileOppAlive(dig(0), 'playing')).toEqual({ tangsengHP: 0, defeated: true });
  });

  it('对手断线但权威血>0 → 仍显示存活（判负走服务端 DisconnectTimeout→result，不在此处判死）', () => {
    expect(reconcileOppAlive(dig(120), 'disconnected')).toEqual({ tangsengHP: 120, defeated: false });
  });

  it('对手认输但权威血>0 → 不显示唐僧死（认输由结算屏解释，非唐僧被吃）', () => {
    expect(reconcileOppAlive(dig(120), 'surrendered')).toEqual({ tangsengHP: 120, defeated: false });
  });

  it('尚无 digest（开局首 tick 前，playing）→ 两字段 null，调用方保留桥接的本地重放值', () => {
    expect(reconcileOppAlive(null, 'playing')).toEqual({ tangsengHP: null, defeated: null });
  });
});
