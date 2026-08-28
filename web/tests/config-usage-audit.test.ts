// 配置使用情况审计 + 防「死配置」回归护栏。
// 扫描全部标量调参袋（TUNING/ECONOMY/BOARD_POWER/PLACE_TIMING/PEACH_TREE/AI_TIMING/GENERAL_TUNING/WEAPON_TUNING）
// 的每个键，统计其在生产代码 / 测试代码里的真实读取次数（剥注释、排除定义行/reexport 行/labels.ts/bags.ts 注册项）。
// 断言：不得出现「生产+测试都没读」且不在白名单的键（白名单=故意未接线的参考键 ECONOMY_REFERENCE_KEYS）。
// 实体袋（generals/actives/passives/units）的字段是动态 .field 访问，另属一类，不在此扫。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { TUNABLE_BAGS, ECONOMY_REFERENCE_KEYS } from '../src/devtools/bags';

const SCALAR = new Set(['tuning', 'economy', 'boardPower', 'placeTiming', 'peachTree', 'aiTiming', 'generalTuning', 'weaponTuning']);

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const cwd = process.cwd(); // web/
const prodFiles = [...walk(join(cwd, 'src')), ...walk(join(cwd, '../game-core/src'))]
  .filter((p) => !p.endsWith('devtools/labels.ts') && !p.endsWith('devtools/bags.ts'));
const testFiles = walk(join(cwd, 'tests'));

const prodDocs = prodFiles.map((p) => ({ p, lines: stripComments(readFileSync(p, 'utf8')).split('\n') }));
const testDocs = testFiles.map((p) => ({ p, lines: stripComments(readFileSync(p, 'utf8')).split('\n') }));

// 真实读取行（排除「对象字面量定义行 `key:`」与「reexport 行 `export const key =`」）
function hitCount(docs: { p: string; lines: string[] }[], key: string): number {
  const word = new RegExp(`\\b${key}\\b`);
  const defLine = new RegExp(`^\\s*${key}\\s*:`);
  const reexport = new RegExp(`^\\s*export\\s+const\\s+${key}\\b`);
  let n = 0;
  for (const d of docs) {
    for (const ln of d.lines) {
      if (defLine.test(ln) || reexport.test(ln)) continue;
      if (word.test(ln)) n++;
    }
  }
  return n;
}

describe('config usage audit（防死配置回归）', () => {
  it('标量配置袋无「非白名单」完全未使用键', () => {
    const dead: string[] = [];
    const testOnly: string[] = [];
    let used = 0;
    for (const bag of TUNABLE_BAGS) {
      if (!SCALAR.has(bag.id)) continue;
      for (const key of Object.keys(bag.live as Record<string, unknown>)) {
        const prod = hitCount(prodDocs, key);
        const test = hitCount(testDocs, key);
        if (prod === 0 && test === 0) dead.push(`${bag.id}.${key}`);
        else if (prod === 0) testOnly.push(`${bag.id}.${key}`);
        else used++;
      }
    }
    console.log(`\n[config-usage] 生产在用 ${used} · 仅测试引用 ${testOnly.length}${testOnly.length ? ' (' + testOnly.join(', ') + ')' : ''} · 完全未使用 ${dead.length}${dead.length ? ' (' + dead.join(', ') + ')' : ''}`);

    // 白名单：ECONOMY_REFERENCE_KEYS 是故意未接线的 game-core 参考曲线值（如 MONSTER_BASE）
    const unexpected = dead.filter((d) => !ECONOMY_REFERENCE_KEYS.has(d.split('.')[1]!));
    expect(unexpected).toEqual([]);
  });
});
