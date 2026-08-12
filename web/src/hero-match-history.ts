// 跨局武将匹配历史：上一局是否匹配过、近 N 局匹配过的武将 id（抽字软降重）
import { storeGet, storeSet, parseStoredJson, safeStringArray } from './storage';
import { RECENT_HERO_HISTORY_LEN } from './word-draw';

const KEY = 'dasheng.heroMatchHistory';

export interface HeroMatchHistory {
  /** 上一局是否达成过至少一次「可组合双字」匹配 */
  lastGameHadMatch: boolean;
  /** 近 N 局匹配过的武将 id（新局在前，去重截断） */
  recentMatched: string[];
}

const DEFAULT: HeroMatchHistory = { lastGameHadMatch: true, recentMatched: [] };

function normalize(raw: unknown): HeroMatchHistory | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  return {
    lastGameHadMatch: o.lastGameHadMatch !== false,
    recentMatched: safeStringArray(o.recentMatched).slice(0, RECENT_HERO_HISTORY_LEN),
  };
}

export function loadHeroMatchHistory(): HeroMatchHistory {
  return parseStoredJson(storeGet(KEY), normalize, { ...DEFAULT, recentMatched: [] });
}

export function saveHeroMatchHistory(h: HeroMatchHistory): void {
  try {
    storeSet(KEY, JSON.stringify({
      lastGameHadMatch: !!h.lastGameHadMatch,
      recentMatched: h.recentMatched.slice(0, RECENT_HERO_HISTORY_LEN),
    }));
  } catch {
    /* ignore */
  }
}

/** 局末写入：是否匹配 + 把本局匹配 id 并入近 N 局列表 */
export function recordHeroMatchGame(matchedHeroIds: readonly string[]): HeroMatchHistory {
  const prev = loadHeroMatchHistory();
  const matched = [...new Set(matchedHeroIds.filter((id) => id.length > 0))];
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const id of [...matched, ...prev.recentMatched]) {
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
    if (merged.length >= RECENT_HERO_HISTORY_LEN) break;
  }
  const next: HeroMatchHistory = {
    lastGameHadMatch: matched.length > 0,
    recentMatched: merged,
  };
  saveHeroMatchHistory(next);
  return next;
}
