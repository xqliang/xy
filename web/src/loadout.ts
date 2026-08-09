// 主动/被动技能「每日购买 + 装备」持久化：跨局 localStorage，按自然日重置。
// 当日购买一次即拥有；可随时卸下/再装备，无需重复扣功德。跨天清空需重新购买。
import { storeGet, storeSet, parseStoredJson, safeNumber, safeStringArray } from './storage';
import { MAX_EQUIPPED_ACTIVES, activeById, isActiveEnabled } from './actives';
import { MAX_EQUIPPED_PASSIVES, passiveById, isPassiveEnabled } from './passives';
import { spendMerit, type MeritState } from './merit';

const KEY = 'dasheng.loadout';

// 自然日索引（与 stamina.ts 保持一致的算法）
function today(): number {
  return Math.floor(Date.now() / 86400000);
}

export interface LoadoutState {
  day: number;
  /** 今日已购买的主动技能（可反复装备） */
  ownedActives: string[];
  /** 今日已购买的被动技能（可反复装备） */
  ownedPassives: string[];
  /** 当前装备中的主动（⊆ ownedActives），最多 MAX_EQUIPPED_ACTIVES */
  equipped: string[];
  /** 当前装备中的被动（⊆ ownedPassives），最多 MAX_EQUIPPED_PASSIVES */
  passives: string[];
}

function emptyLoadout(): LoadoutState {
  return { day: today(), ownedActives: [], ownedPassives: [], equipped: [], passives: [] };
}

