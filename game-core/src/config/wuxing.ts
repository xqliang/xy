// 五行相克：金→木→土→水→火→金（箭头=克制方）。
// 倍率由调用方传入（web 侧来自 TUNING，可 DevTools 热改），core 不持有游戏态。
export type Element = 'metal' | 'wood' | 'water' | 'fire' | 'earth';

export interface ElementMeta {
  id: Element;
  zh: string;   // 中文名（徽章/帮助文案用）
  color: string; // 主题色（徽章底色/克制飘字用）
}

/** 五元素顺序元数据（金木水火土），表现层统一取这里的中文与色值 */
export const ELEMENTS: ElementMeta[] = [
  { id: 'metal', zh: '金', color: '#e8b423' },
  { id: 'wood', zh: '木', color: '#4caf50' },
  { id: 'water', zh: '水', color: '#3d8bff' },
  { id: 'fire', zh: '火', color: '#f4511e' },
  { id: 'earth', zh: '土', color: '#a1743c' },
];

export const ELEMENT_ZH: Record<Element, string> = Object.fromEntries(
  ELEMENTS.map((e) => [e.id, e.zh]),
) as Record<Element, string>;

export const ELEMENT_COLOR: Record<Element, string> = Object.fromEntries(
  ELEMENTS.map((e) => [e.id, e.color]),
) as Record<Element, string>;

/** 克制环：key 克 value（金克木、木克土、土克水、水克火、火克金） */
const OVERCOMES: Record<Element, Element> = {
  metal: 'wood',
  wood: 'earth',
  earth: 'water',
  water: 'fire',
  fire: 'metal',
};

/**
 * 克制倍率：atk 克 def → advMul；atk 被克 → disMul；其余（含同行/任一方 null）→ 1。
 * 兵种（无属性）与无属性目标一律不吃克制。
 */
export function elementMul(
  atk: Element | null,
  def: Element | null,
  advMul = 1.25,
  disMul = 0.75,
): number {
  if (!atk || !def) return 1;
  if (OVERCOMES[atk] === def) return advMul;
  if (OVERCOMES[def] === atk) return disMul;
  return 1;
}
