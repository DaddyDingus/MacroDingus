# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

macrotrack is a personal nutrition/macro tracking PWA (MacroFactor-style), built for a single household on their own homelab server. Backend and frontend are separate npm packages in one repo; there is no root `package.json`.

When the user asks to check the latest screenshot without giving another location, inspect the newest file in `/home/daddydingus/screenshots`.

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

`better-sqlite3` and `bcrypt` are native modules — host installation needs a C toolchain; build via Docker instead if unavailable. Node 24 requires `better-sqlite3` 12.1+; 11.10 compiled but later crashed under real queries in `RemoveEnvironmentCleanupHook`. Production deploys via `docker compose build && docker compose up -d`. `DATA_DIR` controls where SQLite, the cookie secret, and photos live — point it at a scratch dir for test runs.

**After any code change the user should be able to see: redeploy the live container** — `docker compose build && docker compose up -d`, then `docker ps` + `curl .../api/health`. Skipping this means the user's phone shows the old build regardless of how hard they refresh.

## Web and Android workflow

MacroTrack now has a signed Android WebView shell in `android/` that loads the
same live app from `https://macrotrack.tail984e80.ts.net`. Ordinary frontend
and backend work still ships through Docker and appears in the APK
automatically; do not rebuild or ask the user to reinstall for web-only work.
The existing refresh-app flow remains the stale-service-worker escape hatch.

Any change under `android/` or to native capabilities requires all of these:

1. Increment `versionCode` and `versionName` in
   `android/app/build.gradle.kts`, and match them in backend
   `ANDROID_RELEASE`.
2. Build the signed APK with:
   `cd android && JAVA_HOME=/home/daddydingus/.local/share/jdks/temurin-17 ANDROID_HOME=/home/daddydingus/Android/Sdk /home/daddydingus/.gradle/wrapper/dists/gradle-9.1.0-bin/9agqghryom9wkf8r80qlhnts3/gradle-9.1.0/bin/gradle clean assembleRelease`
3. Rebuild/restart Docker, which publishes that artifact at
   `/api/android/apk`, and verify `/api/android/version` plus its signature.
4. End the user handoff with a clickable cache-busted link such as
   `[Download MacroTrack vX.Y](https://macrotrack.tail984e80.ts.net/api/android/apk?v=X.Y)`.

Also provide the current clickable link whenever the user asks for the APK,
install/update link, or says they need to reinstall. State whether installing
it is actually necessary. `android/macrotrack-release.jks` and
`android/.signing-password` are ignored permanent secrets: back both up and
never regenerate them, because every in-place Android update must use the same
key.

**WebView safe-area insets (2026-08-11)**: `WebView.setPadding()` does *not*
inset Chromium's viewport — the value reads back correctly on the Java object
while `window.innerHeight` stays at the full unpadded height and nothing moves
on screen. The WebView must be wrapped in a `FrameLayout` and the *wrapper*
padded, so ordinary Android layout shrinks the child's real bounds. Pad by
exactly `bars.top` (systemBars ∪ displayCutout) with **no extra buffer**: that
reproduces the installed PWA, where Chrome starts the viewport at the status
bar bottom and the app's own CSS header padding supplies the visual gap — a
buffer here is additive with that CSS and visibly overshoots. `env(safe-area-inset-top)`
is `0px` in this WebView, so CSS cannot do this job. Also note the app renders
edge-to-edge only because `onCreate` sets `setDecorFitsSystemWindows(false)` +
`LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES`.

**Barcode scanner camera constraints**: request `facingMode: { ideal: "environment" }`,
never the bare string — Android WebView's Chromium resolves a bare value as
mandatory and throws `OverconstrainedError` where desktop Chrome succeeds.
`BarcodeScanner.tsx` falls back to `{ video: true }` (clearing any saved
`deviceId`) on that error. The `<video>` also needs a blank data-URI `poster`,
or WebView paints a large default media-placeholder glyph before first frame.
A `NotReadableError: Could not start video source` is usually OS-level camera
contention from a previous session, not a code bug — force-close the app first.
But **a reproducible one on the session's *first* scan was ours** (fixed 1.7):
only one `getUserMedia` may be in flight at a time. Recovering from a rejected
lens pin used to `setDeviceId(null)` *and* start a fallback stream inline; the
state change re-runs the effect, so two opens raced for one camera and one
shared `<video>`. Drop the pin and `return` — the re-run owns the retry.

