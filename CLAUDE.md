# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

macrotrack is a personal nutrition/macro tracking PWA (MacroFactor-style), built for a single household on their own homelab server. Backend and frontend are separate npm packages in one repo; there is no root `package.json`.

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

No lint script or test suite — don't invent one. Type-check with each package's `build` command.

`better-sqlite3` and `bcrypt` are native modules — host installation needs a C toolchain; build via Docker instead if unavailable. Production deploys via `docker compose build && docker compose up -d`. `DATA_DIR` controls where SQLite, the cookie secret, and photos live — point it at a scratch dir for test runs.

**After any code change the user should be able to see: redeploy the live container** — `docker compose build && docker compose up -d`, then `docker ps` + `curl .../api/health`. Skipping this means the user's phone shows the old build regardless of how hard they refresh.

## Architecture

**Data model** (`backend/src/db/schema.ts`, Drizzle ORM + `better-sqlite3`): `users`, `foods` (shared), `recipes` + `recipe_ingredients`, `logs`, `weights`, `profiles`, `checkins`, `photos`, `goals`, `programs`, `program_days`, `favorites`. Key invariants:

- **A recipe is not a separate loggable entity.** It materializes as a `foods` row (`source: 'recipe'`). Logging a recipe is logging any other food — no recipe branch in the log path. `totalWeightGrams` is stored independently of ingredient sum because cooking changes weight without changing calories.
- **Foods are shared across all users.** `foods` has no `userId`. Everything else is per-user.
- **Logs have no `meal` concept** — removed entirely in migration `0006`. `date` and `loggedAt` are the only temporal fields. Copy-a-day always copies the whole day; the meal-picker step is gone everywhere.
- **Goals and Programs are separate tables.** A Goal (`goals`) is WHAT the user wants; a Program (`programs`) is HOW. `program_days` holds per-weekday calorie/macro targets — always exactly 7 rows per program (uniform, not sparse). `profiles` is body/lifestyle stats + `checkInDayOfWeek` only. `checkins` is a pure TDEE snapshot — neither table carries target calories any more.

**Auth** (`backend/src/auth.ts`): password-only login — `/api/auth/login` takes `{ password }` and iterates every user with `bcrypt.compare` until one matches. Session is a signed httpOnly cookie (`mt_session`, 30-day expiry). Self-service signup; access control is at the network layer (Tailscale), not the app layer.

