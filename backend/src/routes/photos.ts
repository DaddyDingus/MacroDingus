import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { photos } from "../db/schema.js";

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 82;

export function registerPhotoRoutes(app: FastifyInstance, dataDir: string) {
  const photosDir = path.join(dataDir, "photos");

  app.get("/api/photos", async (req) => {
    return db.select().from(photos).where(eq(photos.userId, req.userId!)).orderBy(desc(photos.date));
  });

  app.post("/api/photos", async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: "No file uploaded" });

    const dateField = data.fields.date;
    const date = dateField && "value" in dateField ? String(dateField.value) : undefined;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.code(400).send({ error: "date is required (YYYY-MM-DD)" });
    }

    const buffer = await data.toBuffer();
    const userId = req.userId!;
    const id = randomUUID();
    const filename = `${id}.jpg`;
    const userDir = path.join(photosDir, userId);
    await fs.promises.mkdir(userDir, { recursive: true });

    // .rotate() with no args auto-orients from EXIF, then bakes that
    // orientation in. Deliberately NOT calling .withMetadata() — sharp's
    // default is to strip all other metadata (including GPS EXIF) from the
    // output, which is the right default for photos that get backed up
    // off this server.
    try {
      await sharp(buffer)
        .rotate()
        .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY })
        .toFile(path.join(userDir, filename));
    } catch (err) {
      req.log.error(err);
      reply.code(400);
      return { error: "Couldn't process that image" };
    }

    await db.insert(photos).values({ id, userId, date, filename, createdAt: new Date().toISOString() });
    const [photo] = await db.select().from(photos).where(eq(photos.id, id));
    reply.code(201);
    return photo;
  });

  app.get("/api/photos/:id/file", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [photo] = await db.select().from(photos).where(and(eq(photos.id, id), eq(photos.userId, req.userId!)));
    if (!photo) return reply.code(404).send({ error: "not found" });

    const filePath = path.join(photosDir, photo.userId, photo.filename);
    reply.type("image/jpeg");
    reply.header("Cache-Control", "private, max-age=31536000, immutable");
    return reply.send(fs.createReadStream(filePath));
  });

  app.delete("/api/photos/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [photo] = await db.select().from(photos).where(and(eq(photos.id, id), eq(photos.userId, req.userId!)));
    if (!photo) return reply.code(404).send({ error: "not found" });

    await db.delete(photos).where(eq(photos.id, id));
    await fs.promises.unlink(path.join(photosDir, photo.userId, photo.filename)).catch(() => {});
    reply.code(204);
    return null;
  });
}
