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
        protein: "#E8A672",
        carbs: "#7CB8E8",
        fat: "#C99BE8",
        fiber: "#8FD6A6",
      },
      fontFamily: {
        sans: ["IBM Plex Sans", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
