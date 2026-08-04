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

- **A recipe is not a separate loggable entity.** It materializes as a `foods` row (`source: 'recipe'`). Logging a recipe is logging any other food. `totalWeightGrams` is stored independently of ingredient sum because cooking changes weight without changing calories.
- **Foods are shared across all users.** `foods` has no `userId`. Everything else is per-user.
- **Logs have no `meal` concept** — removed in migration `0006`. `date` and `loggedAt` are the only temporal fields. Copy-a-day always copies the whole day.
- **Goals and Programs are separate tables.** A Goal (`goals`) is WHAT the user wants; a Program (`programs`) is HOW. `program_days` holds per-weekday calorie/macro targets — always exactly 7 rows (uniform, not sparse). `checkins` is a pure TDEE snapshot — neither table carries target calories.

**Auth** (`backend/src/auth.ts`): password-only login — `/api/auth/login` iterates every user with `bcrypt.compare` until one matches. Session is a signed httpOnly cookie (30-day expiry). Access control is at the network layer (Tailscale), not the app layer.

**Onboarding gate** (`App.tsx`'s `needsOnboarding`): gated on persisted `profiles.onboardingCompletedAt`, not derived live from weights/goal state — deleting your only weigh-in or ending a goal no longer bounces an onboarded user back into `OnboardingFlow`. Stamped by whichever fires first: first `POST /api/goals`, or OnboardingFlow's weight-step "Skip for now". Consequence: **"no active goal" is a real, possibly long-lived Dashboard state**, not transient — `DashboardScreen.tsx`'s "Set a goal" card is the permanent reminder, and every "New Goal" entry routes through `goToNewGoal()`, which opens `LogWeightFirstSheet` first when `trendWeightKg` is null (a soft nudge with a "Continue without weighing in" escape hatch, not a hard block).

**Chrome's password-manager keyboard strip** shows over `LogWeightInline`'s weight input on Android Chrome despite `autoComplete="off"`, the `data-lpignore`/`data-1p-ignore`/`data-bwignore` combo, and a real `<form autoComplete="off">` wrapper. Known, filed Chromium bug (issues.chromium.org/issues/40856139) — intentional per Google, not controllable page-side. Don't retry HTML-attribute variations.

**Coaching/TDEE engine** (`backend/src/engine/tdee.ts`, `trendWeight.ts`, orchestrated by `performCheckin()` in `routes/coach.ts`):
- Trend weight is an EWMA (alpha=0.1) recomputed from full history each request. Gap days are handled by linearly interpolating raw weight and stepping the EWMA once per implied day — NOT a single widened-alpha step, which overshoots (an 80kg trend absorbing 82kg after a 10-day gap: ~81.30kg widened-alpha vs. ~80.83kg stepped correctly).
- `estimateAdaptiveTdee()`: 21-day window, trimmed mean (drops highest+lowest at 5+ values), 50% coverage threshold. Returns `{ tdee, fluxKcal }` where `fluxKcal` is stddev of the *untrimmed* values (keeps variance honest).
- `performCheckin()` snapshots TDEE to `checkins`, falls back to Mifflin-St Jeor when < 2 weigh-ins or < 11 calorie days. Coached programs regenerate `program_days` on every check-in unless `distributionMode = 'custom'`.
- **Target resolution**: `lib/programTargets.ts`'s `targetsForDate()`. `lib/checkins.ts`'s `activeCheckinForDate()` is only for TDEE lookups.
- Current-day boundaries use `lib/householdDate.ts` with `APP_TIME_ZONE` (Brisbane by default); date arithmetic on those `YYYY-MM-DD` strings uses `Date.UTC()` — never `setDate()`/`getDate()`.
- `computeTrend()` (sparse, one row per real weigh-in) feeds the TDEE engine/program generation/coach status — output shape must stay untouched. The Weight Trend chart uses `computeDenseTrend()` instead (one row per calendar day; `computeTrend` is defined in terms of it so they can't drift). Only `GET /api/weights/trend` uses the dense version.
- The Expenditure chart is driven by the daily backfill (`GET /api/coach/expenditure-daily`), not `checkins`. A day without a fresh estimate holds the last real one forward and renders a hollow "Holding" dot instead of a filled one.

## Critical gotchas

**`apiFetch` Content-Type** (`api/client.ts`): only attach `Content-Type: application/json` when the request has a body. Fastify hard-rejects a header-with-no-body (`FST_ERR_CTP_EMPTY_JSON_BODY`, 400). This was the actual cause of deletes silently reverting.

**Service worker** (`vite.config.ts`): no `/api/` runtime caching. Workbox's Cache API throws on non-GET requests. TanStack Query's IndexedDB persistence (`idb-keyval`, `main.tsx`) covers offline/instant-reopen instead. Don't add a caching rule for `/api/` without scoping it to GET only.

**`loggedAt` timestamps**: stored as fake-UTC ISO strings that are actually local wall-clock time. Never parse through `Date`'s UTC conversion — it double-shifts by the browser's timezone offset. Extract hours/minutes via regex (`formatLogTime`, `minutesBetweenLoggedAt`).

**Weight cache invalidation**: any weight mutation must invalidate both `["weights"]` AND `["coach"]` — `/coach/status` recomputes trend weight live. Miss this and Dashboard tiles (Goal Progress, Expenditure) show stale data.

**Optional weight sync** (`routes/weights.ts`: `pushWeightSync`): when both `WEIGHT_SYNC_RELAY_URL` and `WEIGHT_SYNC_USER_NAME` are set, every POST/DELETE on `/api/weights` for that exact account name best-effort pushes the full history to the relay — never blocks the request and swallows failures. It is disabled by default so forks cannot send weights to an unrelated relay.

**Dashboard tiles** (`lib/dashboardLayout.tsx`): `load()` trusts the stored array as-is — does NOT auto-append missing catalog tiles (an earlier version did, silently reversing every toggle-off on reload); a tile added to the catalog later won't appear until the "+ Add" sheet is opened. Also, a tile's headline must match its own subtitle's window — Energy Balance's said "Last 7 days" but its headline was just the latest single day, disagreeing with its own sparkline (`avgBalance7` fixed it by averaging the same window shown).

**Dashboard calorie arc swipe** (`DashboardTotalsArcCard.tsx`): both Total and Remaining pages stay mounted for native scroll-snap. The inactive page's large arc resets transitionlessly; crossing the swipe midpoint marks it active and reveals the arc on the next animation frame, replaying the empty-to-value fill without remounting either page. Keep reduced-motion support and don't animate the smaller macro bars on every page switch.

**DraggableSnapSheet snap** (`components/DraggableSnapSheet.tsx`): collapsed state uses real CSS `height` tracking the snap point, not `transform: translateY` — transform-only left the panel physically full-height, painting over controls below it. Transform is only live drag feedback, discarded on finger lift.

**Rubber-band overscroll** (`hooks/useRubberBandScroll.ts`): offsets `<body>` via `position: relative` + `top`, not `transform` (would make body a containing block for every `position: fixed` descendant — ShortcutsBar, BottomNav). Must `preventDefault()` on the *arming* move itself, or the pull never grows past zero. Arms against the nearest real scrollable ancestor of the touch, not always `window.scrollY`, or a screen with its own inner `overflow-y-auto` reads as permanently "at the boundary" and blocks its own scroll. Horizontal drag controls need `data-no-rubber-band` on a wrapper, or their vertical wobble arms a bounce mid-drag.

**Dashboard scroll restore** (`DashboardScreen.tsx`, `lib/dashboardScroll.ts`): capturing uses `useLayoutEffect`, not `useEffect`, to save scroll position before a lazy detail screen unmounts — its first-ever visit commits an empty subtree and clamps `scrollY` to 0, and only layout-phase cleanup runs early enough to avoid saving that clamped 0 over the real position. Restoring only fires for the Dashboard, and only when returned to from a screen one of its own tiles opened — a tab switch always resets to top (tracked via `BOTTOM_NAV_ROOTS` + `noteNavigation()`, not react-router's `useNavigationType()`, unreliable here).

**Never push a history entry while handling `popstate`** (`lib/useBackDismiss.ts`). Chrome's History Manipulation Intervention marks the entry a page navigates *away from* as skippable whenever the page pushes without user activation — and a back gesture, being browser chrome, grants none. This file used to re-push a replacement entry inside its own popstate handler so one trap could absorb press after press; that silently poisoned the entry underneath, so the next back press found nothing non-skippable and exited the app outright. Only back/forward **UI** sets the flag — programmatic `history.back()` doesn't, so no scripted reproduction can see this. Symptom: back exits the app one press early, only via the real gesture. Contract that fixed it: **one trap owns exactly one history entry, consumed by one back press.** A UI absorbing N presses declares `useBackDismissDepth(n, …)` and holds N entries; every dismiss must reduce depth by exactly one, or the next press desyncs and escapes. Nothing may open a *new* overlay in response to back. Nested traps generalize beyond sheets/modals: FoodDetailScreen's custom keypad (see its own entry below) stacks a second `useBackDismiss` on top of a component's own outer one for a plain in-page toggle state, not just a mounted/unmounted overlay.

**A hook declared after a conditional early return is a live crash, not a lint nit** (found 2026-08-03, `AddFoodSheet.tsx`). This component starts with `if (!open) return null`, and one `useEffect` (the recipe Edit/Explode/Duplicate resolver, keyed off `pendingRecipeDetail`) had drifted below that line. Every render while `open` is false skips it entirely; the moment `open` flips true on that same mounted instance, React sees a different hook count than the previous render and throws ("Rendered more hooks than during the previous render" — `Minified React error #310` in this production build). This app has **no error boundary anywhere**, so the throw unmounts the entire tree: a blank screen with no back button, no nav, nothing — the only recovery is reloading. Reproduced concretely via `RecipeForm`'s own nested `AddFoodSheet` instance (its "Add ingredient" button toggles a plain boolean `open`), in both the create-recipe and edit-recipe paths — anywhere that mounts `AddFoodSheet` once and toggles `open` on the same instance rather than mounting it fresh each time. Fix was purely mechanical (move the hook above the return), but the general lesson isn't: **grep every hook in a component against its own early returns whenever one is added or moved**, since TypeScript's build and this repo's own `tsc` gate catch zero classes of this bug — it only surfaces at runtime, and only on the specific prop transition that flips the return's condition.

**BottomNav** is hidden entirely on `/strategy/*` sub-routes — the wizard CTA button was unclickable because the nav's fixed "+" button intercepted taps.

**Bordered-wrapper inputs**: text inputs inside a div carrying the visible border need `focus-within:border-accent` on the wrapper, not `focus:border-accent` on the input, or keyboard users get no visible focus state.

**Macro colors** (`tailwind.config.js`): calories `#749EF4` / protein `#EF8D6A` / fat `#F7D372` / carbs `#5ABC80` — pixel-sampled from MacroFactor's palette at the user's request, deliberately not run through the dataviz skill's validator (single-person household). Don't reflexively "fix" this back to a validated palette — confirm first. Duplicated as raw hex literals in several chart/animation files — grep before changing again, since `expenditure`/`goal` reuse some pre-MacroFactor hex values coincidentally.

**Nutrient storage**: `microsJson` values are always grams per 100g (display conversion to mg/mcg happens in `FoodDetailScreen`'s meta tables — get this wrong and every vitamin/mineral figure is off by 1000×). Fat subtypes (`monounsaturatedFatPer100g`, `polyunsaturatedFatPer100g`, `omega3Per100g`, `omega6Per100g`, `transFatPer100g`) are real `foods` columns instead, not in `microsJson`.

**AFCD-seeded local food library**: `foods` has ~1,588 generic staples pre-loaded (`source: 'afcd'`) from the Australian Food Composition Database — real government data, not AI-estimated (idempotent import, `backend/src/scripts/import-afcd-foods.ts`). Search is two-stage: live input queries SQLite-only `GET /api/foods` immediately; the 350ms-debounced `GET /api/foods/remote` appends OFF rows later, always below/deduped against local results. Never make local rendering await OFF again. Also added sparse `aminoAcidsJson` (~12% have a real multi-acid panel) and `carbDetailJson`. **Gotcha**: an exact-name older food can block the better AFCD insert (happened with "Honey") — hide the old row (`hiddenAt`) and hand-insert AFCD, don't delete it.

**Local search relevance** (`routes/foods.ts` + `engine/foodSearch.ts`): literal name strength remains the primary sort key; each user's log frequency then recency breaks ties. Candidate matching also expands a deliberately small Australian/everyday alias list (capsicum/bell pepper, mince/ground beef, etc.) and searches brands. Keep aliases equivalent and explicit — broad semantic expansion makes results unpredictable. Completed debounced searches aggregate into per-user `food_search_stats`; a selection records the chosen real food and whether OFF supplied it, making the exact query a private learned alias on its next use without retaining keystrokes. Account-data reset must clear these stats too. Search starts at 2 characters; ranking reads the user's small log history once and filters in JS — never build `IN (...)` from every broad food candidate, which crashed better-sqlite3 on first-letter searches.

**Household food measures**: `foods.measuresJson` stores only verified `{name, grams}` pairs; `servingName`/`servingSizeGrams` remains the primary backwards-compatible serving and is merged into the same UI list. Never infer cup/slice/piece weights from food names — density and item size make guessed conversions silently corrupt logs. Custom foods may define multiple measures; label/OFF primary servings work without duplication.

**OFF search reliability** (`engine/openfoodfacts.ts`): Search-a-licious can translate an English category match into a foreign displayed product name (`honey` returned French `Miel...` even with `langs: ["en"]`), while legacy `/cgi/search.pl` has weak relevance. `searchOffProducts()` queries Australian-filtered current, global current, and legacy results in parallel; prefers `product_name_en`, requires literal query overlap in displayed name/brand, boosts exact/phrase/all-word, Australian, English, and popularity signals, then merges by barcode. Current search uses the documented POST API with English fields/phrase boosting. Each source gets ≥8 candidates, 2 attempts × 4s, and a 10-minute cache. No typo tolerance.

**FoodDetailScreen**: quantity entry is a custom keypad (`keypadOpen` state), not a real `<input>` — reverted once already when tried as a real input (back had nothing keyboard-shaped to close first, exiting the whole screen in one press) and reintroduced 2026-08-03 with a second, nested `useBackDismiss(keypadOpen, …)` trap stacked on the screen's own outer one, so back closes the keypad before a second press leaves the screen. **Gotcha**: this only works if the host contributes zero extra back-dismiss depth of its own for the "detail" step — `AddFoodSheet.tsx`'s `SHEET_SUB_STEP_BACK` deliberately omits it (every *other* step there owns no trap, so the sheet owns their depth instead). Getting this wrong doesn't error, it silently shadows: the host's trap lands on top of both of FoodDetailScreen's, so the first back press is swallowed and skips both. Breakdown rows are plain label + amount, never a percentage, with color-coded %DV bars for macros/vitamins/minerals only (no bar for Net Carbs, Other Fat subtypes, or Cholesterol) — removed then re-added on request, don't remove without being asked.

Since it's not a real input, it also fakes what one gets for free: a `caret-blink` CSS class (index.css) for a blinking cursor after the last digit, and an `allSelected` state that re-arms on every keypad open (including initial mount) so the prefilled quantity shows highlighted and the first keystroke replaces it outright instead of appending — same as tapping into a real input's existing value. Consumed (set false) after one keystroke; backspace while selected clears the whole field rather than trimming one character.

The docked footer (quantity/keypad/Log Foods+Add) is a `shrink-0` flex sibling *after* the scrollable pane, so it can't move up to meet Impact on Targets on its own. A ResizeObserver-measured `spacerHeight` (same idiom as AddFoodSheet's `actionBarHeight`, clamped 12–260px) fills whatever's left of the pane's height after the rings, so Protein Breakdown lands below the fold instead of peeking through — confirmed with the user (2026-08-03) as the actual priority over a perfectly consistent gap size; don't flatten this back to a fixed value without checking first. Skipped entirely when `hideTargetsUi` (recipe-ingredient quantity editing, no rings at all) — filling leftover space there just left a large dead gap under the To custom/Favourite row with nothing for it to protect, so that mode always gets the 12px floor instead.

**`activeCheckinForDate()` tie-break**: same-day check-ins resolved by `createdAt` (latest wins). `latestPerDayCheckins()` collapses same-day duplicates for views that plot check-ins directly.

**Camera focus on Android** (`BarcodeScanner.tsx`): `focusDistance`/`pointsOfInterest` constraints appear to succeed but have zero effect on the actual lens (Galaxy S24+ / Chrome / Samsung driver gap). Don't spend time tuning constraint values.

**`GET /api/logs/history`**: returns every day in the range including zero-calorie days (dense fill). Cap is 3650 days.

**Macros/Nutrient day-detail screens**: Today/Week/Month rows show the **average per day**, not a raw sum — matching every other multi-day stat in the app. "Nutrient Completeness" was deliberately left out — `*Per100g` columns are `NOT NULL` and OFF defaults a missing macro to `0`, so nothing distinguishes "really 0g" from "unknown." Don't approximate with `=== 0`.

**DB surgery**: the `.sqlite` file is root-owned from inside the container. Use `docker exec macrotrack node -e "..."` with `better-sqlite3`, not host-side `sqlite3`.

**`foods.hiddenAt`**: "deleting" a food never removes the row if a log still references it — nutrition is computed live from `foods`, never snapshotted, so hard-deleting would corrupt logs. `DELETE /api/foods/:id` sets `hiddenAt` on FK conflict instead: resolvable by id, but filtered out of every browse/pick surface (`isNull(foods.hiddenAt)`). `ai_estimate` foods from Describe are hidden from creation, not just on delete. Any new browse/search query over foods needs this same filter.

**AI food entry and keys** (`engine/anthropicClient.ts`, `labelScan.ts`, `describeMeal.ts`): each account may save its own key from More → AI features. Keys are files under `DATA_DIR/secrets/anthropic`, never part of the browser-readable settings JSON; an account key overrides optional installation-wide `ANTHROPIC_API_KEY`. Every AI engine resolves with the requesting `userId`. Label scanning uses Claude Haiku 4.5 with a hand-written JSON Schema; meal description uses **Sonnet 5**, matching household foods when confident or persisting a hidden `source: 'ai_estimate'` fallback.

**Progress photos**: six UI poses: front/side/back relaxed and front/side/back flexed. The original stored values (`'front' | 'side' | 'back'`) intentionally mean relaxed so existing photos need no migration; flexed values use an `_flexed` suffix. `photos.pose` remains nullable — null means an older/uncategorized shot, still shown in history but excluded from pose comparison. No separate "latest photo by pose" endpoint: derived client-side from the already-fetched full `usePhotos()` list.
New uploads keep a bounded 2560px working image for alignment, then render one fixed 1200×1600 lossless crop before the server's final metadata-stripping JPEG encode. Don't restore the old 0.4MB post-crop compression pass: it caused redundant JPEG loss and left comparison exports upscaling small crops.

## Frontend patterns

**Sheets**: all built on `BottomSheet.tsx` (backdrop + panel + swipe-to-dismiss) except `AddFoodSheet`, which uses `DraggableSnapSheet.tsx` (two snap points, no dismiss gesture). Build new sheets on `BottomSheet`, not from scratch.

**AddFoodSheet dual-layer**: Layer 1 (background, full-screen) = Plate View. Layer 2 (foreground) = `DraggableSnapSheet` with Search/Scan/Quick Add/Library/Custom tabs. The `ActionBar` (search input + Log Foods) is a plain flex sibling of both layers — not independently `fixed`/`absolute`, which caused a z-index stacking fight that made controls unclickable. Staging does NOT survive closing the sheet.

**FoodRow tap behavior**: tap the row body = open Food Detail screen; tap the "+" button = quick-add with default quantity. Both entry points in Search and Library use this hybrid.

**QuickActionFlow** (`components/QuickActionFlow.tsx`): single shared state machine for both the FAB and Dashboard shortcuts — don't duplicate it for new quick actions. Dates against `lib/viewedDate.tsx`'s `useEffectiveLogDate()`, not `localDateString()` directly, so a quick action fired from either surface lands on the same day `TodayScreen`'s own ‹/› date nav is currently viewing, not always real today.

**Global food logging destination**: a successful Add Food or Quick Add mutation launched through `QuickActionFlow` always navigates to `/log`; direct logging already opened from `TodayScreen` simply closes in place. Navigate only from the mutation's success callback and call `armTrapHandoff()` first, or the outgoing sheet trap's cleanup can `history.back()` over the new route. Recipe ingredient picking is not logging and must not navigate.

**FAB Photos navigation** (`components/QuickActionsSheet.tsx`): preload the lazy Photos chunk when the quick-actions menu mounts, then route immediately underneath the still-visible sheet and dismiss through its normal animation. This overlaps page loading with the slide-down instead of exposing Suspense's null fallback or adding a dead delay. Call `armTrapHandoff()` before navigating; without it, the outgoing sheet trap's cleanup calls `history.back()` when the animation finishes and cancels the route change.

**Fixed-position chrome shown by more than one screen must be mounted once, not per-screen.** `ShortcutsBar` used to be rendered separately by `DashboardScreen` and `TodayScreen` — a route switch between them fully unmounted and remounted it, reading as the colored icons "flashing" on tab change (root-caused 2026-08-03 via a device trace: `visible` itself never changed, it was a real DOM teardown/rebuild, not a CSS/animation bug). Fixed like `BottomNav`: rendered once in `App.tsx`, gated on `location.pathname`. A screen needing it hidden locally (`TodayScreen`'s multi-select mode) goes through `useHideShortcutsBar` (`lib/navVisibility.tsx`, same counter-based pattern as `useHideBottomNav`).

**AddFoodSheet collapsed state**: the pinned `ActionBar` visually collapses via `grid-template-rows` 0fr/1fr (not unmount) whenever `!sheetExpanded` — a floating commit button takes over its job above the collapsed sheet instead. It's a visual collapse, not a real unmount, so `actionBarHeight`'s `ResizeObserver` measurement doesn't lag a tick behind on re-expand and overshoot-then-snap. Expanded Search owns its own `useBackDismissDepth` entry underneath sub-step traps: after Chrome dismisses the real keyboard, back collapses to Plate View, then the next back closes Plate View. Keep that entry owned while a sub-step is open; creating it only when back returns to browse would push from a `popstate`-triggered render and revive the PWA early-exit bug.

**No DnD library** anywhere — hand-rolled drag in `DashboardCustomizeScreen.tsx`, swipe-to-dismiss in `BottomSheet.tsx`. Keep it that way (bundle size + touch reliability).

**Lazy loading**: Dashboard (`/`) and Food log (`/log`) are eager. Everything else is `React.lazy`. `DashboardTileSections.tsx` (recharts) and the barcode scanner (`@zxing/*`, uses `@zxing/browser` not `BarcodeDetector` — Firefox doesn't support it) are lazy-split. Don't import sizeable UI into an eager screen without lazy-splitting. In `App.tsx`, `Suspense` must stay outside the keyed `.page-enter` wrapper so a lazy route's transition begins when its real content mounts, not while the null fallback is showing.

**Global preferences** (`weightUnit`, `energyUnit`, `theme`): React Context + localStorage. Backend always stores kg and kcal; convert at display/input boundary only, never persist a converted value.

**`lib/changeIndicator.ts`**: shared Increase/Decrease/No-change direction logic reused by Weight Trend, Expenditure, Energy Balance. `epsilon` is a required param — don't default it, a kg-scale threshold must not leak into a kcal caller.

**Charts**: use `type="stepAfter"` for TDEE/target lines. Flux Range band uses two stacked `Area`s (`stackId` shared, invisible `low` base + visible `band`), not recharts' array-dataKey shorthand. Y-axis domain computed from only visible series.

**Every history chart screen** is built on `components/ChartCard.tsx` + `hooks/useChartGesture.tsx`, not assembled by hand — the hook owns pan/pinch-to-zoom and expand/collapse state; `ChartCard` owns the card border, `RangeToggle`, and an optional legend slot. Every chart's X axis must be numeric day-index (`lib/date.ts`), not a categorical date string — pan/pinch assumes a linear day-to-pixel mapping. Screens fetch full history once (`days=3650`) and slice client-side by the gesture's view range. Build new history charts on this pair. Gesture windows may extend before the first real point when history is shorter than the selected preset/minimum: clamping both ends to the data extent can create a zero-day window, making pan divide by zero and pinch permanently inert. The overlay uses `touch-action: pan-y` so vertical page scrolling can start over a chart.

## Strategy tab (Goals / Programs)

- **Goal** (`goals` table): goalType, goalWeightKg, targetRateKgPerWeek, startedAt, startWeightKg, endedAt. At most one active row (`endedAt = null`).
- **Program** (`programs` table): `style: 'coached' | 'manual'`, plus Coached-only inputs (dietType, calorieFloorKcal, proteinLevel, proteinPerKgUsed, distributionMode).
- **`program_days`**: exactly 7 rows per program (0=Sun..6=Sat). Uniform storage, not sparse.
- **`distributionMode` flips to `'custom'`** when any single day is hand-edited. "Reset All Days" always resets to `'even'`.
- **Collaborative style**: shown in the wizard but disabled — different generation formula, no reference implementation.
- **Original heuristics** (not reverse-engineered): protein Low/Moderate/High/Extra High = 1.2/1.8/2.4/3.0 g/kg; diet fat% Balanced/Low-fat/Low-carb/Keto = 25/15/35/70%.
- **`GoalSetupForm.tsx` was deleted** — fully superseded by `GoalWizardScreen`. Don't look for it.
- **`WizardShell`**: first linear stepper in the app. `GoalWizardScreen` handles New + Edit via a `mode` prop; Edit skips the goal-type question.

## Things deliberately not built

- Day-level calorie imputation on unlogged days (MacroFactor V3 feature)
- Vitamins/minerals summed into daily totals (only on the food detail screen and create form)
- "Fasting" third state for the logging consistency calendar
- Amino acid / protein type breakdown — no such data from OFF or elsewhere

## Maintaining this file

Keep this file updated as the app changes. Add a note when a feature ships, a real bug is fixed, or a design decision is made or reversed — only if it's non-obvious from reading the code. Don't add implementation narration; keep WHY and gotchas, not WHAT.

**Target size: ~20KB.** When adding notes, trim elsewhere to stay under that. If a note describes the current implementation without adding non-obvious context, cut it. Historical "we tried X and reverted" notes are worth keeping only when short and genuinely needed to prevent re-trying.
