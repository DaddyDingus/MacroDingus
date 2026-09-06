import crypto from "node:crypto";

/**
 * MacroDaddy is an AI-gateway client, not a provider client.
 *
 * Provider credentials, provider/model routing, fallback, quotas and usage
 * accounting live in the central gateway. This module only translates the
 * app's existing AI jobs into provider-neutral gateway capabilities.
 */

export const AI_PROVIDERS = ["openai", "anthropic", "gemini"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_TASKS = [
  "labelScan",
  "mealDescription",
  "foodLookup",
  "recipeImport",
  "recipePhotoImport",
  "photoComparison",
  "checkinNarrative",
] as const;
export type AiTask = (typeof AI_TASKS)[number];

export interface AiImageInput {
  buffer: Buffer;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
}

export interface GenerateAiTextInput {
  prompt: string;
  images?: AiImageInput[];
  jsonSchema?: Record<string, unknown>;
  maxTokens: number;
}

export type AiAccessPolicy = "server" | "bring_your_own_key" | "disabled";
export type CredentialValidationStatus = "unknown" | "valid" | "invalid";

export interface AiProviderAccess {
  provider: AiProvider;
  configured: boolean;
  validationStatus?: CredentialValidationStatus;
}

export interface AiAccess {
  policy: AiAccessPolicy;
  enabled: boolean;
  providers: AiProviderAccess[];
}

export interface AiCredentialMetadata {
  provider: AiProvider;
  configured: true;
  validationStatus: CredentialValidationStatus;
  revision: number;
  createdAtMs: number;
  updatedAtMs: number;
  lastValidatedAtMs: number | null;
  lastValidationErrorCode: string | null;
}

interface GatewayErrorPayload {
  error?: {
    code?: string;
    requestId?: string;
    retryable?: boolean;
    retryAfterSeconds?: number;
  };
}

interface GatewayTaskPayload {
  data?: {
    output?: { type?: string; text?: string; value?: unknown };
  };
}

// OpenAI/Gemini reasoning tokens count against the same output ceiling as the
// visible answer. Preserve MacroDaddy's existing headroom; the gateway still
// applies each centrally configured route maximum.
const REASONING_TOKEN_ALLOWANCE = 4_000;
const MAX_GATEWAY_OUTPUT_TOKENS = 8_192;

export class AiGatewayError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly retryable: boolean;
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;

  constructor(input: {
    code: string;
    message: string;
    statusCode: number;
    retryable?: boolean;
    requestId?: string;
    retryAfterSeconds?: number;
  }) {
    super(input.message);
    this.name = "AiGatewayError";
    this.code = input.code;
    this.statusCode = input.statusCode;
    this.retryable = input.retryable ?? false;
    this.requestId = input.requestId;
    this.retryAfterSeconds = input.retryAfterSeconds;
  }
}

const SAFE_MESSAGES: Record<string, string> = {
  authentication_failure: "Sign out and sign in with Authentik again to use AI features.",
  ai_disabled: "AI features are disabled for this account.",
  byok_required: "Add one of your own AI provider keys in More → AI features first.",
  missing_credential: "Add one of your own AI provider keys in More → AI features first.",
  invalid_credential: "Your AI provider key is invalid. Replace it in More → AI features.",
  credential_exhausted: "Your AI provider account is out of credit or quota.",
  rate_limited: "AI is temporarily rate limited. Please wait and try again.",
  quota_exceeded: "This account's AI usage limit has been reached.",
  request_in_progress: "That AI request is already running.",
  duplicate_request: "That AI request was already submitted. Start it again deliberately if needed.",
  provider_unavailable: "AI is temporarily unavailable. Please try again later.",
  request_too_large: "That request is too large for AI processing.",
  timeout: "The AI request timed out. Check before trying it again.",
  unsupported_capability: "This AI feature is not currently supported.",
  invalid_request: "The AI gateway rejected this request.",
  unsafe_provider_response: "The AI provider returned an unusable response. Please try again.",
  internal_gateway_error: "The AI gateway could not complete that request.",
};

function gatewayBaseUrl(): URL {
  const configured = process.env.AI_GATEWAY_ORIGIN?.trim();
  if (!configured) {
    throw new AiGatewayError({
      code: "gateway_not_configured",
      message: "AI features are not configured on this server.",
      statusCode: 503,
    });
  }

  let origin: URL;
  try {
    origin = new URL(configured);
  } catch {
    throw new AiGatewayError({
      code: "gateway_not_configured",
      message: "AI features are not configured on this server.",
      statusCode: 503,
    });
  }
  const loopbackHttp = origin.protocol === "http:"
    && (origin.hostname === "127.0.0.1" || origin.hostname === "localhost");
  if ((origin.protocol !== "https:" && !loopbackHttp) || origin.username || origin.password) {
    throw new AiGatewayError({
      code: "gateway_not_configured",
      message: "AI features are not configured on this server.",
      statusCode: 503,
    });
  }
  return new URL("/api/ai/v1/", origin);
}

function clientTimeoutMs(): number {
  const parsed = Number(process.env.AI_GATEWAY_CLIENT_TIMEOUT_MS ?? 240_000);
  return Number.isInteger(parsed) && parsed >= 1_000 && parsed <= 300_000 ? parsed : 240_000;
}

