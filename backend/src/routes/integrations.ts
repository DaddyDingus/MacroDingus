import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, sqlite } from "../db/index.js";
import { foods, integrationTokens, logs, users } from "../db/schema.js";
import { householdDateString } from "../lib/householdDate.js";

/**
 * First-party integration endpoints — machine-to-machine writes on a user's
 * behalf, currently DaddysRecipes logging a cooked serving.
 *
 * Authenticated by a revocable per-user bearer token, exactly like the steps
 * webhook: the token identifies WHICH account to write to, so there's no
 * separate account-mapping table anywhere, and revoking access happens here
 * rather than in the calling app. Tokens are hashed at rest.
 */

const TOKEN_PREFIX = "mt_int_";

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function bearerToken(header: string | string[] | undefined): string | null {
  if (typeof header !== "string") return null;
  const match = header.match(new RegExp(`^Bearer\\s+(${TOKEN_PREFIX}[A-Za-z0-9_-]{32,})$`, "i"));
  return match?.[1] ?? null;
}

async function authenticate(header: string | string[] | undefined) {
  const presented = bearerToken(header);
  if (!presented) return null;
  const [credential] = await db.select().from(integrationTokens).where(and(
    eq(integrationTokens.tokenHash, tokenHash(presented)),
    isNull(integrationTokens.revokedAt),
  ));
  if (!credential) return null;
  sqlite.prepare("UPDATE integration_tokens SET last_used_at = ? WHERE id = ?")
    .run(new Date().toISOString(), credential.id);
  return credential;
}

const perServingSchema = z.object({
  calories: z.number().nonnegative(),
  protein: z.number().nonnegative(),
  carbs: z.number().nonnegative(),
  fat: z.number().nonnegative(),
  fiber: z.number().nonnegative().nullable().optional(),
  sugar: z.number().nonnegative().nullable().optional(),
  satFat: z.number().nonnegative().nullable().optional(),
  sodiumMg: z.number().nonnegative().nullable().optional(),
});

const recipeLogSchema = z.object({
  externalId: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  servings: z.number().positive(),
  servingsEaten: z.number().positive().max(50),
  totalGrams: z.number().positive().nullable().optional(),
  perServing: perServingSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * A serving's weight when the caller couldn't work one out.
 *
 * Nutrition here is stored per 100 g, so a serving needs SOME mass to convert
 * against. 250 g is a middling plated portion; it is a display convention
 * only — the calories logged are exactly what the caller sent either way,
 * because quantityGrams is derived from the same number.
 */
const ASSUMED_SERVING_GRAMS = 250;

export function registerIntegrationRoutes(app: FastifyInstance) {
  /** Cheap round-trip so the calling app can confirm a token actually works. */
  app.post("/api/integrations/recipe-log/ping", async (req, reply) => {
    const credential = await authenticate(req.headers.authorization);
    if (!credential) return reply.code(401).send({ error: "A valid integration token is required" });
    const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, credential.userId));
    return { ok: true, user: user?.name ?? null };
  });

  app.post("/api/integrations/recipe-log", async (req, reply) => {
    const credential = await authenticate(req.headers.authorization);
    if (!credential) return reply.code(401).send({ error: "A valid integration token is required" });

    const parsed = recipeLogSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid recipe log payload" });
    }
    const body = parsed.data;
    const now = new Date().toISOString();
    // The caller's calendar day wins when given — it knows the household's
    // timezone; this server falls back to its own configured one.
    const date = body.date ?? householdDateString();

    const servingGrams = body.totalGrams && body.totalGrams > 0
      ? body.totalGrams / body.servings
      : ASSUMED_SERVING_GRAMS;
    const per100 = (value: number) => (value / servingGrams) * 100;

    const nutrition = {
      caloriesPer100g: per100(body.perServing.calories),
      proteinPer100g: per100(body.perServing.protein),
      carbsPer100g: per100(body.perServing.carbs),
      fatPer100g: per100(body.perServing.fat),
      fiberPer100g: body.perServing.fiber != null ? per100(body.perServing.fiber) : null,
      sugarPer100g: body.perServing.sugar != null ? per100(body.perServing.sugar) : null,
      saturatedFatPer100g: body.perServing.satFat != null ? per100(body.perServing.satFat) : null,
      sodiumMgPer100g: body.perServing.sodiumMg != null ? per100(body.perServing.sodiumMg) : null,
    };

    // Keyed on the caller's own id so cooking the same recipe repeatedly
    // updates ONE food rather than accumulating a duplicate every time.
    const [existing] = await db.select().from(foods).where(eq(foods.barcode, body.externalId));
    let foodId: string;
    if (existing) {
      foodId = existing.id;
      await db.update(foods).set({
        name: body.name,
        servingSizeGrams: servingGrams,
        servingName: "1 serving",
        ...nutrition,
      }).where(eq(foods.id, foodId));
    } else {
      foodId = crypto.randomUUID();
      await db.insert(foods).values({
        id: foodId,
        name: body.name,
        // `barcode` carries the external key: it's already unique-ish, indexed
        // and searched, and adding a column for one integration would touch
        // every food-returning route. A "daddysrecipes:" prefix can never
        // collide with a real barcode, which is digits.
        barcode: body.externalId,
        source: "recipe",
        servingSizeGrams: servingGrams,
        servingName: "1 serving",
        createdAt: now,
        ...nutrition,
      });
    }

    const logId = crypto.randomUUID();
    await db.insert(logs).values({
      id: logId,
      userId: credential.userId,
      date,
      foodId,
      quantityGrams: servingGrams * body.servingsEaten,
      loggedAt: now,
      createdAt: now,
      unitType: "measure",
      unitMeasureName: body.servingsEaten === 1 ? "1 serving" : `${body.servingsEaten} servings`,
    });

    return { ok: true, foodId, logId, date };
  });

  // ---- Token management (session-authenticated, like the steps tokens) ----

  app.get("/api/integrations/tokens", async (req) => {
    const rows = await db.select().from(integrationTokens)
      .where(and(eq(integrationTokens.userId, req.userId!), isNull(integrationTokens.revokedAt)));
    return {
      tokens: rows.map((row) => ({
        id: row.id, name: row.name, tokenPrefix: row.tokenPrefix,
        createdAt: row.createdAt, lastUsedAt: row.lastUsedAt,
      })),
    };
  });

  app.post("/api/integrations/tokens", async (req, reply) => {
    const parsed = z.object({ name: z.string().trim().min(1).max(60) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Give the token a name" });
    const raw = `${TOKEN_PREFIX}${crypto.randomBytes(24).toString("base64url")}`;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.insert(integrationTokens).values({
      id, userId: req.userId!, name: parsed.data.name,
      tokenHash: tokenHash(raw), tokenPrefix: `${raw.slice(0, 15)}…`, createdAt: now,
    });
    // The only time the raw token is ever returned — it's hashed at rest.
    return reply.code(201).send({ id, name: parsed.data.name, token: raw, createdAt: now });
  });

  app.delete("/api/integrations/tokens/:id", async (req) => {
    const { id } = req.params as { id: string };
    sqlite.prepare(
      "UPDATE integration_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
    ).run(new Date().toISOString(), id, req.userId!);
    return { ok: true };
  });
}
