# 广告→分享好友改造 + tray铲子分享按钮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 微信端隐藏"看广告加体力"、把"分享好友+5体力"做成真分享（onHide+停留≥2s判定成功、每天4次共享额度），并在 tray 右侧新增微信端专属"铲子×1"分享按钮（第6波起出现，分享成功自动挖最优阵位）；web 端去掉一切分享入口。

**Architecture:** 新增两个纯逻辑模块（`share-quota.ts` 每日次数、`platform.ts` 内 `judgeShareSuccess`+`shareToFriend`），一个 battle 公开方法 `shareDigBest()`（复用洛阳铲玩家侧挖掘路径），再在体力弹窗与战斗渲染两处接线。判定/额度核心抽成纯函数走单测；canvas/UI 与 wx 分支靠 tsc + 冒烟验证。

**Tech Stack:** TypeScript、Vite、Vitest；微信小游戏 `wx.shareAppMessage`/`onHide`/`onShow`；localStorage（`storage.ts`）。

**Spec:** `docs/superpowers/specs/2026-08-27-ads-to-share-friend-design.md`

---

## 文件结构

- **新建** `web/src/share-quota.ts` — 每日分享次数（自然日重置，上限4），纯函数 + storage 薄封装。
- **新建** `web/tests/share-quota.test.ts` — 纯函数单测。
- **改** `web/src/platform.ts` — 新增 `judgeShareSuccess`（纯）+ `shareToFriend`（wx）。
- **新建** `web/tests/share-judge.test.ts` — `judgeShareSuccess` 单测。
- **改** `web/src/battle.ts` — 新增公开方法 `shareDigBest()`。
- **改** `web/tests/battle.share-dig.test.ts`（新建）— `shareDigBest` 单测。
- **改** `web/src/menu-popups.ts` — 体力弹窗按平台画单按钮 + 命中改写。
- **改** `web/src/main.ts` — 弹窗分享处理重写、tray 铲子按钮命中 + `handleShareShovel`、引导文案分叉、导入。
- **改** `web/src/menu-help.ts` — 帮助文案按平台分叉。
- **改** `web/src/render.ts` — tray 铲子按钮 rect/visible/hit/draw + `draw()` 调用。

---

## Task 0: worktree 环境准备（跑测/编译前必做）

新 worktree 无 `web/node_modules`，vitest/tsc 跑不起来（见记忆 web-fresh-worktree-node-modules-symlink）。

**Files:** 无（仅环境）

- [ ] **Step 1: 软链 node_modules + 建 shots 目录**

Run:
```bash
cd /Users/jyxc-dz-0100360/work/fun/xy/.claude/worktrees/share-friend
[ -e web/node_modules ] || ln -s /Users/jyxc-dz-0100360/work/fun/xy/web/node_modules web/node_modules
mkdir -p web/shots
```
Expected: 无报错；`ls -la web/node_modules` 显示软链指向主树。

- [ ] **Step 2: 冒烟确认 vitest 可跑**

Run: `cd web && npx vitest run tests/merit.test.ts`
Expected: 该既有测试 PASS（证明环境可用）。

---

## Task 1: `share-quota.ts` 每日分享次数（TDD）

**Files:**
- Create: `web/src/share-quota.ts`
- Test: `web/tests/share-quota.test.ts`

- [ ] **Step 1: 先写失败测试**

