import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { cookware } from "../db/schema.js";

const cookwareInput = z.object({
  name: z.string().trim().min(1).max(80),
  weightGrams: z.number().positive().max(100_000),
});

export function registerCookwareRoutes(app: FastifyInstance) {
  app.get("/api/cookware", async (req) =>
    db.select().from(cookware).where(eq(cookware.userId, req.userId!)).orderBy(asc(cookware.name))
  );

  app.post("/api/cookware", async (req, reply) => {
    const parsed = cookwareInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Enter a name and a valid empty weight" });

    const now = new Date().toISOString();
    const id = randomUUID();
    await db.insert(cookware).values({
      id,
      userId: req.userId!,
      ...parsed.data,
      createdAt: now,
      updatedAt: now,
    });
    const [created] = await db.select().from(cookware).where(eq(cookware.id, id));
    reply.code(201);
    return created;
  });

  app.patch("/api/cookware/:id", async (req, reply) => {
    const parsed = cookwareInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Enter a name and a valid empty weight" });
    const { id } = req.params as { id: string };

    const [existing] = await db
      .select({ id: cookware.id })
      .from(cookware)
      .where(and(eq(cookware.id, id), eq(cookware.userId, req.userId!)));
    if (!existing) return reply.code(404).send({ error: "Pot or dish not found" });

    await db
      .update(cookware)
      .set({ ...parsed.data, updatedAt: new Date().toISOString() })
      .where(and(eq(cookware.id, id), eq(cookware.userId, req.userId!)));
    const [updated] = await db.select().from(cookware).where(eq(cookware.id, id));
    return updated;
  });

  app.delete("/api/cookware/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.delete(cookware).where(and(eq(cookware.id, id), eq(cookware.userId, req.userId!)));
    reply.code(204);
    return null;
  });
}
