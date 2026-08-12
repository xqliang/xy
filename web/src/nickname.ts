/** 昵称权重上限：中文（含全角）计 2，其余计 1。 */
export const NICKNAME_MAX_WEIGHT = 20;

/** 单字权重：CJK / 全角 = 2，其它 = 1 */
export function charNicknameWeight(ch: string): number {
  const code = ch.codePointAt(0);
  if (code === undefined) return 0;
  if (
    (code >= 0x4e00 && code <= 0x9fff) // CJK 统一汉字
    || (code >= 0x3400 && code <= 0x4dbf) // 扩展 A
    || (code >= 0xf900 && code <= 0xfaff) // 兼容汉字
    || (code >= 0x3000 && code <= 0x303f) // CJK 标点
    || (code >= 0xff00 && code <= 0xffef) // 全角
  ) {
    return 2;
  }
  return 1;
}

export function nicknameWeight(s: string): number {
  let w = 0;
  for (const ch of s) w += charNicknameWeight(ch);
  return w;
}

/** 截断到不超过 max 权重（不半截多字节码点） */
export function clampNickname(s: string, max = NICKNAME_MAX_WEIGHT): string {
  let out = '';
  let w = 0;
  for (const ch of s) {
    const cw = charNicknameWeight(ch);
    if (w + cw > max) break;
    out += ch;
    w += cw;
  }
  return out;
}
