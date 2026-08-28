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
  { id: 'general', name: '将军', unlockType: 'rank', unlockValue: 3, art: 'hero-hongpao' },
  { id: 'yaoguai', name: '小妖', unlockType: 'rank', unlockValue: 4, art: 'monster-minion' },
  { id: 'longwang', name: '龙王', unlockType: 'rank', unlockValue: 5, art: 'hero-bailong' },
  { id: 'clear_1', name: '初通行者', unlockType: 'clear', unlockValue: 1, art: 'hero-liusha' },
  { id: 'clear_3', name: '三通行者', unlockType: 'clear', unlockValue: 3, art: 'hero-laojun' },
  { id: 'clear_5', name: '五通行者', unlockType: 'clear', unlockValue: 5, art: 'hero-wenshu' },
  { id: 'clear_10', name: '十通行者', unlockType: 'clear', unlockValue: 10, art: 'hero-niumowang' },
];

export function avatarById(id: string): AvatarDef | undefined {
  return AVATARS.find((a) => a.id === id);
}

/** 立绘内容框（归一化 0..1，相对源图画布）：各 hero 素材的裁剪/留白不一致，
 *  头像卡片按此框做「等高」统一缩放，保证选择列表里所有立绘视觉大小一致。
 *  数值由离线脚本按 alpha>40 的内容 bbox 量得；更换对应 PNG 后需重新量取。 */
export interface ArtFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

const FULL: ArtFrame = { x: 0, y: 0, w: 1, h: 1 };

export const ART_FRAMES: Record<string, ArtFrame> = {
  'hero-wukong': { x: 0.0022, y: 0.0013, w: 0.9933, h: 0.9974 },
  'hero-tangseng-hero': { x: 0.0020, y: 0.0038, w: 0.9960, h: 0.9949 },
  'hero-bajie': { x: 0.0000, y: 0.0013, w: 1.0000, h: 0.9974 },
  'hero-shaseng': { x: 0.0020, y: 0.0013, w: 0.9959, h: 0.9974 },
  'hero-nezha': { x: 0.0112, y: 0.0038, w: 0.9870, h: 0.9885 },
  'hero-erlang': { x: 0.0019, y: 0.0013, w: 0.9962, h: 0.9974 },
  'hero-guanyin': { x: 0.0034, y: 0.0013, w: 0.9966, h: 0.9974 },
  'hero-laojun': { x: 0.159, y: 0.0167, w: 0.6641, h: 0.9641 },
  'hero-wenshu': { x: 0.1821, y: 0.0346, w: 0.6436, h: 0.9321 },
  'hero-jinzha': { x: 0.0256, y: 0.0179, w: 0.8064, h: 0.9744 },
  'hero-niulang': { x: 0.2115, y: 0.0603, w: 0.6, h: 0.8641 },
  'hero-mile': { x: 0, y: 0.0029, w: 0.9974, h: 0.9956 },
  'hero-fanyin': { x: 0.259, y: 0.0654, w: 0.4923, h: 0.8667 },
  'hero-hongpao': { x: 0.1462, y: 0.0013, w: 0.7154, h: 0.9987 },
  'monster-minion': { x: 0.0061, y: 0.0033, w: 0.9939, h: 0.9967 },
  'hero-bailong': { x: 0.1923, y: 0.0192, w: 0.6885, h: 0.9577 },
  'hero-liusha': { x: 0.1256, y: 0.0231, w: 0.75, h: 0.9538 },
  'hero-niumowang': { x: 0.0032, y: 0.0028, w: 0.9919, h: 0.9944 },
};

export function artFrame(art: string): ArtFrame {
  return ART_FRAMES[art] ?? FULL;
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
