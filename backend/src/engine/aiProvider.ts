import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { userSettings } from "../db/schema.js";

export const AI_PROVIDERS = ["anthropic", "openai", "gemini"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export type AiKeySource = "account" | "environment" | null;

export const AI_TASKS = [
  {
    id: "labelScan",
    label: "Nutrition label scan",
    description: "Reads nutrition panels from photos.",
    defaultProvider: "anthropic",
    defaultModel: "claude-haiku-4-5",
  },
  {
    id: "mealDescription",
    label: "Describe a meal",
    description: "Identifies foods and estimates portions from text or a photo.",
    defaultProvider: "anthropic",
    defaultModel: "claude-sonnet-5",
  },
  {
    id: "recipeImport",
    label: "Recipe import",
    description: "Turns a recipe webpage into editable ingredients.",
    defaultProvider: "anthropic",
    defaultModel: "claude-sonnet-5",
  },
  {
    id: "recipePhotoImport",
    label: "Recipe from photo",
    description: "Reads handwritten or photographed ingredient lists into editable ingredients.",
    defaultProvider: "anthropic",
    defaultModel: "claude-sonnet-5",
  },
  {
    id: "photoComparison",
    label: "Progress photo comparison",
    description: "Compares two progress photos objectively.",
    defaultProvider: "anthropic",
    defaultModel: "claude-sonnet-5",
  },
  {
    id: "checkinNarrative",
    label: "Check-in summary",
    description: "Writes the short factual check-in narrative.",
    defaultProvider: "anthropic",
    defaultModel: "claude-sonnet-5",
  },
] as const satisfies readonly {
  id: string;
  label: string;
  description: string;
  defaultProvider: AiProvider;
  defaultModel: string;
}[];

export type AiTask = (typeof AI_TASKS)[number]["id"];
export interface AiTaskAssignment {
  provider: AiProvider;
  model: string;
}

export const AI_PROVIDER_CATALOG = {
  anthropic: {
    label: "Anthropic",
    keyPlaceholder: "sk-ant-…",
    keyUrl: "https://console.anthropic.com/settings/keys",
    models: ["claude-haiku-4-5", "claude-sonnet-5"],
  },
  openai: {
    label: "OpenAI",
    keyPlaceholder: "sk-…",
    keyUrl: "https://platform.openai.com/api-keys",
    models: ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"],
  },
  gemini: {
    label: "Google Gemini",
    keyPlaceholder: "AIza…",
    keyUrl: "https://aistudio.google.com/app/apikey",
    models: ["gemini-3.6-flash", "gemini-3.1-pro-preview", "gemini-2.5-flash"],
  },
} as const;

// Keep the picker deliberately curated: provider model-list endpoints also
// return embedding, audio, image-only, legacy, and account-specific models
// that cannot necessarily satisfy these text/vision tasks. Recommendations
// are task-specific within that compatible shortlist; an unlisted model ID
// remains available in the UI as the escape hatch for a newly released model.
const AI_TASK_RECOMMENDED_MODELS: Record<AiTask, Record<AiProvider, string>> = {
  labelScan: {
    anthropic: "claude-haiku-4-5",
    openai: "gpt-5.6-luna",
    gemini: "gemini-3.6-flash",
  },
  mealDescription: {
    anthropic: "claude-sonnet-5",
    openai: "gpt-5.6-sol",
    gemini: "gemini-3.1-pro-preview",
  },
  recipeImport: {
    anthropic: "claude-sonnet-5",
    openai: "gpt-5.6-sol",
    gemini: "gemini-3.1-pro-preview",
  },
  recipePhotoImport: {
    anthropic: "claude-sonnet-5",
    openai: "gpt-5.6-sol",
    gemini: "gemini-3.1-pro-preview",
  },
  photoComparison: {
    anthropic: "claude-sonnet-5",
    openai: "gpt-5.6-sol",
    gemini: "gemini-3.1-pro-preview",
  },
  checkinNarrative: {
    anthropic: "claude-sonnet-5",
    openai: "gpt-5.6-sol",
    gemini: "gemini-3.1-pro-preview",
  },
};

export function recommendedModelsForTask(task: AiTask): Record<AiProvider, string> {
  return AI_TASK_RECOMMENDED_MODELS[task];
}

const SETTINGS_KEY = "aiTaskModels";
const FALLBACK_SETTINGS_KEY = "aiTaskFallbackModels";
const MODEL_CATALOG_CACHE_MS = 24 * 60 * 60 * 1000;
let dataRoot: string | undefined;
const anthropicClients = new Map<string, { apiKey: string; client: Anthropic }>();
const modelCatalogCache = new Map<string, {
  keyFingerprint: string;
  models: string[];
  refreshedAt: string;
  expiresAt: number;
}>();

export function configureAiProviderStore(dataDir: string) {
  dataRoot = dataDir;
}

function requireDataRoot(): string {
  if (!dataRoot) throw new Error("AI provider store is not initialized");
  return dataRoot;
}

function providerDirectory(provider: AiProvider): string {
  return path.join(requireDataRoot(), "secrets", "ai", provider);
}

function keyPath(userId: string, provider: AiProvider): string {
  return path.join(providerDirectory(provider), path.basename(userId));
}

function legacyAnthropicKeyPath(userId: string): string {
  return path.join(requireDataRoot(), "secrets", "anthropic", path.basename(userId));
}

function readKeyFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8").trim() || null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function accountKey(userId: string, provider: AiProvider): string | null {
  return readKeyFile(keyPath(userId, provider)) ?? (provider === "anthropic" ? readKeyFile(legacyAnthropicKeyPath(userId)) : null);
}

