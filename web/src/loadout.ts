// 主动技能「每日装备」持久化：跨局 localStorage，与体力(stamina.ts)一样按自然日重置。
// 玩家每天需重新用功德购买主动技能才能装备（功德每日消耗，形成消耗口）。
import { storeGet, storeSet } from './storage';
import { MAX_EQUIPPED_ACTIVES, activeById } from './actives';
import { MAX_EQUIPPED_PASSIVES, passiveById } from './passives';
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
          equipped: s.equipped.slice(0, MAX_EQUIPPED_ACTIVES),
          passives: Array.isArray(s.passives) ? s.passives.slice(0, MAX_EQUIPPED_PASSIVES) : [],
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

// 购买即装备：校验未装备、未满额、功德足够，成功则扣功德并追加装备。
export function buyActive(
  loadout: LoadoutState,
  merit: MeritState,
  id: string,
): { loadout: LoadoutState; merit: MeritState; ok: boolean; reason?: string } {
  const def = activeById(id);
  if (!def) return { loadout, merit, ok: false, reason: '无此技能' };
  if (isEquipped(loadout, id)) return { loadout, merit, ok: false, reason: '已装备' };
  if (merit.merit < def.cost) return { loadout, merit, ok: false, reason: '功德不足' };
  const nextMerit = spendMerit(merit, def.cost);
  const equipped = [...loadout.equipped, id];
  while (equipped.length > MAX_EQUIPPED_ACTIVES) equipped.shift(); // 后买挤掉最旧，恒留最新 N 个
  const nextLoadout = save({ ...loadout, day: today(), equipped });
  return { loadout: nextLoadout, merit: nextMerit, ok: true };
}

// 购买即装备被动技能：校验未装备、未满额、功德足够，成功则扣功德并追加装备。
export function buyPassive(
  loadout: LoadoutState,
  merit: MeritState,
  id: string,
): { loadout: LoadoutState; merit: MeritState; ok: boolean; reason?: string } {
  const def = passiveById(id);
  if (!def) return { loadout, merit, ok: false, reason: '无此技能' };
  if (isPassiveEquipped(loadout, id)) return { loadout, merit, ok: false, reason: '已装备' };
  if (merit.merit < def.cost) return { loadout, merit, ok: false, reason: '功德不足' };
  const nextMerit = spendMerit(merit, def.cost);
  const passives = [...loadout.passives, id];
  while (passives.length > MAX_EQUIPPED_PASSIVES) passives.shift(); // 后买挤掉最旧，恒留最新 N 个
  const nextLoadout = save({ ...loadout, day: today(), passives });
  return { loadout: nextLoadout, merit: nextMerit, ok: true };
}
