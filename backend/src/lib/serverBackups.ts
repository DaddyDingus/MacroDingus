import fs from "node:fs";
import path from "node:path";
import type { FastifyBaseLogger } from "fastify";
import { sqlite } from "../db/index.js";

const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETAIN_BACKUPS = 14;
const BACKUP_PREFIX = "macrotrack-";
const BACKUP_SUFFIX = ".sqlite";
const PHOTO_BACKUP_SUFFIX = ".photos";

let backupDir = "";
let photosDir = "";
let inFlight: Promise<ServerBackupStatus> | null = null;

export interface ServerBackupStatus {
  enabled: boolean;
  lastBackupAt: string | null;
  backupCount: number;
  automaticEveryHours: number;
}

function backupFiles(): string[] {
  if (!backupDir || !fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir)
    .filter((name) => name.startsWith(BACKUP_PREFIX) && name.endsWith(BACKUP_SUFFIX))
    .sort()
    .reverse();
}

export function serverBackupStatus(): ServerBackupStatus {
  const files = backupFiles();
  const newest = files[0];
  return {
    enabled: Boolean(backupDir),
    lastBackupAt: newest ? fs.statSync(path.join(backupDir, newest)).mtime.toISOString() : null,
    backupCount: files.length,
    automaticEveryHours: BACKUP_INTERVAL_MS / (60 * 60 * 1000),
  };
}

export async function createServerBackup(): Promise<ServerBackupStatus> {
  if (!backupDir) throw new Error("Server backups are not configured");
  if (inFlight) return inFlight;

  inFlight = (async () => {
    fs.mkdirSync(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const baseName = `${BACKUP_PREFIX}${timestamp}`;
    const databaseDestination = path.join(backupDir, `${baseName}${BACKUP_SUFFIX}`);
    const photoDestination = path.join(backupDir, `${baseName}${PHOTO_BACKUP_SUFFIX}`);
    try {
      await sqlite.backup(databaseDestination);
      // Progress photos are ordinary files rather than SQLite blobs. Keep a
      // companion photo tree beside every database snapshot so "server
      // backup" genuinely covers the user's complete progress history.
      if (fs.existsSync(photosDir)) {
        await fs.promises.cp(photosDir, photoDestination, { recursive: true });
      } else {
        await fs.promises.mkdir(photoDestination, { recursive: true });
      }
    } catch (err) {
      await fs.promises.rm(databaseDestination, { force: true });
      await fs.promises.rm(photoDestination, { recursive: true, force: true });
      throw err;
    }
    for (const oldName of backupFiles().slice(RETAIN_BACKUPS)) {
      await fs.promises.rm(path.join(backupDir, oldName), { force: true });
      const base = oldName.slice(0, -BACKUP_SUFFIX.length);
      await fs.promises.rm(path.join(backupDir, `${base}${PHOTO_BACKUP_SUFFIX}`), { recursive: true, force: true });
    }
    return serverBackupStatus();
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

export function startAutomaticServerBackups(dataDir: string, logger: FastifyBaseLogger): void {
  backupDir = path.join(dataDir, "backups");
  photosDir = path.join(dataDir, "photos");
  fs.mkdirSync(backupDir, { recursive: true });

  const run = () => {
    createServerBackup().catch((err) => logger.error({ err }, "automatic database backup failed"));
  };
  run();
  const timer = setInterval(run, BACKUP_INTERVAL_MS);
  timer.unref();
}
