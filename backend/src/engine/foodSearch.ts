// Australian-first synonyms and everyday shorthand. Expansion is kept
// intentionally small and explicit: broad semantic expansion makes search
// feel unpredictable, while these pairs describe the same ingredient.
const ALIAS_GROUPS = [
  ["capsicum", "bell pepper"],
  ["mince", "ground meat", "ground beef"],
  ["beef mince", "ground beef"],
  ["coriander", "cilantro"],
  ["zucchini", "courgette"],
  ["eggplant", "aubergine"],
  ["spring onion", "green onion", "scallion"],
  ["rocket", "arugula"],
  ["prawn", "shrimp"],
  ["chickpea", "garbanzo"],
  ["beetroot", "beet"],
  ["icing sugar", "powdered sugar", "confectioners sugar"],
  ["caster sugar", "superfine sugar"],
  ["bicarb soda", "baking soda", "sodium bicarbonate"],
  ["cornflour", "cornstarch"],
  ["full cream milk", "whole milk"],
  ["skim milk", "skimmed milk", "nonfat milk"],
  ["plain flour", "all purpose flour"],
] as const;

export function normalizeFoodQuery(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function expandFoodQuery(value: string): string[] {
  const normalized = normalizeFoodQuery(value);
  const expanded = new Set([normalized]);
  for (const group of ALIAS_GROUPS) {
    for (const alias of group) {
      if (normalized === alias || normalized.includes(` ${alias} `) || normalized.startsWith(`${alias} `) || normalized.endsWith(` ${alias}`)) {
        for (const replacement of group) expanded.add(normalized.replace(alias, replacement));
      }
    }
  }
  return [...expanded].filter(Boolean);
}

function textTier(text: string, query: string): number {
  if (text === query) return 4;
  if (text.startsWith(query)) return 3;
  if (new RegExp(`\\b${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) return 2;
  if (text.includes(query)) return 1;
  return 0;
}

export function foodTextRelevance(name: string, brand: string | null, query: string): number {
  const direct = normalizeFoodQuery(query);
  const nameText = normalizeFoodQuery(name);
  const brandText = normalizeFoodQuery(brand ?? "");
  let best = textTier(nameText, direct) * 10 + (brandText.includes(direct) ? 1 : 0);
  for (const alias of expandFoodQuery(direct).slice(1)) {
    // Alias matches sit just below an equally-shaped literal match.
    best = Math.max(best, textTier(nameText, alias) * 10 - 1);
  }
  return best;
}
