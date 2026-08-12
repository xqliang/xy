// 与 server/avatar_catalog.py 对齐的静态头像表。
export type AvatarUnlockType = 'default' | 'rank' | 'clear';

export interface AvatarDef {
  id: string;
  name: string;
  unlockType: AvatarUnlockType;
  unlockValue: number;
  /** assets sprite key */
  art: string;
}

export const AVATARS: AvatarDef[] = [
  { id: 'wukong', name: '齐天大圣', unlockType: 'default', unlockValue: 0, art: 'hero-wukong' },
  { id: 'tangseng', name: '唐僧', unlockType: 'default', unlockValue: 0, art: 'hero-tangseng-hero' },
  { id: 'bajie', name: '猪八戒', unlockType: 'default', unlockValue: 0, art: 'hero-bajie' },
  { id: 'wujing', name: '沙悟净', unlockType: 'default', unlockValue: 0, art: 'hero-shaseng' },
  { id: 'neza', name: '哪吒', unlockType: 'default', unlockValue: 0, art: 'hero-nezha' },
  { id: 'erlang', name: '二郎神', unlockType: 'default', unlockValue: 0, art: 'hero-erlang' },
  { id: 'guanyin', name: '观音', unlockType: 'default', unlockValue: 0, art: 'hero-guanyin' },
  { id: 'laojun', name: '太上老君', unlockType: 'default', unlockValue: 0, art: 'hero-laojun' },
  { id: 'wenshu', name: '文殊', unlockType: 'default', unlockValue: 0, art: 'hero-wenshu' },
  { id: 'tianbing', name: '天兵', unlockType: 'default', unlockValue: 0, art: 'hero-jinzha' },
  { id: 'poet', name: '布衣诗人', unlockType: 'default', unlockValue: 0, art: 'hero-niulang' },
  { id: 'lantern', name: '提灯老头', unlockType: 'default', unlockValue: 0, art: 'hero-mile' },
  { id: 'pipa', name: '琵琶女', unlockType: 'rank', unlockValue: 2, art: 'hero-fanyin' },
  { id: 'general', name: '将军', unlockType: 'rank', unlockValue: 3, art: 'hero-erlang' },
  { id: 'yaoguai', name: '小妖', unlockType: 'rank', unlockValue: 4, art: 'hero-honghaier' },
  { id: 'longwang', name: '龙王', unlockType: 'rank', unlockValue: 5, art: 'hero-bailong' },
  { id: 'clear_1', name: '初通行者', unlockType: 'clear', unlockValue: 1, art: 'hero-shaseng' },
  { id: 'clear_3', name: '三通行者', unlockType: 'clear', unlockValue: 3, art: 'hero-laojun' },
  { id: 'clear_5', name: '五通行者', unlockType: 'clear', unlockValue: 5, art: 'hero-wenshu' },
  { id: 'clear_10', name: '十通行者', unlockType: 'clear', unlockValue: 10, art: 'hero-niumowang' },
];

export function avatarById(id: string): AvatarDef | undefined {
  return AVATARS.find((a) => a.id === id);
}

export function unlockHint(a: AvatarDef): string {
  if (a.unlockType === 'default') return '已解锁';
  if (a.unlockType === 'rank') return `境界达到「${a.unlockValue}」档解锁`;
  return `通关 ${a.unlockValue} 局解锁`;
}

export function maskUid(uid: string): string {
  if (uid.length <= 4) return `***${uid}`;
  return `***${uid.slice(-4)}`;
}
