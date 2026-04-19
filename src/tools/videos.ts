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
  youtube_id?: string;
  youtubeId?: string;
  transcript_chunks?: Array<{ start?: number; end?: number; t?: number; text: string }>;
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
    // Include the full transcript text so queries about topics only
    // mentioned inside a video (and not in its curated summary) still
    // surface the video. 1.3M chars of transcript text would be wasted
    // otherwise.
    (entry.transcript_chunks || []).map((c) => c.text || '').join(' '),
  ].join(' '));
  return tokens.every((t) => {
    const stem = stemToken(t);
    return stem.length > 0 && hay.includes(stem);
  });
}

/**
 * Relevance score for ordering matched videos within a query.
 * Stronger signal from title matches, lighter from transcript, summary,
 * tags, products. Used to rank matches before the caller slices to limit.
 */
function relevanceScore(entry: VideoEntry, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const titleStem = stemToken(entry.title || '');
  const summaryStem = stemToken(entry.summary || '');
  const tagStem = stemToken((entry.tags || []).join(' '));
  const productStem = stemToken((entry.products || []).join(' '));
  const transcriptStem = stemToken((entry.transcript_chunks || []).map((c) => c.text || '').join(' '));
  let score = 0;
  for (const raw of tokens) {
    const stem = stemToken(raw);
    if (!stem) continue;
    if (titleStem.includes(stem)) score += 5;
    if (tagStem.includes(stem)) score += 3;
    if (productStem.includes(stem)) score += 2;
    if (summaryStem.includes(stem)) score += 2;
    if (transcriptStem.includes(stem)) score += 1;
  }
  return score;
}

/**
 * Find the single best transcript chunk to show as a snippet, given
 * the user's query tokens. Returns null if entry has no transcript or
 * no chunk matches. The "best" chunk is the one that contains the most
 * query stems, tie-broken by earliest in the video.
 */
function bestMatchingChunk(
  entry: VideoEntry,
  tokens: string[],
): { text: string; start?: number; end?: number } | null {
  const chunks = entry.transcript_chunks || [];
  if (chunks.length === 0 || tokens.length === 0) return null;
  const queryStems = tokens.map(stemToken).filter(Boolean);
  if (queryStems.length === 0) return null;
  let best: { index: number; hits: number } | null = null;
  for (let i = 0; i < chunks.length; i++) {
    const chunkStem = stemToken(chunks[i].text || '');
    let hits = 0;
    for (const q of queryStems) if (chunkStem.includes(q)) hits++;
    if (hits === 0) continue;
    if (!best || hits > best.hits) best = { index: i, hits };
  }
  if (!best) return null;
  // Stitch a small window around the best chunk for context — neighbors
  // on either side make the snippet readable ("...as I was saying..." vs
  // cold cut-ins).
  const startIdx = Math.max(0, best.index - 1);
  const endIdx = Math.min(chunks.length - 1, best.index + 1);
  const text = chunks
    .slice(startIdx, endIdx + 1)
    .map((c) => (c.text || '').trim())
    .filter(Boolean)
    .join(' ');
  return {
    text,
    start: chunks[best.index].start ?? chunks[best.index].t,
    end: chunks[best.index].end,
  };
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
  const matched = all
    .filter((v) => matchesTokens(v, tokens))
    .filter((v) => matchesTagFilter(v, tagsFilter))
    .filter((v) => matchesProductFilter(v, productsFilter))
    .filter((v) => matchesCategory(v, category));

  // Rank matches when there's a query; otherwise preserve storage order.
  const ranked = tokens.length > 0
    ? matched
        .map((v) => ({ v, score: relevanceScore(v, tokens) }))
        .sort((a, b) => b.score - a.score)
        .map((x) => x.v)
    : matched;

  const matches = ranked.slice(0, limit);

  return {
    ok: true,
    data: {
      count: matches.length,
      totalVideos: all.length,
      lastUpdated: store.lastUpdated,
      phase: store.phase,
      videos: matches.map((v) => {
        const chunk = tokens.length > 0 ? bestMatchingChunk(v, tokens) : null;
        const ytId = v.youtube_id || v.youtubeId;
        return {
          id: v.id,
          title: v.title,
          url: v.url,
          category: v.category,
          products: v.products,
          tags: v.tags,
          summary: v.summary,
          ...(v.duration ? { duration: v.duration } : {}),
          ...(ytId ? { youtubeId: ytId } : {}),
          hasTranscript: Array.isArray(v.transcript_chunks) && v.transcript_chunks.length > 0,
          ...(chunk ? { matchedChunk: chunk } : {}),
        };
      }),
      _hint:
        'URLs point to Tektronix video pages. When matchedChunk is present, that transcript excerpt was the query match; use it as context rather than fetching the full video. Do not treat video entries as executable.',
    },
    sourceMeta: [{ file: VIDEOS_PATH }],
    warnings: [],
  };
}
