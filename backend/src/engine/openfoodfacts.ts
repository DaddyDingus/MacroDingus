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
// by hand, not just under rapid typing (3 of 4 consecutive legacy-search
// calls 503'd in one such check), so every call gets one short-backoff
// retry rather than surfacing a transient blip as a real failure.
// searchOffProducts depends on both OFF search endpoints to do its
// word-overlap rerank (see there) — silently losing one leg to a single
// 503 shouldn't be the common case.
//
// A per-attempt AbortController timeout is needed for the same reason: a
// plain 503 fails fast, but a *hanging* request (OFF up but slow, not down)
// has nothing else bounding it. Both constants below were tuned down from
// an initial 3 attempts / 6s each after observing OFF's legacy endpoint go
// through a real multi-minute degraded spell live (504s, one raw request
// that just never returned at all) — the original settings took ~14s to
// give up and fall back on a single search during that window, an eternity
// for a live search box. 2 attempts / 4s bounds the worst case per source to
// ~8.4s (both sources run in parallel, so that's the actual worst case, not
// double it) — still enough to ride out a single transient blip, not enough
// to make a real outage feel like a hang. The 10-minute cache in
// searchOffProducts covers most of what a 3rd attempt used to buy: repeat
// searches within a session don't pay this cost more than once.
const OFF_REQUEST_TIMEOUT_MS = 4000;

async function fetchOffWithRetry(url: string, attempts = 2): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), OFF_REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "macrotrack/1.0 - self-hosted personal nutrition tracker" },
        signal: timeoutController.signal,
      });
      if (res.ok) return res;
      lastErr = new Error(`OpenFoodFacts request failed: ${res.status}`);
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timeout);
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

type RawOffHit = { code?: string; product_name?: string; brands?: string | string[]; nutriments?: Record<string, number> };

// OFF's current search backend (search-a-licious) — ranks by real text
// relevance for a short, common query. Confirmed by hand: it turns a plain
// "milk" search into actual milk products, where the older /cgi/search.pl
// endpoint below (no relevance/popularity sort at all) surfaced whatever
// brand had most recently had a batch of unrelated products edited (cheese,
// cookies, kefir all outranking milk). But it falls down hard on a longer,
// descriptive raw-ingredient query — "white potato raw" scores a Bulgarian
// brine cheese first, identical to a search for "white" alone, because that
// cheese is tagged under an "en:white-cheeses"-style category and "raw" hits
// a raw-milk category tag too, and those field-level tag matches apparently
// outweigh product_name matches when no single product's name contains every
// query word. So it's the mirror image of /cgi/search.pl's problem, not a
// strict improvement — see searchOffProducts below, which queries both and
// re-ranks.
async function searchOffCurrent(query: string, limit: number): Promise<OffSearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    page_size: String(Math.max(limit, 1)),
    fields: "code,product_name,brands,nutriments",
  });
  const res = await fetchOffWithRetry(`https://search.openfoodfacts.org/search?${params}`);
  const data = (await res.json()) as { hits?: RawOffHit[] };
  return (data.hits ?? [])
    .filter((p): p is RawOffHit & { code: string; product_name: string } => !!p.code && !!p.product_name)
    .map((p) => ({
      code: p.code,
      // `brands` comes back as an array here rather than the comma-joined
      // string the v2 API and mapOffProduct both expect.
      product: { ...p, brands: Array.isArray(p.brands) ? p.brands.join(", ") : p.brands },
    }));
}

// The deprecated but still-live legacy search endpoint. Kept around
// specifically for the descriptive multi-word queries searchOffCurrent
// mishandles (see above) — its own weakness (no relevance/popularity sort)
// is exactly what a local rerank on word-overlap in searchOffProducts
// papers over.
async function searchOffLegacy(query: string, limit: number): Promise<OffSearchResult[]> {
  const params = new URLSearchParams({
    search_terms: query,
    search_simple: "1",
    action: "process",
    json: "1",
    page_size: String(Math.max(limit, 1)),
    fields: "code,product_name,brands,nutriments",
  });
  const res = await fetchOffWithRetry(`https://world.openfoodfacts.org/cgi/search.pl?${params}`);
  const data = (await res.json()) as { products?: RawOffHit[] };
  return (data.products ?? [])
    .filter((p): p is RawOffHit & { code: string; product_name: string } => !!p.code && !!p.product_name)
    .map((p) => ({
      code: p.code,
      product: { ...p, brands: Array.isArray(p.brands) ? p.brands.join(", ") : p.brands },
    }));
}

