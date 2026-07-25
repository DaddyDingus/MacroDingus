# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

macrotrack is a personal nutrition/macro tracking PWA (MacroFactor-style), built for a single household running it on their own homelab server — not a public multi-tenant SaaS. Backend and frontend are separate npm packages in one repo; there is no root `package.json`.

## Commands

Backend (`backend/`):
```
npm run dev     # tsx watch src/index.ts — hot-reloading dev server on :3000
npm run build   # tsc -p tsconfig.json, then copies src/db/migrations into dist/
npm run start   # node dist/index.js — runs the built output
```

Frontend (`frontend/`):
```
npm run dev       # vite dev server; proxies /api to http://localhost:3000 (see vite.config.ts)
npm run build     # tsc -b && vite build
npm run preview   # preview the production build locally
```

There is no lint script and no test suite in either package — don't invent one. Type-check with each package's `build` command (or `npx tsc --noEmit` from within `frontend/` or `backend/`).

Local dev requires both dev servers running at once (backend on :3000, frontend on its Vite port proxying to it). `better-sqlite3` and `bcrypt` are native modules — installing `backend/`'s dependencies on the host needs a C toolchain (`python3 make g++`); if that's unavailable, build via Docker instead (see below), which installs the toolchain inside the `backend-build` stage.

Production is a single multi-stage `Dockerfile` (frontend build → backend build → runtime) producing one container that serves the API and the built static frontend from the same Fastify process/origin — deployed via `docker compose build && docker compose up -d` in this directory. `DATA_DIR` (default `../data` relative to the backend) controls where the SQLite file, cookie secret, and uploaded photos live; point it at a scratch directory for any throwaway/test runs so you never touch the real database.

## Architecture

**Data model** (`backend/src/db/schema.ts`, Drizzle ORM + `better-sqlite3`, migrations in `backend/src/db/migrations/` via `drizzle-kit`): `users`, `foods` (shared across all users), `recipes` + `recipe_ingredients`, `logs`, `weights`, `profiles`, `checkins`, `photos`. Two things shape most of the routes and are easy to miss from a single file:

- **A recipe is not a separate loggable entity.** Creating/editing a recipe materializes a normal `foods` row (`source: 'recipe'`) computed from its ingredients — `caloriesPer100g` etc. derived from the ingredient sum, `servingSizeGrams = totalWeightGrams / servings`. Logging a recipe is then just logging any other food; there is no recipe-specific branch anywhere in the log-entry path. `totalWeightGrams` is stored independently of the ingredient weight sum because cooking changes weight (water loss/gain) without changing total calories.
- **Foods are shared, everything else is per-user.** `foods` has no `userId`; `logs`, `weights`, `profiles`, `checkins`, `photos`, and recipe *metadata* (not the resulting food) all do. A barcode lookup or custom food created by one person is immediately available to everyone on the instance.

**Auth** (`backend/src/auth.ts`): password-only login, not username+password — `/api/auth/login` takes just `{ password }` and iterates every user running `bcrypt.compare` until one matches, signing you in as whoever's password you typed. Session is a signed httpOnly cookie (`mt_session`, 30-day expiry) containing `userId.expiryTimestamp`; the signing secret is generated once into `${DATA_DIR}/.cookie-secret` (mode 0600) unless `COOKIE_SECRET` is set. A global `preHandler` hook gates every `/api/*` route except `/api/auth/*` and `/api/health`, populating `req.userId`. Signup is self-service with no invite/approval — access control is meant to happen at the network layer (Tailscale), not the app layer.

**Coaching engine** (`backend/src/engine/tdee.ts`, `backend/src/engine/trendWeight.ts`, orchestrated by `performCheckin()` in `backend/src/routes/coach.ts`): trend weight is an EWMA (`computeTrend`, alpha=0.1) with gap correction — a longer gap since the last weigh-in pulls the trend further toward the new reading, computed by widening the effective alpha for that gap (`1-(1-alpha)^daysSinceLast`) rather than always applying a single-day step. It's recomputed from full history on every request, never stored incrementally, so backfilled/edited weigh-ins are always reflected correctly. `performCheckin()` prefers `estimateAdaptiveTdee()` (backs out real TDEE from trend-weight change vs. average logged calories over a 14-day window) and falls back to `mifflinStJeorTdee()` (a formula estimate) when there isn't yet 2+ weigh-ins and 7+ days of calorie logs to trust. A "check-in" snapshots the resulting targets into the `checkins` table — the "current" targets shown anywhere in the app are always just the latest check-in row, never recomputed live, so they stay stable day-to-day and only change when the user deliberately checks in. All date arithmetic in this engine is pure UTC (`Date.UTC`), deliberately avoiding `Date`'s local-timezone-dependent `setDate()`/`getDate()`.

**Frontend structure** (`frontend/src/`): `api/` holds one file per resource, each wrapping TanStack Query hooks around `apiFetch` (`api/client.ts`) — that's also where to look for the Content-Type-only-when-there's-a-body handling that Fastify's JSON parser requires. `screens/` are route-level components wired up in `App.tsx`; `components/` are shared pieces used across screens or composed into a screen (sheets, charts, form steps). `lib/` holds small cross-cutting concerns each following the same pattern: a React Context + localStorage-backed hook (`weightUnit.tsx`, `shortcuts.tsx`), or pure date/nutrition math with no I/O (`date.ts`, `nutrition.ts`).

Routing/bundling: `App.tsx` only keeps the Dashboard (`/`) and Food log (`/log`) screens in the eager bundle — everything else (`Strategy`, `More`, the weight/macros/expenditure detail pages, `Photos`) is `React.lazy`-loaded per route. Within the Dashboard itself, the bento-card sparklines are further split into their own lazy chunk (`components/DashboardInsights.tsx`) because they're the only part of that screen touching `recharts` (~420kB) — don't import chart components into an eagerly-loaded screen without lazy-splitting them the same way; check the built bundle sizes (`npm run build` output) if you add a chart somewhere new. The barcode scanner (`@zxing/*`, ~400kB) is lazy-loaded the same way, and for the same reason it doesn't use the native `BarcodeDetector` API — that's unsupported in Firefox.

The (+) nav button and the Dashboard's 4 pinned shortcut buttons both drive the same underlying flow (`components/QuickActionFlow.tsx`) rather than duplicating the meal-picker/quick-add/log-weight/etc. state machine in two places — extend that one component if you add a new quick action rather than special-casing either entry point.

The service worker (`vite-plugin-pwa`, `frontend/vite.config.ts`) deliberately does not cache `/api/` responses — Workbox's Cache API throws on `cache.put()` for non-GET requests, and an unscoped runtime-caching rule previously broke every DELETE/PATCH/POST silently. TanStack Query's own persistence to IndexedDB (via `idb-keyval`, wired up in `main.tsx`) covers the offline/instant-reopen goal instead.
