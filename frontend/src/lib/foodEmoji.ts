// Best-effort keyword match against common food categories for the Food Log
// card icon slot — not exhaustive by design. Anything that doesn't match
// falls back to a letter avatar (see getFoodIcon below) rather than a
// generic plate, so the fallback still carries per-food identity.
const FOOD_EMOJI_MAP: Array<{ keywords: string[]; emoji: string }> = [
  { keywords: ["beef", "steak", "burger"], emoji: "🥩" },
  { keywords: ["chicken", "turkey", "poultry", "drumstick"], emoji: "🍗" },
  { keywords: ["pork", "bacon", "ham", "sausage"], emoji: "🥓" },
  { keywords: ["fish", "salmon", "tuna", "cod", "shrimp", "prawn", "seafood"], emoji: "🐟" },
  { keywords: ["egg"], emoji: "🥚" },
  { keywords: ["yogurt", "yoghurt"], emoji: "🥣" },
  { keywords: ["milk"], emoji: "🥛" },
  { keywords: ["cheese"], emoji: "🧀" },
  { keywords: ["bread", "toast", "bagel", "bun", "sandwich"], emoji: "🍞" },
  { keywords: ["rice"], emoji: "🍚" },
  { keywords: ["pasta", "noodle", "spaghetti"], emoji: "🍝" },
  { keywords: ["oat", "cereal", "granola", "muesli"], emoji: "🥣" },
  { keywords: ["broccoli", "spinach", "kale", "lettuce", "vegetable", "salad", "greens"], emoji: "🥦" },
  { keywords: ["carrot"], emoji: "🥕" },
  { keywords: ["potato", "fries"], emoji: "🥔" },
  { keywords: ["apple"], emoji: "🍎" },
  { keywords: ["banana"], emoji: "🍌" },
  { keywords: ["berry", "berries", "strawberry", "blueberry", "raspberry"], emoji: "🍓" },
  { keywords: ["orange", "citrus"], emoji: "🍊" },
  { keywords: ["avocado"], emoji: "🥑" },
  { keywords: ["nut", "almond", "peanut", "cashew", "walnut"], emoji: "🥜" },
  { keywords: ["bean", "lentil", "chickpea", "legume"], emoji: "🫘" },
  { keywords: ["pizza"], emoji: "🍕" },
  { keywords: ["soup", "broth", "stew"], emoji: "🍲" },
  { keywords: ["coffee"], emoji: "☕" },
  { keywords: ["tea"], emoji: "🍵" },
  { keywords: ["water"], emoji: "💧" },
  { keywords: ["chocolate", "candy", "sweet", "dessert", "cake", "cookie"], emoji: "🍫" },
  { keywords: ["shake", "smoothie"], emoji: "🥤" },
];

// The full curated set offered by IconPickerModal's grid — a superset of
// FOOD_EMOJI_MAP's own values (keyword-matched emoji should also be pickable
// by hand) plus a handful of generic ones (plate, shaker, supplement pill…)
// that no keyword maps to but are common enough to want on custom entries.
export const CURATED_FOOD_ICONS: string[] = [
  "🍗", "🥩", "🥓", "🐟", "🍤", "🥚", "🧀", "🥛", "🥣",
  "🍞", "🥐", "🥯", "🍚", "🍝", "🌮", "🍕", "🍲", "🥗",
  "🥦", "🥕", "🥔", "🍅", "🧅", "🧄", "🍄", "🫘", "🥑",
  "🍎", "🍌", "🍊", "🍓", "🍇", "🍉", "🍑", "🥝", "🍍",
  "🥜", "🍫", "🍪", "🍩", "🍰", "🍮", "🍯", "🧁",
  "☕", "🍵", "🥤", "🧃", "🍷", "🍺", "💧", "🧊",
  "🍽️", "🥘", "🧂", "💊",
];

export type FoodIcon = { kind: "emoji"; value: string } | { kind: "letter"; value: string };

// `icon` is a user-picked override (foods.icon — see schema.ts) that always
// wins when present; only falls through to the keyword guess below when a
// food has never had one explicitly chosen (custom foods created before this
// existed, and every OpenFoodFacts import, which never sets it).
export function getFoodIcon(name: string, icon?: string | null): FoodIcon {
  if (icon) return { kind: "emoji", value: icon };
  const lower = name.toLowerCase();
  for (const { keywords, emoji } of FOOD_EMOJI_MAP) {
    if (keywords.some((k) => lower.includes(k))) return { kind: "emoji", value: emoji };
  }
  // The first *letter*, not just the first character — food names can start
  // with punctuation (bracketed tags, leading digits/symbols in some
  // OpenFoodFacts imports) that isn't a useful avatar glyph.
  const firstLetter = name.match(/[A-Za-z]/)?.[0]?.toUpperCase();
  return { kind: "letter", value: firstLetter ?? "?" };
}
