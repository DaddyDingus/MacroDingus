import type { FastifyInstance } from "fastify";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { eq, and, desc, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { photos } from "../db/schema.js";
import { comparePhotos } from "../engine/photoCompare.js";
import { daysBetween } from "../engine/trendWeight.js";

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 82;

const compareInput = z.object({
  photoIdA: z.string().min(1),
  photoIdB: z.string().min(1),
});

const photoPose = z.enum(["front", "side", "back", "front_flexed", "side_flexed", "back_flexed"]);

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

    const poseField = data.fields.pose;
    const poseRaw = poseField && "value" in poseField ? String(poseField.value) : undefined;
    const parsedPose = photoPose.safeParse(poseRaw);
    const pose = parsedPose.success ? parsedPose.data : null;

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

    await db.insert(photos).values({ id, userId, date, filename, pose, createdAt: new Date().toISOString() });
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

  // Ad hoc, never cached/persisted — regenerated fresh on every tap, which
  // is fine at a few cents a month for a single-household deployment. Reads
  // the two already-stored, already-processed progress photos straight off
  // disk rather than re-uploading anything; the only new data sent to
  // Anthropic is the day-gap between them (see engine/photoCompare.ts for
  // why weight/scale numbers are deliberately withheld).
  app.post("/api/photos/compare", async (req, reply) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      reply.code(503);
      return { error: "Photo comparison isn't configured on this server yet" };
    }

    const parsed = compareInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { photoIdA, photoIdB } = parsed.data;

    const userId = req.userId!;
    const rows = await db.select().from(photos).where(and(eq(photos.userId, userId), inArray(photos.id, [photoIdA, photoIdB])));
    const photoA = rows.find((p) => p.id === photoIdA);
    const photoB = rows.find((p) => p.id === photoIdB);
    if (!photoA || !photoB) return reply.code(404).send({ error: "Photo not found" });

    try {
      const [bufferA, bufferB] = await Promise.all([
        fs.promises.readFile(path.join(photosDir, photoA.userId, photoA.filename)),
        fs.promises.readFile(path.join(photosDir, photoB.userId, photoB.filename)),
      ]);
      // photoA/photoB are whichever order the client stored as "before"/
      // "after" (PhotoCompareScreen's left/right) — daysBetween's sign only
      // matters for the magnitude the prompt quotes, so this always passes
      // the earlier date first regardless of which side of the UI it came from.
      const [earlier, later] = photoA.date <= photoB.date ? [photoA, photoB] : [photoB, photoA];
      const [earlierBuffer, laterBuffer] = photoA.date <= photoB.date ? [bufferA, bufferB] : [bufferB, bufferA];
      const result = await comparePhotos(
        { buffer: earlierBuffer, mediaType: "image/jpeg" },
        { buffer: laterBuffer, mediaType: "image/jpeg" },
        Math.abs(daysBetween(earlier.date, later.date))
      );
      return result;
    } catch (err) {
      req.log.error(err);
      reply.code(502);
      return { error: err instanceof Error ? err.message : "Couldn't compare those photos" };
    }
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
