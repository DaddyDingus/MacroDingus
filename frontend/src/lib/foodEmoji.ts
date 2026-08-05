// Best-effort keyword match against common food categories for the Food Log
// card icon slot — not exhaustive by design. Anything that doesn't match
// falls back to a letter avatar (see getFoodIcon below) rather than a
// generic plate, so the fallback still carries per-food identity.
const FOOD_EMOJI_MAP: Array<{ keywords: string[]; emoji: string }> = [
  // Prepared dishes come before their ingredient words (a chicken burger
  // should look like a burger, not a drumstick).
  { keywords: ["hamburger", "burger"], emoji: "🍔" },
  { keywords: ["sandwich"], emoji: "🥪" },
  { keywords: ["wrap", "burrito"], emoji: "🌯" },
  { keywords: ["taco"], emoji: "🌮" },
  { keywords: ["pizza"], emoji: "🍕" },
  { keywords: ["sushi"], emoji: "🍣" },
  { keywords: ["dumpling", "gyoza", "wonton"], emoji: "🥟" },
  { keywords: ["curry"], emoji: "🍛" },
  { keywords: ["soup", "broth", "stock", "stew"], emoji: "🍲" },
  { keywords: ["salad"], emoji: "🥗" },
  { keywords: ["pancake", "pikelet"], emoji: "🥞" },
  { keywords: ["waffle"], emoji: "🧇" },
  { keywords: ["pie", "tart"], emoji: "🥧" },

  { keywords: ["beef", "steak", "veal", "lamb", "mutton", "venison", "kangaroo", "mince", "goat", "buffalo", "camel", "crocodile", "emu"], emoji: "🥩" },
  { keywords: ["chicken", "turkey", "duck", "poultry", "drumstick"], emoji: "🍗" },
  { keywords: ["pork", "bacon", "ham", "sausage", "salami"], emoji: "🥓" },
  { keywords: ["prawn", "shrimp", "crab", "lobster", "crayfish", "shellfish", "abalone", "oyster"], emoji: "🍤" },
  { keywords: ["fish", "salmon", "tuna", "cod", "trout", "sardine", "anchovy", "seafood", "shark", "barramundi", "bassa", "basa", "blue grenadier", "hoki", "bream", "flathead", "gemfish", "kingfish", "mackerel", "milkfish", "morwong", "mullet", "mulloway", "perch", "snapper"], emoji: "🐟" },
  { keywords: ["egg"], emoji: "🥚" },
  { keywords: ["tofu", "tempeh", "meat alternative", "lupin"], emoji: "🫘" },

  { keywords: ["peanut butter", "almond butter", "nut butter"], emoji: "🥜" },
  { keywords: ["ice cream", "gelato", "ice confection"], emoji: "🍨" },
  { keywords: ["yogurt", "yoghurt"], emoji: "🥣" },
  { keywords: ["butter", "margarine"], emoji: "🧈" },
  { keywords: ["milk", "cream", "soy beverage", "oat beverage", "almond beverage"], emoji: "🥛" },
  { keywords: ["cheese"], emoji: "🧀" },

  { keywords: ["croissant", "pastry", "scone"], emoji: "🥐" },
  { keywords: ["bagel"], emoji: "🥯" },
  { keywords: ["bread", "toast", "bun", "roll"], emoji: "🍞" },
  { keywords: ["rice"], emoji: "🍚" },
  { keywords: ["pasta", "noodle", "spaghetti", "lasagne", "lasagna", "macaroni"], emoji: "🍝" },
  { keywords: ["oat", "cereal", "granola", "muesli", "porridge"], emoji: "🥣" },
  { keywords: ["flour", "wheat", "barley", "rye", "grain", "quinoa"], emoji: "🌾" },

  { keywords: ["broccoli", "cauliflower"], emoji: "🥦" },
  { keywords: ["pumpkin", "squash"], emoji: "🎃" },
  { keywords: ["spinach", "kale", "lettuce", "cabbage", "bok choy", "silverbeet", "leafy", "greens"], emoji: "🥬" },
  { keywords: ["carrot"], emoji: "🥕" },
  { keywords: ["sweet potato", "kumara"], emoji: "🍠" },
  { keywords: ["potato", "potatoes", "fries"], emoji: "🥔" },
  { keywords: ["tomato", "tomatoes"], emoji: "🍅" },
  { keywords: ["onion", "shallot"], emoji: "🧅" },
  { keywords: ["garlic"], emoji: "🧄" },
  { keywords: ["mushroom"], emoji: "🍄" },
  { keywords: ["corn", "maize"], emoji: "🌽" },
  { keywords: ["capsicum", "bell pepper"], emoji: "🫑" },
  { keywords: ["chilli", "chili pepper"], emoji: "🌶️" },
  { keywords: ["cucumber", "zucchini", "courgette"], emoji: "🥒" },
  { keywords: ["pea"], emoji: "🫛" },
  { keywords: ["eggplant", "aubergine"], emoji: "🍆" },
  { keywords: ["vegetable", "cassava", "artichoke", "asparagus", "beetroot", "ginger"], emoji: "🥦" },

  { keywords: ["apple"], emoji: "🍎" },
  { keywords: ["banana"], emoji: "🍌" },
  { keywords: ["berry", "berries", "strawberry", "blueberry", "raspberry"], emoji: "🍓" },
  { keywords: ["orange", "mandarin", "tangerine"], emoji: "🍊" },
  { keywords: ["lemon", "lime", "citrus"], emoji: "🍋" },
  { keywords: ["grape"], emoji: "🍇" },
  { keywords: ["watermelon", "melon"], emoji: "🍉" },
  { keywords: ["peach", "nectarine", "apricot"], emoji: "🍑" },
  { keywords: ["plum"], emoji: "🍑" },
  { keywords: ["pear"], emoji: "🍐" },
  { keywords: ["cherry", "cherries"], emoji: "🍒" },
  { keywords: ["mango", "mangoes"], emoji: "🥭" },
  { keywords: ["kiwi", "passionfruit"], emoji: "🥝" },
  { keywords: ["pineapple"], emoji: "🍍" },
  { keywords: ["coconut"], emoji: "🥥" },
  { keywords: ["avocado"], emoji: "🥑" },
  { keywords: ["nut", "almond", "peanut", "cashew", "walnut", "hazelnut", "macadamia", "pistachio", "seed"], emoji: "🥜" },
  { keywords: ["bean", "soybean", "lentil", "chickpea", "legume"], emoji: "🫘" },

  { keywords: ["coffee"], emoji: "☕" },
  { keywords: ["tea"], emoji: "🍵" },
  { keywords: ["juice", "cordial", "fruit drink"], emoji: "🧃" },
  { keywords: ["soft drink", "soda", "cola", "shake", "milkshake", "smoothie", "beverage", "beverage base"], emoji: "🥤" },
  { keywords: ["beer", "ale", "lager"], emoji: "🍺" },
  { keywords: ["wine"], emoji: "🍷" },
  { keywords: ["water"], emoji: "💧" },

  { keywords: ["chocolate", "cocoa", "bar"], emoji: "🍫" },
  { keywords: ["cookie", "biscuit"], emoji: "🍪" },
  { keywords: ["cake"], emoji: "🍰" },
  { keywords: ["muffin"], emoji: "🧁" },
  { keywords: ["doughnut", "donut"], emoji: "🍩" },
  { keywords: ["custard", "pudding"], emoji: "🍮" },
  { keywords: ["honey"], emoji: "🍯" },
  { keywords: ["candy", "lolly", "confectionery", "sweet"], emoji: "🍬" },
  { keywords: ["baking soda", "bicarbonate"], emoji: "🧂" },
  { keywords: ["sugar"], emoji: "🧂" },
  { keywords: ["salt", "sodium"], emoji: "🧂" },
  { keywords: ["oil", "vinegar", "dressing"], emoji: "🫗" },
  { keywords: ["sauce", "spread", "jam", "condiment", "paste", "syrup"], emoji: "🫙" },
  { keywords: ["supplement", "vitamin", "protein powder"], emoji: "💊" },
];

