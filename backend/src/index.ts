import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const STATIC_DIR = path.join(__dirname, "..", "public");

const app = Fastify({ logger: true });

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
