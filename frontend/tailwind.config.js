/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Theme-switchable neutrals — one shared design language (page bg <
        // card < raised card < divider, each a step lighter), sourced from
        // CSS variables (see index.css) so the "black" vs "graphite" theme
        // picker in More can swap every one of these at once, everywhere,
        // without a rebuild. `canvas`/`surface`/`surface-raised`/`line` and
        // `dashboardBg`/`dashboardCard`/`dashboardDivider`/`dashboardChip`/
        // `dashboardTrack` are deliberately aliases of the very same
        // variables, not two systems — they grew apart historically (the
        // Dashboard/Food Log rebuild introduced the `dashboard*` names before
        // the rest of the app caught up), and unifying them here is what
        // makes every screen consistent again without renaming classes
        // across two dozen files.
        //
        // Named `canvas`, not `base` — `base` collides with Tailwind's own
        // built-in `text-base` *font-size* utility (1rem). A custom color
        // named `base` makes Tailwind also generate a `text-base` *color*
        // utility of the same class name; both rules apply since they don't
        // share properties, so any element using the ordinary font-size
        // `text-base` silently also got its text color set to the page
        // background — invisible text, zero contrast, not a layout/clipping
        // bug. This was the actual cause of WizardShell's blank title (and
        // any other `text-base` element), misdiagnosed for a while as a
        // flexbox/browser-engine rendering quirk before being caught via
        // getComputedStyle. Don't reuse any Tailwind font-size scale name
        // (`xs`/`sm`/`base`/`lg`/`xl`/`2xl`.../`8xl`) for a custom color.
        canvas: "rgb(var(--color-bg) / <alpha-value>)",
        surface: "rgb(var(--color-card) / <alpha-value>)",
        "surface-raised": "rgb(var(--color-card-raised) / <alpha-value>)",
        ink: "#ECEDEE",
        muted: "#8A8F98",
        line: "rgb(var(--color-divider) / <alpha-value>)",
        // Light orchid purple — chosen (not just picked) via the dataviz
        // skill's validator against the existing weight color (#9085E9,
        // below): both are shown side-by-side as selectable options in the
        // dashboard shortcut-chip color picker, so they need to actually
        // read as different colors there, not just in a chart-series sense.
        // #D896FF clears that (ΔE well above the 15 normal-vision floor);
        // several closer/more saturated purples tried first didn't (e.g.
        // #C084FC came back ΔE 8.0 vs weight, "hard to tell apart even with
        // full color vision"). Like the old mint accent it replaces, this
        // sits above the categorical lightness band (L 0.78) — that's the
        // same accepted exception fat's yellow already has, not a new one:
        // accent is a UI brand/action color, not a chart-series entry in
        // the calories/protein/carbs/fat set validated together below.
        accent: "#D896FF",
        // Third palette pass — pixel-sampled straight from MacroFactor's own
        // dark-mode palette (calories=periwinkle blue, protein=coral,
        // fat=gold, carbs=sage) at the user's explicit request, deliberately
        // NOT run through the dataviz skill's validator this time. That
        // validator's colorblind-separation and chroma-floor checks (carbs'
        // sage came back reading as gray, and only ~5.5 ΔE from protein's
        // coral under deuteranopia — both real fails) are the right default
        // for a palette serving unknown users, but this is a single-person
        // household app for someone with normal color vision — there's no
        // colorblind user those checks are protecting here, so distorting
        // MacroFactor's actual colors to satisfy them would be solving a
        // problem this deployment doesn't have. Contrast against the dark
        // surface still comfortably clears 3:1 for all four; only the
        // colorblind-specific checks were skipped.
        calories: "#749EF4",
        protein: "#EF8D6A",
        carbs: "#5ABC80",
        fat: "#F7D372",
        // Single-series chart accents, each used in views that never show
        // more than one of these at once, so they're not part of the
        // above all-pairs validation — reused/duplicated hexes where two
        // concepts are related and simply never appear side by side.
        weight: "#9085E9",
        expenditure: "#D95926",
        goal: "#059669",
        // `dashboard*` names predate the app-wide theme unification above —
        // they were introduced for the Dashboard/Food Log rebuild before the
        // rest of the app had caught up to that visual language. Now that
        // `base`/`surface`/`surface-raised`/`line` point at the very same
        // variables, these are plain aliases (same values, different names
        // used at different call sites) rather than a second palette. Both
        // graphite and black pass the categorical-color validator against
        // `--color-card` (see index.css) — checked for both themes, not just
        // black; fat's lightness-band exception noted above is unaffected by
        // surface color and still applies either way.
        dashboardBg: "rgb(var(--color-bg) / <alpha-value>)",
        dashboardCard: "rgb(var(--color-card) / <alpha-value>)",
        dashboardDivider: "rgb(var(--color-divider) / <alpha-value>)",
        // Same value as dashboardDivider, kept as its own name since it's
        // used as a filled button background (shortcut chips), not a
        // hairline — same "intentional duplicate for a distinct role"
        // pattern as weight/expenditure/goal above.
        dashboardChip: "rgb(var(--color-divider) / <alpha-value>)",
        // Also the same value, for the "empty" side of a meter (gauge ring
        // track, progress-bar tracks, unfilled habit-grid cells) sitting on
        // dashboardCard.
        dashboardTrack: "rgb(var(--color-divider) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["IBM Plex Sans", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
