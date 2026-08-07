import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import fastifyRateLimit from "@fastify/rate-limit";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./db/index.js";
import { registerAuth } from "./auth.js";
import { registerFoodRoutes } from "./routes/foods.js";
import { registerLogRoutes } from "./routes/logs.js";
import { registerRecipeRoutes } from "./routes/recipes.js";
import { registerWeightRoutes } from "./routes/weights.js";
import { registerCoachRoutes } from "./routes/coach.js";
import { registerGoalRoutes } from "./routes/goals.js";
import { registerProgramRoutes } from "./routes/programs.js";
import { registerPhotoRoutes } from "./routes/photos.js";
import { registerMeasurementRoutes } from "./routes/measurements.js";
import { registerFavoriteRoutes } from "./routes/favorites.js";
import { registerAccountRoutes } from "./routes/account.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerCookwareRoutes } from "./routes/cookware.js";
import { configureAnthropicKeyStore } from "./engine/anthropicClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const STATIC_DIR = path.join(__dirname, "..", "public");
const DATA_DIR = process.env.DATA_DIR ?? path.join(__dirname, "..", "..", "data");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, "photos"), { recursive: true });
configureAnthropicKeyStore(DATA_DIR);

runMigrations();

// Behind a reverse proxy every request arrives from the proxy's address. Without
// trustProxy the rate limiter below buckets ALL traffic under that one address,
// so a single hostile client locks out everybody — the limiter would actively
// make things worse than having none. Only enable it when a proxy really is in
// front, since it makes X-Forwarded-For (client-controlled) authoritative.
const TRUST_PROXY = process.env.MACRODINGUS_TRUST_PROXY !== "false";

const app = Fastify({ logger: true, trustProxy: TRUST_PROXY });

// Global ceiling. Generous — this is a backstop against runaway clients and
// scrapers, not the login control; that is the much tighter per-route bucket
// in auth.ts. In-memory on purpose: a single-instance app does not need Redis,
// and a restart resetting the counters is an acceptable trade for one fewer
// moving part.
await app.register(fastifyRateLimit, {
  global: true,
  max: 300,
  timeWindow: "1 minute",
  // Health checks come from the container runtime on every interval and must
  // never be throttled, or a busy moment marks the container unhealthy.
  allowList: (req) => req.raw.url === "/api/health",
});

await registerAuth(app, DATA_DIR);
await app.register(fastifyMultipart, {
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB — generous for a phone camera photo
});

registerFoodRoutes(app);
registerLogRoutes(app);
registerRecipeRoutes(app);
registerWeightRoutes(app);
registerCoachRoutes(app);
registerGoalRoutes(app);
registerProgramRoutes(app);
registerPhotoRoutes(app, DATA_DIR);
registerMeasurementRoutes(app);
registerFavoriteRoutes(app);
registerAccountRoutes(app, DATA_DIR);
registerSettingsRoutes(app);
registerCookwareRoutes(app);

app.register(fastifyStatic, {
  root: STATIC_DIR,
  index: "index.html",
  // The service worker script and the HTML/manifest that bootstrap it must
  // always be revalidated, explicitly, rather than relying on @fastify/static's
  // default (`max-age=0`, which forces revalidation but doesn't rule out
  // caching layers that treat "revalidate" more loosely than "always refetch"
  // — e.g. a browser's own service-worker-update fetch, which by default
  // (`updateViaCache: 'imports'`) is still allowed to reuse HTTP cache rather
  // than genuinely go to the network). `no-cache` is the explicit, documented
  // Workbox-recommended header for exactly this file for that reason. This
  // alone may not have been the whole story behind needing several manual
  // refreshes (or a full close-and-reopen) to see a deploy take effect —
  // see the Dashboard's "Refresh app" button (lib/forceRefreshApp.ts) for the
  // deterministic manual fix regardless of root cause.
  setHeaders: (reply, filePath) => {
    const name = path.basename(filePath);
    if (name === "sw.js" || name === "registerSW.js" || name === "manifest.webmanifest" || name === "index.html") {
      reply.header("Cache-Control", "no-cache");
    }
  },
});

app.get("/api/health", async () => ({ ok: true, time: new Date().toISOString() }));

// SPA fallback: any non-/api route serves index.html so client-side routing works.
app.setNotFoundHandler((req, reply) => {
  if (req.raw.url?.startsWith("/api/")) {
    reply.code(404).send({ error: "not found" });
    return;
  }
  reply.sendFile("index.html");
});

app.listen({ port: PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
