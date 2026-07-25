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
        // Validated via the dataviz skill's palette validator (node
        // scripts/validate_palette.js) — the original amber/blue/violet trio
        // failed hard: fat and carbs were ΔE 0.5 apart for deuteranopia and
        // ΔE 11.9 for normal vision (below the 15 floor), i.e. genuinely
        // indistinguishable for a lot of readers, not just a nitpick. This
        // orange/blue/aqua triad is the skill's own documented all-pairs-safe
        // set. No separate "fiber" color — it was never actually rendered as
        // a colored marker, only ever plain text, so it didn't need one.
        protein: "#D95926",
        carbs: "#3987E5",
        fat: "#199E70",
      },
      fontFamily: {
        sans: ["IBM Plex Sans", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
