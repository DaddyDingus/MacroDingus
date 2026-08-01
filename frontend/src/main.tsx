import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { get, set, del } from "idb-keyval";
import App from "./App";
import "./index.css";

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
      persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24 * 7 }}
    >
      <App />
    </PersistQueryClientProvider>
  </StrictMode>
);
