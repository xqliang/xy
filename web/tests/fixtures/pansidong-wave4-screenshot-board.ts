import type { Battle, Monster } from '../../src/battle';
import { makePlacedUnit } from '../../src/battle';
import { isPlayerCell, isPathCell, mirrorCell } from '../../src/board';

const cellKey = (c: number, r: number) => `${c},${r}`;

function unlockOccupiedPlayer(b: Battle) {
  const unlocked = (b as unknown as { unlocked: Set<string> }).unlocked;
  for (const k of b.units.keys()) unlocked.add(k);
  for (const k of b.words.keys()) unlocked.add(k);
  // 截图 mid-game：除已占格外再开若干空位供布阵
  for (const { c, r } of [
    { c: 1, r: 7 },
    { c: 5, r: 8 },
    { c: 6, r: 8 },
  ]) {
    if (isPlayerCell(b.map, c, r) && !isPathCell(b.map, c, r)) unlocked.add(cellKey(c, r));
  }
}

function unlockOccupiedAi(b: Battle) {
  const aiUnlocked = (b as unknown as { aiUnlocked: Set<string> }).aiUnlocked;
  for (const u of b.aiUnits) aiUnlocked.add(cellKey(u.cell.c, u.cell.r));
  for (const k of b.aiWords.keys()) aiUnlocked.add(k);
  for (const { c, r } of [
    { c: 2, r: 1 },
    { c: 6, r: 1 },
    { c: 2, r: 2 },
  ]) {
    aiUnlocked.add(cellKey(c, r));
  }
}

function makeSpider(dist: number, id: number): Monster {
  return {
    id,
    dist,
    hp: 120,
    maxHp: 120,
    spd: 0.45,
    isBoss: false,
    isMiniBoss: false,
    miniBossKind: null,
    isCavalry: false,
    hitFlash: 0,
    skill: null,
    skillCd: 0,
    castFlash: 0,
    spawnT: 2,
    stunT: 0,
    slowT: 0,
    hasteT: 0,
    healFlash: 0,
    burnT: 0,
    burnDps: 0,
  };
}

/**
 * 用户截图：盘丝洞第 4 波 mid-game（牛郎已激活、tray 含沙、AI 半场有孤字「背」+ 多兵种、路径上有蜘蛛）。
 */
export function setupPansidongWave4Screenshot(b: Battle) {
  const gate = { c: 0, r: 9 };

  b.introDone = true;
  b.wave = 4;
  b.status = 'playing';
  b.waveActive = true;
  b.spawnRemaining = 3;
  b.spawnTimer = 1.5;
  b.peach = 17;
  b.message = '妖怪来袭!';
  (b as unknown as { summonCost: number }).summonCost = 18;

  // —— 玩家半场（下半）——
  b.units.set(cellKey(1, 8), makePlacedUnit('dao', 3, { c: 1, r: 8 }, gate));
  b.units.set(cellKey(2, 7), makePlacedUnit('cavalry', 1, { c: 2, r: 7 }, gate));
  b.words.set(cellKey(3, 7), { char: '牛', general: 'niulang', tier: 1, cell: { c: 3, r: 7 } });
  b.words.set(cellKey(4, 7), { char: '郎', general: 'niulang', tier: 1, cell: { c: 4, r: 7 } });
  b.units.set(cellKey(5, 7), makePlacedUnit('spear', 2, { c: 5, r: 7 }, gate));
  b.units.set(cellKey(6, 7), makePlacedUnit('archer', 3, { c: 6, r: 7 }, gate));
  b.units.set(cellKey(2, 8), makePlacedUnit('dao', 1, { c: 2, r: 8 }, gate));

  b.tray = [
    { kind: 'unit', type: 'spear', tier: 1 },
    { kind: 'unit', type: 'cavalry', tier: 1 },
    { kind: 'word', char: '沙', general: 'shaseng', tier: 1 },
    { kind: 'unit', type: 'dao', tier: 1 },
    { kind: 'unit', type: 'cavalry', tier: 1 },
  ];

  b.monsters = [
    makeSpider(b.entranceDist + 4, 1),
    makeSpider(b.entranceDist + 7, 2),
    makeSpider(b.entranceDist + 10, 3),
    makeSpider(b.entranceDist + 12, 4),
  ];

  unlockOccupiedPlayer(b);

  // —— AI 半场（上半，镜像布局）——
  const aiGate = mirrorCell(gate);
  b.aiUnits = [
    makePlacedUnit('dao', 1, { c: 6, r: 1 }, aiGate),
    makePlacedUnit('archer', 1, { c: 4, r: 1 }, aiGate),
    makePlacedUnit('archer', 2, { c: 5, r: 1 }, aiGate),
    makePlacedUnit('archer', 2, { c: 4, r: 2 }, aiGate),
    makePlacedUnit('cavalry', 2, { c: 3, r: 1 }, aiGate),
    makePlacedUnit('dao', 2, { c: 5, r: 2 }, aiGate),
    makePlacedUnit('dao', 2, { c: 6, r: 2 }, aiGate),
  ];
  b.aiWords.set(cellKey(3, 2), { char: '背', general: 'tiebei', tier: 1, cell: { c: 3, r: 2 } });
  b.aiTray = [{ kind: 'word', char: '铁', general: 'tiebei', tier: 1 }];
  b.aiMonsters = [
    makeSpider(b.aiEntranceDist + 3, 11),
    makeSpider(b.aiEntranceDist + 6, 12),
  ];
  (b as unknown as { aiPeach: number }).aiPeach = 40;
  (b as unknown as { aiSummonTimer: number }).aiSummonTimer = 2;
  (b as unknown as { aiRepositionTimer: number }).aiRepositionTimer = 0.5;

  unlockOccupiedAi(b);
}
