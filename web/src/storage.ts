// 跨平台键值存储：Web = localStorage（行为与直接调用完全一致），微信小游戏 = wx storage。
// 目的：让 rank/stamina/merit/weapons/sfx 等持久化在微信端也可用，且 **Web 端零行为变化**，
// 不影响本地调试与服务器部署。所有对 wx 的访问都在 typeof 守卫后。

declare const wx: any; // eslint-disable-line @typescript-eslint/no-explicit-any
const useWxStore = typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function';

// 读取字符串值；不存在返回 null（与 localStorage.getItem 语义一致）
export function storeGet(key: string): string | null {
  try {
    if (useWxStore) {
      const v = wx.getStorageSync(key);
      return v === '' || v == null ? null : String(v); // 微信未命中返回 ''，归一为 null
    }
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// 写入字符串值（失败静默，与现有 try/catch 用法一致）
export function storeSet(key: string, val: string): void {
  try {
    if (useWxStore) { wx.setStorageSync(key, val); return; }
    localStorage.setItem(key, val);
  } catch {
    /* ignore */
  }
}