function environmentKey(provider: AiProvider): string | null {
  const value = provider === "anthropic"
    ? process.env.ANTHROPIC_API_KEY
    : provider === "openai"
    ? process.env.OPENAI_API_KEY
    : process.env.GEMINI_API_KEY;
  return value?.trim() || null;
}

function resolvedKey(userId: string, provider: AiProvider): { apiKey: string; source: Exclude<AiKeySource, null> } | null {
  const ownKey = accountKey(userId, provider);
  if (ownKey) return { apiKey: ownKey, source: "account" };
  const sharedKey = environmentKey(provider);
  return sharedKey ? { apiKey: sharedKey, source: "environment" } : null;
}

export function aiProviderKeyStatus(userId: string, provider: AiProvider): { configured: boolean; source: AiKeySource } {
  const resolved = resolvedKey(userId, provider);
  return { configured: resolved != null, source: resolved?.source ?? null };
}

export interface AiProviderModelCatalog {
  models: string[];
  discoveredModels: string[];
  modelCatalogSource: "live" | "cache" | "fallback";
  modelsRefreshedAt: string | null;
}

function modelCacheKey(userId: string, provider: AiProvider): string {
  return `${userId}:${provider}`;
}

function fingerprintKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(4_000) });
  if (!response.ok) throw new Error(`Model catalogue returned ${response.status}`);
  return response.json();
}

function stringIds(value: unknown, key: "id" | "name"): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const id = (entry as Record<string, unknown>)[key];
    return typeof id === "string" && id ? [id] : [];
  });
}

async function discoverProviderModels(provider: AiProvider, apiKey: string): Promise<string[]> {
  if (provider === "anthropic") {
    const body = await fetchJson("https://api.anthropic.com/v1/models?limit=100", {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    }) as { data?: unknown };
    return stringIds(body.data, "id");
  }

  if (provider === "openai") {
    const body = await fetchJson("https://api.openai.com/v1/models", {
      Authorization: `Bearer ${apiKey}`,
    }) as { data?: unknown };
    return stringIds(body.data, "id").filter((id) =>
      /^(gpt-|o[1-9])/.test(id)
      && !/(audio|realtime|transcribe|tts|image|search|embedding|moderation|codex|instruct)/i.test(id)
      && !id.startsWith("ft:")
    );
  }

  const body = await fetchJson("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
    "x-goog-api-key": apiKey,
  }) as { models?: unknown };
  if (!Array.isArray(body.models)) return [];
  return body.models.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const model = entry as Record<string, unknown>;
    const name = typeof model.name === "string" ? model.name.replace(/^models\//, "") : "";
    const methods = Array.isArray(model.supportedGenerationMethods) ? model.supportedGenerationMethods : [];
    if (!name || !methods.includes("generateContent") || /(embedding|aqa|imagen|veo|lyria|tts|live)/i.test(name)) return [];
    return [name];
  });
}

