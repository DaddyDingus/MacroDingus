export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // Content-Type: application/json on a bodyless request (DELETE, most GETs) makes
  // Fastify's JSON body parser reject it outright — FST_ERR_CTP_EMPTY_JSON_BODY —
  // which is why deletes were silently failing and rolling back their optimistic
  // update. Only attach the header when there's actually a body to describe.
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) };
  if (init?.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

  const res = await fetch(`/api${path}`, {
    credentials: "include",
    ...init,
    headers,
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? res.statusText);
  }
  return body as T;
}
