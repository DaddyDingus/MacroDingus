import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { get, set, del } from "idb-keyval";
import App from "./App";
import "./index.css";

// Barcode scanning is a core quick action, but its decoder is intentionally a
// separate ~400kB chunk. Load/parse it and enumerate camera labels once the
// initial UI is idle, so a cold Scan tap normally has only the physical camera
// startup left to wait for. enumerateDevices does not activate the camera.
function prewarmBarcodeScanner() {
  void import("./components/BarcodeScanner")
    .then((module) => module.prewarmBarcodeCamera())
    .catch(() => {
      // Speculative only; the scanner's normal mount remains the retry path.
    });
}

if ("requestIdleCallback" in window) {
  window.requestIdleCallback(prewarmBarcodeScanner, { timeout: 2500 });
} else {
  globalThis.setTimeout(prewarmBarcodeScanner, 1000);
}

// Without this, the browser's own native scroll restoration on back/forward
// navigation runs *in addition to* (and racing against) the app's own
// explicit window.scrollTo calls (see App.tsx's AppRoutes and
// lib/dashboardScroll.ts) — whichever one wins depends on paint/effect
// timing that varies by device and load, which is exactly what read as
// "sometimes the scroll position is right, sometimes it isn't." Setting this
// once, before the app ever navigates, hands scroll position entirely to
// our own code.
if ("scrollRestoration" in history) {
  history.scrollRestoration = "manual";
}

// autoUpdate installs and activates a new service worker in the background,
// but an already-open WebView keeps executing the old document's JavaScript
// until it navigates. Reload once when an update takes control so live web
// deploys become visible in the APK without requiring a manual cache clear.
// Skip the first-ever registration, when there was no controller at load.
if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
  let reloadingForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    window.location.reload();
  });
}

const persister = createAsyncStoragePersister({
  storage: {
    getItem: async (key) => (await get(key)) ?? null,
    setItem: (key, value) => set(key, value),
    removeItem: (key) => del(key),
  },
  key: "macrotrack-cache",
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        // Invalidate the pre-gateway cache once: older builds could persist a
        // paused key-save mutation (including its plaintext API-key variable).
        buster: "ai-gateway-v1",
        maxAge: 1000 * 60 * 60 * 24 * 7,
        dehydrateOptions: {
          // Mutations can contain transient secrets such as a newly entered
          // BYOK credential and must never be written to the IndexedDB cache.
          shouldDehydrateMutation: () => false,
          // Cached nutrition data makes reopen instant; cached auth state is
          // actively harmful. In particular, logout stores false and an OIDC
          // callback then reloads into that stale value despite having just
          // received a valid session cookie.
          shouldDehydrateQuery: (query) => query.queryKey[0] !== "auth",
        },
      }}
    >
      <App />
    </PersistQueryClientProvider>
  </StrictMode>
);
