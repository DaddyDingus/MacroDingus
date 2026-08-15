import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, sqlite } from "../db/index.js";
import { stepDailyTotals, stepRecords, stepSyncState, stepsWebhookTokens } from "../db/schema.js";
import { householdDateString } from "../lib/householdDate.js";

export const STEPS_PAYLOAD_CONTRACT = "health-connect-webhook/v1.9.14-md2";
const SUPPORTED_APP_VERSION = "1.9.14-md2";
const ACCEPTED_APP_VERSIONS = [SUPPORTED_APP_VERSION, "1.9.14-md1"] as const;
const MAX_RECORDS = 1_000;
const MAX_STEPS_PER_INTERVAL = 200_000;
const MAX_INTERVAL_MS = 48 * 60 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const EARLIEST_ACCEPTED_MS = Date.parse("2015-01-01T00:00:00Z");

const metadataSchema = z.object({
  data_origin: z.string().trim().min(1).max(200).optional(),
  recording_method: z.string().trim().max(80).optional(),
  device: z.object({
    manufacturer: z.string().max(120).optional(),
    model: z.string().max(120).optional(),
    type: z.number().int().optional(),
  }).strict().optional(),
}).strict();

const stepSchema = z.object({
  count: z.number().int().min(0).max(MAX_STEPS_PER_INTERVAL),
  start_time: z.string().datetime({ offset: true }),
  end_time: z.string().datetime({ offset: true }),
  // Present in the released source even though v1.9.14's field table only
  // documents count/start/end. It is provenance only and never health data.
  metadata: metadataSchema.optional(),
}).strict();

const payloadSchema = z.object({
  timestamp: z.string().datetime({ offset: true }),
  // md1 remains accepted during the in-place bridge upgrade. md2 changes
  // only how the phone obtains today's aggregate; its payload shape is the same.
  app_version: z.enum(ACCEPTED_APP_VERSIONS),
  // Health Connect Webhook's built-in Test Webhook action adds this marker.
  // It is not health data; test payloads are validated but never persisted.
  test: z.literal(true).optional(),
  steps: z.array(stepSchema).max(MAX_RECORDS).optional(),
}).strict();

const tokenInput = z.object({ name: z.string().trim().min(1).max(60) });
const historyQuery = z.object({ days: z.coerce.number().int().min(1).max(3650).default(3650) });

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function addDays(date: string, amount: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

// Brisbane has no daylight-saving transition. Keeping the conversion here
// explicit also makes webhook bucketing independent of the server/container
// timezone. All API dates remain the app's normal YYYY-MM-DD household dates.
const BRISBANE_OFFSET_MS = 10 * 60 * 60 * 1_000;
function brisbaneDayStart(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day) - BRISBANE_OFFSET_MS;
}

function brisbaneDate(ms: number): string {
  return new Date(ms + BRISBANE_OFFSET_MS).toISOString().slice(0, 10);
}

function isDailyResolutionInterval(startMs: number, endMs: number): boolean {
  const date = brisbaneDate(startMs);
  return startMs === brisbaneDayStart(date) && endMs <= brisbaneDayStart(addDays(date, 1));
}

function sourceKey(step: z.infer<typeof stepSchema>): string {
  const startMs = Date.parse(step.start_time);
  const endMs = Date.parse(step.end_time);
  if (isDailyResolutionInterval(startMs, endMs)) return `daily:${brisbaneDate(startMs)}`;
  const origin = step.metadata?.data_origin ?? "unknown";
  return `interval:${crypto.createHash("sha256").update(`${origin}\0${step.start_time}\0${step.end_time}`).digest("hex")}`;
}

function validateInterval(step: z.infer<typeof stepSchema>, nowMs: number): string | null {
  const startMs = Date.parse(step.start_time);
  const endMs = Date.parse(step.end_time);
  if (startMs < EARLIEST_ACCEPTED_MS || endMs > nowMs + MAX_CLOCK_SKEW_MS) return "A step timestamp is outside the accepted range";
  if (endMs <= startMs || endMs - startMs > MAX_INTERVAL_MS) return "A step interval is invalid";
  const minutes = Math.max((endMs - startMs) / 60_000, 1);
  if (step.count / minutes > 400) return "A step count is not plausible for its interval";
  return null;
}

interface StoredRecord {
  count: number;
  startTime: string;
  endTime: string;
}

