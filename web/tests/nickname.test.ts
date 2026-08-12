import { describe, it, expect } from 'vitest';
import { charNicknameWeight, clampNickname, nicknameWeight, NICKNAME_MAX_WEIGHT } from '../src/nickname';

describe('nickname weight', () => {
  it('中文计 2，英文计 1', () => {
    expect(charNicknameWeight('测')).toBe(2);
    expect(charNicknameWeight('a')).toBe(1);
    expect(nicknameWeight('测试侠')).toBe(6);
    expect(nicknameWeight('hello')).toBe(5);
    expect(nicknameWeight('测a试')).toBe(5);
  });

  it('clamp 到上限 20', () => {
    expect(NICKNAME_MAX_WEIGHT).toBe(20);
    expect(clampNickname('一二三四五六七八九十')).toBe('一二三四五六七八九十'); // 20
    expect(clampNickname('一二三四五六七八九十甲')).toBe('一二三四五六七八九十'); // 22→20
    expect(clampNickname('abcdefghijabcdefghijX')).toBe('abcdefghijabcdefghij');
    expect(clampNickname('测abcdefghij')).toBe('测abcdefghij'); // 2+10=12
  });
});