Create `web/tests/share-quota.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { normalizeQuota, remainingOf, MAX_DAILY_SHARES } from '../src/share-quota';

describe('share-quota 纯逻辑', () => {
  it('上限为 4', () => {
    expect(MAX_DAILY_SHARES).toBe(4);
  });

  it('无存档 → 当日清零', () => {
    expect(normalizeQuota(null, 100)).toEqual({ day: 100, count: 0 });
  });

  it('跨天 → 次数清零并更新到当日', () => {
    expect(normalizeQuota({ day: 99, count: 3 }, 100)).toEqual({ day: 100, count: 0 });
  });

  it('同一天 → 保留次数', () => {
    expect(normalizeQuota({ day: 100, count: 2 }, 100)).toEqual({ day: 100, count: 2 });
  });

  it('异常次数被夹到 [0, MAX]', () => {
    expect(normalizeQuota({ day: 100, count: 9 }, 100)).toEqual({ day: 100, count: 4 });
    expect(normalizeQuota({ day: 100, count: -3 }, 100)).toEqual({ day: 100, count: 0 });
  });

  it('remainingOf = MAX - count（不小于 0）', () => {
    expect(remainingOf({ day: 100, count: 0 })).toBe(4);
    expect(remainingOf({ day: 100, count: 4 })).toBe(0);
    expect(remainingOf({ day: 100, count: 7 })).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测确认失败**

Run: `cd web && npx vitest run tests/share-quota.test.ts`
Expected: FAIL（`Cannot find module '../src/share-quota'`）。

- [ ] **Step 3: 写实现**

Create `web/src/share-quota.ts`:
```ts
// 每日分享次数额度：自然日重置，全局上限 4 次；体力弹窗分享 + tray 铲子分享共用同一池。
// 仿 loadout.ts 的自然日索引与跨天重置；核心判定抽成纯函数便于单测。
import { storeGet, storeSet, parseStoredJson, safeNumber } from './storage';

const KEY = 'dasheng.shareQuota';
export const MAX_DAILY_SHARES = 4;

export interface ShareQuota {
  /** 自然日索引（floor(Date.now()/86400000)），跨天则重置 count */
  day: number;
  /** 今日已成功分享次数（0..MAX_DAILY_SHARES） */
  count: number;
}

// 自然日索引（与 stamina.ts / loadout.ts 一致）
function today(): number {
  return Math.floor(Date.now() / 86400000);
}

/** 纯函数：给定已存状态与当日索引，算规范化后的状态（跨天清零、次数夹紧） */
export function normalizeQuota(q: ShareQuota | null, todayIdx: number): ShareQuota {
  if (!q || q.day !== todayIdx) return { day: todayIdx, count: 0 };
  const count = Math.max(0, Math.min(MAX_DAILY_SHARES, Math.floor(q.count)));
  return { day: todayIdx, count };
}

/** 纯函数：剩余可分享次数 */
export function remainingOf(q: ShareQuota): number {
  return Math.max(0, MAX_DAILY_SHARES - q.count);
}

function normalizeRaw(raw: unknown): ShareQuota | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.day !== 'number') return null;
  return {
    day: Math.floor(safeNumber(s.day, today(), 0)),
    count: Math.floor(safeNumber(s.count, 0, 0, MAX_DAILY_SHARES)),
  };
}

function save(q: ShareQuota): ShareQuota {
  try {
    storeSet(KEY, JSON.stringify(q));
  } catch {
    /* ignore */
  }
  return q;
}

/** 读取今日额度（跨天自动清零并持久化） */
export function loadShareQuota(): ShareQuota {
  const raw = parseStoredJson<ShareQuota | null>(storeGet(KEY), normalizeRaw, null);
  return save(normalizeQuota(raw, today()));
}

/** 今日剩余可分享次数 */
export function remainingShares(): number {
  return remainingOf(loadShareQuota());
}

/** 今日是否还能分享 */
export function canShare(): boolean {
  return remainingShares() > 0;
}

/** 记一次成功分享（count+1，夹到上限并持久化）。调用方须保证分享确已成功。 */
export function consumeShare(): ShareQuota {
  const q = loadShareQuota();
  return save({ day: q.day, count: Math.min(MAX_DAILY_SHARES, q.count + 1) });
}
```

- [ ] **Step 4: 跑测确认通过**

Run: `cd web && npx vitest run tests/share-quota.test.ts`
Expected: PASS（6 个用例全绿）。

- [ ] **Step 5: 提交**

```bash
cd /Users/jyxc-dz-0100360/work/fun/xy/.claude/worktrees/share-friend
git add web/src/share-quota.ts web/tests/share-quota.test.ts
git commit -m "feat(share): 每日分享次数额度模块 share-quota(自然日重置,上限4,共享池)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `judgeShareSuccess` + `shareToFriend`（TDD 纯函数 + wx 封装）

**Files:**
- Modify: `web/src/platform.ts`（文件末尾追加）
- Test: `web/tests/share-judge.test.ts`

- [ ] **Step 1: 先写失败测试**

