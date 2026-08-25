// 开发者标记（DevTools 可开）：跨模块读取的轻量 localStorage 开关。
// 与 play-history.ts 同形态（直接走 storage.ts）。之所以单独成模块、而非塞进 devtools/：
//   render.ts / main.ts 等**非懒加载**模块需要**同步**读取这些开关（每帧 draw/hit 都过），
//   而 devtools/panel.ts 是懒加载 bundle——若 render.ts import devtools 会把整个 DevTools
//   打进首屏，违背懒加载。故凡「非 DevTools 模块要读、DevTools 可写」的开关都放这里：
//   写路径（DevTools 面板）import 本模块，读路径（render/main）也只 import 本模块，零循环、零首屏膨胀。
import { storeGet, storeSet } from './storage';

const KEY_SHOW_AUTOPLACE = 'dasheng.dev.showAutoplaceBtn';

/**
 * 是否显示底部「布阵」按钮（一键布阵）。
 * 默认隐藏（首次玩家体验：避免布阵入口分散注意力、与动态引导抢戏）；
 * 仅 DevTools 面板勾选「显示布阵按钮」后才显示，供测试 / 演示 / 老玩家使用。
 * render.ts 的 getButtons() 据此决定是否放入该按钮（draw 与 hit 共享同一列表，隐藏则两处一起消失）。
 */
export function showAutoplaceBtn(): boolean {
  return storeGet(KEY_SHOW_AUTOPLACE) === '1';
}

/** DevTools 面板写：切换「显示布阵按钮」。 */
export function setShowAutoplaceBtn(on: boolean): void {
  storeSet(KEY_SHOW_AUTOPLACE, on ? '1' : '0');
}

const KEY_WUXING = 'dasheng.dev.wuxing';

/** 五行开关缓存：render 每帧画徽章、battle 每次命中算倍率都要读，避免高频 localStorage 同步 IO。 */
let wuxingCache: boolean | null = null;

/**
 * 五行相克总开关（默认开）。
 * 关闭后：克制/被克伤害倍率一律按 1（hurtMonster / estimateOptimalPower 等全部生效点），
 * 伤害飘字不再出现「克」前缀与金/灰样式，棋盘武将与怪物头顶、图鉴的五行徽章全部隐藏。
 * 供 DevTools 对比「有无五行」的手感与平衡差异。
 */
export function wuxingEnabled(): boolean {
  if (wuxingCache === null) wuxingCache = storeGet(KEY_WUXING) !== '0';
  return wuxingCache;
}

/** DevTools 面板写：切换「五行相克」。 */
export function setWuxingEnabled(on: boolean): void {
  storeSet(KEY_WUXING, on ? '1' : '0');
  wuxingCache = on;
}