async function gatewayFetch<T>(
  accessToken: string,
  requestPath: string,
  init: RequestInit = {},
): Promise<T> {
  if (!accessToken) {
    throw new AiGatewayError({
      code: "authentication_failure",
      message: SAFE_MESSAGES.authentication_failure!,
      statusCode: 401,
    });
  }

  let response: Response;
  try {
    response = await fetch(new URL(requestPath, gatewayBaseUrl()), {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
      // No Origin header is forwarded. This is a server-to-server request;
      // the registered Authentik token still identifies both user and client.
      signal: init.signal ?? AbortSignal.timeout(clientTimeoutMs()),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new AiGatewayError({
      code: timedOut ? "timeout" : "provider_unavailable",
      message: timedOut ? SAFE_MESSAGES.timeout! : "The AI gateway could not be reached.",
      statusCode: timedOut ? 504 : 503,
      retryable: !timedOut,
    });
  }

  const payload = await response.json().catch(() => null) as (T & GatewayErrorPayload) | null;
  if (!response.ok) {
    const code = payload?.error?.code ?? "internal_gateway_error";
    throw new AiGatewayError({
      code,
      // Gateway messages are sanitized, but this closed mapping keeps the UI
      // stable and prevents future upstream detail from leaking through.
      message: SAFE_MESSAGES[code] ?? "The AI gateway could not complete that request.",
      statusCode: response.status >= 400 && response.status <= 599 ? response.status : 502,
      retryable: payload?.error?.retryable,
      requestId: payload?.error?.requestId,
      retryAfterSeconds: payload?.error?.retryAfterSeconds,
    });
  }
  if (!payload) {
    throw new AiGatewayError({
      code: "unsafe_provider_response",
      message: SAFE_MESSAGES.unsafe_provider_response!,
      statusCode: 502,
    });
  }
  return payload;
}

function structuredPrompt(prompt: string, schema: Record<string, unknown>): string {
  return `${prompt}\n\nReturn only one valid JSON object, with no Markdown fence or commentary. The object must satisfy this JSON Schema:\n${JSON.stringify(schema)}`;
}

function normalizeStructuredOutput(text: string): string {
  const trimmed = text.trim();
  const withoutFence = trimmed.match(/^\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`$/i)?.[1]?.trim() ?? trimmed;
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  const candidate = start >= 0 && end >= start ? withoutFence.slice(start, end + 1) : withoutFence;
  try {
    return JSON.stringify(JSON.parse(candidate));
  } catch {
    throw new AiGatewayError({
      code: "unsafe_provider_response",
      message: SAFE_MESSAGES.unsafe_provider_response!,
      statusCode: 502,
    });
  }
}

export async function generateAiText(
  accessToken: string,
  task: AiTask,
  input: GenerateAiTextInput,
): Promise<string> {
  const capability = input.images?.length
    ? "vision"
    : task === "checkinNarrative" || task === "foodLookup"
      ? "general"
      : "complex_reasoning";
  const text = input.jsonSchema ? structuredPrompt(input.prompt, input.jsonSchema) : input.prompt;
  const body = {
    capability,
    input: input.images?.length
      ? {
          text,
          images: input.images.map((image) => ({
            mimeType: image.mediaType,
            dataBase64: image.buffer.toString("base64"),
          })),
        }
      : { text },
    parameters: {},
    maxOutputTokens: Math.min(MAX_GATEWAY_OUTPUT_TOKENS, input.maxTokens + REASONING_TOKEN_ALLOWANCE),
  };
  const payload = await gatewayFetch<GatewayTaskPayload>(accessToken, "tasks", {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(body),
  });
  const output = payload.data?.output;
  const result = output?.type === "text" && typeof output.text === "string"
    ? output.text
    : output?.type === "json"
      ? JSON.stringify(output.value)
      : null;
  if (!result) {
    throw new AiGatewayError({
      code: "unsafe_provider_response",
      message: SAFE_MESSAGES.unsafe_provider_response!,
      statusCode: 502,
    });
  }
  return input.jsonSchema ? normalizeStructuredOutput(result) : result;
}

export async function getAiAccess(accessToken: string): Promise<AiAccess> {
  const payload = await gatewayFetch<{ data: AiAccess }>(accessToken, "access");
  return payload.data;
}

export async function saveAiProviderKey(
  accessToken: string,
  provider: AiProvider,
  credential: string,
): Promise<AiCredentialMetadata> {
  const payload = await gatewayFetch<{ data: AiCredentialMetadata }>(accessToken, `credentials/${provider}`, {
    method: "PUT",
    body: JSON.stringify({ credential, validate: true }),
  });
  return payload.data;
}

export async function testAiProviderKey(
  accessToken: string,
  provider: AiProvider,
): Promise<AiCredentialMetadata> {
  const payload = await gatewayFetch<{ data: AiCredentialMetadata }>(accessToken, `credentials/${provider}/test`, {
    method: "POST",
  });
  return payload.data;
}

export async function removeAiProviderKey(accessToken: string, provider: AiProvider): Promise<boolean> {
  const payload = await gatewayFetch<{ data: { deleted: boolean } }>(accessToken, `credentials/${provider}`, {
    method: "DELETE",
  });
  return payload.data.deleted;
}

export function aiHttpStatus(error: unknown, fallback = 502): number {
  const statusCode = (error as { statusCode?: unknown })?.statusCode;
  return typeof statusCode === "number" && statusCode >= 400 && statusCode <= 599 ? statusCode : fallback;
}
