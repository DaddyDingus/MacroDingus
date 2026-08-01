import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { measurements } from "../db/schema.js";

const saveInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  measurements: z
    .array(
      z.object({
        part: z.string().min(1),
        valueCm: z.number().positive().max(500),
      })
    )
    .min(1),
});

export function registerMeasurementRoutes(app: FastifyInstance) {
  app.get("/api/measurements", async (req) => {
    return db.select().from(measurements).where(eq(measurements.userId, req.userId!));
  });

  // Upsert per (date, part): re-saving a day's log corrects those parts
  // rather than piling up duplicate rows, same reasoning as weights' one
  // entry per person per day.
  app.post("/api/measurements", async (req, reply) => {
    const parsed = saveInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const userId = req.userId!;
    const { date } = parsed.data;
    const now = new Date().toISOString();

    for (const { part, valueCm } of parsed.data.measurements) {
      await db
        .delete(measurements)
        .where(and(eq(measurements.userId, userId), eq(measurements.date, date), eq(measurements.part, part)));
      await db.insert(measurements).values({ id: randomUUID(), userId, date, part, valueCm, createdAt: now });
    }

    const saved = await db.select().from(measurements).where(and(eq(measurements.userId, userId), eq(measurements.date, date)));
    reply.code(201);
    return saved;
  });

  app.delete("/api/measurements/date/:date", async (req, reply) => {
    const { date } = req.params as { date: string };
    await db.delete(measurements).where(and(eq(measurements.userId, req.userId!), eq(measurements.date, date)));
    reply.code(204);
    return null;
  });
}
