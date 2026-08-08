// 主动技能「每日装备」持久化：跨局 localStorage，与体力(stamina.ts)一样按自然日重置。
// 玩家每天需重新用功德购买主动技能才能装备（功德每日消耗，形成消耗口）。
import { storeGet, storeSet } from './storage';
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
  equipped: string[]; // 已装备(已购买)的主动技能 id，最多 MAX_EQUIPPED_ACTIVES 个
  passives: string[]; // 已装备(已购买)的被动技能 id，最多 MAX_EQUIPPED_PASSIVES 个
}

function save(s: LoadoutState): LoadoutState {
  try {
    storeSet(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
  return s;
}

// 读取装备；跨天则清空（需重新购买）
export function loadLoadout(): LoadoutState {
  try {
    const raw = storeGet(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (typeof s.day === 'number' && Array.isArray(s.equipped)) {
        if (s.day !== today()) return save({ day: today(), equipped: [], passives: [] }); // 跨天重置
        return {
          day: s.day,
          // 已下架技能从存档装备中剔除，避免局内仍生效
          equipped: s.equipped.filter(isActiveEnabled).slice(0, MAX_EQUIPPED_ACTIVES),
          passives: Array.isArray(s.passives)
            ? s.passives.filter(isPassiveEnabled).slice(0, MAX_EQUIPPED_PASSIVES)
            : [],
        };
      }
    }
  } catch {
    /* ignore */
  }
  return save({ day: today(), equipped: [], passives: [] });
}

export function isEquipped(s: LoadoutState, id: string): boolean {
  return s.equipped.includes(id);
}

export function isPassiveEquipped(s: LoadoutState, id: string): boolean {
  return s.passives.includes(id);
}

/** 主动槽已满时的购买提示 */
export const ACTIVE_FULL_HINT = `已有 ${MAX_EQUIPPED_ACTIVES} 个启用中，请先禁用才能购买`;
/** 被动槽已满时的购买提示 */
export const PASSIVE_FULL_HINT = `已有 ${MAX_EQUIPPED_PASSIVES} 个启用中，请先禁用才能购买`;

// 购买即启用：校验未启用、未满额、功德足够；满额不挤旧，需先禁用腾位。
export function buyActive(
  loadout: LoadoutState,
  merit: MeritState,
  id: string,
): { loadout: LoadoutState; merit: MeritState; ok: boolean; reason?: string } {
  const def = activeById(id);
  if (!def) return { loadout, merit, ok: false, reason: '无此技能' };
  if (def.disabled) return { loadout, merit, ok: false, reason: '技能已下架' };
  if (isEquipped(loadout, id)) return { loadout, merit, ok: false, reason: '已启用' };
  if (loadout.equipped.length >= MAX_EQUIPPED_ACTIVES) {
    return { loadout, merit, ok: false, reason: ACTIVE_FULL_HINT };
  }
  if (merit.merit < def.cost) return { loadout, merit, ok: false, reason: '功德不足' };
  const nextMerit = spendMerit(merit, def.cost);
  const nextLoadout = save({ ...loadout, day: today(), equipped: [...loadout.equipped, id] });
  return { loadout: nextLoadout, merit: nextMerit, ok: true };
}

// 购买即启用被动：满额不挤旧，需先禁用腾位。
export function buyPassive(
  loadout: LoadoutState,
  merit: MeritState,
  id: string,
): { loadout: LoadoutState; merit: MeritState; ok: boolean; reason?: string } {
  const def = passiveById(id);
  if (!def) return { loadout, merit, ok: false, reason: '无此技能' };
  if (def.disabled) return { loadout, merit, ok: false, reason: '技能已下架' };
  if (isPassiveEquipped(loadout, id)) return { loadout, merit, ok: false, reason: '已启用' };
  if (loadout.passives.length >= MAX_EQUIPPED_PASSIVES) {
    return { loadout, merit, ok: false, reason: PASSIVE_FULL_HINT };
  }
  if (merit.merit < def.cost) return { loadout, merit, ok: false, reason: '功德不足' };
  const nextMerit = spendMerit(merit, def.cost);
  const nextLoadout = save({ ...loadout, day: today(), passives: [...loadout.passives, id] });
  return { loadout: nextLoadout, merit: nextMerit, ok: true };
}

/** 禁用已启用的主动技能（腾出槽位；不退功德） */
export function unequipActive(loadout: LoadoutState, id: string): LoadoutState {
  if (!isEquipped(loadout, id)) return loadout;
  return save({ ...loadout, day: today(), equipped: loadout.equipped.filter((x) => x !== id) });
}

/** 禁用已启用的被动技能（腾出槽位；不退功德） */
export function unequipPassive(loadout: LoadoutState, id: string): LoadoutState {
  if (!isPassiveEquipped(loadout, id)) return loadout;
  return save({ ...loadout, day: today(), passives: loadout.passives.filter((x) => x !== id) });
}