**Coaching/TDEE engine** (`backend/src/engine/tdee.ts`, `trendWeight.ts`, orchestrated by `performCheckin()` in `routes/coach.ts`):
- Trend weight is an EWMA (alpha=0.1) recomputed from full history on every request. Gap days between weigh-ins are handled by linearly interpolating raw weight and stepping the EWMA once per implied day — NOT a single widened-alpha step, which overshoots (an 80kg trend absorbing 82kg after a 10-day gap: ~81.30kg widened-alpha vs. ~80.83kg stepped correctly).
- `estimateAdaptiveTdee()`: 21-day window, trimmed mean (drops highest + lowest daily calories at 5+ values), coverage threshold 50% of window. Returns `{ tdee, fluxKcal }` where `fluxKcal` = stddev of the *untrimmed* values (deliberate — keeps variance honest while estimate is less jumpy).
- `performCheckin()` snapshots TDEE to `checkins`. Falls back to Mifflin-St Jeor when < 2 weigh-ins or < 11 calorie days. Coached programs regenerate `program_days` on every check-in unless `distributionMode = 'custom'`. Manual programs are never touched.
- **Target resolution**: `lib/programTargets.ts`'s `targetsForDate()` for anything target-related. `lib/checkins.ts`'s `activeCheckinForDate()` is only for TDEE lookups.
- All date arithmetic uses `Date.UTC()` — never `setDate()`/`getDate()` (timezone-dependent).
- `computeTrend()` (sparse, one row per real weigh-in) is used by the TDEE engine, program generation, and coach status — its output shape must stay untouched. The Weight Trend chart instead calls `computeDenseTrend()`, which `computeTrend` is now defined in terms of (`= computeDenseTrend(...).filter(p => p.weightKg !== null)`, so the two can't drift): one row per *calendar day* with `weightKg: null` on an implied day — the trend is a legitimate derived stat every day (the EWMA steps daily internally), but the raw scale reading must never be fabricated. Only `GET /api/weights/trend` uses the dense version; every consumer of it reads `.trendKg`, never `.weightKg`.
- The Expenditure chart (`TdeeChart.tsx`) is driven entirely by the daily backfill (`GET /api/coach/expenditure-daily`, one row per day the adaptive engine had enough trailing data for), not by `checkins` — check-ins now only feed "Current Expenditure"/"Current Strategy" on the detail screen. A day without a fresh estimate holds the last real one forward (both `tdee` *and* `fluxKcal`, so the Flux Range band stays continuous) and renders with a hollow-square "Holding" dot instead of a filled "Expenditure" circle — MacroFactor's two-marker single-line approach, deliberately not two colored lines. `lib/expenditureInsights.ts` samples this same held series, so the header stat and the graph can't disagree (see the Dashboard-tile note below).

## Critical gotchas

**`apiFetch` Content-Type** (`api/client.ts`): only attach `Content-Type: application/json` when the request has a body. Fastify hard-rejects a header-with-no-body (`FST_ERR_CTP_EMPTY_JSON_BODY`, 400). This was the actual cause of deletes silently reverting.

**Service worker** (`vite.config.ts`): no `/api/` runtime caching. Workbox's Cache API throws on non-GET requests (breaks every DELETE/PATCH/POST silently). TanStack Query's IndexedDB persistence (via `idb-keyval`, `main.tsx`) covers offline/instant-reopen instead. Don't add a caching rule for `/api/` without scoping it to GET only.

**`loggedAt` timestamps**: stored as fake-UTC ISO strings that are actually local wall-clock time (`localIsoNoTz`). Never parse through `Date`'s UTC conversion — it double-shifts by the browser's timezone offset. Extract hours/minutes via regex (`formatLogTime`, `minutesBetweenLoggedAt`).

**Weight cache invalidation**: any weight mutation must invalidate both `["weights"]` AND `["coach"]` — `/coach/status` recomputes trend weight live, so a new or deleted weigh-in changes it immediately. Miss this and Dashboard tiles (Goal Progress, Expenditure) show stale data.

**Iron Dingus weight sync** (`routes/weights.ts`: `pushWeightSyncToIronDingus`): every POST/DELETE on `/api/weights` fires a best-effort push of the full weight history to `http://iron-dingus-backup:3000/api/weight-sync` (same `proxy` docker network as `iron-dingus-backup`, reached by container name — not Tailscale, this is container-to-container; the stack/containers were renamed from `mypwa`/`mypwa-backup` on 2026-08-02, along with the old pre-v2 Iron Dingus build that used to share that folder). Iron Dingus (a separate, single-person PWA with no login) polls that relay itself on its own schedule; this side only ever pushes, never blocks the request, and swallows any failure. Only **Tristan**'s weigh-ins sync — matched by `users.name`, not a hardcoded id, since this is one person's app, not the whole household's. If a second person's weight ever needs to sync somewhere, this needs a real per-target mapping, not another hardcoded name check.

**Dashboard tile persistence** (`lib/dashboardLayout.tsx`): `load()` trusts the stored array as-is — it does NOT auto-append missing catalog tiles. An earlier version tried to be helpful and silently reversed every toggle-off on reload. A tile added to the catalog later won't appear until the "+ Add" sheet is opened.

**Dashboard tile headline numbers must match their own subtitle's window.** The Energy Balance tile's subtitle said "Last 7 days" and its sparkline plotted 7 days, but the headline value was just the most recent single day's balance — noisy, and disagreed with the Energy Balance detail page's own trailing-average headline. Looked like a bug report; was actually two different stats both labeled "the" balance. Fixed by averaging the same window already shown (`DashboardTileSections.tsx`'s `avgBalance7`).

**DraggableSnapSheet snap** (`components/DraggableSnapSheet.tsx`): collapsed state uses real CSS `height` tracking the snap point, not `transform: translateY`. Transform-only left the panel physically full-height, causing it to paint over and block controls below. Transform is only live drag feedback, discarded on finger lift.

**Rubber-band overscroll** (`hooks/useRubberBandScroll.ts`): offsets `<body>` via `position: relative` + `top`, not padding (moves the document's height, not its content — the bottom edge silently did nothing) and not `transform` (would make body the containing block for every `position: fixed` descendant — ShortcutsBar, BottomNav). Must `preventDefault()` on the arming move itself, not a move later — bailing out of the arming move re-armed every move, so the pull never grew past zero and neither edge bounced. Fling momentum ending at an edge doesn't bounce (no hook for the tail of native momentum scroll). Arms by comparing against the *nearest real scrollable ancestor* of the touch's start element when one exists (`findScrollableAncestor`), not always `window.scrollY` — a screen that scrolls via its own inner `overflow-y-auto` (e.g. `WizardShell`'s `main`) leaves `window.scrollY` permanently at 0, which used to read as "already at the bottom" on the very first swipe and `preventDefault`-cancel the container's own scroll before it could move at all (the onboarding "About You" step's last field was permanently clipped below the fold). Any horizontal drag control (sliders, the Compare screen's before/after handle) needs `data-no-rubber-band` on a wrapping element — a horizontal drag always carries a little vertical wobble, enough to arm this hook and steal the gesture mid-drag otherwise. Every `<input type="range">` in the app has this except the ones inside `PhotoAlignerModal`, which already locks `document.body.style.overflow = "hidden"` while open (this hook already bails out entirely on that).

**Dashboard scroll restore** (`DashboardScreen.tsx`, `lib/dashboardScroll.ts`) has two failure-prone halves. *Capturing*: a `useLayoutEffect` (not `useEffect`, for cleanup timing) saves scroll position before a lazy (`React.lazy`+`Suspense`) detail screen unmounts. Its **first** visit commits an empty subtree, collapsing the document and clamping `scrollY` to 0 — a passive effect would save that clamped 0 over the real position; only the layout-phase cleanup runs early enough to avoid it (explains "first visit into a tile loses scroll, second visit works"). `saveDashboardScroll()` also refuses to record while unscrollable or mid-restore. *Deciding whether to restore*: only fires for the Dashboard, and only when returned to from a screen one of its own tiles opened — a tab switch (tracked via `BOTTOM_NAV_ROOTS` + `noteNavigation()`, since forward navigations fire no `popstate`) always resets to top instead. Deliberately not `useNavigationType()` (unreliable here). `history.scrollRestoration = "manual"` (`main.tsx`) stops the browser's own restore from racing this.

**BottomNav** is hidden entirely on `/strategy/*` sub-routes — the wizard CTA button was unclickable because the nav's fixed "+" button intercepted taps (`useLocation().pathname.startsWith("/strategy/")`).

**Bordered-wrapper inputs**: text inputs inside a div that carries the visible border need `focus-within:border-accent` on the wrapper, not `focus:border-accent` on the input. Missing this = no visible focus state for keyboard users.

**Macro colors** (`tailwind.config.js`): calories `#749EF4` / protein `#EF8D6A` / fat `#F7D372` / carbs `#5ABC80` — pixel-sampled from MacroFactor's dark-mode palette and chroma-matched by hand (~0.13 OKLCH chroma) at the user's request. Deliberately NOT run through the dataviz skill's validator (single-person household, normal color vision — its colorblind checks protect no one real here). Don't reflexively "fix" this back to a validated palette — confirm first. Duplicated as raw hex literals (not Tailwind classes) in several chart/animation files — grep before changing again, since `expenditure`/`goal` reuse some *pre-MacroFactor* hex values coincidentally and must NOT change alongside a macro-color update.

**OFF micronutrient storage**: `microsJson` values are always grams per 100g (same unit as OFF's `_100g` fields). Display conversion to mg/mcg (×1000 / ×1,000,000) happens in `FoodDetailScreen`'s meta tables. Get this wrong and every vitamin/mineral figure is off by 1000×.

**OFF search reliability** (`engine/openfoodfacts.ts`): neither OFF search endpoint is trustworthy alone. Legacy `/cgi/search.pl` has no relevance/popularity sort — "milk" surfaced whatever brand had most recently had unrelated products edited. The current `search.openfoodfacts.org` backend ranks well for short queries but derails on descriptive ones — "white potato raw" scored a Bulgarian brine cheese first (tag-matched on "white"/"raw" category terms), identical to searching "white" alone. `searchOffProducts()` queries both in parallel, merges by barcode, and re-ranks by literal word-overlap against `product_name` — a stable sort, so ties keep the current-backend's better default order. Each source is always asked for ≥8 candidates (`MIN_OFF_CANDIDATE_POOL`) regardless of the caller's requested limit — routes/foods.ts often only has 1-2 remote slots left after local matches, and that was too narrow a pool for the true best match to ever get fetched in the first place, no rerank could then find it. Results cache 10 min (FIFO-capped, both endpoints hit on every uncached query) and every OFF call gets 3 retries plus a 6s per-attempt timeout — it 503s often (3 of 4 consecutive calls, confirmed by hand). Real remaining gaps: rerank only checks `product_name`, not `brands`, so a brand-only match isn't boosted; no typo tolerance or phrase-adjacency bonus; OFF's own regional/language data coverage is a ceiling no client-side rerank fixes.

**FoodDetailScreen bottom bar**: quantity entry is a native `<input type="number">` — a custom on-screen keypad was built here and explicitly reverted on user request. Don't reintroduce it.

**FoodDetailScreen breakdown bars**: plain label + amount as text, never a percentage. Color-coded %DV bars underneath for macros/vitamins/minerals — no bar for Net Carbs, Other Fat subtypes, or Cholesterol (no %DV reference). Bars were removed then re-added on explicit request; don't remove without being asked.

**Fat subtypes** (`monounsaturatedFatPer100g`, `polyunsaturatedFatPer100g`, `omega3Per100g`, `omega6Per100g`, `transFatPer100g`) are real `foods` columns, not in `microsJson` — small closed set, omega-3/6 are first-class tracked nutrients.

**`activeCheckinForDate()` tie-break**: same-day check-ins resolved by `createdAt` (latest wins). `latestPerDayCheckins()` collapses same-day duplicates for views that plot check-ins directly.

**Camera focus on Android** (`BarcodeScanner.tsx`): `focusDistance` and `pointsOfInterest` constraints appear to succeed but have zero effect on the actual lens (Galaxy S24+ / Chrome / Samsung driver gap). Don't spend time tuning constraint values.

**`GET /api/logs/history`**: returns every day in the range including zero-calorie days (dense fill). Cap is 3650 days.

**Macros/Nutrient day-detail screens** (`MacrosDayDetailScreen.tsx`, `NutrientDayDetailScreen.tsx`, reached by tapping a history row on the parent screens): Today/Week/Month rows show the **average per day**, not a raw sum over the window — deliberately, to match every other multi-day stat in the app (Weight Trend's Average/Difference, the chart's own window Average). "Nutrient Completeness" (a per-food data-quality score) was deliberately left out — the `*Per100g` macro columns are `NOT NULL` and OFF imports default a missing macro to `0` (`engine/openfoodfacts.ts`), so nothing distinguishes "really 0g" from "unknown." Needs nullable raw-value tracking first — don't approximate it with `=== 0`.

**DB surgery**: the `.sqlite` file is root-owned from inside the container. Use `docker exec macrotrack node -e "..."` with `better-sqlite3`, not host-side `sqlite3`.

**`foods.hiddenAt`**: "deleting" a food never actually removes a row still referenced by a log entry — nutrition is always computed live from `foods`, never snapshotted onto the log, so hard-deleting one would corrupt every existing log entry and break copy-day. `DELETE /api/foods/:id` (and the recipe-delete fallback in `routes/recipes.ts`) instead sets `hiddenAt` on FK conflict: the row stays fully resolvable by id (logs, copy-day, nutrition math all keep working unchanged) but disappears from every browse/pick surface — search, Library, Favorites, Describe's match candidates — all of which filter `isNull(foods.hiddenAt)`. Every `ai_estimate` food from the Describe tab is hidden from the moment it's *created* (not just on delete) for the same reason as the schema comment explains: those are meant to back only the log entry(ies) that used them, never become a reusable Library entry. Adding a new hiddenAt-filtered query anywhere foods are browsed/searched/matched needs this same filter, or a "deleted" food silently reappears there.

**Nutrition-label scanning** (`engine/labelScan.ts`, `POST /api/foods/scan-label`): a label photo goes to Claude Haiku 4.5, which does the per-serving→per-100g conversion itself (reads the label's own serving size) — no OFF-style unit-conversion logic needed here. Uses a hand-written JSON Schema, not the SDK's `zodOutputFormat` helper (that needs zod's `/v4` subpath, a different namespace from the `zod` v3 every route's request validation already uses — bumped to `^3.25.76` just so `/v4` exists, kept hand-rolled to avoid a second zod API in the codebase). Every field is nullable; `CreateFoodForm` only overwrites fields that came back non-null. `ANTHROPIC_API_KEY` is optional — unset, the route 503s (checked lazily, not at boot) and nothing else in the app is affected. Shares a lazy `getAnthropicClient()` singleton with the feature below.

**Meal description** (`engine/describeMeal.ts`, `POST /api/foods/describe-meal`, the "Describe" tab): free text goes to Claude **Sonnet 5**, not Haiku — needs real judgment (portion/nutrition estimation) vs. the label scanner's pure transcription. Every returned item is already a real, persisted `foods` row: the model is handed the household's own foods/recipes/logged items (capped 300, newest first, excluding the noisy OFF search-cache) and matches by id when confident, else creates a fresh `source: 'ai_estimate'` row from its own estimate. It's told to **always** fill in its own estimate even when matching by id — the fallback if that id turns out hallucinated/invalid (checked against the real candidate set sent). `ai_estimate` foods are deletable like `custom` ones. `foods.source` has no DB-level CHECK constraint, so this value needed no migration — don't assume that's true of a real enum column elsewhere.

**Progress photos** (`screens/PhotosScreen.tsx`, `PhotoCompareScreen.tsx`, `components/PhotoAlignerModal.tsx`): `photos.pose` is nullable (`'front' | 'side' | 'back' | null`) — null means an older/uncategorized shot, still shown in history but excluded from pose comparison. No separate "latest photo by pose" endpoint: the aligner's ghost overlay and the compare screen's date lists are both derived client-side from the already-fetched full `usePhotos()` list (no per-user photo count large enough to justify a dedicated query).

## Frontend patterns

**Sheets**: all built on `BottomSheet.tsx` (backdrop + panel + swipe-to-dismiss) except `AddFoodSheet`, which uses `DraggableSnapSheet.tsx` (two snap points, no dismiss gesture). Build new sheets on `BottomSheet`, not from scratch.

**AddFoodSheet dual-layer**: Layer 1 (background, full-screen) = Plate View. Layer 2 (foreground) = `DraggableSnapSheet` with Search/Scan/Quick Add/Library/Custom tabs. The `ActionBar` (search input + Log Foods) is a plain flex sibling of both layers — not independently `fixed`/`absolute` positioned, which would cause the same z-index stacking fight that made controls unclickable. Staging does NOT survive closing the sheet (reset by a `useEffect` on `open`, not listing `clearPlate` in deps).

**FoodRow tap behavior**: tap the row body = open Food Detail screen (inspect); tap the "+" button on the right = quick-add with default quantity. Both entry points in Search and Library use this hybrid. Don't replace one with the other.

**QuickActionFlow** (`components/QuickActionFlow.tsx`): single shared state machine for both the FAB and Dashboard shortcuts. Don't duplicate it for new quick actions.

**No DnD library** anywhere — hand-rolled drag in `DashboardCustomizeScreen.tsx`, swipe-to-dismiss in `BottomSheet.tsx`. Keep it that way (bundle size + touch reliability).

**Lazy loading**: Dashboard (`/`) and Food log (`/log`) are eager. Everything else is `React.lazy`. Within the Dashboard, `DashboardTileSections.tsx` is lazy-split (only recharts consumer on that screen, ~420kB). Barcode scanner (`@zxing/*`, ~400kB) is lazy-loaded and uses `@zxing/browser` rather than `BarcodeDetector` API (Firefox doesn't support it). Don't import sizeable UI into an eager screen without lazy-splitting.

**Global preferences** (`weightUnit`, `energyUnit`, `theme`): React Context + localStorage. Backend always stores kg and kcal; convert at display/input boundary only, never persist a converted value. `energyUnit` applied to chart data arrays (not just tooltips) so axes stay consistent.

**`lib/changeIndicator.ts`**: shared Increase/Decrease/No-change direction logic reused by Weight Trend, Expenditure, Energy Balance. `epsilon` is a required param — don't default it, a kg-scale threshold must not leak into a kcal caller.

**Charts**: use `type="stepAfter"` for TDEE/target lines (holds constant between check-ins, not a diagonal suggesting gradual change). Flux Range band uses two stacked `Area`s (`stackId` shared, invisible `low` base + visible `band`), not recharts' array-dataKey shorthand. Y-axis domain computed from only visible series — don't use recharts' `"dataMin"/"dataMax"` keywords when some series can be toggled off.

**Every history chart screen** (Expenditure, Weight Trend, Scale Weight, Energy Balance, Macros, Nutrient×4) is built on `components/ChartCard.tsx` + `hooks/useChartGesture.tsx`, not assembled by hand — the hook owns pan/pinch-to-zoom, the eased preset-tween animation, and expand/collapse state; `ChartCard` owns the card border, chevron row, height-transition wrapper, gesture overlay, `RangeToggle` (always *below* the chart), and an optional legend slot (always below the `RangeToggle`, never above the chart). Shared layout constants (margins, heights, colors, `formatShortTs`) live in `lib/chartLayout.ts`. This means every chart component's X axis must be numeric day-index (`dayIndex()`/`dateFromDayIndex()` in `lib/date.ts`), not a categorical date string — pan/pinch assumes a linear day-to-pixel mapping. Screens fetch their full history once (`days=3650`) and slice/filter client-side by the gesture's `view.start`/`view.end`, rather than re-fetching per range like the old per-screen `days` state did. Build new history charts on this pair; don't reinvent the gesture math per screen.

## Strategy tab (Goals / Programs)

- **Goal** (`goals` table): goalType, goalWeightKg, targetRateKgPerWeek, startedAt, startWeightKg, endedAt. At most one active row (`endedAt = null`). "Reopen Previous Goal" just clears `endedAt` on an old one.
- **Program** (`programs` table): `style: 'coached' | 'manual'`, plus Coached-only inputs (dietType, calorieFloorKcal, proteinLevel, proteinPerKgUsed, distributionMode).
- **`program_days`**: exactly 7 rows per program (0=Sun..6=Sat). Uniform storage, not sparse.
- **`distributionMode` flips to `'custom'`** when any single day is hand-edited. "Reset All Days" always resets to `'even'`, not the original distribution.
- **Collaborative style**: shown in the wizard but disabled — different generation formula, no reference implementation.
- **Original heuristics** (not reverse-engineered): protein levels Low/Moderate/High/Extra High = 1.2/1.8/2.4/3.0 g/kg; diet type fat%: Balanced/Low-fat/Low-carb/Keto = 25/15/35/70%.
- **`GoalSetupForm.tsx` was deleted** — fully superseded by `GoalWizardScreen`. Don't look for it.
- **`WizardShell`**: first linear stepper in the app (progress bar + back/next). `GoalWizardScreen` handles New + Edit via a `mode` prop; Edit skips the goal-type question.

## Things deliberately not built

- Day-level calorie imputation on unlogged days (MacroFactor V3 feature, not attempted)
- Vitamins/minerals summed into daily totals (only on the food detail screen and create form)
- "Fasting" third state for the logging consistency calendar (needs its own UX scoped separately before building)
- Amino acid / protein type breakdown — no such data from OFF or elsewhere

## Maintaining this file

Keep this file updated as the app changes. Add a note when a feature ships, a real bug is fixed, or a design decision is made or reversed — only if it's non-obvious from reading the code. Don't add implementation narration; keep WHY and gotchas, not WHAT (the code says what).

**Target size: ~20KB.** When adding notes, trim elsewhere to stay under that. If a note describes the current implementation without adding non-obvious context, cut it. Historical "we tried X and reverted" notes are worth keeping only when short and genuinely needed to prevent re-trying.
