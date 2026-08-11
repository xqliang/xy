import { ACTIVE_SKILLS } from '../actives';
import { PASSIVE_SKILLS } from '../passives';
import { WEAPONS, type BagState } from '../weapons';
import { loadBag, saveBag } from '../weapons';
import { loadLoadout, writeLoadout, type LoadoutState } from '../loadout';
import { loadMerit, setMerit, type MeritState } from '../merit';
import { loadRank, saveRank, type RankState } from '../rank';
import { loadStamina, setStaminaValue, STAMINA_MAX, type Stamina } from '../stamina';
import { loadTutorialState, writeTutorialState } from '../tutorial';
import { storeRemove } from '../storage';

export interface DevUserSnapshot {
  tutorialSeen: Record<string, boolean>;
  stamina: number;
  merit: number;
  rankLevel: number;
  rankStars: number;
  difficulty: number;
  equippedActives: string[];
  equippedPassives: string[];
  ownedActives: string[];
  ownedPassives: string[];
  bagOwned: Record<string, number>;
  bagFragments: Record<string, number>;
  bagEquipped: string[];
}

export function readUserSnapshot(): DevUserSnapshot {
  const tutorial = loadTutorialState();
  const stamina = loadStamina();
  const merit = loadMerit();
  const rank = loadRank();
  const loadout = loadLoadout();
  const bag = loadBag();
  return {
    tutorialSeen: { ...tutorial.seen },
    stamina: stamina.value,
    merit: merit.merit,
    rankLevel: rank.level,
    rankStars: rank.stars,
    difficulty: rank.difficulty,
    equippedActives: [...loadout.equipped],
    equippedPassives: [...loadout.passives],
    ownedActives: [...loadout.ownedActives],
    ownedPassives: [...loadout.ownedPassives],
    bagOwned: { ...bag.owned },
    bagFragments: { ...bag.fragments },
    bagEquipped: [...bag.equipped],
  };
}

export interface ApplyUserResult {
  stamina: Stamina;
  merit: MeritState;
  rank: RankState;
  loadout: LoadoutState;
  bag: BagState;
}

/** 应用用户参数写入；调用方负责刷新 main 内存态 */
export function applyUserSnapshot(partial: Partial<DevUserSnapshot>): ApplyUserResult {
  if (partial.tutorialSeen) {
    writeTutorialState({ seen: partial.tutorialSeen });
  }
  let stamina = loadStamina();
  if (partial.stamina != null) stamina = setStaminaValue(partial.stamina);

  let merit = loadMerit();
  if (partial.merit != null) merit = setMerit(merit, partial.merit);

  let rank = loadRank();
  if (partial.rankLevel != null || partial.rankStars != null || partial.difficulty != null) {
    rank = {
      level: partial.rankLevel ?? rank.level,
      stars: partial.rankStars ?? rank.stars,
      difficulty: partial.difficulty ?? rank.difficulty,
    };
    saveRank(rank);
  }

  let loadout = loadLoadout();
  if (
    partial.equippedActives || partial.equippedPassives
    || partial.ownedActives || partial.ownedPassives
  ) {
    loadout = writeLoadout({
      ...loadout,
      ownedActives: partial.ownedActives ?? loadout.ownedActives,
      ownedPassives: partial.ownedPassives ?? loadout.ownedPassives,
      equipped: partial.equippedActives ?? loadout.equipped,
      passives: partial.equippedPassives ?? loadout.passives,
    });
  }

  let bag = loadBag();
  if (partial.bagOwned || partial.bagFragments || partial.bagEquipped) {
    bag = {
      owned: partial.bagOwned ?? bag.owned,
      fragments: partial.bagFragments ?? bag.fragments,
      equipped: partial.bagEquipped ?? bag.equipped,
    };
    saveBag(bag);
    bag = loadBag();
  }

  return { stamina, merit, rank, loadout, bag };
}

/** 重置本地用户进度到默认空档 */
export function resetUserProgress(): ApplyUserResult {
  writeTutorialState({ seen: {} });
  const stamina = setStaminaValue(STAMINA_MAX);
  const merit = setMerit(loadMerit(), 0);
  const rank: RankState = { level: 0, stars: 0, difficulty: 1 };
  saveRank(rank);
  const loadout = writeLoadout({
    day: Math.floor(Date.now() / 86400000),
    ownedActives: [],
    ownedPassives: [],
    equipped: [],
    passives: [],
  });
  const bag: BagState = { owned: {}, fragments: {}, equipped: [] };
  saveBag(bag);
  storeRemove('dasheng.aiskill');
  storeRemove('dasheng.aiwinstreak');
  storeRemove('dasheng.ailossstreak');
  storeRemove('endless.enabled');
  storeRemove('endless.bestWave');
  return { stamina, merit, rank, loadout, bag };
}

/** 一键拉满常用测试档：满体、功德 999、全技能、全神兵金阶并装备前 3 */
export function fillUserTestLoadout(): ApplyUserResult {
  const ownedActives = ACTIVE_SKILLS.filter((a) => !a.disabled).map((a) => a.id);
  const ownedPassives = PASSIVE_SKILLS.filter((p) => !p.disabled).map((p) => p.id);
  const owned: Record<string, number> = {};
  const fragments: Record<string, number> = {};
  for (const w of WEAPONS) {
    owned[w.id] = 5;
    fragments[w.id] = 4;
  }
  return applyUserSnapshot({
    tutorialSeen: {},
    stamina: STAMINA_MAX,
    merit: 999,
    rankLevel: 0,
    rankStars: 0,
    difficulty: 1,
    ownedActives,
    ownedPassives,
    equippedActives: ownedActives.slice(0, 2),
    equippedPassives: ownedPassives.slice(0, 6),
    bagOwned: owned,
    bagFragments: fragments,
    bagEquipped: WEAPONS.slice(0, 3).map((w) => w.id),
  });
}
