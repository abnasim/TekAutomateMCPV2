/**
 * knowledgeRetrieveAll — cross-corpus unified retrieval.
 *
 * Invoked by knowledge{action:"retrieve"} when no `corpus` is passed (or
 * corpus:"all"). Fans out in parallel to every searchable corpus and
 * merges results with Reciprocal Rank Fusion (RRF).
 *
 * Why RRF: each corpus scores differently — tek_docs/scpi/failures/
 * templates use BM25 (arbitrary positive floats), videos and lessons
 * use stemmed token matching with simple relevance scores. RRF fuses
 * ranks not raw scores, so all sources contribute fairly without
 * per-corpus score normalization hacks. Standard k=60.
 *
 *   fused_score(hit) = Σ over sources it appears in:  1 / (k + rank_in_source)
 *
 * In practice each hit appears in one source, so it's just 1/(60 + rank).
 * Guarantees every source that returned ANY hits gets some representation
 * in the fused top-N (the rank-1 hit of each source is tied at ~0.01639).
 *
 * Output shape — single ranked `hits` list + `by_source` counts sidecar:
 *   {
 *     query, products?, hits: [ {source, rank, fusedScore, title, snippet, ...metadata} ],
 *     by_source: { tek_docs: n, videos: n, scpi: n, lessons: n, failures: n, templates: n },
 *     total, note
 *   }
 *
 * NOT included in the fan-out:
 *   - firmware — that's a lookup, not search. Use action:"firmware".
 *   - personality — config overlay, not retrievable knowledge.
 */

import { getTemplateExamples } from './getTemplateExamples';
import { retrieveLessons } from './lessons';
import { retrieveRagChunks } from './retrieveRagChunks';
import { searchKnownFailures } from './searchKnownFailures';
import { retrieveVideos } from './videos';
import type { ToolResult } from '../core/schemas';

const RRF_K = 60;

interface RetrieveAllInput {
  query?: unknown;
  products?: unknown;
  modelFamily?: unknown;
  tags?: unknown;
  topK?: unknown;
  perSourceCap?: unknown;
}

type HitSource = 'tek_docs' | 'videos' | 'scpi' | 'lessons' | 'failures' | 'templates';

interface UnifiedHit {
  source: HitSource;
  rank: number;
  fusedScore: number;
  title: string;
  snippet: string;
  [key: string]: unknown;
}

function snip(text: string | undefined | null, n = 280): string {
  if (!text) return '';
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed.length <= n ? trimmed : `${trimmed.slice(0, n - 1)}…`;
}

function rrfScore(rank: number): number {
  return 1 / (RRF_K + rank);
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string' && x.trim()).map((x) => String(x).trim());
  if (typeof v === 'string' && v.trim()) return v.split(/[,;\s]+/).filter(Boolean);
  return [];
}