Create `web/tests/share-judge.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { judgeShareSuccess } from '../src/platform';

describe('judgeShareSuccess：onHide 真触发 + 停留≥2s 判成功', () => {
  it('未切后台(onHide 未触发) → 失败', () => {
    expect(judgeShareSuccess(false, 0, 999999)).toBe(false);
  });

  it('切了后台但停留 <2s（秒取消） → 失败', () => {
    expect(judgeShareSuccess(true, 1000, 1000 + 1999)).toBe(false);
  });

  it('切了后台且停留 =2s（边界） → 成功', () => {
    expect(judgeShareSuccess(true, 1000, 1000 + 2000)).toBe(true);
  });

  it('切了后台且停留 >2s → 成功', () => {
    expect(judgeShareSuccess(true, 1000, 1000 + 5000)).toBe(true);
  });

  it('可自定义阈值', () => {
    expect(judgeShareSuccess(true, 0, 2500, 3000)).toBe(false);
    expect(judgeShareSuccess(true, 0, 3000, 3000)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测确认失败**

Run: `cd web && npx vitest run tests/share-judge.test.ts`
Expected: FAIL（`judgeShareSuccess` 未导出）。

- [ ] **Step 3: 在 `platform.ts` 末尾追加实现**

在 `web/src/platform.ts` 文件末尾（`wxLogin` 之后）追加：
```ts
// —— 通用好友分享（体力/铲子奖励用；区别于 PvP 邀请的 shareVersusInvite）——
// 微信小游戏 wx.shareAppMessage 转发给单个好友无可靠成功回调（shareTicket 仅群分享产生）。
// 故用启发式：拉起分享后若 onHide 真触发(转发面板/选人页真打开、App切后台)且停留≥2s 判成功。

/** 纯判定：onHide 是否触发 且 onHide→onShow 停留是否 ≥ minDwellMs。抽出便于单测。 */
export function judgeShareSuccess(
  sawHide: boolean,
  hideTs: number,
  showTs: number,
  minDwellMs = 2000,
): boolean {
  return sawHide && showTs - hideTs >= minDwellMs;
}

export interface ShareToFriendOpts {
  title: string;
  query?: string;
  imageUrl?: string;
}

/**
 * 拉起微信好友转发并按 onHide+停留启发式判定是否成功。
 * - Web / 无 wx → resolve(false)（调用方据此不发奖）。
 * - 挂临时 onHide/onShow（用 offHide/offShow 收尾），不影响 main.ts 已注册的全局暂停/重连 handler。
 * - 兜底：拉起后 ~5s 内 onHide 未触发（面板没起/被频控）→ resolve(false)，避免永久 pending。
 */
export function shareToFriend(opts: ShareToFriendOpts): Promise<boolean> {
  if (!(isWeChat && typeof wx.shareAppMessage === 'function')) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let sawHide = false;
    let hideTs = 0;
    const onHide = () => { sawHide = true; hideTs = Date.now(); };
    const onShow = () => { if (!settled) finish(judgeShareSuccess(sawHide, hideTs, Date.now())); };
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { wx.offHide?.(onHide); } catch { /* ignore */ }
      try { wx.offShow?.(onShow); } catch { /* ignore */ }
      resolve(ok);
    };
    // 5s 内无 onHide → 面板未真正打开，判失败
    const timer = setTimeout(() => { if (!sawHide) finish(false); }, 5000);
    try {
      wx.onHide?.(onHide);
      wx.onShow?.(onShow);
      wx.shareAppMessage({ title: opts.title, query: opts.query ?? '', imageUrl: opts.imageUrl });
    } catch {
      finish(false);
    }
  });
}
```

- [ ] **Step 4: 跑测确认通过**

Run: `cd web && npx vitest run tests/share-judge.test.ts`
Expected: PASS（5 个用例全绿）。

- [ ] **Step 5: 类型检查不新增报错**

Run: `cd web && npx tsc --noEmit 2>&1 | grep "error TS" | grep -E "platform\.ts|share-judge"`
Expected: 无输出（本次改动文件不引入新报错）；基线既有 ~28 处报错另计。
（勿用 `git stash` 做前后对比——本仓 stash 栈跨 worktree 共享有风险；改用上面的按文件名过滤即可。）

- [ ] **Step 6: 提交**

```bash
cd /Users/jyxc-dz-0100360/work/fun/xy/.claude/worktrees/share-friend
git add web/src/platform.ts web/tests/share-judge.test.ts
git commit -m "feat(share): platform.shareToFriend + judgeShareSuccess(onHide+停留≥2s判定)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `battle.shareDigBest()` 公开方法（TDD）

