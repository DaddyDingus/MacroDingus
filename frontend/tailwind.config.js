/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#14161A",
        surface: "#1E2126",
        "surface-raised": "#262A31",
        ink: "#ECEDEE",
        muted: "#8A8F98",
        line: "#33373E",
        accent: "#6BE4C0",
        // Second palette pass, re-validated via the dataviz skill's
        // validator (node scripts/validate_palette.js) against this
        // requested mapping: calories=blue, protein=orange, fat=yellow,
        // carbs=green. All four re-checked together (adjacent AND all-pairs,
        // dark mode, our own #1E2126 card surface): CVD separation worst
        // case ΔE 9.4 (≥8 target), normal-vision floor worst case ΔE 17.5+
        // (≥15 floor) — both clear. The one check that does NOT clear is the
        // categorical lightness band (fat's yellow sits at L 0.80, above the
        // 0.48–0.67 band): that's a deliberate, documented exception, not an
        // oversight. The skill's own palette.md explicitly warns this exact
        // orange+yellow pairing fails all-pairs at any lightness *within*
        // that band (verified: every in-band yellow tried came back
        // ΔE 2–5 vs this orange, a hard CVD fail) — the only way to
        // genuinely separate them is a brighter/paler yellow, which is what
        // "fat" is here. Every place these four render, a text label
        // ("Protein"/"Fat"/etc.) sits right next to the swatch, so color is
        // reinforcing, not the sole identity channel — same mitigation the
        // skill applies to its own light-mode WARN slots.
        calories: "#3987E5",
        protein: "#D95926",
        carbs: "#059669",
        fat: "#F0B400",
        // Single-series chart accents, each used in views that never show
        // more than one of these at once, so they're not part of the
        // above all-pairs validation — reused/duplicated hexes where two
        // concepts are related and simply never appear side by side.
        weight: "#9085E9",
        expenditure: "#D95926",
        goal: "#059669",
        // Dashboard-scoped dark palette (dark-grey page + iOS-style card
        // grey) — intentionally separate from base/surface above, which the
        // rest of the app still uses. Requested specifically for the
        // Dashboard screen, not a global reskin, so it's kept as its own
        // named pair rather than changed in place. Re-ran the categorical
        // validator against this card's #1C1C1E surface (previously checked
        // only against #1E2126): same result — CVD separation, normal-vision
        // floor, and contrast all still clear; fat's lightness-band exception
        // above is unaffected by surface color and still applies.
        // dashboardBg: true black (#000000) → darker-than-base #0F1114 →
        // lightened to #17191D → back to true OLED black, landing here.
        // Shared by the Dashboard screen and BottomNav (global chrome, same
        // token), so both move together — deliberately identical so the two
        // blend into one seamless black rather than reading as two surfaces.
        dashboardBg: "#000000",
        dashboardCard: "#1C1C1E",
        dashboardDivider: "#2C2C2E",
        // Same hex as dashboardDivider, kept as its own name since it's used
        // as a filled button background (shortcut chips), not a hairline —
        // same "intentional duplicate for a distinct role" pattern as
        // weight/expenditure/goal above.
        dashboardChip: "#2C2C2E",
        // Also the same hex, for the "empty" side of a meter (gauge ring
        // track, progress-bar tracks, unfilled habit-grid cells) sitting on
        // dashboardCard — the app's regular `surface-raised` was tuned
        // against `surface` (#1E2126), a lighter surface than dashboardCard
        // (#1C1C1E), so on this card it read as barely-there.
        dashboardTrack: "#2C2C2E",
      },
      fontFamily: {
        sans: ["IBM Plex Sans", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
