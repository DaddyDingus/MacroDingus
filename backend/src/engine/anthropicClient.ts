import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type AnthropicKeySource = "account" | "environment" | null;

let secretsDir: string | undefined;
const clients = new Map<string, { apiKey: string; client: Anthropic }>();

// Account keys live outside the general settings JSON because that blob is
// intentionally returned wholesale to the browser. The files are readable
// only by the container user and the key itself is never returned by an API.
export function configureAnthropicKeyStore(dataDir: string) {
  secretsDir = path.join(dataDir, "secrets", "anthropic");
}

function requireSecretsDir(): string {
  if (!secretsDir) throw new Error("Anthropic key store is not initialized");
  return secretsDir;
}

function keyPath(userId: string): string {
  // User ids are generated UUIDs, but basename keeps this safe even if that
  // invariant ever changes or a malformed id reaches this helper.
  return path.join(requireSecretsDir(), path.basename(userId));
}

function accountKey(userId: string): string | null {
  try {
    const key = fs.readFileSync(keyPath(userId), "utf8").trim();
    return key || null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function resolvedKey(userId: string): { apiKey: string; source: Exclude<AnthropicKeySource, null> } | null {
  const ownKey = accountKey(userId);
  if (ownKey) return { apiKey: ownKey, source: "account" };
  const environmentKey = process.env.ANTHROPIC_API_KEY?.trim();
  return environmentKey ? { apiKey: environmentKey, source: "environment" } : null;
}

export function anthropicKeyStatus(userId: string): { configured: boolean; source: AnthropicKeySource } {
  const resolved = resolvedKey(userId);
  return { configured: resolved != null, source: resolved?.source ?? null };
}

export function getAnthropicClient(userId: string): Anthropic {
  const resolved = resolvedKey(userId);
  if (!resolved) throw new Error("ANTHROPIC_API_KEY is not configured");
  const cached = clients.get(userId);
  if (cached?.apiKey === resolved.apiKey) return cached.client;
  const client = new Anthropic({ apiKey: resolved.apiKey });
  clients.set(userId, { apiKey: resolved.apiKey, client });
  return client;
}

export async function saveAnthropicApiKey(userId: string, apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  // Validate before persisting. Listing one model is read-only and does not
  // consume model tokens, while still proving Anthropic accepts the key.
  const candidate = new Anthropic({ apiKey: trimmed });
  await candidate.models.list({ limit: 1 });

  const dir = requireSecretsDir();
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.promises.chmod(dir, 0o700);
  const target = keyPath(userId);
  const temporary = path.join(dir, `.${path.basename(userId)}.${randomUUID()}.tmp`);
  try {
    await fs.promises.writeFile(temporary, `${trimmed}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await fs.promises.rename(temporary, target);
    await fs.promises.chmod(target, 0o600);
  } finally {
    await fs.promises.rm(temporary, { force: true });
  }
  clients.set(userId, { apiKey: trimmed, client: candidate });
}

export async function removeAnthropicApiKey(userId: string): Promise<void> {
  await fs.promises.rm(keyPath(userId), { force: true });
  clients.delete(userId);
}
