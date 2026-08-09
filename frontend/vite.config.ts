import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.png", "icons/apple-touch-icon.png"],
      manifest: {
        name: "macrotrack",
        short_name: "macrotrack",
        description: "Personal nutrition and coaching tracker",
        // Static — the manifest can't follow the in-app theme picker, so
        // this matches "black" (the default theme in lib/theme.tsx). Only
        // affects the OS splash screen/task switcher before the app itself
        // has painted with the user's actual chosen theme.
        theme_color: "#000000",
        background_color: "#000000",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // API requests are deliberately NOT routed through Workbox here. A runtime
        // caching rule matches every HTTP method unless scoped, and the Cache API
        // throws on any attempt to cache.put() a non-GET request/response — which
        // surfaced to the page as a failed fetch() on every DELETE/PATCH/POST, even
        // though the request had already succeeded server-side. TanStack Query's
        // own IndexedDB persistence (see main.tsx) already covers instant-reopen
        // and offline resilience for API data, so there's no need for a second,
        // method-unsafe caching layer underneath it.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/index.html",
      },
    }),
  ],
  server: {
    proxy: {
      "/api": { target: "http://localhost:3099", changeOrigin: true },
    },
  },
});