// The rerank below needs a real pool of candidates from *each* source to
// work with — the caller (routes/foods.ts) often asks for very few remote
// results (e.g. `take - local.length` is 1-2 once local DB matches have
// filled most of the display quota), and requesting only that many from
// each OFF source risked the true best match never being fetched at all in
// the first place, no rerank could then surface it. So each source is
// always asked for at least this many, regardless of what the caller
// needs, and the final list is trimmed back down to `limit` after
// reranking — the same "over-fetch beyond `take` so there's a real pool to
// re-rank" trade routes/foods.ts already makes for local DB candidates.
const MIN_OFF_CANDIDATE_POOL = 8;

// Both OFF search endpoints are hit on every uncached query (see below), so
// results are cached briefly — short enough that a genuinely new/edited OFF
// product shows up again soon, long enough to absorb retyping, backspacing,
// or searching the same common ingredient again later the same session
// without doubling network calls or being at the mercy of OFF's own
// flakiness a second time. FIFO eviction past the size cap, not real LRU —
// overkill for a single-household app's query variety.
const OFF_CACHE_TTL_MS = 10 * 60 * 1000;
const OFF_CACHE_MAX_ENTRIES = 200;
const offSearchCache = new Map<string, { expiresAt: number; value: OffSearchResult[] }>();

async function cachedOffSearch(key: string, fetcher: () => Promise<OffSearchResult[]>): Promise<OffSearchResult[]> {
  const hit = offSearchCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const value = await fetcher();

  if (offSearchCache.size >= OFF_CACHE_MAX_ENTRIES) {
    const oldestKey = offSearchCache.keys().next().value;
    if (oldestKey !== undefined) offSearchCache.delete(oldestKey);
  }
  offSearchCache.set(key, { expiresAt: Date.now() + OFF_CACHE_TTL_MS, value });
  return value;
}

// Neither of OFF's two search endpoints is reliable alone (see the two
// functions above), so both are queried in parallel and merged by barcode,
// then re-ranked by how many of the query's words literally appear in the
// product name — a plain local relevance check neither backend reliably
// applies itself. This is a stable sort, so ties (including the common case
// of every candidate scoring 0, e.g. a query with no exact name match in
// either source) keep their original merged order — searchOffCurrent's
// results first, since it's the better-ranked source for the common case of
// a short query that *does* have real matches.
export async function searchOffProducts(query: string, limit: number): Promise<OffSearchResult[]> {
  const perSourceLimit = Math.max(limit, MIN_OFF_CANDIDATE_POOL);
  const cacheKeyBase = `${query.trim().toLowerCase()}::${perSourceLimit}`;

  const [current, legacy] = await Promise.all([
    cachedOffSearch(`current::${cacheKeyBase}`, () => searchOffCurrent(query, perSourceLimit)).catch(() => []),
    cachedOffSearch(`legacy::${cacheKeyBase}`, () => searchOffLegacy(query, perSourceLimit)).catch(() => []),
  ]);

  const seen = new Set<string>();
  const merged: OffSearchResult[] = [];
  for (const r of [...current, ...legacy]) {
    if (seen.has(r.code)) continue;
    seen.add(r.code);
    merged.push(r);
  }

  const queryWords = query.toLowerCase().split(/\s+/).filter(Boolean);
  function wordOverlap(r: OffSearchResult): number {
    // Brand included alongside name — "coca cola" should score a product
    // named "Classic Coke" (brand "Coca-Cola") on "coca", not just whatever
    // literally has both words in its product_name.
    const haystack = `${r.product.product_name ?? ""} ${r.product.brands ?? ""}`.toLowerCase();
    return queryWords.filter((w) => haystack.includes(w)).length;
  }

  return merged
    .map((r, index) => ({ r, score: wordOverlap(r), index }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ r }) => r);
}
