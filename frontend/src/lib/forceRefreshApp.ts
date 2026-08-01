// A manual, guaranteed-effective escape hatch for PWA update staleness. The
// service worker's own background update check (registerType: "autoUpdate"
// in vite.config.ts, plus no-cache headers on sw.js/index.html — see
// backend/src/index.ts) should normally pick up a new deploy on its own, but
// service worker update timing is notoriously unreliable across browsers,
// and this app was regularly needing several manual refreshes — or a full
// close-and-reopen — before a real code change ever visibly took effect.
// This does the same thing that brute-force routine was accomplishing,
// deterministically in one tap: drop the current service worker entirely,
// clear every Cache Storage entry it populated, then reload. TanStack
// Query's own IndexedDB-persisted cache (see main.tsx) is left untouched —
// that's app *data* (foods, logs, weights…), not app *code*, and isn't what
// goes stale here.
export async function forceRefreshApp(): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((r) => r.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } finally {
    window.location.reload();
  }
}
