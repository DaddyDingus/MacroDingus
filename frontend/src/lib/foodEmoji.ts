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

export type FoodIcon = { kind: "emoji"; value: string } | { kind: "letter"; value: string };

// Emoji match first; when nothing in FOOD_EMOJI_MAP fits (e.g. "Protein
// Powder"), fall back to the food's first letter as an avatar rather than a
// generic plate emoji that carries no information about the food at all.
export function getFoodIcon(name: string): FoodIcon {
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