function save(s: LoadoutState): LoadoutState {
  try {
    storeSet(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
  return s;
}

function uniqKeepOrder(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** 规范化：剔下架、保证装备 ⊆ 拥有、截断装备上限 */
function normalize(s: LoadoutState): LoadoutState {
  const ownedActives = uniqKeepOrder(s.ownedActives.filter(isActiveEnabled));
  const ownedPassives = uniqKeepOrder(s.ownedPassives.filter(isPassiveEnabled));
  const ownedA = new Set(ownedActives);
  const ownedP = new Set(ownedPassives);
  // 旧档仅有 equipped/passives 时，装备项并入拥有
  for (const id of s.equipped) if (isActiveEnabled(id) && !ownedA.has(id)) {
    ownedActives.push(id);
    ownedA.add(id);
  }
  for (const id of s.passives) if (isPassiveEnabled(id) && !ownedP.has(id)) {
    ownedPassives.push(id);
    ownedP.add(id);
  }
  const equipped = uniqKeepOrder(s.equipped.filter((id) => ownedA.has(id))).slice(0, MAX_EQUIPPED_ACTIVES);
  const passives = uniqKeepOrder(s.passives.filter((id) => ownedP.has(id))).slice(0, MAX_EQUIPPED_PASSIVES);
  return { day: s.day, ownedActives, ownedPassives, equipped, passives };
}

function normalizeLoadoutRaw(raw: unknown): LoadoutState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const day = safeNumber(s.day, today(), 0);
  if (!Array.isArray(s.equipped)) return null;
  return normalize({
    day,
    ownedActives: safeStringArray(s.ownedActives).length > 0
      ? safeStringArray(s.ownedActives)
      : safeStringArray(s.equipped),
    ownedPassives: safeStringArray(s.ownedPassives).length > 0
      ? safeStringArray(s.ownedPassives)
      : safeStringArray(s.passives),
    equipped: safeStringArray(s.equipped),
    passives: safeStringArray(s.passives),
  });
}

// 读取装备；跨天则清空（需重新购买）
export function loadLoadout(): LoadoutState {
  const loaded = parseStoredJson(storeGet(KEY), normalizeLoadoutRaw, emptyLoadout());
  if (loaded.day !== today()) return save(emptyLoadout());
  return save(loaded);
}

export function isOwnedActive(s: LoadoutState, id: string): boolean {
  return s.ownedActives.includes(id);
}

export function isOwnedPassive(s: LoadoutState, id: string): boolean {
  return s.ownedPassives.includes(id);
}

export function isEquipped(s: LoadoutState, id: string): boolean {
  return s.equipped.includes(id);
}

export function isPassiveEquipped(s: LoadoutState, id: string): boolean {
  return s.passives.includes(id);
}

/** 装备槽已满时的提示（卸下腾位后再装备） */
export const ACTIVE_FULL_HINT = `已有 ${MAX_EQUIPPED_ACTIVES} 个装备中，请先卸下才能装备`;
export const PASSIVE_FULL_HINT = `已有 ${MAX_EQUIPPED_PASSIVES} 个装备中，请先卸下才能装备`;

// 购买：当日首次扣功德并拥有；有空位则自动装备。已拥有不可再买。
export function buyActive(
  loadout: LoadoutState,
  merit: MeritState,
  id: string,
): { loadout: LoadoutState; merit: MeritState; ok: boolean; reason?: string } {
  const def = activeById(id);
  if (!def) return { loadout, merit, ok: false, reason: '无此技能' };
  if (def.disabled) return { loadout, merit, ok: false, reason: '技能已下架' };
  if (isOwnedActive(loadout, id)) return { loadout, merit, ok: false, reason: '今日已购买' };
  if (merit.merit < def.cost) return { loadout, merit, ok: false, reason: '功德不足' };
  const nextMerit = spendMerit(merit, def.cost);
  const ownedActives = [...loadout.ownedActives, id];
  const equipped = loadout.equipped.length < MAX_EQUIPPED_ACTIVES
    ? [...loadout.equipped, id]
    : loadout.equipped;
  const nextLoadout = save(normalize({ ...loadout, day: today(), ownedActives, equipped }));
  return { loadout: nextLoadout, merit: nextMerit, ok: true };
}

export function buyPassive(
  loadout: LoadoutState,
  merit: MeritState,
  id: string,
): { loadout: LoadoutState; merit: MeritState; ok: boolean; reason?: string } {
  const def = passiveById(id);
  if (!def) return { loadout, merit, ok: false, reason: '无此技能' };
  if (def.disabled) return { loadout, merit, ok: false, reason: '技能已下架' };
  if (isOwnedPassive(loadout, id)) return { loadout, merit, ok: false, reason: '今日已购买' };
  if (merit.merit < def.cost) return { loadout, merit, ok: false, reason: '功德不足' };
  const nextMerit = spendMerit(merit, def.cost);
  const ownedPassives = [...loadout.ownedPassives, id];
  const passives = loadout.passives.length < MAX_EQUIPPED_PASSIVES
    ? [...loadout.passives, id]
    : loadout.passives;
  const nextLoadout = save(normalize({ ...loadout, day: today(), ownedPassives, passives }));
  return { loadout: nextLoadout, merit: nextMerit, ok: true };
}

/** 装备已拥有的主动（不扣功德）；槽满则失败 */
export function equipActive(
  loadout: LoadoutState,
  id: string,
): { loadout: LoadoutState; ok: boolean; reason?: string } {
  if (!isOwnedActive(loadout, id)) return { loadout, ok: false, reason: '尚未购买' };
  if (isEquipped(loadout, id)) return { loadout, ok: false, reason: '已装备' };
  if (loadout.equipped.length >= MAX_EQUIPPED_ACTIVES) {
    return { loadout, ok: false, reason: ACTIVE_FULL_HINT };
  }
  return {
    loadout: save(normalize({ ...loadout, day: today(), equipped: [...loadout.equipped, id] })),
    ok: true,
  };
}

/** 装备已拥有的被动（不扣功德）；槽满则失败 */
export function equipPassive(
  loadout: LoadoutState,
  id: string,
): { loadout: LoadoutState; ok: boolean; reason?: string } {
  if (!isOwnedPassive(loadout, id)) return { loadout, ok: false, reason: '尚未购买' };
  if (isPassiveEquipped(loadout, id)) return { loadout, ok: false, reason: '已装备' };
  if (loadout.passives.length >= MAX_EQUIPPED_PASSIVES) {
    return { loadout, ok: false, reason: PASSIVE_FULL_HINT };
  }
  return {
    loadout: save(normalize({ ...loadout, day: today(), passives: [...loadout.passives, id] })),
    ok: true,
  };
}

/** 卸下已装备的主动（仍保留今日拥有，可再装备） */
export function unequipActive(loadout: LoadoutState, id: string): LoadoutState {
  if (!isEquipped(loadout, id)) return loadout;
  return save(normalize({
    ...loadout,
    day: today(),
    equipped: loadout.equipped.filter((x) => x !== id),
  }));
}

/** 卸下已装备的被动（仍保留今日拥有，可再装备） */
export function unequipPassive(loadout: LoadoutState, id: string): LoadoutState {
  if (!isPassiveEquipped(loadout, id)) return loadout;
  return save(normalize({
    ...loadout,
    day: today(),
    passives: loadout.passives.filter((x) => x !== id),
  }));
}

/** 抽奖等场景：不扣功德，直接拥有并尽量装备 */
export function grantActive(loadout: LoadoutState, id: string): LoadoutState {
  if (!isActiveEnabled(id)) return loadout;
  const ownedActives = loadout.ownedActives.includes(id)
    ? loadout.ownedActives
    : [...loadout.ownedActives, id];
  const equipped = loadout.equipped.includes(id) || loadout.equipped.length >= MAX_EQUIPPED_ACTIVES
    ? loadout.equipped
    : [...loadout.equipped, id];
  return save(normalize({ ...loadout, day: today(), ownedActives, equipped }));
}

export function grantPassive(loadout: LoadoutState, id: string): LoadoutState {
  if (!isPassiveEnabled(id)) return loadout;
  const ownedPassives = loadout.ownedPassives.includes(id)
    ? loadout.ownedPassives
    : [...loadout.ownedPassives, id];
  const passives = loadout.passives.includes(id) || loadout.passives.length >= MAX_EQUIPPED_PASSIVES
    ? loadout.passives
    : [...loadout.passives, id];
  return save(normalize({ ...loadout, day: today(), ownedPassives, passives }));
}