export async function aiProviderModelCatalog(userId: string, provider: AiProvider): Promise<AiProviderModelCatalog> {
  const curated: string[] = [...AI_PROVIDER_CATALOG[provider].models];
  const resolved = resolvedKey(userId, provider);
  if (!resolved) {
    return { models: curated, discoveredModels: [], modelCatalogSource: "fallback", modelsRefreshedAt: null };
  }

  const cacheKey = modelCacheKey(userId, provider);
  const keyFingerprint = fingerprintKey(resolved.apiKey);
  const cached = modelCatalogCache.get(cacheKey);
  if (cached?.keyFingerprint === keyFingerprint && cached.expiresAt > Date.now()) {
    return {
      models: [...curated, ...cached.models.filter((model) => !curated.includes(model))],
      discoveredModels: cached.models.filter((model) => !curated.includes(model)),
      modelCatalogSource: "cache",
      modelsRefreshedAt: cached.refreshedAt,
    };
  }

  try {
    const discovered = [...new Set(await discoverProviderModels(provider, resolved.apiKey))].sort((a, b) => a.localeCompare(b));
    if (discovered.length === 0) throw new Error("Provider returned no compatible models");
    const refreshedAt = new Date().toISOString();
    modelCatalogCache.set(cacheKey, {
      keyFingerprint,
      models: discovered,
      refreshedAt,
      expiresAt: Date.now() + MODEL_CATALOG_CACHE_MS,
    });
    return {
      models: [...curated, ...discovered.filter((model) => !curated.includes(model))],
      discoveredModels: discovered.filter((model) => !curated.includes(model)),
      modelCatalogSource: "live",
      modelsRefreshedAt: refreshedAt,
    };
  } catch {
    if (cached?.keyFingerprint === keyFingerprint) {
      return {
        models: [...curated, ...cached.models.filter((model) => !curated.includes(model))],
        discoveredModels: cached.models.filter((model) => !curated.includes(model)),
        modelCatalogSource: "cache",
        modelsRefreshedAt: cached.refreshedAt,
      };
    }
    return { models: curated, discoveredModels: [], modelCatalogSource: "fallback", modelsRefreshedAt: null };
  }
}

async function validateOpenAiKey(apiKey: string): Promise<void> {
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`OpenAI returned ${response.status}`);
}

async function validateGeminiKey(apiKey: string): Promise<void> {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
    headers: { "x-goog-api-key": apiKey },
  });
  if (!response.ok) throw new Error(`Gemini returned ${response.status}`);
}