// The full curated set offered by IconPickerModal's grid — a superset of
// FOOD_EMOJI_MAP's own values (keyword-matched emoji should also be pickable
// by hand) plus a handful of generic ones (plate, shaker, supplement pill…)
// that no keyword maps to but are common enough to want on custom entries.
export const CURATED_FOOD_ICONS: string[] = [
  "🍗", "🥩", "🥓", "🐟", "🍤", "🥚", "🧀", "🥛", "🧈", "🥣",
  "🍞", "🥐", "🥯", "🍚", "🍝", "🌾", "🍔", "🥪", "🌯", "🌮",
  "🍕", "🍣", "🥟", "🍛", "🍲", "🥘", "🥗", "🥞", "🧇", "🥧",
  "🥦", "🥬", "🥕", "🥔", "🍠", "🍅", "🧅", "🧄", "🍄", "🌽",
  "🫑", "🌶️", "🥒", "🫛", "🍆", "🫘", "🥑", "🥜",
  "🍎", "🍌", "🍊", "🍋", "🍓", "🍇", "🍉", "🍑", "🍐", "🍒",
  "🥭", "🥝", "🍍", "🥥",
  "🍫", "🍪", "🍩", "🍰", "🍮", "🍯", "🍬", "🧁", "🍨",
  "☕", "🍵", "🥤", "🧃", "🍷", "🍺", "💧", "🧊", "🫗", "🫙",
  "🍽️", "🧂", "💊", "🎃", "🍼",
];

