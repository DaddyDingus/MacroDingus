// A manual, guaranteed-effective escape hatch for PWA update staleness. The
// service worker's own background update check (registerType: "autoUpdate"
// in vite.config.ts, plus no-cache headers on sw.js/index.html — see
// backend/src/index.ts) should normally pick up a new deploy on its own, but
// service worker update timing is notoriously unreliable across browsers,
// and this app was regularly needing several manual refreshes — or a full
// close-and-reopen — before a real code change ever visibly took effect.
// This does the same thing that brute-force routine was accomplishing,
// deterministically in one tap: wait until the live backend is reachable,
// drop the current service worker entirely, clear every Cache Storage entry
// it populated, then reload. Waiting first matters during a deploy: clearing
// the working offline shell while Tailscale has no backend turns a recoverable
// cached app into a raw 502 page. TanStack
// Query's own IndexedDB-persisted cache (see main.tsx) is left untouched —
// that's app *data* (foods, logs, weights…), not app *code*, and isn't what
// goes stale here.
const HEALTH_ATTEMPTS = 30;
const HEALTH_RETRY_MS = 1_000;

async function waitForHealthyBackend(): Promise<void> {
  for (let attempt = 0; attempt < HEALTH_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(`/api/health?refresh=${Date.now()}`, {
        cache: "no-store",
        credentials: "include",
      });
      if (response.ok) return;
    } catch {
      // The proxy/backend is still restarting; keep the cached app intact.
    }
    await new Promise((resolve) => window.setTimeout(resolve, HEALTH_RETRY_MS));
  }
  throw new Error("The server is still unavailable. Try again in a moment.");
}

export async function forceRefreshApp(): Promise<void> {
  await waitForHealthyBackend();
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));
  }
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
  window.location.reload();
}