export async function saveAiProviderKey(userId: string, provider: AiProvider, apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (provider === "anthropic") {
    await new Anthropic({ apiKey: trimmed }).models.list({ limit: 1 });
  } else if (provider === "openai") {
    await validateOpenAiKey(trimmed);
  } else {
    await validateGeminiKey(trimmed);
  }

  const dir = providerDirectory(provider);
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.promises.chmod(dir, 0o700);
  const target = keyPath(userId, provider);
  const temporary = path.join(dir, `.${path.basename(userId)}.${randomUUID()}.tmp`);
  try {
    await fs.promises.writeFile(temporary, `${trimmed}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await fs.promises.rename(temporary, target);
    await fs.promises.chmod(target, 0o600);
  } finally {
    await fs.promises.rm(temporary, { force: true });
  }
  modelCatalogCache.delete(modelCacheKey(userId, provider));
  if (provider === "anthropic") anthropicClients.delete(userId);
}

export async function removeAiProviderKey(userId: string, provider: AiProvider): Promise<void> {
  await fs.promises.rm(keyPath(userId, provider), { force: true });
  modelCatalogCache.delete(modelCacheKey(userId, provider));
  if (provider === "anthropic") {
    await fs.promises.rm(legacyAnthropicKeyPath(userId), { force: true });
    anthropicClients.delete(userId);
  }
}

function parseAssignments(value: unknown): Partial<Record<AiTask, AiTaskAssignment>> {
  if (!value || typeof value !== "object") return {};
  const input = value as Record<string, unknown>;
  const result: Partial<Record<AiTask, AiTaskAssignment>> = {};
  for (const task of AI_TASKS) {
    const raw = input[task.id];
    if (!raw || typeof raw !== "object") continue;
    const provider = (raw as Record<string, unknown>).provider;
    const model = (raw as Record<string, unknown>).model;
    if (AI_PROVIDERS.includes(provider as AiProvider) && typeof model === "string" && model.trim()) {
      result[task.id] = { provider: provider as AiProvider, model: model.trim() };
    }
  }
  return result;
}

async function readSettings(userId: string): Promise<{ rowExists: boolean; settings: Record<string, unknown> }> {
  const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
  if (!row) return { rowExists: false, settings: {} };
  try {
    const parsed = JSON.parse(row.settingsJson);
    return { rowExists: true, settings: parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {} };
  } catch {
    return { rowExists: true, settings: {} };
  }
}

async function writeSettingsPatch(userId: string, patch: Record<string, unknown>): Promise<void> {
  const { rowExists, settings } = await readSettings(userId);
  const settingsJson = JSON.stringify({ ...settings, ...patch });
  const updatedAt = new Date().toISOString();
  if (rowExists) {
    await db.update(userSettings).set({ settingsJson, updatedAt }).where(eq(userSettings.userId, userId));
  } else {
    await db.insert(userSettings).values({ userId, settingsJson, updatedAt });
  }
}

export async function aiTaskAssignments(userId: string): Promise<Record<AiTask, AiTaskAssignment>> {
  const { settings } = await readSettings(userId);
  const saved = parseAssignments(settings[SETTINGS_KEY]);
  return Object.fromEntries(AI_TASKS.map((task) => [
    task.id,
    saved[task.id] ?? { provider: task.defaultProvider, model: task.defaultModel },
  ])) as Record<AiTask, AiTaskAssignment>;
}

export async function saveAiTaskAssignment(userId: string, taskId: AiTask, assignment: AiTaskAssignment): Promise<void> {
  const { settings } = await readSettings(userId);
  const assignments = parseAssignments(settings[SETTINGS_KEY]);
  assignments[taskId] = assignment;
  await writeSettingsPatch(userId, { [SETTINGS_KEY]: assignments });
}

// A *second*, independent per-task assignment — unlike the primary one
// above, absence is meaningful ("no fallback configured") rather than
// something to default away, so this is never merged with task.defaultProvider/
// defaultModel the way aiTaskAssignments is. Exists for the case that
// actually happened to prompt this feature: a provider's account runs out of
// funds/quota silently, and every task assigned to it starts failing with no
// warning until generateAiText's own fallback attempt (below) picks up the
// slack.
export async function aiTaskFallbackAssignments(userId: string): Promise<Partial<Record<AiTask, AiTaskAssignment>>> {
  const { settings } = await readSettings(userId);
  return parseAssignments(settings[FALLBACK_SETTINGS_KEY]);
}

export async function saveAiTaskFallbackAssignment(userId: string, taskId: AiTask, assignment: AiTaskAssignment | null): Promise<void> {
  const { settings } = await readSettings(userId);
  const assignments = parseAssignments(settings[FALLBACK_SETTINGS_KEY]);
  if (assignment) assignments[taskId] = assignment;
  else delete assignments[taskId];
  await writeSettingsPatch(userId, { [FALLBACK_SETTINGS_KEY]: assignments });
}

export async function aiTaskConfigured(userId: string, task: AiTask): Promise<boolean> {
  const assignment = (await aiTaskAssignments(userId))[task];
  return aiProviderKeyStatus(userId, assignment.provider).configured;
}

function getAnthropicClient(userId: string, apiKey: string): Anthropic {
  const cached = anthropicClients.get(userId);
  if (cached?.apiKey === apiKey) return cached.client;
  const client = new Anthropic({ apiKey });
  anthropicClients.set(userId, { apiKey, client });
  return client;
}

export interface AiImageInput {
  buffer: Buffer;
  mediaType: "image/jpeg";
}

interface GenerateAiTextInput {
  prompt: string;
  images?: AiImageInput[];
  jsonSchema?: Record<string, unknown>;
  maxTokens: number;
}

// Gemini and OpenAI charge a reasoning model's *thinking* tokens against the
// same ceiling as its visible answer; Anthropic's max_tokens covers only the
// reply. Passing a caller's prose budget straight through therefore starves the
// answer rather than capping it — measured on gemini-3.6-flash, a 300-token
// ceiling went 284 tokens on thinking and came back as a 6-word fragment with
// finishReason=MAX_TOKENS, which the old code returned as a successful result.
// Thinking on a short prose task measured ~3k tokens, so this is deliberately
// generous. It's a ceiling, not a target: unused headroom costs nothing.
const REASONING_TOKEN_ALLOWANCE = 4000;

async function generateWithOpenAi(apiKey: string, model: string, task: AiTask, input: GenerateAiTextInput): Promise<string> {
  const content: Array<Record<string, unknown>> = (input.images ?? []).map((image) => ({
    type: "input_image",
    image_url: `data:${image.mediaType};base64,${image.buffer.toString("base64")}`,
  }));
  content.push({ type: "input_text", text: input.prompt });
  const body: Record<string, unknown> = {
    model,
    input: [{ role: "user", content }],
    max_output_tokens: input.maxTokens + REASONING_TOKEN_ALLOWANCE,
    store: false,
  };
  if (input.jsonSchema) {
    body.text = {
      format: {
        type: "json_schema",
        name: `macrotrack_${task.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`,
        strict: true,
        schema: input.jsonSchema,
      },
    };
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const error = raw?.error && typeof raw.error === "object" ? raw.error as Record<string, unknown> : null;
    throw new Error(typeof error?.message === "string" ? error.message : `OpenAI returned ${response.status}`);
  }
  if (typeof raw?.output_text === "string" && raw.output_text.trim()) return raw.output_text.trim();
  const output = Array.isArray(raw?.output) ? raw.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const blocks = Array.isArray((item as Record<string, unknown>).content) ? (item as Record<string, unknown>).content as unknown[] : [];
    for (const block of blocks) {
      if (block && typeof block === "object" && typeof (block as Record<string, unknown>).text === "string") {
        return ((block as Record<string, unknown>).text as string).trim();
      }
    }
  }
  throw new Error("No text returned by OpenAI");
}

async function generateWithGemini(apiKey: string, model: string, input: GenerateAiTextInput): Promise<string> {
  const parts: Array<Record<string, unknown>> = (input.images ?? []).map((image) => ({
    inlineData: { mimeType: image.mediaType, data: image.buffer.toString("base64") },
  }));
  parts.push({ text: input.prompt });
  const generationConfig: Record<string, unknown> = { maxOutputTokens: input.maxTokens + REASONING_TOKEN_ALLOWANCE };
  if (input.jsonSchema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseJsonSchema = input.jsonSchema;
  }
  const modelId = model.replace(/^models\//, "");
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig }),
    }
  );
  const raw = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const error = raw?.error && typeof raw.error === "object" ? raw.error as Record<string, unknown> : null;
    throw new Error(typeof error?.message === "string" ? error.message : `Gemini returned ${response.status}`);
  }
  const candidates = Array.isArray(raw?.candidates) ? raw.candidates : [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const content = (candidate as Record<string, unknown>).content;
    if (!content || typeof content !== "object") continue;
    const responseParts = Array.isArray((content as Record<string, unknown>).parts)
      ? (content as Record<string, unknown>).parts as unknown[]
      : [];
    for (const part of responseParts) {
      if (!part || typeof part !== "object") continue;
      // A reasoning model streams its thinking back in the same parts array,
      // flagged `thought: true`. Taking the first part with any text at all can
      // hand back the model's own scratchpad as the answer.
      if ((part as Record<string, unknown>).thought === true) continue;
      if (typeof (part as Record<string, unknown>).text === "string") {
        return ((part as Record<string, unknown>).text as string).trim();
      }
    }
    // Reached only when nothing usable came back. A truncated answer must fail
    // loudly rather than surface as a successful (and silently cut off) result.
    if ((candidate as Record<string, unknown>).finishReason === "MAX_TOKENS") {
      throw new Error("Gemini hit its output limit before finishing a reply");
    }
  }
  throw new Error("No text returned by Gemini");
}

async function generateWithAnthropic(userId: string, apiKey: string, model: string, input: GenerateAiTextInput): Promise<string> {
  const content: Array<Record<string, unknown>> = (input.images ?? []).map((image) => ({
    type: "image",
    source: { type: "base64", media_type: image.mediaType, data: image.buffer.toString("base64") },
  }));
  content.push({ type: "text", text: input.prompt });
  const request: Record<string, unknown> = {
    model,
    max_tokens: input.maxTokens,
    messages: [{ role: "user", content }],
  };
  if (input.jsonSchema) request.output_config = { format: { type: "json_schema", schema: input.jsonSchema } };
  const response = await getAnthropicClient(userId, apiKey).messages.create(request as never);
  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("No text returned by Anthropic");
  return textBlock.text.trim();
}

// Single dispatch point shared by generateAiText's primary attempt and its
// fallback retry below — kept as one function precisely so the two attempts
// can't drift (e.g. one branch gaining a provider-specific tweak the other
// never gets).
async function callProvider(userId: string, provider: AiProvider, model: string, apiKey: string, task: AiTask, input: GenerateAiTextInput): Promise<string> {
  if (provider === "openai") return generateWithOpenAi(apiKey, model, task, input);
  if (provider === "gemini") return generateWithGemini(apiKey, model, input);
  return generateWithAnthropic(userId, apiKey, model, input);
}

export async function generateAiText(userId: string, task: AiTask, input: GenerateAiTextInput): Promise<string> {
  const assignment = (await aiTaskAssignments(userId))[task];
  const resolved = resolvedKey(userId, assignment.provider);
  const primaryError = resolved
    ? null
    : new Error(`${AI_PROVIDER_CATALOG[assignment.provider].label} API key is not configured`);

  if (resolved) {
    try {
      return await callProvider(userId, assignment.provider, assignment.model, resolved.apiKey, task, input);
    } catch (err) {
      return attemptFallback(userId, task, input, err);
    }
  }
  return attemptFallback(userId, task, input, primaryError);
}

// Only reached once the primary provider has already failed (missing key,
// auth/quota/rate-limit error, network error — anything generateWith* or the
// key check above throws). Silent by design: this exists specifically for
// "a provider's account ran out of funds/quota without anyone noticing," so
// there's nowhere in this backend that surfaces *which* provider actually
// served a given response — only the combined error message below, and only
// once both have failed.
async function attemptFallback(userId: string, task: AiTask, input: GenerateAiTextInput, primaryError: unknown): Promise<string> {
  const fallback = (await aiTaskFallbackAssignments(userId))[task];
  if (!fallback) throw primaryError;
  const resolved = resolvedKey(userId, fallback.provider);
  if (!resolved) throw primaryError; // fallback configured but has no key of its own — nothing more to try

  try {
    return await callProvider(userId, fallback.provider, fallback.model, resolved.apiKey, task, input);
  } catch (fallbackError) {
    const primaryMessage = primaryError instanceof Error ? primaryError.message : String(primaryError);
    const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
    throw new Error(`${primaryMessage} (fallback ${AI_PROVIDER_CATALOG[fallback.provider].label} also failed: ${fallbackMessage})`);
  }
}
