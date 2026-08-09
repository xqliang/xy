// 首页关卡选择：每日推荐或固定某张地图。
import { storeGet, storeSet } from './storage';
import { MAPS, mapById, pickDailyMap, type GameMap } from './board';

const KEY = 'dasheng.map';

export type MapSelection =
  | { mode: 'daily' }
  | { mode: 'fixed'; mapId: string };

export function loadMapSelection(): MapSelection {
  try {
    const raw = storeGet(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<MapSelection>;
      if (s.mode === 'fixed' && typeof s.mapId === 'string' && MAPS.some((m) => m.id === s.mapId)) {
        return { mode: 'fixed', mapId: s.mapId };
      }
    }
  } catch {
    /* ignore */
  }
  return { mode: 'daily' };
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