function splitAcrossBrisbaneDays(record: StoredRecord): { date: string; steps: number; complete: boolean }[] {
  const startMs = Date.parse(record.startTime);
  const endMs = Date.parse(record.endTime);
  const duration = endMs - startMs;
  const pieces: { date: string; exact: number; complete: boolean }[] = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const date = brisbaneDate(cursor);
    const nextDay = brisbaneDayStart(addDays(date, 1));
    const pieceEnd = Math.min(endMs, nextDay);
    pieces.push({
      date,
      exact: record.count * ((pieceEnd - cursor) / duration),
      complete: startMs <= brisbaneDayStart(date) && endMs >= nextDay,
    });
    cursor = pieceEnd;
  }
  // Largest-remainder allocation preserves the source interval's exact count.
  const floors = pieces.map((piece) => Math.floor(piece.exact));
  let remaining = record.count - floors.reduce((sum, count) => sum + count, 0);
  const order = pieces.map((piece, index) => ({ index, remainder: piece.exact - floors[index] }))
    .sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; i < remaining; i++) floors[order[i % order.length].index]++;
  return pieces.map((piece, index) => ({ date: piece.date, steps: floors[index], complete: piece.complete }));
}

function rebuildDailyTotals(userId: string, receivedAt: string): void {
  const records = sqlite.prepare(
    "SELECT count, start_time AS startTime, end_time AS endTime FROM step_records WHERE user_id = ?",
  ).all(userId) as StoredRecord[];
  const totals = new Map<string, { steps: number; complete: boolean }>();
  for (const record of records) {
    for (const piece of splitAcrossBrisbaneDays(record)) {
      const current = totals.get(piece.date) ?? { steps: 0, complete: false };
      current.steps += piece.steps;
      current.complete ||= piece.complete;
      totals.set(piece.date, current);
    }
  }
  sqlite.prepare("DELETE FROM step_daily_totals WHERE user_id = ?").run(userId);
  const insert = sqlite.prepare(
    "INSERT INTO step_daily_totals (id, user_id, date, steps, complete, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (const [date, total] of totals) {
    insert.run(crypto.randomUUID(), userId, date, total.steps, total.complete ? 1 : 0, receivedAt);
  }
}

function authorizationToken(header: string | string[] | undefined): string | null {
  if (typeof header !== "string") return null;
  const match = header.match(/^Bearer\s+(mt_steps_[A-Za-z0-9_-]{32,})$/i);
  return match?.[1] ?? null;
}