const CURATED_FOOD_ICON_SET = new Set(CURATED_FOOD_ICONS);

export function hasBundledFoodEmoji(value: string): boolean {
  return CURATED_FOOD_ICON_SET.has(value);
}

export function foodEmojiAssetPath(value: string): string {
  const codepoints = Array.from(value)
    .map((character) => character.codePointAt(0)!)
    .filter((codepoint) => codepoint !== 0xfe0e && codepoint !== 0xfe0f)
    .map((codepoint) => codepoint.toString(16));
  return `/food-icons/noto/${codepoints.join("-")}.svg`;
}

export type FoodIcon = { kind: "emoji"; value: string } | { kind: "letter"; value: string };

// `icon` is a user-picked override (foods.icon — see schema.ts) that always
// wins when present; only falls through to the keyword guess below when a
// food has never had one explicitly chosen (custom foods created before this
// existed, and every OpenFoodFacts import, which never sets it).
export function getFoodIcon(name: string, icon?: string | null): FoodIcon {
  if (icon) return { kind: "emoji", value: icon };
  const lower = name.toLowerCase();
  // AFCD names put the food's identity first and preparation/ingredient
  // qualifiers after commas. Matching only that leading identity avoids
  // making "cornmeal, boiled, no added salt" a salt shaker or a plain beef
  // lasagne a steak merely because those words appear later in its details.
  const primaryName = lower.split(",", 1)[0];
  for (const { keywords, emoji } of FOOD_EMOJI_MAP) {
    // Match complete food terms, with an optional regular plural, instead of
    // arbitrary substrings: "boiled" must not become oil, "peanut" must not
    // become pea, and "eggplant" must not become egg. Phrases still match
    // naturally across spaces or punctuation in AFCD/OFF display names.
    if (keywords.some((keyword) => {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(^|[^a-z0-9])${escaped}s?(?=$|[^a-z0-9])`, "i").test(primaryName);
    })) return { kind: "emoji", value: emoji };
  }
  // The first *letter*, not just the first character — food names can start
  // with punctuation (bracketed tags, leading digits/symbols in some
  // OpenFoodFacts imports) that isn't a useful avatar glyph.
  const firstLetter = name.match(/[A-Za-z]/)?.[0]?.toUpperCase();
  return { kind: "letter", value: firstLetter ?? "?" };
}
