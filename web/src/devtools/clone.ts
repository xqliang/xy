/** 深拷贝 JSON 可序列化对象（调参默认值快照用） */
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 把 source 的字段写回 target（保持 target 引用；数组按索引覆写并截断） */
export function assignDeep(target: unknown, source: unknown): void {
  if (target === source) return;
  if (Array.isArray(target) && Array.isArray(source)) {
    target.length = 0;
    for (const item of source) {
      if (item !== null && typeof item === 'object') {
        const copy = Array.isArray(item) ? [] : {};
        assignDeep(copy, item);
        target.push(copy);
      } else {
        target.push(item);
      }
    }
    return;
  }
  if (!target || !source || typeof target !== 'object' || typeof source !== 'object') return;
  const t = target as Record<string, unknown>;
  const s = source as Record<string, unknown>;
  for (const key of Object.keys(s)) {
    const sv = s[key];
    const tv = t[key];
    if (sv !== null && typeof sv === 'object') {
      if (tv !== null && typeof tv === 'object') {
        assignDeep(tv, sv);
      } else {
        t[key] = deepClone(sv);
      }
    } else {
      t[key] = sv;
    }
  }
}

export interface DiffEntry {
  path: string;
  from: unknown;
  to: unknown;
}

export function collectDiffs(current: unknown, defaults: unknown, path = ''): DiffEntry[] {
  if (Object.is(current, defaults)) return [];
  if (typeof current !== typeof defaults || current === null || defaults === null
    || typeof current !== 'object' || typeof defaults !== 'object') {
    return [{ path: path || '(root)', from: defaults, to: current }];
  }
  if (Array.isArray(current) || Array.isArray(defaults)) {
    if (!Array.isArray(current) || !Array.isArray(defaults)) {
      return [{ path: path || '(root)', from: defaults, to: current }];
    }
    const out: DiffEntry[] = [];
    const len = Math.max(current.length, defaults.length);
    for (let i = 0; i < len; i++) {
      out.push(...collectDiffs(current[i], defaults[i], `${path || '(root)'}[${i}]`));
    }
    return out;
  }
  const out: DiffEntry[] = [];
  const keys = new Set([...Object.keys(current as object), ...Object.keys(defaults as object)]);
  for (const key of keys) {
    const next = path ? `${path}.${key}` : key;
    out.push(...collectDiffs(
      (current as Record<string, unknown>)[key],
      (defaults as Record<string, unknown>)[key],
      next,
    ));
  }
  return out;
}

export function formatDiffValue(v: unknown): string {
  if (typeof v === 'number') {
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
  }
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