export function registerStepRoutes(app: FastifyInstance) {
  app.post("/api/steps/webhook", { bodyLimit: 256 * 1024 }, async (req, reply) => {
    const presented = authorizationToken(req.headers.authorization);
    if (!presented) return reply.code(401).send({ error: "A valid steps webhook token is required" });
    const [credential] = await db.select().from(stepsWebhookTokens).where(and(
      eq(stepsWebhookTokens.tokenHash, tokenHash(presented)),
      isNull(stepsWebhookTokens.revokedAt),
    ));
    if (!credential) return reply.code(401).send({ error: "A valid steps webhook token is required" });

    const parsed = payloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: `Payload must match ${STEPS_PAYLOAD_CONTRACT} and contain only Steps`,
      });
    }
    const now = new Date();
    const payloadMs = Date.parse(parsed.data.timestamp);
    if (payloadMs < EARLIEST_ACCEPTED_MS || payloadMs > now.getTime() + MAX_CLOCK_SKEW_MS) {
      return reply.code(400).send({ error: "Payload timestamp is outside the accepted range" });
    }
    for (const step of parsed.data.steps ?? []) {
      const error = validateInterval(step, now.getTime());
      if (error) return reply.code(400).send({ error });
    }

    if (parsed.data.test === true) {
      return {
        ok: true,
        test: true,
        accepted: 0,
        contract: STEPS_PAYLOAD_CONTRACT,
      };
    }

    const receivedAt = now.toISOString();
    const upsertRecord = sqlite.prepare(`
      INSERT INTO step_records
        (id, user_id, source_key, source_app, count, start_time, end_time, payload_timestamp, app_version, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, source_key) DO UPDATE SET
        source_app = excluded.source_app,
        count = excluded.count,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        payload_timestamp = excluded.payload_timestamp,
        app_version = excluded.app_version,
        received_at = excluded.received_at
    `);
    const ingest = sqlite.transaction(() => {
      for (const step of parsed.data.steps ?? []) {
        upsertRecord.run(
          crypto.randomUUID(), credential.userId, sourceKey(step), step.metadata?.data_origin ?? null,
          step.count, step.start_time, step.end_time, parsed.data.timestamp, parsed.data.app_version, receivedAt,
        );
      }
      rebuildDailyTotals(credential.userId, receivedAt);
      const lastEnd = parsed.data.steps?.reduce<string | null>((latest, step) =>
        latest === null || step.end_time > latest ? step.end_time : latest, null) ?? null;
      sqlite.prepare(`
        INSERT INTO step_sync_state
          (user_id, last_successful_sync_at, last_payload_timestamp, last_app_version, last_record_end_at, last_record_count, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          last_successful_sync_at = excluded.last_successful_sync_at,
          last_payload_timestamp = excluded.last_payload_timestamp,
          last_app_version = excluded.last_app_version,
          last_record_end_at = COALESCE(excluded.last_record_end_at, step_sync_state.last_record_end_at),
          last_record_count = excluded.last_record_count,
          updated_at = excluded.updated_at
      `).run(credential.userId, receivedAt, parsed.data.timestamp, parsed.data.app_version, lastEnd, parsed.data.steps?.length ?? 0, receivedAt);
      sqlite.prepare("UPDATE steps_webhook_tokens SET last_used_at = ? WHERE id = ?").run(receivedAt, credential.id);
    });
    ingest();
    return { ok: true, accepted: parsed.data.steps?.length ?? 0, contract: STEPS_PAYLOAD_CONTRACT };
  });

  app.get("/api/steps", async (req, reply) => {
    const parsed = historyQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid history range" });
    const today = householdDateString();
    const start = addDays(today, -(parsed.data.days - 1));
    const rows = sqlite.prepare(`
      SELECT date, steps, complete, updated_at AS updatedAt
      FROM step_daily_totals WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date
    `).all(req.userId!, start, today) as { date: string; steps: number; complete: number; updatedAt: string }[];
    const byDate = new Map(rows.map((row) => [row.date, row]));
    const days: { date: string; steps: number | null; state: "missing" | "complete" | "partial"; updatedAt: string | null }[] = [];
    for (let date = start; date <= today; date = addDays(date, 1)) {
      const row = byDate.get(date);
      days.push(row
        ? { date, steps: row.steps, state: date === today || !row.complete ? "partial" : "complete", updatedAt: row.updatedAt }
        : { date, steps: null, state: "missing", updatedAt: null });
    }
    return { today, days };
  });

  app.get("/api/steps/status", async (req) => {
    const userId = req.userId!;
    const tokens = await db.select({
      id: stepsWebhookTokens.id,
      name: stepsWebhookTokens.name,
      tokenPrefix: stepsWebhookTokens.tokenPrefix,
      createdAt: stepsWebhookTokens.createdAt,
      lastUsedAt: stepsWebhookTokens.lastUsedAt,
      revokedAt: stepsWebhookTokens.revokedAt,
    }).from(stepsWebhookTokens).where(eq(stepsWebhookTokens.userId, userId)).orderBy(desc(stepsWebhookTokens.createdAt));
    const [sync] = await db.select().from(stepSyncState).where(eq(stepSyncState.userId, userId));
    return {
      contract: STEPS_PAYLOAD_CONTRACT,
      supportedAppVersion: SUPPORTED_APP_VERSION,
      webhookPath: "/api/steps/webhook",
      authorizationHeader: "Authorization: Bearer <token>",
      tokens,
      sync: sync ?? null,
    };
  });

  app.post("/api/steps/tokens", async (req, reply) => {
    const parsed = tokenInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Give this connection a name" });
    const raw = `mt_steps_${crypto.randomBytes(32).toString("base64url")}`;
    const now = new Date().toISOString();
    const row = {
      id: crypto.randomUUID(), userId: req.userId!, name: parsed.data.name,
      tokenHash: tokenHash(raw), tokenPrefix: `${raw.slice(0, 15)}…`, createdAt: now,
      lastUsedAt: null, revokedAt: null,
    };
    await db.insert(stepsWebhookTokens).values(row);
    return reply.code(201).send({
      id: row.id, name: row.name, token: raw, tokenPrefix: row.tokenPrefix, createdAt: row.createdAt,
    });
  });

  app.delete("/api/steps/tokens/:id", async (req, reply) => {
    const id = (req.params as { id?: string }).id;
    if (!id) return reply.code(404).send({ error: "Token not found" });
    const result = sqlite.prepare(
      "UPDATE steps_webhook_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
    ).run(new Date().toISOString(), id, req.userId!);
    if (!result.changes) return reply.code(404).send({ error: "Token not found" });
    reply.code(204);
    return null;
  });
}
