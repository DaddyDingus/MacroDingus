import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, desc, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { favorites, foods } from "../db/schema.js";

const favoriteInput = z.object({
  foodId: z.string().min(1),
});

export function registerFavoriteRoutes(app: FastifyInstance) {
  // Favorite foods, most recently favorited first — a plain join against
  // `foods` since callers want the full Food row (name, macros, etc.), not
  // just the bare favorite record.
  app.get("/api/favorites", async (req) => {
    const userId = req.userId!;
    // hiddenAt excludes a favorite whose food was since "deleted" — it's
    // gone from the user's list, so it shouldn't resurface as a one-tap
    // shortcut either, even though the underlying row still exists to back
    // whatever log entries already used it.
    const rows = await db
      .select({ food: foods })
      .from(favorites)
      .innerJoin(foods, eq(favorites.foodId, foods.id))
      .where(and(eq(favorites.userId, userId), isNull(foods.hiddenAt)))
      .orderBy(desc(favorites.createdAt));
    return rows.map((r) => r.food);
  });

  // Idempotent: favoriting an already-favorited food is a no-op, not an
  // error — the frontend just toggles a heart, it doesn't track "already
  // favorited" as a failure case.
  app.post("/api/favorites", async (req, reply) => {
    const parsed = favoriteInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const userId = req.userId!;

    const [existing] = await db
      .select()
      .from(favorites)
      .where(and(eq(favorites.userId, userId), eq(favorites.foodId, parsed.data.foodId)));
    if (existing) return existing;

    const id = randomUUID();
    await db.insert(favorites).values({
      id,
      userId,
      foodId: parsed.data.foodId,
      createdAt: new Date().toISOString(),
    });
    const [created] = await db.select().from(favorites).where(eq(favorites.id, id));
    reply.code(201);
    return created;
  });

  app.delete("/api/favorites/:foodId", async (req, reply) => {
    const { foodId } = req.params as { foodId: string };
    await db.delete(favorites).where(and(eq(favorites.userId, req.userId!), eq(favorites.foodId, foodId)));
    reply.code(204);
    return null;
  });
}