**Files:**
- Modify: `web/src/battle.ts`（`playerAutoDigCell` 方法之后插入）
- Test: `web/tests/battle.share-dig.test.ts`

- [ ] **Step 1: 先写失败测试**

Create `web/tests/battle.share-dig.test.ts`:
```ts
// 分享奖励：shareDigBest() 复用洛阳铲玩家侧路径自动挖最优格。
// 契约：有可挖格→挖1格(unlocked+1、digFx+1、返回true、message为分享文案)；无可挖格→返回false不改动。
import { describe, it, expect } from 'vitest';
import { Battle, NO_META, type PeachTree } from '../src/battle';
import { MAPS } from '../src/board';

const mkBattle = () =>
  new Battle(7, 1, MAPS[0]!, NO_META, {}, [], [], false, undefined, 1, undefined);
const treeAt = (c: number, r: number): PeachTree => ({ level: 1, cell: { c, r }, growT: 0 });

describe('shareDigBest：分享奖励自动挖最优格', () => {
  it('有可挖格 → 挖开一格并返回 true', () => {
    const b = mkBattle();
    expect(b.status).toBe('ready'); // 初始态可挖
    expect(b.lockedCells().length).toBeGreaterThan(0);
    const before = b.unlocked.size;
    const beforeFx = b.digFx.length;
    const ok = b.shareDigBest();
    expect(ok).toBe(true);
    expect(b.unlocked.size).toBe(before + 1);
    expect(b.digFx.length).toBe(beforeFx + 1);
    expect(b.message).toBe('好友助力，铲开新阵位！');
  });

  it('只挖一格（不多挖）', () => {
    const b = mkBattle();
    const before = b.unlocked.size;
    b.shareDigBest();
    b.shareDigBest();
    expect(b.unlocked.size).toBe(before + 2); // 两次各挖一格
  });

  it('无可挖格（锁定格全被桃树占） → 返回 false 且不改动', () => {
    const b = mkBattle();
    for (const c of b.lockedCells()) b.trees.set(`${c.c},${c.r}`, treeAt(c.c, c.r));
    const before = b.unlocked.size;
    const ok = b.shareDigBest();
    expect(ok).toBe(false);
    expect(b.unlocked.size).toBe(before);
    expect(b.digFx.length).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测确认失败**

Run: `cd web && npx vitest run tests/battle.share-dig.test.ts`
Expected: FAIL（`b.shareDigBest is not a function`）。

- [ ] **Step 3: 在 `battle.ts` 的 `playerAutoDigCell` 之后插入公开方法**

在 `web/src/battle.ts` 中找到 `private playerAutoDigCell(to: Cell): boolean {` 方法的结束 `}`（其后紧跟 `aiAutoDigCell` 的注释块），在两者之间插入：
```ts
  /**
   * 分享奖励：自动挖一个最优可开挖阵位（复用洛阳铲玩家侧确定性路径 scoreDiggableCells→最优格→playerAutoDigCell）。
   * 不消耗铲子道具、不依赖 mods.autoShovel；无可挖格 / 终局态返回 false（调用方据此决定是否扣分享次数）。
   */
  shareDigBest(): boolean {
    if (this.status !== 'playing' && this.status !== 'ready') return false;
    const scored = scoreDiggableCells(this.buildPlayerAutoView(), DIG_EXIT_WEIGHT);
    if (scored.length === 0) return false;
    const ok = this.playerAutoDigCell(scored[0]!.cell);
    if (ok) this.message = '好友助力，铲开新阵位！'; // 覆盖 playerAutoDigCell 的洛阳铲文案
    return ok;
  }
