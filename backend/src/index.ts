import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./db/index.js";
import { registerAuth } from "./auth.js";
import { registerFoodRoutes } from "./routes/foods.js";
import { registerLogRoutes } from "./routes/logs.js";
import { registerRecipeRoutes } from "./routes/recipes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const STATIC_DIR = path.join(__dirname, "..", "public");
const DATA_DIR = process.env.DATA_DIR ?? path.join(__dirname, "..", "..", "data");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, "photos"), { recursive: true });

runMigrations();

const app = Fastify({ logger: true });

await registerAuth(app, DATA_DIR);

registerFoodRoutes(app);
registerLogRoutes(app);
registerRecipeRoutes(app);

app.register(fastifyStatic, {
  root: STATIC_DIR,
  index: "index.html",
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
