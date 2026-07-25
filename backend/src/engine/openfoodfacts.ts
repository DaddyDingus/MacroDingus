// OpenFoodFacts reports salt, not sodium, on a lot of products — sodium (mg) is
// derived from salt (g) via the standard sodium = salt / 2.5 approximation when
// the more direct sodium_100g field isn't present.
const MICRO_KEYS = [
  "vitamin-a_100g",
  "vitamin-c_100g",
  "vitamin-d_100g",
  "vitamin-e_100g",
  "vitamin-b12_100g",
  "calcium_100g",
  "iron_100g",
  "potassium_100g",
  "magnesium_100g",
  "zinc_100g",
  "cholesterol_100g",
] as const;

interface OffProduct {
  product_name?: string;
  brands?: string;
  serving_quantity?: number;
  serving_size?: string;
  nutriments?: Record<string, number>;
}

export interface MappedFood {
  name: string;
  brand?: string;
  barcode: string;
  source: "openfoodfacts";
  servingSizeGrams?: number;
  servingName?: string;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  fiberPer100g?: number;
  sugarPer100g?: number;
  saturatedFatPer100g?: number;
  sodiumMgPer100g?: number;
  microsJson?: string;
}

export function mapOffProduct(barcode: string, product: OffProduct): MappedFood {
  const n = product.nutriments ?? {};

  const sodiumMgPer100g =
    n["sodium_100g"] != null
      ? n["sodium_100g"] * 1000
      : n["salt_100g"] != null
        ? (n["salt_100g"] / 2.5) * 1000
        : undefined;

  const micros: Record<string, number> = {};
  for (const key of MICRO_KEYS) {
    if (n[key] != null) micros[key] = n[key];
  }

  return {
    name: product.product_name?.trim() || "Unknown product",
    brand: product.brands?.split(",")[0]?.trim() || undefined,
    barcode,
    source: "openfoodfacts",
    servingSizeGrams: product.serving_quantity ?? undefined,
    servingName: product.serving_size ?? undefined,
    caloriesPer100g: n["energy-kcal_100g"] ?? 0,
    proteinPer100g: n["proteins_100g"] ?? 0,
    carbsPer100g: n["carbohydrates_100g"] ?? 0,
    fatPer100g: n["fat_100g"] ?? 0,
    fiberPer100g: n["fiber_100g"],
    sugarPer100g: n["sugars_100g"],
    saturatedFatPer100g: n["saturated-fat_100g"],
    sodiumMgPer100g,
    microsJson: Object.keys(micros).length > 0 ? JSON.stringify(micros) : undefined,
  };
}

export async function fetchOffProduct(barcode: string): Promise<OffProduct | null> {
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`, {
    headers: { "User-Agent": "macrotrack/1.0 - self-hosted personal nutrition tracker" },
  });
  if (!res.ok) throw new Error(`OpenFoodFacts request failed: ${res.status}`);
  const data = (await res.json()) as { status: number; product?: OffProduct };
  if (data.status !== 1 || !data.product) return null;
  return data.product;
}
