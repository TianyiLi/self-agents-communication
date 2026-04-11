import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { RedisService } from "./redis";

const MEDIA_DIR = process.env.MEDIA_DIR || "/tmp/agent-media";
const MEDIA_TTL_SECONDS = 3600; // 1 hour

export interface MediaDescriptor {
  id: string;
  filename: string;
  mime: string;
}

export interface MediaRecord {
  path: string;
  filename: string;
  mime: string;
}

/** Guard against path traversal — only accept hex UUIDs (with dashes). */
export function isValidMediaId(id: string): boolean {
  return /^[a-f0-9-]{36}$/.test(id);
}

/** Ensure the media directory exists. */
export async function ensureMediaDir(): Promise<string> {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  return MEDIA_DIR;
}

/** Save a downloaded file buffer to disk and register it in Redis. */
export async function saveMedia(
  redis: RedisService,
  buffer: Buffer,
  filename: string,
  mime: string
): Promise<MediaDescriptor> {
  await ensureMediaDir();

  const id = randomUUID();
  const ext = path.extname(filename) || extFromMime(mime) || ".bin";
  const safeId = id; // uuid is already safe
  const filePath = path.join(MEDIA_DIR, `${safeId}${ext}`);

  await fs.writeFile(filePath, buffer);

  const record: MediaRecord = {
    path: filePath,
    filename,
    mime,
  };
  await redis.set(`media:${id}`, JSON.stringify(record), MEDIA_TTL_SECONDS);

  return { id, filename, mime };
}

/** Look up a media record by id. Returns null if missing or expired. */
export async function getMedia(
  redis: RedisService,
  id: string
): Promise<MediaRecord | null> {
  if (!isValidMediaId(id)) return null;
  const raw = await redis.get(`media:${id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MediaRecord;
  } catch {
    return null;
  }
}

/** Scan the media directory and delete files older than maxAgeMs. */
export async function cleanupStaleFiles(maxAgeMs: number = 3600 * 1000): Promise<number> {
  try {
    await ensureMediaDir();
    const entries = await fs.readdir(MEDIA_DIR);
    const now = Date.now();
    let deleted = 0;
    for (const name of entries) {
      const full = path.join(MEDIA_DIR, name);
      try {
        const stat = await fs.stat(full);
        if (now - stat.mtimeMs > maxAgeMs) {
          await fs.unlink(full);
          deleted++;
        }
      } catch {
        // File may have been deleted in parallel
      }
    }
    return deleted;
  } catch {
    return 0;
  }
}

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
  };
  return map[mime] || "";
}

export { MEDIA_DIR, MEDIA_TTL_SECONDS };