```
（`scoreDiggableCells`、`DIG_EXIT_WEIGHT`、`buildPlayerAutoView`、`playerAutoDigCell` 均已在本文件作用域内。）

- [ ] **Step 4: 跑测确认通过**

Run: `cd web && npx vitest run tests/battle.share-dig.test.ts`
Expected: PASS（3 个用例全绿）。

- [ ] **Step 5: 回归——挖掘/自动铲相关既有测试不破**

Run: `cd web && npx vitest run tests/battle.auto-shovel.test.ts tests/autoplace.test.ts`
Expected: PASS（未触碰既有路径）。

- [ ] **Step 6: 提交**

```bash
cd /Users/jyxc-dz-0100360/work/fun/xy/.claude/worktrees/share-friend
git add web/src/battle.ts web/tests/battle.share-dig.test.ts
git commit -m "feat(share): battle.shareDigBest() 复用洛阳铲路径自动挖最优格(分享奖励用)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 体力弹窗按平台单按钮 + 分享处理重写 + 文案分叉

**Files:**
- Modify: `web/src/menu-popups.ts`（imports、`staminaPopupHitAt`、`drawStaminaPopup` 按钮段）
- Modify: `web/src/main.ts`（`kind:'share'` 处理、引导文案、imports）
- Modify: `web/src/menu-help.ts`（帮助文案）

- [ ] **Step 1: `menu-popups.ts` 增加导入**

在 `web/src/menu-popups.ts` 顶部 import 区（`import { STAMINA_MAX, STAMINA_REGEN_MS } from './stamina';` 附近）追加：
```ts
import { isWeChat } from './platform';
import { remainingShares } from './share-quota';
```

- [ ] **Step 2: 改写 `staminaPopupHitAt`（单按钮画在 STA_SHARE 位）**

将 `web/src/menu-popups.ts` 中：
```ts
export function staminaPopupHitAt(x: number, y: number): StaminaPopupHit {
  if (inRect(x, y, STA_CLOSE)) return { kind: 'close' };
  if (inRect(x, y, STA_AD)) return { kind: 'ad' };
  if (inRect(x, y, STA_SHARE)) return { kind: 'share' };
  if (x >= STA_PX && x <= STA_PX + STA_PW && y >= STA_PY && y <= STA_PY + STA_PH) return null;
  return { kind: 'close' };
}
```
替换为：
```ts
export function staminaPopupHitAt(x: number, y: number): StaminaPopupHit {
  if (inRect(x, y, STA_CLOSE)) return { kind: 'close' };
  // 单按钮：微信端=分享好友(真分享)、web 端=看广告；都画在底部 STA_SHARE 位。
  if (inRect(x, y, STA_SHARE)) return isWeChat ? { kind: 'share' } : { kind: 'ad' };
  if (x >= STA_PX && x <= STA_PX + STA_PW && y >= STA_PY && y <= STA_PY + STA_PH) return null;
  return { kind: 'close' };
}
```

- [ ] **Step 3: 改写 `drawStaminaPopup` 的按钮绘制段**

将 `web/src/menu-popups.ts` 中原两行按钮绘制：
```ts
  drawInkActionButton(ctx, STA_AD, '看广告 +10', false, 'accent');
  drawInkActionButton(ctx, STA_SHARE, '分享好友 +5', false, 'secondary');
```
替换为：
```ts
  // 单按钮：微信端「分享好友 +5」(真分享，受每日额度/体力上限影响置灰)；web 端「看广告 +10」(不变)。
  if (isWeChat) {
    const full = stamina >= STAMINA_MAX;
    const noQuota = remainingShares() <= 0;
    const label = noQuota ? '今日分享已达上限' : full ? '体力已满' : '分享好友 +5';
    drawInkActionButton(ctx, STA_SHARE, label, full || noQuota, 'secondary');
  } else {
    drawInkActionButton(ctx, STA_SHARE, '看广告 +10', false, 'accent');
  }
```
（`STA_AD` 常量保留不删——`STA_REGEN_Y` 等布局仍引用它算坐标。）

- [ ] **Step 4: `main.ts` 增加导入**

在 `web/src/main.ts` 的 import 区，`shareVersusInvite` 所在的 `'./platform'` 那行追加 `shareToFriend`：
```ts
import { getGameCanvas, onAppHide, onAppShow, isWeChat, onNetworkOnline, onWxTouch, type WxTouchEvent, getVersusInviteCode, shareVersusInvite, shareToFriend, onWxShowVersus } from './platform';
```
并新增一行：
```ts
import { canShare, consumeShare } from './share-quota';
```

- [ ] **Step 5: 重写弹窗 `kind:'share'` 处理为真分享**

