import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, gte } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { weights, users } from "../db/schema.js";
import { computeDenseTrend, addDaysToDateString } from "../engine/trendWeight.js";

// Iron Dingus (a separate, single-person PWA with no backend of its own)
// mirrors this household's scale + trend weight. It has no login, so it
// can't hit our own auth'd /api/weights - instead we push a full snapshot,
// best-effort, to a small relay endpoint on the mypwa-backup sidecar (same
// `proxy` docker network, reached by container name) every time a weigh-in
// changes. Iron Dingus polls that relay on its own schedule. Only Tristan's
// weigh-ins sync - matched by name (survives a DB rebuild) rather than a
// hardcoded user id, since Iron Dingus is one person's app, not the whole
// household's.
const WEIGHT_SYNC_RELAY_URL = "http://mypwa-backup:3000/api/weight-sync";
const WEIGHT_SYNC_USER_NAME = "Tristan";

async function pushWeightSyncToIronDingus(userId: string) {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.name !== WEIGHT_SYNC_USER_NAME) return;

    const rows = await db.select().from(weights).where(eq(weights.userId, userId)).orderBy(weights.date);
    await fetch(WEIGHT_SYNC_RELAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weights: rows.map((r) => ({ date: r.date, weightKg: r.weightKg })) }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Best-effort - Iron Dingus's next poll just picks up the last successful push.
  }
}

const weightInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weightKg: z.number().positive().max(500),
  bodyFatPercent: z.number().min(3).max(70).nullable().optional(),
});

export function registerWeightRoutes(app: FastifyInstance) {
  // Upsert: re-weighing on a day you've already logged corrects that day's
  // reading rather than creating a second entry — there's only ever one
  // scale weight per person per day.
  app.post("/api/weights", async (req, reply) => {
    const parsed = weightInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const userId = req.userId!;

    const [existing] = await db
      .select()
      .from(weights)
      .where(and(eq(weights.userId, userId), eq(weights.date, parsed.data.date)));

    if (existing) {
      await db
        .update(weights)
        .set({
          weightKg: parsed.data.weightKg,
          // omitted (undefined) leaves the existing value alone; explicit
          // null clears it — only overwrite when the field was sent at all.
          ...(parsed.data.bodyFatPercent !== undefined ? { bodyFatPercent: parsed.data.bodyFatPercent } : {}),
        })
        .where(eq(weights.id, existing.id));
      const [updated] = await db.select().from(weights).where(eq(weights.id, existing.id));
      void pushWeightSyncToIronDingus(userId);
      return updated;
    }

    const id = randomUUID();
    await db.insert(weights).values({
      id,
      userId,
      date: parsed.data.date,
      weightKg: parsed.data.weightKg,
      bodyFatPercent: parsed.data.bodyFatPercent ?? null,
      createdAt: new Date().toISOString(),
    });
    const [created] = await db.select().from(weights).where(eq(weights.id, id));
    void pushWeightSyncToIronDingus(userId);
    reply.code(201);
    return created;
  });

  app.get("/api/weights", async (req) => {
    const { days } = req.query as { days?: string };
    const userId = req.userId!;
    const take = Math.min(Number(days) || 90, 3650);
    const since = addDaysToDateString(new Date().toISOString().slice(0, 10), -take);

    return db
      .select()
      .from(weights)
      .where(and(eq(weights.userId, userId), gte(weights.date, since)))
      .orderBy(weights.date);
  });

  // Trend weight is computed from the FULL history every time, not just the
  // requested window — otherwise the EWMA would restart cold at the window
  // boundary and understate how settled the trend actually is. Only the
  // response is sliced to the requested range.
  //
  // Dense (one row per calendar day, not just weigh-in days) — the Weight
  // Trend chart plots a trend value for every day, matching MacroFactor's
  // own "recalculated daily" look. `weightKg` is null on implied days (see
  // computeDenseTrend's doc comment); every other consumer of this route
  // only ever reads `trendKg`, so the density change is transparent to them.
  app.get("/api/weights/trend", async (req) => {
    const { days } = req.query as { days?: string };
    const userId = req.userId!;
    const take = Math.min(Number(days) || 90, 3650);

    const all = await db.select().from(weights).where(eq(weights.userId, userId)).orderBy(weights.date);
    const trend = computeDenseTrend(all.map((w) => ({ date: w.date, weightKg: w.weightKg })));

    const since = addDaysToDateString(new Date().toISOString().slice(0, 10), -take);
    return trend.filter((t) => t.date >= since);
  });

  app.delete("/api/weights/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = req.userId!;
    await db.delete(weights).where(and(eq(weights.id, id), eq(weights.userId, userId)));
    void pushWeightSyncToIronDingus(userId);
    reply.code(204);
    return null;
  });
}