**Media `deviceId`s do not survive an app restart.** Chromium salts them per
browsing session and the WebView shell re-salts every launch, so a pinned lens
is always rejected on first open. The saved preference therefore stores
`{id, label}`; the label is stable hardware identity and re-pins the id after
the fallback stream comes up (labels are blank until camera access is granted,
so this can't happen earlier). One recovery attempt per mount — re-pinning
restarts the stream and an unmatchable label would otherwise loop.

**`navigator.vibrate()` in the WebView runs against the host app's Android
permissions, not the browser's.** All keypad/check-in haptics were silently
dead in the shell while still working in Chrome until `android.permission.VIBRATE`
was declared (added 1.7). Any web API with an Android permission behind it needs
the same check — a working PWA proves nothing about the APK.

## Architecture

**Data model** (`backend/src/db/schema.ts`, Drizzle ORM + `better-sqlite3`): `users`, `foods` (shared), `recipes` + `recipe_ingredients`, `logs`, `weights`, `profiles`, `checkins`, `photos`, `goals`, `programs`, `program_days`, `favorites`. Key invariants:

- **A recipe is not a separate loggable entity.** It materializes as a `foods` row (`source: 'recipe'`). Logging a recipe is logging any other food. `totalWeightGrams` is stored independently of ingredient sum because cooking changes weight without changing calories.
- **Foods are shared across all users.** `foods` has no `userId`. Everything else is per-user.
- **Logs have no `meal` concept** — removed in migration `0006`. `date` and `loggedAt` are the only temporal fields. Copy-a-day always copies the whole day.
- **Goals and Programs are separate tables.** A Goal (`goals`) is WHAT the user wants; a Program (`programs`) is HOW. `program_days` holds per-weekday calorie/macro targets — always exactly 7 rows (uniform, not sparse). `checkins` is a pure TDEE snapshot — neither table carries target calories.

**Auth** (`backend/src/auth.ts`): password-only login — `/api/auth/login` iterates every user with `bcrypt.compare` until one matches. Session is a signed httpOnly cookie (30-day expiry). Access control is at the network layer (Tailscale), not the app layer.

**Onboarding gate** (`App.tsx`'s `needsOnboarding`): gated on persisted `profiles.onboardingCompletedAt`, not derived live from weights/goal state — deleting your only weigh-in or ending a goal no longer bounces an onboarded user back into `OnboardingFlow`. Stamped by whichever fires first: first `POST /api/goals`, or OnboardingFlow's weight-step "Skip for now". Consequence: **"no active goal" is a real, possibly long-lived Dashboard state**, not transient — `DashboardScreen.tsx`'s "Set a goal" card is the permanent reminder, and every "New Goal" entry routes through `goToNewGoal()`, which opens `LogWeightFirstSheet` first when `trendWeightKg` is null (a soft nudge with a "Continue without weighing in" escape hatch, not a hard block).

**All user-facing numeric entry uses the shared custom decimal keypad**, not a real input. Android Chrome's password-manager keyboard strip could not be suppressed page-side (known Chromium issue 40856139), and the system keyboard also resized sheets inconsistently. `LogWeightInline` and `FoodDetailScreen` embed `DecimalKeypad`; form fields use `DecimalInput`, which presents the same keypad in a sheet. Keep the fake caret/selection behavior rather than restoring native numeric inputs.

`DecimalInput` must blur any focused native input and wait for the visual viewport to finish expanding before it opens its keypad. Android does not reliably dismiss the previous IME merely because a button was tapped; mounting the nested keypad sheet while that keyboard remains open hides the keypad's value and keys behind the IME.

Standalone Quick Add embeds `DecimalKeypad` in its own sheet instead of opening a nested `DecimalInput` sheet. This keeps one backdrop/viewport owner; the selected macro field remains the sole live value display, and the smaller form pane scrolls it into view above the keys. Embedded keypad hosts use Food Detail's flat `bg-dashboardBg` dock treatment—never wrap the shared keypad in a rounded floating card or duplicate its active value above the keys.

**Coaching/TDEE engine** (`backend/src/engine/tdee.ts`, `trendWeight.ts`, orchestrated by `performCheckin()` in `routes/coach.ts`):
- Trend weight is an EWMA (alpha=0.1) recomputed from full history each request. Gap days are handled by linearly interpolating raw weight and stepping the EWMA once per implied day — NOT a single widened-alpha step, which overshoots (an 80kg trend absorbing 82kg after a 10-day gap: ~81.30kg widened-alpha vs. ~80.83kg stepped correctly).
- `estimateAdaptiveTdee()`: 21-day window, trimmed mean (drops highest+lowest at 5+ values), 50% coverage threshold. Returns `{ tdee, fluxKcal }` where `fluxKcal` is stddev of the *untrimmed* values (keeps variance honest).
- A logged day can be explicitly marked incomplete in `nutrition_day_statuses`. It remains visible in the diary but is excluded from adaptive TDEE, Energy Balance, and multi-day nutrition averages. Absence of a status row means an otherwise logged day is complete.
- `performCheckin()` snapshots TDEE to `checkins`, falls back to Mifflin-St Jeor when < 2 weigh-ins or < 11 calorie days. Coached programs regenerate `program_days` on every check-in unless `distributionMode = 'custom'`. It also returns `targetChanges` (before/after calories/protein/carbs/fat, averaged over the 7 `program_days` rows — read *before* the regenerate overwrites them in place, since program_days isn't versioned) for `CheckInFlow`. Null when nothing regenerated (manual/hand-edited program) — that's "no change to show", not a change of zero, and the screen says so (and promotes the refreshed expenditure to its headline instead).
- **`CheckInFlow.tsx`** (replaced `CheckInResultSheet`, 2026-08-10) owns the whole check-in as a full-screen overlay, mutation included, so Dashboard and Strategy only decide when to open it. Phases: orbit illustration held for a `MIN_WORKING_MS` floor (the API is normally faster — the floor sets the pace), the headline Calorie delta *dropped* onto the screen (`@keyframes checkin-drop`), then the detail. What's easy to break: per-keyframe `animation-timing-function` (ease-in falling, ease-out rising) + scale tracking height + a one-frame squash at each impact are jointly what make it read as a dropped object rather than a floaty slide, and translates are percentages of the number's own height (never `vh`) so the fall scales with the type. Keyframes animating `transform` override a `-translate-x-1/2` class outright — the impact line centers with a negative margin instead. Haptics are one `navigator.vibrate([0, …])` pattern, not timers, so the taps stay glued to the landings under jank; dropped along with the animation under reduced motion. Phase advance and the next phase's timer must live in *separate* effects, or the advance's own cleanup cancels the timer it just set. Accept/decline is real (2026-08-10): the screen opens on `POST /api/checkins/preview`, which runs `planCheckin()` — the whole computation with **no writes** — and Accept then re-runs it for real through `POST /api/checkins`. Keep `planCheckin()` side-effect-free; `performCheckin()` re-plans rather than accepting a plan over the wire, so a client can't dictate its own targets, and the two agree because generation is deterministic on the same data. The narrative is deliberately generated only on commit (it's a paid Claude call the preview never displays). **Decline is just `POST /api/checkins/ignore`** — the same silence-this-cycle mechanism as the Ignore buttons on Dashboard/Strategy, so there's no third "declined" state in the schema; closing with X/back is neither, leaving the check-in due and reminders on.
- **Check-in narrative tone** (`engine/checkinNarrative.ts`): the original prompt banned all sentiment ("No encouragement, congratulations, praise"). Reversed on request 2026-08-11 — it reads as sterile — for a warm, plain-spoken voice that acknowledges a cycle that went well and is straight about one that didn't. **The rule that keeps it honest: code reaches the verdict, the model only phrases it.** `assessProgress()` classifies the cycle (on_track / faster / slower / wrong_direction / holding_steady / drifting / insufficient_data / no_goal) from the observed vs. target kg/week, and each verdict carries its own tone instruction. Handing a model both the numbers and permission to encourage gets praise for any week at all, which is the one thing a factual summary can't do. Bands are deliberately loose (±0.15 kg/wk, ratio 0.75–1.5) because the verdict drives the tone and a summary that flips between "nice work" and "this slipped" on EWMA noise reads as insincere. The kg/week figure is withheld below `MIN_VERDICT_DAYS` (5) — a 3-day cycle annualizes into a wild number the model would otherwise quote next to "not enough data to judge". Tone was pushed further the same day, in three steps, to a **"muscle mommy" girlfriend persona supplied verbatim by the user** (fiercely protective, slightly bossy, references lifting/protein, "babe"/"little guy"/"good boy", calls herself Mummy). Requested deliberately for their own single-household app — **don't sanitize it back toward neutral without asking.** The persona's "makes sure you eat your protein" is why `gatherAdaptiveTdeeInputs()` now also returns `dailyProtein` (same scan, same exclusions as calories — nothing in the TDEE engine reads it) and `planCheckin()` returns the average target protein: told to talk about protein with no protein in the Facts, the model simply invents a figure. The general rule — **give the persona real data for whatever it's bound to mention, or forbid it from mentioning it.** The verdict is what decides whether he's been good or bad, which is exactly why it stays in code: a "good boy" for a cycle that missed breaks the dynamic in the same way unearned praise broke the factual version. Guardrails this voice specifically needs, all load-bearing: consequences stay teasing and **unspecified**, and may never be made out of food, meals or eating less (a punitive nutrition app would be genuinely harmful); nothing explicit; no inventing shared life context ("I know that weekend threw you off" — it knows only the Facts block); and no inferring a day-to-day pattern from an average ("under target most days" — Claude did exactly this before the rule was added). Still banned: invented numbers, emoji, more than two exclamation marks. The blanket no-advice rule was relaxed to fit the persona — she may say "keep your protein up" / "keep logging", but must not invent targets or prescribe numbers the app hasn't set. Two voice-calibration examples carry the register across providers; they're marked as other weeks so their numbers aren't reused. The narrative needs goal + in-force target calories, so `planCheckin()` reads `program_days` *before* the accept path overwrites them in place.
- **`MIN_CHECKIN_CYCLE_DAYS`** (`lib/checkinSchedule.ts`, 4): `nextCheckinDueDate()` starts its search for the chosen weekday that many days after the last check-in, not the next day. Inert in steady state (same weekday to same weekday is 7 days either way) — it exists solely for *changing* the check-in weekday, which re-aims the due date within the same week and used to be able to make a check-in due 1–2 days after the previous one (happened live 2026-08-10; the narrative it generated opened "Only 1 day has passed since the last check-in"). A cycle that short has no new data in it: the 21-day adaptive window and alpha-0.1 EWMA both return the previous answer, targets regenerate off nothing, and it burns a paid narrative call. 4 rather than 7 keeps every cycle inside 4–10 days; a 7-day floor would defer a day change by up to 13.
- **"Ignore check-in"** (`profiles.checkinIgnoredForDate`, `POST /api/checkins/ignore`): silences only the *reminders* — Dashboard banner and BottomNav's attention dot both gate on `CoachStatus.checkinIgnored`. The Strategy screen deliberately does not: its card always keeps a working Check In button (that's the "changed my mind" path), it just drops the urgent/overdue styling. The stored value is the ignored cycle's due date (or `"initial"` pre-first-check-in), so it expires by itself — a completed check-in advances the due date, which re-arms reminders. Since the due date only moves by checking in, ignoring and never checking in stays quiet indefinitely, which is the point.
- **Target resolution**: `lib/programTargets.ts`'s `targetsForDate()`. `lib/checkins.ts`'s `activeCheckinForDate()` is only for TDEE lookups.
- **"Carry Forward Shortfall"** (`daily_adjustments` table, `routes/adjustments.ts`, `CarryForwardSheet.tsx`, TodayScreen's Day actions menu): a user who came in under target one day can add the difference to the next day's target — the point being the weekly average is unaffected either way, this just reconciles *when*. Deliberately a new date-scoped table rather than an edit to `program_days` (which is the weekday template, reused every week) — the first per-calendar-date target override in the schema. One row per `(userId, date)`, upserted like `weights`. Amounts are computed and capped client-side in `CarryForwardSheet.tsx` (targets are already resolved client-only via `targetsForDate`, so the backend has nothing to compare against): calories/carbs/fat can make up at most 50% of the source day's target, protein only 25% (daily protein spread matters more for MPS than weekly total, so a big one-day protein bump is a worse "make-up" than a calorie one). Only offered one calendar day back, and only when the source day actually has logged entries — an unlogged day isn't a shortfall, it's missing data. **Only `TodayScreen` and `QuickActionFlow` apply the adjustment** via `applyAdjustment()` before handing `targets` down to `AddFoodSheet` — every AddFoodSheet mount trusts its `targets` prop as pre-adjusted rather than resolving its own, so each caller is independently responsible for applying it. **Bug fixed 2026-08-08**: `QuickActionFlow.tsx` (the FAB's "+" button and Dashboard's pinned shortcuts — i.e. any Plate View opened from somewhere other than TodayScreen's own AddFoodSheet instance) computed `targets` with bare `targetsForDate()` and no `useAdjustment()`/`applyAdjustment()` call at all, so a carried-forward day's Plate View macro bars reverted to the un-boosted target while TodayScreen's own bars correctly showed the boost — same underlying value, two call sites, one forgot the adjustment. Fixed by mirroring TodayScreen's `useAdjustment(date)` + `applyAdjustment()` there too. Dashboard and every historical/averaging screen (`NutrientDayDetailScreen`, `MacrosDayDetailScreen`, `EnergyBalanceDetailScreen`, `dayWindowStats.ts`) still deliberately call bare `targetsForDate()` and show the un-boosted target — that part remains a scope decision, not an oversight. **If a new caller ever mounts `AddFoodSheet` directly, it must apply the adjustment itself** — there's no shared hook enforcing this, so grep for `targetsForDate(` before adding one.
- All date arithmetic uses `Date.UTC()` — never `setDate()`/`getDate()` (timezone-dependent).
- `computeTrend()` (sparse, one row per real weigh-in) feeds the TDEE engine/program generation/coach status — output shape must stay untouched. The Weight Trend chart uses `computeDenseTrend()` instead (one row per calendar day; `computeTrend` is defined in terms of it so they can't drift). Only `GET /api/weights/trend` uses the dense version.
- The Expenditure chart is driven by the daily backfill (`GET /api/coach/expenditure-daily`), not `checkins`. A day without a fresh estimate holds the last real one forward and renders a hollow "Holding" dot instead of a filled one.

## Critical gotchas

**`apiFetch` Content-Type** (`api/client.ts`): only attach `Content-Type: application/json` when the request has a body. Fastify hard-rejects a header-with-no-body (`FST_ERR_CTP_EMPTY_JSON_BODY`, 400). This was the actual cause of deletes silently reverting.

**Service worker** (`vite.config.ts`): no `/api/` runtime caching. Workbox's Cache API throws on non-GET requests. TanStack Query's IndexedDB persistence (`idb-keyval`, `main.tsx`) covers offline/instant-reopen instead. Don't add a caching rule for `/api/` without scoping it to GET only.

**Transient deploy recovery**: the Tailscale sidecar stays up while the single app container is recreated, so it can briefly return a non-JSON 502/503/504. `apiFetch` retries only idempotent reads for that proxy-shaped failure; never extend this to mutations or JSON API errors. Dashboard's development refresh button waits for `/api/health` before deleting the service worker/caches, preserving the working app shell during a restart.

**`loggedAt` timestamps**: stored as fake-UTC ISO strings that are actually local wall-clock time. Never parse through `Date`'s UTC conversion — it double-shifts by the browser's timezone offset. Extract hours/minutes via regex (`formatLogTime`, `minutesBetweenLoggedAt`).

**Weight cache invalidation**: any weight mutation must invalidate both `["weights"]` AND `["coach"]` — `/coach/status` recomputes trend weight live. Miss this and Dashboard tiles (Goal Progress, Expenditure) show stale data.

**Optional weight sync** (`routes/weights.ts`: `pushWeightSync`): when both `WEIGHT_SYNC_RELAY_URL` and `WEIGHT_SYNC_USER_NAME` are set, every POST/DELETE on `/api/weights` for that exact account name best-effort pushes the full history to the relay — never blocks the request and swallows failures. It is disabled by default so forks cannot send weights to an unrelated relay.

**Health Connect remains native-only.** The PWA cannot call Android's Jetpack Health Connect SDK directly. `POST /api/weights/import` is the authenticated batch-upsert bridge for a future native companion/TWA shell; it does not bypass normal session auth or grant browser-side Health Connect access.

**Dashboard tiles** (`lib/dashboardLayout.tsx`): `load()` trusts the stored array as-is — does NOT auto-append missing catalog tiles (an earlier version did, silently reversing every toggle-off on reload); a tile added to the catalog later won't appear until the "+ Add" sheet is opened. Also, a tile's headline must match its own subtitle's window — Energy Balance's said "Last 7 days" but its headline was just the latest single day, disagreeing with its own sparkline (`avgBalance7` fixed it by averaging the same window shown).

**Dashboard calorie arc swipe** (`DashboardTotalsArcCard.tsx`): both Total and Remaining pages stay mounted for native scroll-snap. The inactive page's large arc resets transitionlessly; crossing the swipe midpoint marks it active and reveals the arc on the next animation frame, replaying the empty-to-value fill without remounting either page. Keep reduced-motion support and don't animate the smaller macro bars on every page switch.

**DraggableSnapSheet snap** (`components/DraggableSnapSheet.tsx`): collapsed state uses real CSS `height` tracking the snap point, not `transform: translateY` — transform-only left the panel physically full-height, painting over controls below it. Transform is only live drag feedback, discarded on finger lift.

**Rubber-band overscroll** (`hooks/useRubberBandScroll.ts`): hot-path screens expose a content-only `data-rubber-band-surface` for compositor transforms; shared/fixed chrome must stay outside that surface or be portaled, since any transformed ancestor becomes its fixed containing block. Other routes fall back to `<body>` via `position: relative` + `top`—never transform body/root. Must `preventDefault()` on the *arming* move itself, or the pull never grows past zero; visual writes are separately rAF-coalesced. Arms against the nearest real scrollable ancestor of the touch, not always `window.scrollY`, or a screen with its own inner `overflow-y-auto` reads as permanently "at the boundary" and blocks its own scroll. Finger-up momentum uses a deliberately smaller velocity estimate because Chromium hides discarded overscroll after clamping; keep it bounded and cancel it on a new touch. Horizontal drag controls need `data-no-rubber-band` on a wrapper, or their vertical wobble arms a bounce mid-drag.

**Dashboard scroll restore** (`DashboardScreen.tsx`, `lib/dashboardScroll.ts`): capturing uses `useLayoutEffect`, not `useEffect`, to save scroll position before a lazy detail screen unmounts — its first-ever visit commits an empty subtree and clamps `scrollY` to 0, and only layout-phase cleanup runs early enough to avoid saving that clamped 0 over the real position. Restoring only fires for the Dashboard, and only when returned to from a screen one of its own tiles opened — a tab switch always resets to top (tracked via `BOTTOM_NAV_ROOTS` + `noteNavigation()`, not react-router's `useNavigationType()`, unreliable here).

**Never push a history entry while handling `popstate`** (`lib/useBackDismiss.ts`). Chrome's History Manipulation Intervention marks the entry a page navigates *away from* as skippable whenever the page pushes without user activation — and a back gesture, being browser chrome, grants none. This file used to re-push a replacement entry inside its own popstate handler so one trap could absorb press after press; that silently poisoned the entry underneath, so the next back press found nothing non-skippable and exited the app outright. Only back/forward **UI** sets the flag — programmatic `history.back()` doesn't, so no scripted reproduction can see this. Symptom: back exits the app one press early, only via the real gesture. Contract that fixed it: **one trap owns exactly one history entry, consumed by one back press.** A UI absorbing N presses declares `useBackDismissDepth(n, …)` and holds N entries; every dismiss must reduce depth by exactly one, or the next press desyncs and escapes. The one safe non-dismiss exception is AddFoodSheet's opt-in dirty blocker: it cancels traversal with `history.forward()` to the same pre-existing entry and renders a warning with no trap of its own—still no push from `popstate`. Nested traps generalize beyond sheets/modals: FoodDetailScreen's custom keypad (see its own entry below) stacks a second `useBackDismiss` on top of a component's own outer one for a plain in-page toggle state, not just a mounted/unmounted overlay.

**A hook declared after a conditional early return is a live crash, not a lint nit** (found 2026-08-03, `AddFoodSheet.tsx`). This component starts with `if (!open) return null`, and one `useEffect` (the recipe Edit/Explode/Duplicate resolver, keyed off `pendingRecipeDetail`) had drifted below that line. Every render while `open` is false skips it entirely; the moment `open` flips true on that same mounted instance, React sees a different hook count than the previous render and throws ("Rendered more hooks than during the previous render" — `Minified React error #310` in this production build). This app has **no error boundary anywhere**, so the throw unmounts the entire tree: a blank screen with no back button, no nav, nothing — the only recovery is reloading. Reproduced concretely via `RecipeForm`'s own nested `AddFoodSheet` instance (its "Add ingredient" button toggles a plain boolean `open`), in both the create-recipe and edit-recipe paths — anywhere that mounts `AddFoodSheet` once and toggles `open` on the same instance rather than mounting it fresh each time. Fix was purely mechanical (move the hook above the return), but the general lesson isn't: **grep every hook in a component against its own early returns whenever one is added or moved**, since TypeScript's build and this repo's own `tsc` gate catch zero classes of this bug — it only surfaces at runtime, and only on the specific prop transition that flips the return's condition.

**BottomNav** is hidden entirely on `/strategy/*` sub-routes — the wizard CTA button was unclickable because the nav's fixed "+" button intercepted taps.

**Bordered-wrapper inputs**: text inputs inside a div carrying the visible border need `focus-within:border-accent` on the wrapper, not `focus:border-accent` on the input, or keyboard users get no visible focus state.

**Macro colors** (`tailwind.config.js`): calories `#749EF4` / protein `#EF8D6A` / fat `#F7D372` / carbs `#5ABC80` — pixel-sampled from MacroFactor's palette at the user's request, deliberately not run through the dataviz skill's validator (single-person household). Don't reflexively "fix" this back to a validated palette — confirm first. Duplicated as raw hex literals in several chart/animation files — grep before changing again, since `expenditure`/`goal` reuse some pre-MacroFactor hex values coincidentally.

**Nutrient storage**: `microsJson` values are always grams per 100g (display conversion to mg/mcg happens in `FoodDetailScreen`'s meta tables — get this wrong and every vitamin/mineral figure is off by 1000×). Fat subtypes (`monounsaturatedFatPer100g`, `polyunsaturatedFatPer100g`, `omega3Per100g`, `omega6Per100g`, `transFatPer100g`) are real `foods` columns instead, not in `microsJson`.

**AFCD-seeded local food library**: `foods` has ~1,588 generic staples pre-loaded (`source: 'afcd'`) from the Australian Food Composition Database — real government data, not AI-estimated (idempotent import, `backend/src/scripts/import-afcd-foods.ts`). Search is two-stage: live input queries SQLite-only `GET /api/foods` immediately; the 350ms-debounced `GET /api/foods/remote` appends OFF rows later, always below/deduped against local results. Never make local rendering await OFF again. Also added sparse `aminoAcidsJson` (~12% have a real multi-acid panel) and `carbDetailJson`. **Gotcha**: an exact-name older food can block the better AFCD insert (happened with "Honey") — hide the old row (`hiddenAt`) and hand-insert AFCD, don't delete it.

**Local search relevance** (`routes/foods.ts` + `engine/foodSearch.ts`): literal name strength remains the primary sort key; each user's log frequency then recency breaks ties. Candidate matching also expands a deliberately small Australian/everyday alias list (capsicum/bell pepper, mince/ground beef, etc.) and searches brands. Keep aliases equivalent and explicit — broad semantic expansion makes results unpredictable. Completed debounced searches aggregate into per-user `food_search_stats`; a selection records the chosen real food and whether OFF supplied it, making the exact query a private learned alias on its next use without retaining keystrokes. Account-data reset must clear these stats too. Search starts at 2 characters; ranking reads the user's small log history once and filters in JS — never build `IN (...)` from every broad food candidate, which crashed better-sqlite3 on first-letter searches.

**Household food measures**: `foods.measuresJson` stores only verified `{name, grams}` pairs; `servingName`/`servingSizeGrams` remains the primary backwards-compatible serving and is merged into the same UI list. Never infer cup/slice/piece weights from food names — density and item size make guessed conversions silently corrupt logs. Custom foods may define multiple measures; label/OFF primary servings work without duplication. **One documented exception (2026-08-07)**: the six whole-egg AFCD entries (raw/poached/hard-boiled/fried/omega-3 raw/omega-3 boiled — not yolk-only, white-only, or the milk-mixed scrambled entry) got Medium/Large/XL/Jumbo measures via `backend/src/scripts/backfill-egg-measures.ts`, composed from AU carton grading minus a ~11% USDA shell-weight fraction (AFCD is per 100g edible portion). Egg size grading is a real regulated standard, not a name-based guess, which is why this gets an exception and a generic "add measures to X" request shouldn't.

**OFF search reliability** (`engine/openfoodfacts.ts`): Search-a-licious can translate an English category match into a foreign displayed product name (`honey` returned French `Miel...` even with `langs: ["en"]`), while legacy `/cgi/search.pl` has weak relevance. `searchOffProducts()` queries Australian-filtered current, global current, and legacy results in parallel; prefers `product_name_en`, requires literal query overlap in displayed name/brand, boosts exact/phrase/all-word, Australian, English, and popularity signals, then merges by barcode. Current search uses the documented POST API with English fields/phrase boosting. Each source gets ≥8 candidates, 2 attempts × 4s, and a 10-minute cache. No typo tolerance.

**FoodDetailScreen**: quantity entry is a custom keypad (`keypadOpen` state), not a real `<input>` — reverted once already when tried as a real input (back had nothing keyboard-shaped to close first, exiting the whole screen in one press) and reintroduced 2026-08-03 with a second, nested `useBackDismiss(keypadOpen, …)` trap stacked on the screen's own outer one, so back closes the keypad before a second press leaves the screen. **Gotcha**: this only works if the host contributes zero extra back-dismiss depth of its own for the "detail" step — `AddFoodSheet.tsx`'s `SHEET_SUB_STEP_BACK` deliberately omits it (every *other* step there owns no trap, so the sheet owns their depth instead). Getting this wrong doesn't error, it silently shadows: the host's trap lands on top of both of FoodDetailScreen's, so the first back press is swallowed and skips both. Breakdown rows are plain label + amount, never a percentage, with color-coded %DV bars for macros/vitamins/minerals only (no bar for Net Carbs, Other Fat subtypes, or Cholesterol); headings and those bars provide the grouping, so category/row divider rules are deliberately omitted. Editing a log hides the food-library Delete action because its footer already owns Delete for the log entry; showing both identical labels was ambiguous and risked deleting the wrong object. The food identity gets a consistent minimum-height slot; names may use two lines and an optional brand sits beneath, avoiding both a cramped short name and premature one-line truncation.

**Food icons**: the stored value remains an emoji string, but curated food emoji render through locally bundled Noto SVGs for identical cross-device artwork. Name-derived icons match only the leading identity before AFCD's first comma and use whole terms, preventing preparation text such as "boiled, no added salt" from becoming an oil/salt icon. Unknown names keep the letter avatar and arbitrary user-entered emoji keep native rendering; don't replace either fallback with a misleading guessed category.

Since it's not a real input, it also fakes what one gets for free: a `caret-blink` CSS class (index.css) for a blinking cursor after the last digit, and an `allSelected` state that re-arms on every keypad open (including initial mount) so the prefilled quantity shows highlighted and the first keystroke replaces it outright instead of appending — same as tapping into a real input's existing value. Consumed (set false) after one keystroke; backspace while selected clears the whole field rather than trimming one character.

The docked footer (quantity/keypad/Log Foods+Add) is a `shrink-0` flex sibling *after* the scrollable pane. While the keypad is open, ResizeObserver-measured space after the Impact rings keeps Protein Breakdown wholly below the footer instead of showing a clipped heading; when large enough, that space renders a subtle "View nutrition details" affordance which closes the keypad and reveals the breakdown rather than appearing as a dead void. It is skipped entirely for `hideTargetsUi` recipe-ingredient editing (which has no rings).

**`activeCheckinForDate()` tie-break**: same-day check-ins resolved by `createdAt` (latest wins). `latestPerDayCheckins()` collapses same-day duplicates for views that plot check-ins directly.

**Barcode camera controls on Android** (`BarcodeScanner.tsx`): tap-to-focus works on the Galaxy S24+'s regular rear lens, but the wide lens and manual `focusDistance` may accept constraints without visibly moving focus. Torch is capability-gated through ZXing's active scanner controls and resets whenever the lens changes. Keep the preview edge-to-edge and guidance beside the scan target rather than restoring header/footer slabs.

**`GET /api/logs/history`**: returns every day in the range including zero-calorie days (dense fill). Cap is 3650 days.

**Macros/Nutrient day-detail screens**: Today/Week/Month rows show the **average per day**, not a raw sum — matching every other multi-day stat in the app. "Nutrient Completeness" was deliberately left out — `*Per100g` columns are `NOT NULL` and OFF defaults a missing macro to `0`, so nothing distinguishes "really 0g" from "unknown." Don't approximate with `=== 0`.

**DB surgery**: the `.sqlite` file is root-owned from inside the container. Use `docker exec macrotrack node -e "..."` with `better-sqlite3`, not host-side `sqlite3`.

**`foods.hiddenAt`**: "deleting" a food never removes the row if a log still references it — nutrition is computed live from `foods`, never snapshotted, so hard-deleting would corrupt logs. `DELETE /api/foods/:id` sets `hiddenAt` on FK conflict instead: resolvable by id, but filtered out of every browse/pick surface (`isNull(foods.hiddenAt)`). `ai_estimate` foods from Describe are hidden from creation, not just on delete. Any new browse/search query over foods needs this same filter.

**AI providers, tasks, and keys** (`engine/aiProvider.ts`, `labelScan.ts`, `describeMeal.ts`): each account may save Anthropic, OpenAI, and/or Google Gemini keys from More → AI features, then independently select a provider and free-form model ID for label scans, meal descriptions, recipe imports, photo comparisons, and check-in summaries. Keys are files under `DATA_DIR/secrets/ai/<provider>`, never part of browser-readable settings or account exports; an account key overrides optional installation-wide `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GEMINI_API_KEY`. Legacy Anthropic keys under `DATA_DIR/secrets/anthropic` remain readable. Task assignments are non-secret `user_settings` data and do travel with account exports. Every AI engine resolves with the requesting `userId`.

**Reasoning models count thinking against the output ceiling** (found 2026-08-11): Gemini's `maxOutputTokens` and OpenAI's `max_output_tokens` cover the model's thinking *and* its reply, while Anthropic's `max_tokens` covers only the reply. Passing a caller's prose budget straight through starves the answer instead of capping it — `gemini-3.6-flash` spent 284 of a 300-token ceiling thinking and returned a 6-word fragment with `finishReason: MAX_TOKENS`, which the old code handed back as a *successful* narrative. Both non-Anthropic paths now add `REASONING_TOKEN_ALLOWANCE` (4000; measured ~3k thinking tokens for short prose) and Gemini throws on a MAX_TOKENS candidate rather than returning a truncated string. Gemini also streams its thinking back in the same `parts` array flagged `thought: true` — take the first *non-thought* text part, or the scratchpad becomes the answer. Only Gemini is verified (no OpenAI key on this install). Since the whole point of the fallback is "the primary silently ran dry", nothing surfaces which provider served a response — test a fallback by calling it directly, never by assuming the primary was used. Defaults preserve the original behavior: label scanning uses Claude Haiku 4.5 and the other tasks use Sonnet 5. Structured tasks use a hand-written JSON Schema through the shared adapter; meal description matches household foods when confident or persists a hidden `source: 'ai_estimate'` fallback.

**Progress photos**: six UI poses: front/side/back relaxed and front/side/back flexed. The original stored values (`'front' | 'side' | 'back'`) intentionally mean relaxed so existing photos need no migration; flexed values use an `_flexed` suffix. `photos.pose` remains nullable — null means an older/uncategorized shot, still shown in history but excluded from pose comparison. No separate "latest photo by pose" endpoint: derived client-side from the already-fetched full `usePhotos()` list.
New uploads keep a bounded 2560px working image for alignment, then render one fixed 1200×1600 lossless crop before the server's final metadata-stripping JPEG encode. Don't restore the old 0.4MB post-crop compression pass: it caused redundant JPEG loss and left comparison exports upscaling small crops.

## Frontend patterns

**Sheets**: all built on `BottomSheet.tsx` (backdrop + panel + swipe-to-dismiss) except `AddFoodSheet`, which uses `DraggableSnapSheet.tsx` (two snap points, no dismiss gesture). Build new sheets on `BottomSheet`, not from scratch.

Every terminal sheet dismissal must blur the focused native input synchronously before unmounting it. `BottomSheet.close()` does this centrally; AddFoodSheet's custom shell routes X/back/discard/success exits through its own `closeSheet()` equivalent, and its downward snap-to-Plate gesture blurs before changing `sheetExpanded`. Blurring in an unmount effect is too late on Android—the input is already gone and the regular keyboard can remain onscreen over the revealed page.

**AddFoodSheet dual-layer**: Layer 1 (background, full-screen) = Plate View. Layer 2 (foreground) = `DraggableSnapSheet` with Search/Scan/Quick Add/Describe/Library tabs. The `ActionBar` is a plain flex sibling of both layers — not independently `fixed`/`absolute`, which caused a z-index stacking fight that made controls unclickable. It shows Search + Log Foods on Search, and pins Describe's Add to Plate beside Log Foods so the item-level action cannot scroll behind the plate-level action when the keyboard opens. Staging does NOT survive closing the sheet.

**FoodRow tap behavior**: tap the row body = open Food Detail screen; tap the "+" button = quick-add with default quantity. Both entry points in Search and Library use this hybrid.

**QuickActionFlow** (`components/QuickActionFlow.tsx`): single shared state machine for both the FAB and Dashboard shortcuts — don't duplicate it for new quick actions. Dates against `lib/viewedDate.tsx`'s `useEffectiveLogDate()`, not `localDateString()` directly, so a quick action fired from either surface lands on the same day `TodayScreen`'s own ‹/› date nav is currently viewing, not always real today.

**Global food logging destination**: a successful Add Food or Quick Add mutation launched through `QuickActionFlow` always navigates to `/log`; direct logging already opened from `TodayScreen` simply closes in place. Navigate only from the mutation's success callback and call `armTrapHandoff()` first, or the outgoing sheet trap's cleanup can `history.back()` over the new route. Recipe ingredient picking is not logging and must not navigate.
The Recipes shortcut directly hands the quick-actions menu's history trap to `AddFoodSheet` and opens Library → Recipes; don't reintroduce a separate recipe-list sheet or wait for the menu's dismiss animation first, since that creates a conspicuous down-then-up delay.

**FAB Photos navigation** (`components/QuickActionsSheet.tsx`): preload the lazy Photos chunk when the quick-actions menu mounts, then route immediately underneath the still-visible sheet and dismiss through its normal animation. This overlaps page loading with the slide-down instead of exposing Suspense's null fallback or adding a dead delay. Call `armTrapHandoff()` before navigating; without it, the outgoing sheet trap's cleanup calls `history.back()` when the animation finishes and cancels the route change.

**FAB overlay handoff** (`components/QuickActionsSheet.tsx`): every non-route action swaps the menu directly for `QuickActionFlow` in one commit instead of waiting for the menu's 320ms close animation. Call `armTrapHandoff()` immediately before setting the action so the outgoing and incoming overlays share one history entry; delaying the handoff or mounting both traps together desynchronizes back dismissal.

**Fixed-position chrome shown by more than one screen must be mounted once, not per-screen.** `ShortcutsBar` used to be rendered separately by `DashboardScreen` and `TodayScreen` — a route switch between them fully unmounted and remounted it, reading as the colored icons "flashing" on tab change (root-caused 2026-08-03 via a device trace: `visible` itself never changed, it was a real DOM teardown/rebuild, not a CSS/animation bug). Fixed like `BottomNav`: rendered once in `App.tsx`, gated on `location.pathname`. A screen needing it hidden locally (`TodayScreen`'s multi-select mode) goes through `useHideShortcutsBar` (`lib/navVisibility.tsx`, same counter-based pattern as `useHideBottomNav`). The docked bar and nav are one unbroken surface: positioning uses the nav's fractional `getBoundingClientRect().height` (integer `offsetHeight` left a device-pixel seam), and the nav's top border matches its background on routes with a docked bar.

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
