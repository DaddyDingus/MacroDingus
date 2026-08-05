export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const TRANSIENT_GATEWAY_STATUSES = new Set([502, 503, 504]);
const GET_RETRY_DELAYS_MS = [350, 700, 1_400, 2_800];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // Content-Type: application/json on a bodyless request (DELETE, most GETs) makes
  // Fastify's JSON body parser reject it outright — FST_ERR_CTP_EMPTY_JSON_BODY —
  // which is why deletes were silently failing and rolling back their optimistic
  // update. Only attach the header when the body is actually a JSON string —
  // FormData bodies (photo upload) must NOT get this header, or the browser's
  // auto-generated multipart boundary never gets set and the upload breaks.
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) };
  if (typeof init?.body === "string" && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

  const method = (init?.method ?? "GET").toUpperCase();
  const canRetry = method === "GET" || method === "HEAD";
  let res: Response | null = null;

  // A deploy briefly leaves the always-running Tailscale proxy without its
  // single backend container. Retry only idempotent reads, and only network
  // failures or non-JSON gateway responses. Real API errors are JSON and pass
  // straight through; mutations are never retried because the server may have
  // committed one even if its response was lost.
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(`/api${path}`, {
        credentials: "include",
        ...init,
        headers,
      });
      const isProxyFailure =
        TRANSIENT_GATEWAY_STATUSES.has(res.status) &&
        !res.headers.get("content-type")?.includes("application/json");
      if (!canRetry || !isProxyFailure || attempt >= GET_RETRY_DELAYS_MS.length) break;
    } catch (error) {
      if (!canRetry || attempt >= GET_RETRY_DELAYS_MS.length) throw error;
    }
    await delay(GET_RETRY_DELAYS_MS[attempt]);
  }

  // The loop always either assigns a response or throws on its final attempt.
  if (!res) throw new TypeError("Network request failed");
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? res.statusText);
  }
  return body as T;
}
