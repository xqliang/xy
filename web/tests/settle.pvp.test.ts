// PvP 结算屏纯逻辑测试：reason 契约串 → 中文文案映射（Task 11）。
import { describe, it, expect } from 'vitest';
import { pvpReasonText } from '../src/settle';

describe('pvpReasonText', () => {
  it('胜方 reason → 对手相关中文', () => {
    expect(pvpReasonText('opponentTangsengDead')).toBe('对手唐僧被消灭');
    expect(pvpReasonText('opponentSurrender')).toBe('对手认输');
    expect(pvpReasonText('opponentDisconnectTimeout')).toBe('对手掉线');
  });
  it('负方 reason → 本方相关中文', () => {
    expect(pvpReasonText('selfTangsengDead')).toBe('你的唐僧被消灭');
    expect(pvpReasonText('selfSurrender')).toBe('你已认输');
    expect(pvpReasonText('selfDisconnect')).toBe('你已掉线');
  });
  it('平局 reason', () => {
    expect(pvpReasonText('draw')).toBe('势均力敌');
  });
  it('未知 reason 回退', () => {
    expect(pvpReasonText('somethingUnknown')).toBe('对局结束');
    expect(pvpReasonText('')).toBe('对局结束');
  });
});
