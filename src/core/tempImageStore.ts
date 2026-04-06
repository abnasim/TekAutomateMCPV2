import crypto from 'crypto';

interface TempImageRecord {
  id: string;
  mimeType: string;
  buffer: Buffer;
  createdAt: string;
  expiresAt: number;
}

const tempImages = new Map<string, TempImageRecord>();
const DEFAULT_TTL_MS = 30_000;

function cleanupExpiredTempImages() {
  const now = Date.now();
  for (const [id, record] of tempImages.entries()) {
    if (record.expiresAt <= now) tempImages.delete(id);
  }
}

setInterval(cleanupExpiredTempImages, 5_000).unref?.();

export function storeTempVisionImage(input: {
  buffer: Buffer;
  mimeType: string;
  createdAt?: string;
  ttlMs?: number;
}): { id: string; path: string; expiresAt: string } {
  cleanupExpiredTempImages();
  const id = crypto.randomBytes(12).toString('hex');
  const ttlMs = Math.max(5_000, Math.min(input.ttlMs ?? DEFAULT_TTL_MS, 300_000));
  const expiresAt = Date.now() + ttlMs;
  tempImages.set(id, {
    id,
    mimeType: input.mimeType,
    buffer: input.buffer,
    createdAt: input.createdAt || new Date().toISOString(),
    expiresAt,
  });
  return {
    id,
    path: `/temp/vision/${encodeURIComponent(id)}`,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export function getTempVisionImage(id: string): TempImageRecord | null {
  cleanupExpiredTempImages();
  const record = tempImages.get(id);
  if (!record) return null;
  if (record.expiresAt <= Date.now()) {
    tempImages.delete(id);
    return null;
  }
  return record;
}
