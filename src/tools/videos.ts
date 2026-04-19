/**
 * videos — lookup of curated Tektronix instructional videos.
 *
 * Reads <projectRoot>/data/videos.json (see data/videos.json for schema
 * + update procedure). Serves reference metadata — title, URL, product
 * family, tags, summary. Transcript content is reserved for a future
 * phase; callers fetch the URL directly for the full video.
 *
 * Exposed via knowledge{action:"retrieve", corpus:"videos"}.
 *
 * Retrieval uses the same stemmed / case-insensitive / plural-aware
 * matching as the Lessons corpus (masks → mask, tolerances → tolerance,
 * etc.), so query phrasing doesn't have to match the curated tags exactly.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ToolResult } from '../core/schemas';

const _projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VIDEOS_PATH = path.join(_projectRoot, 'data', 'videos.json');

interface VideoEntry {
  id: string;
  title: string;
  url: string;
  category?: string;
  products?: string[];
  tags?: string[];
  summary?: string;
  duration?: string;
  youtubeId?: string;
  transcript_chunks?: Array<{ t?: number; text: string }>;
}

interface VideosStore {
  $schema?: string;
  note?: string;
  lastUpdated?: string;
  phase?: string;
  videos: VideoEntry[];
}

interface RetrieveVideosInput {
  query?: unknown;
  tags?: unknown;
  products?: unknown;
  modelFamily?: unknown;
  category?: unknown;
  limit?: unknown;
  topK?: unknown;
}

function readStore(): VideosStore | null {
  try {
    const raw = fs.readFileSync(VIDEOS_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.videos)) return parsed as VideosStore;
    return null;
  } catch {
    return null;
  }
}

// Same lenient token-stem approach used by lessons.ts. Lowercase, strip
// non-alphanumerics, drop trailing s/es when the stem is ≥3 chars. Keeps
// "masks" → "mask", "tolerances" → "tolerance", but "bus" stays "bus".
function stemToken(raw: string): string {
  let t = raw.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (t.length > 4 && t.endsWith('es')) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith('s')) t = t.slice(0, -1);
  return t;
}

function normStrArray(v: unknown, maxItems: number): string[] {
  if (!Array.isArray(v)) {
    if (typeof v === 'string') {
      return v.split(/[,;\s]+/).filter(Boolean).slice(0, maxItems);
    }
    return [];
  }
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string') continue;
    const t = x.trim();
    if (t) out.push(t);
    if (out.length >= maxItems) break;
  }
  return out;
}

function matchesTokens(entry: VideoEntry, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const hay = stemToken([
    entry.title,
    entry.summary || '',
    (entry.tags || []).join(' '),
    (entry.products || []).join(' '),
    entry.category || '',
  ].join(' '));
  return tokens.every((t) => {
    const stem = stemToken(t);
    return stem.length > 0 && hay.includes(stem);
  });
}

function matchesTagFilter(entry: VideoEntry, required: string[]): boolean {
  if (required.length === 0) return true;
  const entryStems = new Set((entry.tags || []).map(stemToken).filter(Boolean));
  return required.every((r) => {
    const want = stemToken(r);
    if (!want) return false;
    if (entryStems.has(want)) return true;
    for (const es of entryStems) {
      if (es.includes(want) || want.includes(es)) return true;
    }
    return false;
  });
}

function matchesProductFilter(entry: VideoEntry, required: string[]): boolean {
  if (required.length === 0) return true;
  const entryStems = new Set((entry.products || []).map(stemToken).filter(Boolean));
  return required.some((r) => {
    const want = stemToken(r);
    if (!want) return false;
    if (entryStems.has(want)) return true;
    for (const es of entryStems) {
      if (es.includes(want) || want.includes(es)) return true;
    }
    return false;
  });
}

function matchesCategory(entry: VideoEntry, want: string): boolean {
  if (!want) return true;
  return (entry.category || '').toLowerCase() === want.toLowerCase();
}

export async function retrieveVideos(input: RetrieveVideosInput): Promise<ToolResult<unknown>> {
  const store = readStore();
  if (!store) {
    return {
      ok: false,
      data: {
        error: 'STORE_UNAVAILABLE',
        message: `Videos index not found at ${VIDEOS_PATH}. Deploy may be incomplete, or the index has not been populated yet.`,
      },
      sourceMeta: [],
      warnings: ['videos.json missing'],
    };
  }

  const query = typeof input.query === 'string' ? input.query.trim() : '';
  const tagsFilter = normStrArray(input.tags, 12);
  const productsInput = input.products ?? input.modelFamily;
  const productsFilter = normStrArray(productsInput, 8);
  const category = typeof input.category === 'string' ? input.category.trim() : '';
  const rawLimit = Number(input.limit ?? input.topK);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 50) : 10;

  const tokens = query ? query.split(/\s+/).filter((t) => t.length >= 2) : [];

  const all = store.videos;
  const matches = all
    .filter((v) => matchesTokens(v, tokens))
    .filter((v) => matchesTagFilter(v, tagsFilter))
    .filter((v) => matchesProductFilter(v, productsFilter))
    .filter((v) => matchesCategory(v, category))
    .slice(0, limit);

  return {
    ok: true,
    data: {
      count: matches.length,
      totalVideos: all.length,
      lastUpdated: store.lastUpdated,
      phase: store.phase,
      videos: matches.map((v) => ({
        id: v.id,
        title: v.title,
        url: v.url,
        category: v.category,
        products: v.products,
        tags: v.tags,
        summary: v.summary,
        ...(v.duration ? { duration: v.duration } : {}),
        ...(v.youtubeId ? { youtubeId: v.youtubeId } : {}),
        hasTranscript: Array.isArray(v.transcript_chunks) && v.transcript_chunks.length > 0,
      })),
      _hint: 'Reference material — URLs point to Tektronix video pages. Transcripts are NOT yet populated in the index; fetch the URL directly for the full video. Do not treat video entries as executable.',
    },
    sourceMeta: [{ file: VIDEOS_PATH }],
    warnings: [],
  };
}
