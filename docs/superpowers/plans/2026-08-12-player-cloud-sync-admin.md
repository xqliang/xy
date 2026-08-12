# Player Cloud Sync · Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship anonymous UID cloud backup, daily rank leaderboard, avatar/nickname profile UI, event telemetry, and a dubbing-style `/admin` on ECS `:8082` with MySQL `xy_game`.

**Architecture:** Repo-root Python `server/` serves static `/opt/xy/html` plus `/api/*` and `/admin/*` against MariaDB. Web client keeps gameplay authority in localStorage, syncs `save_json`, submits daily rank, and posts batched events. Admin HTML reads aggregated `daily_stats` + raw tables.

**Tech Stack:** Python 3 + PyMySQL + stdlib `http.server`; Vite/TS canvas client; MariaDB; systemd + mysqldump backup (dubbing pattern).

## Global Constraints

- Hybrid authority per `docs/superpowers/specs/2026-08-12-player-cloud-sync-admin-design.md`
- UID: `^\d{8,20}$`; header `X-Uid`
- DB: `xy_game`, user `xy_game@localhost`, utf8mb4
- Day boundary: `Asia/Shanghai`
- No WeChat auth in v1; no Redis
- Do not commit unless user asks
- Numeric balance docs: N/A unless TUNING constants change

## File Structure

| Path | Responsibility |
|------|----------------|
| `server/server.py` | HTTP entry: static + route `/api` `/admin` |
| `server/db.py` | connect, migrate schema |
| `server/avatar_catalog.py` | static avatar defs (mirror TS) |
| `server/api_player.py` | login/sync/me/profile/unlock |
| `server/api_leaderboard.py` | submit + daily get |
| `server/api_events.py` | batch events + aggregator thread |
| `server/admin_app.py` | session auth + HTML pages |
| `server/config.example.yaml` | DSN, admin, static_dir |
| `server/requirements.txt` | PyMySQL, PyYAML |
| `server/deploy/*` | init db, backup timer, systemd unit |
| `server/tests/*` | pytest against MYSQL_TEST_DSN |
| `web/src/api/client.ts` | fetch wrapper + base URL |
| `web/src/user-id.ts` | auto-generate UID |
| `web/src/cloud-sync.ts` | save snapshot + sync/login |
| `web/src/avatar-catalog.ts` | mirror server catalog |
| `web/src/profile-popup.ts` | avatar + nickname UI |
| `web/src/leaderboard.ts` | real API rows |
| `web/src/telemetry.ts` | event queue |
| `start.sh` | deploy syncs `server/` + restart |

---

### Task 1: Server skeleton + schema + player API

**Files:**
- Create: `server/server.py`, `server/db.py`, `server/config.py`, `server/avatar_catalog.py`, `server/api_player.py`, `server/requirements.txt`, `server/config.example.yaml`, `server/tests/test_player_api.py`

**Produces:** `login`, `sync`, `me`, `profile`, `avatar/unlock` working against MySQL.

- [ ] Start MariaDB test container; create `xy_game_test`
- [ ] Implement schema migrate + player handlers
- [ ] Pytest: login idempotent, sync newer-wins, unlock default + rank gate, reject locked avatar
- [ ] Manual: `python server/server.py` with test DSN

### Task 2: Leaderboard + events + aggregator

**Files:**
- Create: `server/api_leaderboard.py`, `server/api_events.py`, `server/tests/test_leaderboard_events.py`

**Produces:** daily submit/get; event batch; 5‑min (or on-demand) recompute last 2 days into `daily_stats`.

- [ ] Pytest: submit max-of-day; daily top+me; events → stats fields

### Task 3: Admin UI

**Files:**
- Create: `server/admin_app.py`, `server/templates/*.html`

**Produces:** `/admin` login; users / overview / heroes / items / ads / economy / leaderboard pages.

- [ ] Manual smoke with seeded events

### Task 4: Deploy scripts

**Files:**
- Create: `server/deploy/deploy-server.sh`, `backup-mysql.sh`, systemd unit/timer
- Modify: `start.sh` deploy path; retire use of `web/public/server.py` as API host

**Produces:** ECS can init DB, run service, daily dump.

### Task 5: Client UID + API + cloud sync + telemetry

**Files:**
- Modify: `web/src/user-id.ts`
- Create: `web/src/api/client.ts`, `web/src/cloud-sync.ts`, `web/src/telemetry.ts`, `web/src/clear-count.ts`
- Wire: `web/src/main.ts` menu enter / settle

**Produces:** auto UID; login/sync; events on start/end/shop/ad/stamina/merit/fragment.

- [ ] Vitest where pure; manual against local server

### Task 6: Avatar catalog + profile popup + menu hit

**Files:**
- Create: `web/src/avatar-catalog.ts`, `web/src/profile-popup.ts`
- Modify: `web/src/menu.ts`, `web/src/main.ts`, `web/src/menu-popups.ts` as needed

**Produces:** click avatar → scroll pick + optional nickname; locked states; profile POST.

- [ ] Placeholders: reuse existing hero sprites as avatar art until Seedream pack uploaded

### Task 7: Leaderboard UI + settle submit

**Files:**
- Modify: `web/src/leaderboard.ts`, settle path in `web/src/main.ts` / `settle.ts`

**Produces:** real daily board; offline message; submit after settle.

### Task 8: End-to-end self-test

- [ ] Docker MySQL + server + `curl` API script
- [ ] `npm test` / targeted vitest
- [ ] Browser or puppeteer smoke if available

---

## Spec coverage checklist

| Spec section | Task |
|--------------|------|
| Hybrid backup + profile | 1, 5 |
| Daily rank board | 2, 7 |
| Avatar unlock + UI | 1, 6 |
| Events + admin stats | 2, 3 |
| MySQL + backup deploy | 1, 4 |
| No WeChat v1 | — (omitted) |
