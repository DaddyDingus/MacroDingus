// OpenFoodFacts reports salt, not sodium, on a lot of products — sodium (mg) is
// derived from salt (g) via the standard sodium = salt / 2.5 approximation when
// the more direct sodium_100g field isn't present.
//
// Comprehensive vitamin/mineral set (cholesterol included — see
// schema.ts's comment on why it stays in this opaque blob rather than
// getting its own column, unlike the fat subtypes below). "vitamin-pp" is
// OFF's own field name for niacin/B3 (from the French "vitamine PP",
// historically named for preventing pellagra) — not a typo.
const MICRO_KEYS = [
  "vitamin-a_100g",
  "vitamin-c_100g",
  "vitamin-d_100g",
  "vitamin-e_100g",
  "vitamin-k_100g",
  "vitamin-b1_100g",
  "vitamin-b2_100g",
  "vitamin-pp_100g",
  "vitamin-b6_100g",
  "vitamin-b9_100g",
  "vitamin-b12_100g",
  "calcium_100g",
  "iron_100g",
  "potassium_100g",
  "magnesium_100g",
  "zinc_100g",
  "phosphorus_100g",
  "copper_100g",
  "manganese_100g",
  "selenium_100g",
  "iodine_100g",
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
  monounsaturatedFatPer100g?: number;
  polyunsaturatedFatPer100g?: number;
  omega3Per100g?: number;
  omega6Per100g?: number;
  transFatPer100g?: number;
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
    monounsaturatedFatPer100g: n["monounsaturated-fat_100g"],
    polyunsaturatedFatPer100g: n["polyunsaturated-fat_100g"],
    omega3Per100g: n["omega-3-fat_100g"],
    omega6Per100g: n["omega-6-fat_100g"],
    transFatPer100g: n["trans-fat_100g"],
    microsJson: Object.keys(micros).length > 0 ? JSON.stringify(micros) : undefined,
  };
}

// OpenFoodFacts' public endpoints 503 ("Page temporarily unavailable")
// noticeably often even under normal, human-paced request rates — confirmed
// by hand, not just under rapid typing — so every call to them gets one
// short-backoff retry rather than surfacing a transient blip as a real
// failure.
async function fetchOffWithRetry(url: string, attempts = 2): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "macrotrack/1.0 - self-hosted personal nutrition tracker" } });
      if (res.ok) return res;
      lastErr = new Error(`OpenFoodFacts request failed: ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 400));
  }
  throw lastErr;
}

export async function fetchOffProduct(barcode: string): Promise<OffProduct | null> {
  const res = await fetchOffWithRetry(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`);
  const data = (await res.json()) as { status: number; product?: OffProduct };
  if (data.status !== 1 || !data.product) return null;
  return data.product;
}

export interface OffSearchResult {
  code: string;
  product: OffProduct;
}

// The v2 product-by-barcode endpoint above has no free-text search; this is
// OFF's older but still-supported search endpoint, used only for matching by
// name (barcode lookups always go through fetchOffProduct instead).
export async function searchOffProducts(query: string, limit: number): Promise<OffSearchResult[]> {
  const params = new URLSearchParams({
    search_terms: query,
    search_simple: "1",
    action: "process",
    json: "1",
    page_size: String(Math.max(limit, 1)),
    fields: "code,product_name,brands,nutriments,serving_quantity,serving_size",
  });
  const res = await fetchOffWithRetry(`https://world.openfoodfacts.org/cgi/search.pl?${params}`);
  const data = (await res.json()) as { products?: (OffProduct & { code?: string })[] };
  return (data.products ?? [])
    .filter((p): p is OffProduct & { code: string } => !!p.code && !!p.product_name)
    .map((p) => ({ code: p.code, product: p }));
}