function pickNumber(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

/**
 * Fan out to every searchable corpus, normalize each result into a
 * UnifiedHit, and fuse via RRF.
 */
export async function knowledgeRetrieveAll(input: RetrieveAllInput): Promise<ToolResult<unknown>> {
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (!query) {
    return {
      ok: false,
      data: { error: 'MISSING_QUERY', message: 'knowledge{action:"retrieve"} requires a `query` string.' },
      sourceMeta: [],
      warnings: ['Empty query'],
    };
  }

  const products = asStringArray(input.products);
  const modelFamily = typeof input.modelFamily === 'string' && input.modelFamily.trim()
    ? input.modelFamily.trim()
    : products[0];
  const tags = asStringArray(input.tags);
  const topK = pickNumber(input.topK, 15, 1, 50);
  const perSourceCap = pickNumber(input.perSourceCap, 5, 1, 15);
  // Retrieve a bit extra per source to give RRF room — fused top slice
  // then trims to topK overall.
  const perSourceFetch = Math.min(perSourceCap * 2, 20);

  // Parallel fan-out. Each retriever handles its own errors; we defend
  // against rejections at the Promise.allSettled layer so one flaky
  // corpus doesn't kill the whole response.
  const tasks = await Promise.allSettled([
    // tek_docs — primary source. BM25 + soft product-family scoring.
    retrieveRagChunks({ corpus: 'tek_docs', query, topK: perSourceFetch, modelFamily }),
    // videos — transcripts included in search hay (see videos.ts).
    retrieveVideos({ query, products, modelFamily, tags, limit: perSourceFetch }),
    // scpi — raw programmer-manual chunks; useful as grounding even
    // though tek_router is the preferred SCPI path for execution.
    retrieveRagChunks({ corpus: 'scpi', query, topK: perSourceCap, modelFamily }),
    // lessons — user-saved reference notes; filter by modelFamily.
    retrieveLessons({ query, modelFamily, tags, limit: perSourceCap }),
    // failures — known-error corpus.
    searchKnownFailures({ query, limit: perSourceCap }),
    // templates (workflow examples).
    getTemplateExamples({ query, limit: perSourceCap }),
  ]);

  const [tekDocsRes, videosRes, scpiRes, lessonsRes, failuresRes, templatesRes] = tasks;

  const hits: UnifiedHit[] = [];
  const bySource: Record<HitSource, number> = {
    tek_docs: 0,
    videos: 0,
    scpi: 0,
    lessons: 0,
    failures: 0,
    templates: 0,
  };
  const warnings: string[] = [];
  const sourceMetaOut: Array<Record<string, unknown>> = [];

  // ── tek_docs ────────────────────────────────────────────────────────
  if (tekDocsRes.status === 'fulfilled' && tekDocsRes.value.ok) {
    const chunks = Array.isArray(tekDocsRes.value.data) ? tekDocsRes.value.data : [];
    chunks.slice(0, perSourceCap).forEach((c: any, idx: number) => {
      const rank = idx + 1;
      hits.push({
        source: 'tek_docs',
        rank,
        fusedScore: rrfScore(rank),
        title: String(c.title || c.id || 'tek_docs chunk'),
        snippet: snip(c.body),
        id: c.id,
        tags: c.tags,
        url: c.source,
        pathHint: c.pathHint,
      });
      bySource.tek_docs++;
    });
    if (tekDocsRes.value.sourceMeta) sourceMetaOut.push(...tekDocsRes.value.sourceMeta.slice(0, perSourceCap));
  } else if (tekDocsRes.status === 'rejected') {
    warnings.push(`tek_docs corpus error: ${String(tekDocsRes.reason).slice(0, 120)}`);
  }

  // ── videos ──────────────────────────────────────────────────────────
  if (videosRes.status === 'fulfilled' && videosRes.value.ok) {
    const data = videosRes.value.data as any;
    const videos = Array.isArray(data?.videos) ? data.videos : [];
    videos.slice(0, perSourceCap).forEach((v: any, idx: number) => {
      const rank = idx + 1;
      // Prefer the transcript chunk that matched, then summary, then title.
      const snippet = v.matchedChunk?.text
        ? snip(v.matchedChunk.text)
        : snip(v.summary || v.title);
      hits.push({
        source: 'videos',
        rank,
        fusedScore: rrfScore(rank),
        title: String(v.title || 'video'),
        snippet,
        id: v.id,
        url: v.url,
        products: v.products,
        tags: v.tags,
        ...(v.youtubeId ? { youtubeId: v.youtubeId } : {}),
        ...(v.duration ? { duration: v.duration } : {}),
        ...(v.matchedChunk ? { transcriptTimestamp: v.matchedChunk.start } : {}),
        hasTranscript: !!v.hasTranscript,
      });
      bySource.videos++;
    });
  } else if (videosRes.status === 'rejected') {
    warnings.push(`videos corpus error: ${String(videosRes.reason).slice(0, 120)}`);
  }

  // ── scpi (raw chunks) ───────────────────────────────────────────────
  if (scpiRes.status === 'fulfilled' && scpiRes.value.ok) {
    const chunks = Array.isArray(scpiRes.value.data) ? scpiRes.value.data : [];
    chunks.slice(0, perSourceCap).forEach((c: any, idx: number) => {
      const rank = idx + 1;
      hits.push({
        source: 'scpi',
        rank,
        fusedScore: rrfScore(rank),
        title: String(c.title || c.id || 'scpi chunk'),
        snippet: snip(c.body),
        id: c.id,
        tags: c.tags,
        url: c.source,
        pathHint: c.pathHint,
        _hint: 'For SCPI execution/syntax, prefer tek_router{search} — this chunk is grounding context only.',
      });
      bySource.scpi++;
    });
  } else if (scpiRes.status === 'rejected') {
    warnings.push(`scpi corpus error: ${String(scpiRes.reason).slice(0, 120)}`);
  }

  // ── lessons ─────────────────────────────────────────────────────────
  if (lessonsRes.status === 'fulfilled' && lessonsRes.value.ok) {
    const data = lessonsRes.value.data as any;
    const lessons = Array.isArray(data?.lessons) ? data.lessons : [];
    lessons.slice(0, perSourceCap).forEach((l: any, idx: number) => {
      const rank = idx + 1;
      const snippet = snip([l.observation, l.implication].filter(Boolean).join(' → '));
      hits.push({
        source: 'lessons',
        rank,
        fusedScore: rrfScore(rank),
        title: String(l.lesson || 'lesson'),
        snippet,
        id: l.id,
        tags: l.tags,
        modelFamily: l.modelFamily,
        scpiContext: l.scpiContext,
        createdAt: l.createdAt,
      });
      bySource.lessons++;
    });
  } else if (lessonsRes.status === 'rejected') {
    warnings.push(`lessons corpus error: ${String(lessonsRes.reason).slice(0, 120)}`);
  }

  // ── failures ────────────────────────────────────────────────────────
  if (failuresRes.status === 'fulfilled' && failuresRes.value.ok) {
    const failures = Array.isArray(failuresRes.value.data) ? failuresRes.value.data : [];
    failures.slice(0, perSourceCap).forEach((f: any, idx: number) => {
      const rank = idx + 1;
      hits.push({
        source: 'failures',
        rank,
        fusedScore: rrfScore(rank),
        title: String(f.title || f.id || 'failure'),
        snippet: snip([f.symptom, f.fix].filter(Boolean).join(' → ')),
        id: f.id,
        affected_files: f.affected_files,
      });
      bySource.failures++;
    });
  } else if (failuresRes.status === 'rejected') {
    warnings.push(`failures corpus error: ${String(failuresRes.reason).slice(0, 120)}`);
  }

  // ── templates ───────────────────────────────────────────────────────
  if (templatesRes.status === 'fulfilled' && templatesRes.value.ok) {
    const templates = Array.isArray(templatesRes.value.data) ? templatesRes.value.data : [];
    templates.slice(0, perSourceCap).forEach((t: any, idx: number) => {
      const rank = idx + 1;
      hits.push({
        source: 'templates',
        rank,
        fusedScore: rrfScore(rank),
        title: String(t.name || 'template'),
        snippet: snip(t.description),
        sourceFile: t.sourceFile,
        stepsCount: Array.isArray(t.steps) ? t.steps.length : undefined,
      });
      bySource.templates++;
    });
  } else if (templatesRes.status === 'rejected') {
    warnings.push(`templates corpus error: ${String(templatesRes.reason).slice(0, 120)}`);
  }

  // ── Fuse + slice ────────────────────────────────────────────────────
  hits.sort((a, b) => b.fusedScore - a.fusedScore);
  const fusedTop = hits.slice(0, topK);

  return {
    ok: true,
    data: {
      query,
      ...(products.length > 0 ? { products } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      hits: fusedTop,
      by_source: bySource,
      total: fusedTop.length,
      allHitsCount: hits.length,
      note:
        'Cross-corpus retrieval fused via Reciprocal Rank Fusion (k=60). Every source that returned results is represented; pass corpus:"<name>" to scope to one source (corpora: tek_docs, videos, scpi, lessons, errors, templates). firmware and personality actions are separate — use action:"firmware" / action:"personality".',
    },
    sourceMeta: sourceMetaOut,
    warnings,
  };
}