将 `web/src/main.ts` 中：
```ts
  if (hit.kind === 'share') {
    stamina = addStamina(stamina, 5);
    staminaPopupToast = '体力 +5';
    return true;
  }
```
替换为：
```ts
  if (hit.kind === 'share') {
    // 微信端真分享：判定成功后 +5 体力，扣 1 次每日额度；web 端弹窗不画此按钮，不会走到这里。
    if (!canShare()) { staminaPopupToast = '今日分享已达上限'; return true; }
    if (stamina.value >= STAMINA_MAX) { staminaPopupToast = '体力已满'; return true; }
    staminaPopupToast = '正在拉起分享…';
    track('share_click', { scene: 'stamina' });
    void shareToFriend({ title: '大圣塔防·助我一臂之力！' }).then((ok) => {
      if (ok) {
        consumeShare();
        stamina = addStamina(stamina, 5);
        staminaPopupToast = '分享成功，体力 +5';
        track('share_success', { scene: 'stamina' });
        track('stamina', { delta: 5, remain: stamina.value });
        scheduleCloudSync(2000);
      } else {
        staminaPopupToast = '未完成分享，未发放体力';
        track('share_fail', { scene: 'stamina' });
      }
      scheduleFrame();
    });
    return true;
  }
```

- [ ] **Step 6: 引导文案按平台分叉（main.ts）**

将 `web/src/main.ts` 中：
```ts
        text: '体力不够时无法开始游戏，点这里的【+】可以看广告或分享好友补充体力。',
```
替换为：
```ts
        text: isWeChat
          ? '体力不够时无法开始游戏，点这里的【+】可以分享好友补充体力。'
          : '体力不够时无法开始游戏，点这里的【+】可以看广告补充体力。',
```

- [ ] **Step 7: 帮助文案按平台分叉（menu-help.ts）**

先确认 `web/src/menu-help.ts` 是否已导入 `isWeChat`：
Run: `grep -n "isWeChat" web/src/menu-help.ts`
若无，在其 import 区加：`import { isWeChat } from './platform';`

将 `web/src/menu-help.ts` 中：
```ts
    text: `开始游戏消耗 ${STAMINA_COST} 点体力。体力不足时，可点顶栏「+」看广告或分享好友补充；未满时也会随时间自动恢复。`,
```
替换为：
```ts
    text: `开始游戏消耗 ${STAMINA_COST} 点体力。体力不足时，可点顶栏「+」${isWeChat ? '分享好友' : '看广告'}补充；未满时也会随时间自动恢复。`,
```

- [ ] **Step 8: 类型检查不新增报错**

Run: `cd web && npx tsc --noEmit 2>&1 | grep "error TS" | grep -E "menu-popups|menu-help|main\.ts"`
Expected: 无与本次改动相关的新报错（基线既有报错另计）。

- [ ] **Step 9: 提交**

```bash
cd /Users/jyxc-dz-0100360/work/fun/xy/.claude/worktrees/share-friend
git add web/src/menu-popups.ts web/src/main.ts web/src/menu-help.ts
git commit -m "feat(share): 体力弹窗按平台单按钮(微信=真分享+5/web=看广告)+文案分叉

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: tray 右侧铲子分享按钮（渲染 + 命中 + 处理）

**Files:**
- Modify: `web/src/render.ts`（imports、rect/visible/hit/draw、`draw()` 调用）
- Modify: `web/src/main.ts`（imports、`handleShareShovel`、`onPointerDown` 命中）

- [ ] **Step 1: `render.ts` 增加导入**

在 `web/src/render.ts` 的 `import { isWeChat } from './platform';` 之后追加：
```ts
import { remainingShares } from './share-quota';
```

- [ ] **Step 2: `render.ts` 新增按钮 rect/visible/hit/draw**

在 `web/src/render.ts` 中 `drawPauseBtn` 函数定义之前（或 `hitPauseBtn` 之后的合适位置）新增：
```ts
// tray 右侧「分享得铲」按钮（一格大小）：仅微信端、wave≥6、今日仍有分享额度时显示。
// 位置与 dev-only「布阵」按钮同区；生产 showAutoplaceBtn()=false 不冲突（仅 DevTools 开 autoplace 时视觉重叠）。
export function shareShovelBtnRect(): { x: number; y: number; w: number; h: number } {
  const x = TRAY_LEFT + TUNING.traySize * TRAY_SLOT + 4; // tray 右缘 +4
  return { x, y: TRAY_Y + 5, w: TRAY_SLOT - 6, h: TRAY_H - 10 };
}

