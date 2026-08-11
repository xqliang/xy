// 平台适配层：隔离 Web / 微信小游戏 的运行时差异。
// 关键约束：所有 Web 分支的返回值与原生调用完全一致 —— 保证本地调试(vite)与服务器部署零行为变化。
// 对 wx 的访问一律在 isWeChat 守卫之后，Web 端不会触碰未定义的 wx。

declare const wx: any; // eslint-disable-line @typescript-eslint/no-explicit-any

// 是否运行在微信小游戏环境（wx.createCanvas 是小游戏特有 API）
export const isWeChat: boolean =
  typeof wx !== 'undefined' && typeof wx.createCanvas === 'function';

// 主画布：Web = 页面 <canvas id="game">；微信 = wx.createCanvas() 返回的主屏画布。
export function getGameCanvas(): HTMLCanvasElement {
  if (isWeChat) return wx.createCanvas();
  return document.getElementById('game') as HTMLCanvasElement;
}

// 音频上下文：Web = AudioContext；微信 = wx.createWebAudioContext()（API 兼容 WebAudio）。
export function createAudioContext(): AudioContext | null {
  try {
    if (isWeChat && typeof wx.createWebAudioContext === 'function') {
      return wx.createWebAudioContext() as AudioContext;
    }
    const AC =
      (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    return AC ? new AC() : null;
  } catch {
    return null;
  }
}

// 图片对象：Web = new Image()；微信 = wx.createImage()。
export function createImage(): HTMLImageElement {
  if (isWeChat) return wx.createImage();
  return new Image();
}

// 离屏画布（用于生成「空手」立绘等）：Web = document.createElement；微信 = wx.createCanvas。
export function createOffscreenCanvas(width: number, height: number): HTMLCanvasElement {
  const c = (isWeChat ? wx.createCanvas() : document.createElement('canvas')) as HTMLCanvasElement;
  c.width = width;
  c.height = height;
  return c;
}

// 应用前后台生命周期：仅微信下生效（对齐"切后台/看广告时暂停"）；Web 下为 no-op，行为不变。
export function onAppHide(cb: () => void): void {
  if (isWeChat && typeof wx.onHide === 'function') wx.onHide(cb);
}
export function onAppShow(cb: () => void): void {
  if (isWeChat && typeof wx.onShow === 'function') wx.onShow(cb);
}
