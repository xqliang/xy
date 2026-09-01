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

/**
 * 异步写入（session 落档专用，2026-09-01 低端机卡顿修复）：
 * 微信端 wx.setStorageSync 是同步跨进程 IPC——战斗中每次玩家输入（征兵/部署/合并…）
 * 触发的 500ms 节流落档 + 2s 保底心跳，在低端机上都是一帧内几十 ms 的同步阻塞
 * （用户感知：征兵后连续操作「卡一段时间」、空闲时每 2s 周期性微顿）。
 * 这里改用异步 wx.setStorage（fire-and-forget，fail 静默），把 IPC 移出 JS 线程；
 * 序列化（JSON.stringify）仍同步在调用方完成——保证快照一致性，且成本远小于 IPC。
 * Web/其它端无 IPC（localStorage 是内存操作），保持同步 setItem 行为零变化。
 * 旧内核缺 wx.setStorage 时回退同步版，保住持久化语义。
 */
export function storeSetAsync(key: string, val: string): void {
  try {
    if (useWxStore) {
      if (typeof wx.setStorage === 'function') {
        wx.setStorage({ key, data: val, fail: () => { /* 静默：与 storeSet 吞异常一致 */ } });
        return;
      }
      wx.setStorageSync(key, val); // 旧内核兜底
      return;
    }
    localStorage.setItem(key, val);
  } catch {
    /* ignore */
  }
}

/** 删除键（DevTools 重置本地进度用） */
export function storeRemove(key: string): void {
  try {
    if (useWxStore) { wx.removeStorageSync(key); return; }
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** 有限数值：非 number / NaN / Infinity 时回退 fallback，并可 clamp */
export function safeNumber(value: unknown, fallback: number, min?: number, max?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  let n = value;
  if (min != null) n = Math.max(min, n);
  if (max != null) n = Math.min(max, n);
  return n;
}

/** 字符串数组：过滤非字符串与空串 */
export function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

/** 解析 localStorage JSON；normalize 返回 null 表示无效，回退 fallback */
export function parseStoredJson<T>(
  raw: string | null,
  normalize: (value: unknown) => T | null,
  fallback: T,
): T {
  if (raw == null || raw === '') return fallback;
  try {
    return normalize(JSON.parse(raw)) ?? fallback;
  } catch {
    return fallback;
  }
}
