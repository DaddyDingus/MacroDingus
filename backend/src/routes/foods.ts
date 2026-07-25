import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, like, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { foods } from "../db/schema.js";

const foodInput = z.object({
  name: z.string().min(1),
  brand: z.string().optional(),
  servingSizeGrams: z.number().positive().optional(),
  servingName: z.string().optional(),
  caloriesPer100g: z.number().nonnegative(),
  proteinPer100g: z.number().nonnegative(),
  carbsPer100g: z.number().nonnegative(),
  fatPer100g: z.number().nonnegative(),
  fiberPer100g: z.number().nonnegative().optional(),
  sugarPer100g: z.number().nonnegative().optional(),
  saturatedFatPer100g: z.number().nonnegative().optional(),
  sodiumMgPer100g: z.number().nonnegative().optional(),
});

export function registerFoodRoutes(app: FastifyInstance) {
  app.get("/api/foods", async (req) => {
    const { q, limit } = req.query as { q?: string; limit?: string };
    const take = Math.min(Number(limit) || 20, 50);
    if (!q || q.trim() === "") {
      return db.select().from(foods).orderBy(desc(foods.createdAt)).limit(take);
    }
    return db
      .select()
      .from(foods)
      .where(like(foods.name, `%${q.trim()}%`))
      .limit(take);
  });

  app.get("/api/foods/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [food] = await db.select().from(foods).where(eq(foods.id, id));
    if (!food) return reply.code(404).send({ error: "not found" });
    return food;
  });

  app.post("/api/foods", async (req, reply) => {
    const parsed = foodInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const id = randomUUID();
    const now = new Date().toISOString();
    await db.insert(foods).values({
      id,
      source: "custom",
      createdAt: now,
      ...parsed.data,
    });
    const [food] = await db.select().from(foods).where(eq(foods.id, id));
    reply.code(201);
    return food;
  });

  app.patch("/api/foods/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = foodInput.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    await db.update(foods).set(parsed.data).where(eq(foods.id, id));
    const [food] = await db.select().from(foods).where(eq(foods.id, id));
    if (!food) return reply.code(404).send({ error: "not found" });
    return food;
  });

  app.delete("/api/foods/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.delete(foods).where(eq(foods.id, id));
    reply.code(204);
    return null;
  });
}
