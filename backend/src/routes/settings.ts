import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { userSettings } from "../db/schema.js";
import {
  AI_PROVIDER_CATALOG,
  AI_PROVIDERS,
  AI_TASKS,
  aiProviderKeyStatus,
  aiProviderModelCatalog,
  aiTaskAssignments,
  aiTaskFallbackAssignments,
  removeAiProviderKey,
  recommendedModelsForTask,
  saveAiProviderKey,
  saveAiTaskAssignment,
  saveAiTaskFallbackAssignment,
  type AiProvider,
  type AiTask,
} from "../engine/aiProvider.js";

// One loosely-typed JSON blob rather than a strict schema — this is a bag of
// independent frontend preferences (theme, units, dashboard shortcuts/colors,
// dashboard layout), each owned by its own Context/lib file, and a new
// preference should be addable there without a backend change. Values are
// merged shallowly into whatever's already stored (see PATCH below), so a
// client only ever needs to send the keys it actually changed.
const patchInput = z.record(z.string(), z.unknown());
const apiKeyInput = z.object({ apiKey: z.string().trim().min(20).max(500) });
const providerInput = z.enum(AI_PROVIDERS);
const taskInput = z.enum(AI_TASKS.map((task) => task.id) as [AiTask, ...AiTask[]]);
const taskAssignmentInput = z.object({
  provider: providerInput,
  model: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9._:/-]+$/, "Invalid model ID"),
});

async function aiSettingsStatus(userId: string) {
  const assignments = await aiTaskAssignments(userId);
  const fallbackAssignments = await aiTaskFallbackAssignments(userId);
  const legacyAnthropicStatus = aiProviderKeyStatus(userId, "anthropic");
  const providerEntries = await Promise.all(AI_PROVIDERS.map(async (provider) => [
    provider,
    {
      ...AI_PROVIDER_CATALOG[provider],
      ...await aiProviderModelCatalog(userId, provider),
      ...aiProviderKeyStatus(userId, provider),
    },
  ] as const));
  return {
    // Top-level fields preserve the old response contract for a cached app
    // shell during a rolling deploy. The new UI reads `providers` below.
    configured: legacyAnthropicStatus.configured,
    source: legacyAnthropicStatus.source,
    providers: Object.fromEntries(providerEntries),
    tasks: AI_TASKS.map((task) => {
      const assignment = assignments[task.id];
      const fallback = fallbackAssignments[task.id] ?? null;
      return {
        id: task.id,
        label: task.label,
        description: task.description,
        recommendedModels: recommendedModelsForTask(task.id),
        ...assignment,
        configured: aiProviderKeyStatus(userId, assignment.provider).configured,
        // Nullable and never defaulted (unlike the primary provider/model
        // above) — absence means "no fallback," not "use some default
        // fallback," so the UI's own "None" option round-trips cleanly.
        fallbackProvider: fallback?.provider ?? null,
        fallbackModel: fallback?.model ?? null,
        fallbackConfigured: fallback ? aiProviderKeyStatus(userId, fallback.provider).configured : false,
      };
    }),
  };
}

export function registerSettingsRoutes(app: FastifyInstance) {
  app.get("/api/settings/ai", async (req) => aiSettingsStatus(req.userId!));

  // Keep these two legacy endpoints working for a cached pre-deploy frontend.
  app.put("/api/settings/ai", async (req, reply) => {
    const parsed = apiKeyInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Enter a valid Anthropic API key" });
    try {
      await saveAiProviderKey(req.userId!, "anthropic", parsed.data.apiKey);
      return aiSettingsStatus(req.userId!);
    } catch (err) {
      req.log.warn({ err }, "Anthropic API key validation failed");
      return reply.code(400).send({ error: "Couldn't validate that key with Anthropic" });
    }
  });

  app.delete("/api/settings/ai", async (req, reply) => {
    await removeAiProviderKey(req.userId!, "anthropic");
    reply.code(204);
    return null;
  });

  app.put("/api/settings/ai/providers/:provider", async (req, reply) => {
    const provider = providerInput.safeParse((req.params as { provider?: string }).provider);
    const body = apiKeyInput.safeParse(req.body);
    if (!provider.success || !body.success) return reply.code(400).send({ error: "Enter a valid API key" });
    try {
      await saveAiProviderKey(req.userId!, provider.data, body.data.apiKey);
      return aiSettingsStatus(req.userId!);
    } catch (err) {
      req.log.warn({ err, provider: provider.data }, "AI provider API key validation failed");
      return reply.code(400).send({ error: `Couldn't validate that key with ${AI_PROVIDER_CATALOG[provider.data].label}` });
    }
  });

  app.delete("/api/settings/ai/providers/:provider", async (req, reply) => {
    const provider = providerInput.safeParse((req.params as { provider?: string }).provider);
    if (!provider.success) return reply.code(404).send({ error: "Unknown AI provider" });
    await removeAiProviderKey(req.userId!, provider.data);
    reply.code(204);
    return null;
  });

  app.put("/api/settings/ai/tasks/:task", async (req, reply) => {
    const task = taskInput.safeParse((req.params as { task?: string }).task);
    const assignment = taskAssignmentInput.safeParse(req.body);
    if (!task.success || !assignment.success) return reply.code(400).send({ error: "Choose a valid provider and model" });
    await saveAiTaskAssignment(req.userId!, task.data, assignment.data as { provider: AiProvider; model: string });
    return aiSettingsStatus(req.userId!);
  });

  // Fallback is a second, independent assignment per task — PUT sets it,
  // DELETE clears it back to "none" (there's no "default fallback" to reset
  // to, unlike the primary assignment). Deliberately its own pair of
  // endpoints rather than an optional field folded into the PUT above: the
  // primary assignment always has a value, this one's whole point is being
  // absent by default.
  app.put("/api/settings/ai/tasks/:task/fallback", async (req, reply) => {
    const task = taskInput.safeParse((req.params as { task?: string }).task);
    const assignment = taskAssignmentInput.safeParse(req.body);
    if (!task.success || !assignment.success) return reply.code(400).send({ error: "Choose a valid provider and model" });
    await saveAiTaskFallbackAssignment(req.userId!, task.data, assignment.data as { provider: AiProvider; model: string });
    return aiSettingsStatus(req.userId!);
  });

  app.delete("/api/settings/ai/tasks/:task/fallback", async (req, reply) => {
    const task = taskInput.safeParse((req.params as { task?: string }).task);
    if (!task.success) return reply.code(404).send({ error: "Unknown AI task" });
    await saveAiTaskFallbackAssignment(req.userId!, task.data, null);
    return aiSettingsStatus(req.userId!);
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
