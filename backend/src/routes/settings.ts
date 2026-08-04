import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { userSettings } from "../db/schema.js";
import { anthropicKeyStatus, removeAnthropicApiKey, saveAnthropicApiKey } from "../engine/anthropicClient.js";

// One loosely-typed JSON blob rather than a strict schema — this is a bag of
// independent frontend preferences (theme, units, dashboard shortcuts/colors,
// dashboard layout), each owned by its own Context/lib file, and a new
// preference should be addable there without a backend change. Values are
// merged shallowly into whatever's already stored (see PATCH below), so a
// client only ever needs to send the keys it actually changed.
const patchInput = z.record(z.string(), z.unknown());
const anthropicKeyInput = z.object({ apiKey: z.string().trim().min(20).max(300) });

export function registerSettingsRoutes(app: FastifyInstance) {
  app.get("/api/settings/ai", async (req) => anthropicKeyStatus(req.userId!));

  app.put("/api/settings/ai", async (req, reply) => {
    const parsed = anthropicKeyInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Enter a valid Anthropic API key" });
    try {
      await saveAnthropicApiKey(req.userId!, parsed.data.apiKey);
      return anthropicKeyStatus(req.userId!);
    } catch (err) {
      req.log.warn({ err }, "Anthropic API key validation failed");
      return reply.code(400).send({ error: "Couldn't validate that key with Anthropic" });
    }
  });

  app.delete("/api/settings/ai", async (req, reply) => {
    await removeAnthropicApiKey(req.userId!);
    reply.code(204);
    return null;
  });

  app.get("/api/settings", async (req) => {
    const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, req.userId!));
    if (!row) return {};
    try {
      const parsed = JSON.parse(row.settingsJson);
      return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  });

  app.patch("/api/settings", async (req, reply) => {
    const parsed = patchInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const userId = req.userId!;
    const now = new Date().toISOString();

    const [existing] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
    let current: Record<string, unknown> = {};
    if (existing) {
      try {
        const p = JSON.parse(existing.settingsJson);
        if (typeof p === "object" && p !== null) current = p;
      } catch {
        // Corrupt stored JSON — overwrite rather than fail the request.
      }
    }
    const next = { ...current, ...parsed.data };
    const settingsJson = JSON.stringify(next);

    if (existing) {
      await db.update(userSettings).set({ settingsJson, updatedAt: now }).where(eq(userSettings.userId, userId));
    } else {
      await db.insert(userSettings).values({ userId, settingsJson, updatedAt: now });
    }
    return next;
  });
}
