// 首页关卡选择：每日推荐或固定某张地图。
import { storeGet, storeSet, parseStoredJson } from './storage';
import { MAPS, mapById, pickDailyMap, type GameMap } from './board';

const KEY = 'dasheng.map';

export type MapSelection =
  | { mode: 'daily' }
  | { mode: 'fixed'; mapId: string };

const DEFAULT_MAP_SELECTION: MapSelection = { mode: 'daily' };

function normalizeMapSelection(raw: unknown): MapSelection | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<MapSelection>;
  if (s.mode === 'fixed' && typeof s.mapId === 'string' && MAPS.some((m) => m.id === s.mapId)) {
    return { mode: 'fixed', mapId: s.mapId };
  }
  if (s.mode === 'daily') return { mode: 'daily' };
  return null;
}

export function loadMapSelection(): MapSelection {
  return parseStoredJson(storeGet(KEY), normalizeMapSelection, DEFAULT_MAP_SELECTION);
}

export function saveMapSelection(sel: MapSelection): MapSelection {
  try {
    storeSet(KEY, JSON.stringify(sel));
  } catch {
    /* ignore */
  }
  return sel;
}

export function resolveMap(sel: MapSelection, date = new Date()): GameMap {
  if (sel.mode === 'fixed') return mapById(sel.mapId);
  return pickDailyMap(date);
}
