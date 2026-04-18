/**
 * Lessons Learned store.
 *
 * NOT shortcuts. NOT executable. A lesson is structured reference material
 * the AI can search and read when researching a problem — it never
 * auto-triggers, never takes precedence in routing, never dispatches a
 * command on its own.
 *
 * Persisted to <projectRoot>/data/lessons.json as a flat array. Atomic
 * writes (write to .tmp, rename) so concurrent saves don't corrupt the
 * file. Read on every call — no in-process cache — to keep behavior
 * predictable across multiple mcp-server instances that share a volume.
 *
 * Shape per entry:
 *   {
 *     id, lesson, observation, implication,
 *     tags[], modelFamily?, scpiContext[]?, createdAt
 *   }
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ToolResult } from '../core/schemas';

const _projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LESSONS_PATH = path.join(_projectRoot, 'data', 'lessons.json');

// ─── Types ──────────────────────────────────────────────────────────────

export interface LessonEntry {
  id: string;
  lesson: string;
  observation: string;
  implication: string;
  tags: string[];
  modelFamily?: string;
  scpiContext?: string[];
  createdAt: string;
}

interface SaveLessonInput {
  lesson?: unknown;
  observation?: unknown;
  implication?: unknown;
  tags?: unknown;
  modelFamily?: unknown;
  scpiContext?: unknown;
}

interface RetrieveLessonsInput {
  query?: unknown;
  tags?: unknown;
  modelFamily?: unknown;
  limit?: unknown;
  topK?: unknown; // alias for limit (agents familiar with knowledge{retrieve} use topK)
}

// ─── Persistence ────────────────────────────────────────────────────────

function readLessonsFromDisk(): LessonEntry[] {
  try {
    const raw = fs.readFileSync(LESSONS_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is LessonEntry =>
        e && typeof e === 'object' &&
        typeof e.id === 'string' &&
        typeof e.lesson === 'string' &&
        typeof e.observation === 'string' &&
        typeof e.implication === 'string',
    );
  } catch {
    return [];
  }
}

function writeLessonsToDisk(entries: LessonEntry[]): void {
  const dir = path.dirname(LESSONS_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${LESSONS_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), 'utf-8');
  fs.renameSync(tmp, LESSONS_PATH);
}

// ─── Validation / normalisation ─────────────────────────────────────────

const MAX_LESSON = 300;
const MAX_OBSERVATION = 1200;
const MAX_IMPLICATION = 1200;
const MAX_TAGS = 12;
const MAX_TAG_LEN = 48;
const MAX_SCPI_CONTEXT = 20;

function normStr(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

function normStrArray(v: unknown, maxItems: number, maxItemLen: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    if (typeof raw !== 'string') continue;
    const t = raw.trim();
    if (!t) continue;
    const clipped = t.length > maxItemLen ? t.slice(0, maxItemLen) : t;
    const key = clipped.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clipped);
    if (out.length >= maxItems) break;
  }
  return out;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'lesson';
}

// ─── Public API ─────────────────────────────────────────────────────────

export async function saveLesson(input: SaveLessonInput): Promise<ToolResult<unknown>> {
  const lesson = normStr(input.lesson, MAX_LESSON);
  const observation = normStr(input.observation, MAX_OBSERVATION);
  const implication = normStr(input.implication, MAX_IMPLICATION);

  const missing: string[] = [];
  if (!lesson) missing.push('lesson');
  if (!observation) missing.push('observation');
  if (!implication) missing.push('implication');
  if (missing.length) {
    return {
      ok: false,
      data: {
        error: 'MISSING_FIELDS',
        message: `A lesson requires non-empty: ${missing.join(', ')}. These are the Lesson / Observation / Implication triple — all three are required.`,
        missing,
      },
      sourceMeta: [],
      warnings: [`Lesson save rejected: missing ${missing.join(', ')}`],
    };
  }

  const tags = normStrArray(input.tags, MAX_TAGS, MAX_TAG_LEN);
  const scpiContext = normStrArray(input.scpiContext, MAX_SCPI_CONTEXT, 80);
  const modelFamilyRaw = normStr(input.modelFamily, 40);
  const modelFamily = modelFamilyRaw ? modelFamilyRaw : undefined;

  const now = new Date().toISOString();
  const id = `lesson:${slugify(lesson!)}_${Date.now()}`;

  const entry: LessonEntry = {
    id,
    lesson: lesson!,
    observation: observation!,
    implication: implication!,
    tags,
    ...(modelFamily ? { modelFamily } : {}),
    ...(scpiContext.length ? { scpiContext } : {}),
    createdAt: now,
  };

  const existing = readLessonsFromDisk();
  existing.push(entry);
  writeLessonsToDisk(existing);

  return {
    ok: true,
    data: {
      id,
      persisted: true,
      totalLessons: existing.length,
      entry,
      _hint: 'Lesson saved as reference material. It will NOT auto-trigger on user queries. Retrieve later via knowledge{retrieve, corpus:"lessons", query or tags}, or it will surface as a side-channel in tek_router{search} results when tags match.',
    },
    sourceMeta: [{ file: LESSONS_PATH }],
    warnings: [],
  };
}

// Lenient token normalisation for retrieval matching. Lowercases, strips
// non-alphanumerics (so "arg-names", "arg_names", "arg names" collapse),
// and strips trailing "s"/"es" plurals when the stem is ≥3 chars (so
// "masks"→"mask", "tolerances"→"tolerance", but "bus"→"bus"). Intended
// to make search forgiving without turning it into a semantic model.
function stemToken(raw: string): string {
  let t = raw.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (t.length > 4 && t.endsWith('es')) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith('s')) t = t.slice(0, -1);
  return t;
}

function buildStemSet(strings: string[]): Set<string> {
  const out = new Set<string>();
  for (const s of strings) {
    for (const part of s.toLowerCase().split(/[\s,]+/)) {
      const stem = stemToken(part);
      if (stem.length >= 2) out.add(stem);
    }
  }
  return out;
}

// Token-level fuzzy match: lesson matches if every query token (stemmed)
// appears as a substring in the stemmed haystack of the entry's text
// fields. Predictable, no ranking magic, no semantic model.
function matchesTokens(entry: LessonEntry, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const hay = stemToken([
    entry.lesson,
    entry.observation,
    entry.implication,
    entry.tags.join(' '),
    entry.modelFamily || '',
    (entry.scpiContext || []).join(' '),
  ].join(' '));
  return tokens.every((t) => {
    const stem = stemToken(t);
    return stem.length > 0 && hay.includes(stem);
  });
}

// Tag match: each required tag matches if its stem equals or is a
// substring match against any of the entry's tag stems. Handles plural
// ("masks" matches ["mask"]), hyphen/underscore variants, and casing.
function matchesTags(entry: LessonEntry, requiredTags: string[]): boolean {
  if (requiredTags.length === 0) return true;
  const entryStems = buildStemSet(entry.tags);
  return requiredTags.every((rt) => {
    const want = stemToken(rt);
    if (!want) return false;
    if (entryStems.has(want)) return true;
    // fall back to substring match so "trig" matches "trigger"
    for (const es of entryStems) {
      if (es.includes(want) || want.includes(es)) return true;
    }
    return false;
  });
}

function matchesModelFamily(entry: LessonEntry, want: string): boolean {
  if (!want) return true;
  if (!entry.modelFamily) return true; // scope-neutral lessons always pass family filter
  return entry.modelFamily.toLowerCase() === want.toLowerCase();
}

export async function retrieveLessons(input: RetrieveLessonsInput): Promise<ToolResult<unknown>> {
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  const tagsFilter = normStrArray(input.tags, MAX_TAGS, MAX_TAG_LEN);
  const modelFamily = typeof input.modelFamily === 'string' ? input.modelFamily.trim() : '';
  // Accept either "limit" (native) or "topK" (alias — agents familiar with
  // knowledge{retrieve} reach for topK. Silently rejecting their param is
  // the same class of silent-fallback trap as the waveform channel/source
  // mismatch — accept both, document the canonical name).
  const rawLimit = Number(input.limit ?? input.topK);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 50) : 10;

  const tokens = query
    ? query.split(/\s+/).filter((t) => t.length >= 2)
    : [];

  const all = readLessonsFromDisk();
  const matches = all
    .filter((e) => matchesTokens(e, tokens))
    .filter((e) => matchesTags(e, tagsFilter))
    .filter((e) => matchesModelFamily(e, modelFamily))
    // Newest first
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit);

  return {
    ok: true,
    data: {
      count: matches.length,
      totalLessons: all.length,
      lessons: matches,
      _hint: 'These are REFERENCE NOTES, not executable shortcuts. Read them and apply the guidance to your reasoning — do not try to dispatch them as tools.',
    },
    sourceMeta: [{ file: LESSONS_PATH }],
    warnings: [],
  };
}

// Synchronous helper for the tek_router{search} side-channel. No I/O error
// throws — returns [] on any failure. Uses the same stemmed matching as
// retrieveLessons so plural/hyphen/case variants still hit.
export function findMatchingLessonsSync(query: string, limit: number = 3): LessonEntry[] {
  try {
    const tokens = (query || '')
      .split(/\s+/)
      .filter((t) => t.length >= 2);
    if (tokens.length === 0) return [];
    const all = readLessonsFromDisk();
    return all
      .filter((e) => matchesTokens(e, tokens))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, Math.max(1, Math.min(limit, 10)));
  } catch {
    return [];
  }
}
