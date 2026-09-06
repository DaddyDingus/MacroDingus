import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { userSettings } from "../db/schema.js";
import {
  AI_PROVIDERS,
  aiHttpStatus,
  getAiAccess,
  removeAiProviderKey,
  saveAiProviderKey,
  testAiProviderKey,
} from "../engine/aiProvider.js";
import { gatewayAccessToken } from "../auth.js";

// One loosely-typed JSON blob rather than a strict schema — this is a bag of
// independent frontend preferences (theme, units, dashboard shortcuts/colors,
// dashboard layout), each owned by its own Context/lib file, and a new
// preference should be addable there without a backend change. Values are
// merged shallowly into whatever's already stored (see PATCH below), so a
// client only ever needs to send the keys it actually changed.
const patchInput = z.record(z.string(), z.unknown());
const apiKeyInput = z.object({ apiKey: z.string().trim().min(8).max(8_192) });
const providerInput = z.enum(AI_PROVIDERS);

function aiErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && typeof (error as { statusCode?: unknown }).statusCode === "number"
    ? error.message
    : fallback;
}

export function registerSettingsRoutes(app: FastifyInstance) {
  app.get("/api/settings/ai", async (req, reply) => {
    try {
      return await getAiAccess(await gatewayAccessToken(req));
    } catch (error) {
      return reply.code(aiHttpStatus(error)).send({ error: aiErrorMessage(error, "Couldn't load AI settings") });
    }
  });

  app.put("/api/settings/ai/providers/:provider", async (req, reply) => {
    const provider = providerInput.safeParse((req.params as { provider?: string }).provider);
    const body = apiKeyInput.safeParse(req.body);
    if (!provider.success || !body.success) return reply.code(400).send({ error: "Enter a valid API key" });
    try {
      const credential = await saveAiProviderKey(await gatewayAccessToken(req), provider.data, body.data.apiKey);
      return { ok: true, credential };
    } catch (error) {
      return reply.code(aiHttpStatus(error, 400)).send({ error: aiErrorMessage(error, "Couldn't save that key") });
    }
  });

  app.post("/api/settings/ai/providers/:provider/test", async (req, reply) => {
    const provider = providerInput.safeParse((req.params as { provider?: string }).provider);
    if (!provider.success) return reply.code(404).send({ error: "Unknown AI provider" });
    try {
      const credential = await testAiProviderKey(await gatewayAccessToken(req), provider.data);
      return { ok: true, credential };
    } catch (error) {
      return reply.code(aiHttpStatus(error, 400)).send({ error: aiErrorMessage(error, "Couldn't test that key") });
    }
  });

  app.delete("/api/settings/ai/providers/:provider", async (req, reply) => {
    const provider = providerInput.safeParse((req.params as { provider?: string }).provider);
    if (!provider.success) return reply.code(404).send({ error: "Unknown AI provider" });
    try {
      const deleted = await removeAiProviderKey(await gatewayAccessToken(req), provider.data);
      return { ok: true, deleted };
    } catch (error) {
      return reply.code(aiHttpStatus(error, 400)).send({ error: aiErrorMessage(error, "Couldn't remove that key") });
    }
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