export function shareShovelBtnVisible(b: Battle): boolean {
  return isWeChat
    && b.wave >= 6
    && (b.status === 'ready' || b.status === 'playing')
    && remainingShares() > 0;
}

export function hitShareShovelBtn(x: number, y: number, b: Battle): boolean {
  if (!shareShovelBtnVisible(b)) return false;
  const r = shareShovelBtnRect();
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function drawShareShovelBtn(ctx: CanvasRenderingContext2D, b: Battle): void {
  if (!shareShovelBtnVisible(b)) return;
  const r = shareShovelBtnRect();
  ctx.save();
  // 金色圆角底 + 描边
  roundRect(ctx, r.x, r.y, r.w, r.h, 10);
  ctx.fillStyle = '#f6c451';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#b9791e';
  ctx.stroke();
  ctx.clip();
  // 铲子立绘（复用现有 item-shovel 素材）
  const spr = sprite('item-shovel');
  if (spr) {
    const pad = 8;
    const s = Math.min(r.w - pad * 2, r.h - pad * 2);
    const scale = Math.min(s / spr.width, s / spr.height);
    const dw = spr.width * scale;
    const dh = spr.height * scale;
    ctx.drawImage(spr, r.x + (r.w - dw) / 2, r.y + (r.h - dh) / 2 - 2, dw, dh);
  }
  ctx.restore();
  // 右下「×1」角标
  ctx.fillStyle = '#7a3b12';
  ctx.font = 'bold 15px "PingFang SC", sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('×1', r.x + r.w - 5, r.y + r.h - 3);
}
```
（`TRAY_LEFT`、`TRAY_SLOT`、`TUNING`、`roundRect`、`sprite`、`isWeChat` 均已在 render.ts 作用域内；`'item-shovel'` 是合法资源键。）

- [ ] **Step 3: 在 `draw()` 中调用绘制**

将 `web/src/render.ts` `draw()` 中：
```ts
  drawPauseBtn(ctx, b);
```
替换为：
```ts
  drawPauseBtn(ctx, b);
  drawShareShovelBtn(ctx, b);
```

- [ ] **Step 4: `main.ts` 增加导入**

`main.ts` 已从 `'./render'` 导入若干符号（含 `hitPauseBtn`）。定位该 import 行：
Run: `grep -n "hitPauseBtn" web/src/main.ts`
在该 `from './render'` 的解构 import 里追加 `hitShareShovelBtn`（与 `hitPauseBtn` 并列）。
本任务 main 侧无需其它新导入——`canShare`/`consumeShare`/`shareToFriend` 已在 Task 4 导入。

- [ ] **Step 5: `main.ts` 新增 `handleShareShovel`**

在 `web/src/main.ts` 模块作用域（例如 `onPointerDown` 函数定义之前）新增：
```ts
// tray 铲子分享按钮点击：微信真分享→成功则自动挖最优格并扣 1 次额度（先挖后扣，无可挖格不扣）。
async function handleShareShovel(): Promise<void> {
  if (!canShare()) return; // 双保险（按钮已按额度隐藏）
  track('share_click', { scene: 'shovel' });
  const ok = await shareToFriend({ title: '大圣塔防·助我一铲之力！' });
  if (!ok) {
    battle.message = '未完成分享';
    track('share_fail', { scene: 'shovel' });
    scheduleFrame();
    return;
  }
  if (battle.shareDigBest()) {
    consumeShare(); // 挖到才扣次数；shareDigBest 内已设 message
    track('share_success', { scene: 'shovel' });
  } else {
    battle.message = '暂无可开垦阵位'; // 无可挖格：不扣次数
  }
  scheduleFrame();
}
```
（`battle`、`scheduleFrame`、`track` 均为 main.ts 现有模块符号。）

- [ ] **Step 6: `onPointerDown` 中加命中（暂停按钮命中之前）**

在 `web/src/main.ts` 中找到：
```ts
  if (hitPauseBtn(x, y) && (battle.status === 'ready' || battle.status === 'playing')) {
```
在这一行**之前**插入：
```ts
  if (hitShareShovelBtn(x, y, battle)) {
    playSfx('click');
    void handleShareShovel();
    return;
  }
```
（铲子按钮位于 tray 右侧 y≈777，与暂停按钮 HUD 区不重叠；`hitShareShovelBtn` 内部已含微信/波次/额度可见性判断，非微信/未满足条件恒返回 false，web 端不受影响。）

- [ ] **Step 7: 类型检查不新增报错**

Run: `cd web && npx tsc --noEmit 2>&1 | grep "error TS" | grep -E "render\.ts|main\.ts"`
Expected: 无与本次改动相关的新报错。

- [ ] **Step 8: 全量单测回归**

Run: `cd web && npx vitest run`
Expected: 全绿（或与基线一致；新加的 3 个测试文件通过，既有不破）。

- [ ] **Step 9: 提交**

```bash
cd /Users/jyxc-dz-0100360/work/fun/xy/.claude/worktrees/share-friend
git add web/src/render.ts web/src/main.ts
git commit -m "feat(share): tray右侧铲子分享按钮(微信端·第6波起·共享额度)成功自动挖最优格

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: 验证与收尾

**Files:** 无（验证）

- [ ] **Step 1: 类型检查——不新增报错**

Run: `cd web && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: 数字与 main 基线（约 28）一致；如超出，逐条核对新报错不来自本次改动文件。

- [ ] **Step 2: 全量单测**

Run: `cd web && npx vitest run`
Expected: 新增 `share-quota`/`share-judge`/`battle.share-dig` 全绿；既有测试不回归。

- [ ] **Step 3: Web 浏览器冒烟（见记忆 web-smoke-test-harness）**

启动 dev（`web/` 下 `npx vite` 或既有 start 脚本），用 puppeteer-core + 本机 Chrome + `window.__game` 钩子，或人工在浏览器：
- 打开体力弹窗：**只有「看广告 +10」**，无「分享好友」。
- 进入战斗打到第 6 波：**无铲子按钮**（web 端 `shareShovelBtnVisible` 恒 false）。
Expected: 与预期一致；无运行时初始化错误（见记忆 verify-web-in-browser）。

- [ ] **Step 4: 记录微信真机验证清单（本任务不在 CI 内，交付时人工过）**

在 PR/交付说明中列出真机待验证项：
- 体力弹窗只剩「分享好友 +5」；点分享拉起转发面板。
- 停留 <2s 取消 → toast「未完成分享」，不加体力、不扣次数。
- 停留 ≥2s → toast「分享成功，体力 +5」，体力 +5（上限 30 封顶）、扣 1 次。
- 第 6 波起出现铲子按钮；点击分享成功 → 挖格动画+音效、message「好友助力，铲开新阵位！」。
- 体力弹窗分享 + 铲子分享合计 4 次后：弹窗按钮置灰「今日分享已达上限」、铲子按钮消失。
- 隔日再进：额度恢复 4 次。

- [ ] **Step 5: 更新 CHANGELOG（若项目惯例要求）**

Run: `head -20 CHANGELOG.md`
若有"未发布"段落惯例，追加一条：`feat(share): 广告→分享好友(微信端)：体力弹窗真分享+5、tray铲子分享按钮(第6波起)、每天4次共享额度`。

- [ ] **Step 6: 最终提交（若有 CHANGELOG 等收尾改动）**

```bash
cd /Users/jyxc-dz-0100360/work/fun/xy/.claude/worktrees/share-friend
git add -A && git commit -m "chore(share): CHANGELOG + 收尾

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 备注 / 已知边界

- **判定可被规避**：停留启发式理论上可"故意切后台 2s"刷；配合 4 次/天上限，风险可控。第 2 期若上真广告或需强校验，可加群分享 shareTicket。
- **dev autoplace 按钮重叠**：仅 DevTools 开 `showAutoplaceBtn()` 时与铲子按钮同区重叠，生产不触发。
- **广告代码保留**：`ads.ts` 不动；微信端仅隐藏入口，第 2 期开广告位时把体力弹窗微信分支恢复/新增「看广告」按钮即可。
- **素材**：复用 `item-shovel.png`（已上线 CDN），无需 tos-upload；若后续要竞品同款金框立绘，另起素材任务（遵循 asset-generation-rules + tos-upload）。
