// 平台适配层：隔离 Web / 微信小游戏 的运行时差异。
// 关键约束：所有 Web 分支的返回值与原生调用完全一致 —— 保证本地调试(vite)与服务器部署零行为变化。
// 对 wx 的访问一律在 isWeChat 守卫之后，Web 端不会触碰未定义的 wx。

declare const wx: any; // eslint-disable-line @typescript-eslint/no-explicit-any

// 是否运行在微信小游戏环境（wx.createCanvas 是小游戏特有 API）
export const isWeChat: boolean =
  typeof wx !== 'undefined' && typeof wx.createCanvas === 'function';

// 主画布：Web = 页面 <canvas id="game">；微信 = wx.createCanvas() 返回的主屏画布。
export function getGameCanvas(): HTMLCanvasElement {
  if (isWeChat) {
    // 小游戏主画布无 DOM 属性：补 style（防 main.ts resize 里 canvas.style.width= 崩）+
    // getBoundingClientRect（全屏、左上角为原点），让 web 侧画布尺寸/坐标代码零改动跑通。
    const c = wx.createCanvas() as {
      style?: Record<string, string>; width: number; height: number;
      getBoundingClientRect?: () => DOMRect;
      addEventListener?: () => void; removeEventListener?: () => void;
      setPointerCapture?: () => void; releasePointerCapture?: () => void;
    };
    if (!c.style) c.style = {};
    if (typeof c.getBoundingClientRect !== 'function') {
      c.getBoundingClientRect = () => ({ left: 0, top: 0, right: c.width, bottom: c.height, width: c.width, height: c.height, x: 0, y: 0, toJSON() { return this; } } as DOMRect);
    }
    // wx 画布无 DOM 事件/指针捕获 API：补 no-op，让 web 侧 canvas.addEventListener('pointer…')/setPointerCapture
    // 调用不崩（小游戏输入实际走 platform.onWxTouch → 合成 PointerEvent）。
    const noop = () => { /* wx canvas 无此 DOM API */ };
    if (typeof c.addEventListener !== 'function') c.addEventListener = noop;
    if (typeof c.removeEventListener !== 'function') c.removeEventListener = noop;
    if (typeof c.setPointerCapture !== 'function') c.setPointerCapture = noop;
    if (typeof c.releasePointerCapture !== 'function') c.releasePointerCapture = noop;
    return c as unknown as HTMLCanvasElement;
  }
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

// 网络恢复通知（弱网优化③用）：微信用 wx.onNetworkStatusChange 的 isConnected=true，
// Web 用 window 'online' 事件。供 PvP 断线等退避时立即重连；不可用环境下 no-op。
export function onNetworkOnline(cb: () => void): void {
  if (isWeChat && typeof wx.onNetworkStatusChange === 'function') {
    wx.onNetworkStatusChange((res: { isConnected: boolean }) => { if (res.isConnected) cb(); });
  } else if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('online', cb);
  }
}

// —— 好友邀请（PvP 深链/分享）——
// Web：好友邀请走 URL ?versus=<房号>，发起方复制链接、好友打开链接即加入。
// 小游戏：无 URL——发起方用 wx.shareAppMessage 弹分享卡片(query 带房号)，好友点卡片启动小游戏，
//         启动参数 query.versus 里带房号；已在前台则由 wx.onShow 的 query 收到。

/** 读取邀请房号：Web 取 URL ?versus=；小游戏取启动参数 query.versus。无则 null。 */
export function getVersusInviteCode(): string | null {
  if (isWeChat) {
    try {
      const opts = typeof wx.getLaunchOptionsSync === 'function' ? wx.getLaunchOptionsSync() : null;
      const v = opts?.query?.versus;
      return typeof v === 'string' && v ? v : null;
    } catch { return null; }
  }
  try { return new URLSearchParams(location.search).get('versus'); } catch { return null; }
}

/** 分享邀请：小游戏弹微信分享卡片(query 带房号，好友点开即进)，返回 true；Web/无 wx 返回 false（由调用方复制链接）。 */
export function shareVersusInvite(code: string, title: string): boolean {
  if (isWeChat && typeof wx.shareAppMessage === 'function') {
    try {
      wx.shareAppMessage({ title, query: 'versus=' + encodeURIComponent(code) });
      return true;
    } catch { return false; }
  }
  return false;
}

/** 小游戏温启动（已在前台）收到分享卡片点击：onShow 带 query.versus 时回调房号。Web/无 wx 为 no-op。 */
export function onWxShowVersus(cb: (code: string) => void): void {
  if (isWeChat && typeof wx.onShow === 'function') {
    wx.onShow((res: { query?: Record<string, string> }) => {
      const v = res?.query?.versus;
      if (typeof v === 'string' && v) cb(v);
    });
  }
}

// —— 触摸输入（小游戏）——
// Web 用 canvas 的 pointer 事件；小游戏无 pointer，改用 wx.onTouch* 全局事件。此处仅在微信下把四类
// 触摸交给上层（main.ts 合成 PointerEvent 复用同一套指针逻辑）；Web 下 no-op 返回 false（走原 pointer 绑定）。
export interface WxTouch { clientX: number; clientY: number; identifier: number; }
export interface WxTouchEvent { touches: WxTouch[]; changedTouches: WxTouch[]; }
export function onWxTouch(h: {
  start: (e: WxTouchEvent) => void; move: (e: WxTouchEvent) => void;
  end: (e: WxTouchEvent) => void; cancel: (e: WxTouchEvent) => void;
}): boolean {
  if (!isWeChat) return false;
  wx.onTouchStart(h.start); wx.onTouchMove(h.move); wx.onTouchEnd(h.end); wx.onTouchCancel(h.cancel);
  return true;
}

// 微信登录：wx.login 拿临时 code（换 openid 用）。Web/无 wx 返回 null。
export function wxLogin(): Promise<string | null> {
  if (!(isWeChat && typeof wx.login === 'function')) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      wx.login({
        success: (res: { code?: string }) => resolve(res?.code || null),
        fail: () => resolve(null),
      });
    } catch { resolve(null); }
  });
}
