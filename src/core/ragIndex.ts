import { promises as fs } from 'fs';
import * as path from 'path';
import { Bm25Index } from './bm25';
import { resolveRagDir } from './paths';

export type RagCorpus =
  | 'scpi'
  | 'tmdevices'
  | 'app_logic'
  | 'scope_logic'
  | 'errors'
  | 'templates'
  | 'pyvisa_tekhsi';

export interface RagChunkDoc extends Record<string, unknown> {
  id: string;
  corpus: RagCorpus;
  title: string;
  body: string;
  tags?: string[];
  source?: string;
  pathHint?: string;
  text: string;
}

interface RagManifest {
  corpora?: Partial<Record<RagCorpus, string>>;
}

export class RagIndexes {
  private readonly byCorpus: Partial<Record<RagCorpus, Bm25Index<RagChunkDoc>>>;
  private readonly docsByCorpus: Partial<Record<RagCorpus, RagChunkDoc[]>>;

  constructor(
    byCorpus: Partial<Record<RagCorpus, Bm25Index<RagChunkDoc>>>,
    docsByCorpus: Partial<Record<RagCorpus, RagChunkDoc[]>>
  ) {
    this.byCorpus = byCorpus;
    this.docsByCorpus = docsByCorpus;
  }

  search(corpus: RagCorpus, query: string, topK = 5): RagChunkDoc[] {
    const docs = this.docsByCorpus[corpus] || [];
    const index = this.byCorpus[corpus];
    if (!index) return [];

    const normalizedQuery = normalizeRagText(query);
    const exactMatches = docs
      .map((doc) => ({ doc, score: scoreExactMatch(doc, normalizedQuery) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.doc);
    const bm25Matches = index.search(query, Math.max(topK * 4, 12)).map((s) => s.doc);

    const merged = new Map<string, RagChunkDoc>();
    for (const doc of exactMatches) {
      if (!merged.has(doc.id)) merged.set(doc.id, doc);
      if (merged.size >= topK) break;
    }
    for (const doc of bm25Matches) {
      if (!merged.has(doc.id)) merged.set(doc.id, doc);
      if (merged.size >= topK) break;
    }
    return Array.from(merged.values()).slice(0, topK);
  }

  getCorpus(corpus: RagCorpus): RagChunkDoc[] {
    return this.docsByCorpus[corpus] || [];
  }
}

function normalizeRagText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function scoreExactMatch(doc: RagChunkDoc, normalizedQuery: string): number {
  if (!normalizedQuery) return 0;
  const id = normalizeRagText(doc.id);
  const title = normalizeRagText(doc.title);
  const tags = Array.isArray(doc.tags) ? doc.tags.map((tag) => normalizeRagText(String(tag))) : [];
  const source = normalizeRagText(doc.source || '');
  const pathHint = normalizeRagText(doc.pathHint || '');

  if (id === normalizedQuery) return 120;
  if (title === normalizedQuery) return 110;
  if (tags.includes(normalizedQuery)) return 100;
  if (pathHint === normalizedQuery) return 95;
  if (source.endsWith(normalizedQuery)) return 90;
  if (id.includes(normalizedQuery)) return 80;
  if (title.includes(normalizedQuery)) return 75;
  if (tags.some((tag) => tag.includes(normalizedQuery))) return 70;
  if (pathHint.includes(normalizedQuery)) return 65;
  if (source.includes(normalizedQuery)) return 60;
  return 0;
}

let _ragPromise: Promise<RagIndexes> | null = null;

export async function initRagIndexes(options?: {
  ragDir?: string;
  manifestFile?: string;
}): Promise<RagIndexes> {
  if (_ragPromise) return _ragPromise;
  _ragPromise = (async () => {
    const ragDir = options?.ragDir || resolveRagDir();
    const manifestFile = options?.manifestFile || 'manifest.json';
    const manifestRaw = await fs.readFile(path.join(ragDir, manifestFile), 'utf8');
    const manifest = JSON.parse(manifestRaw) as RagManifest;
    const byCorpus: Partial<Record<RagCorpus, Bm25Index<RagChunkDoc>>> = {};
    const docsByCorpus: Partial<Record<RagCorpus, RagChunkDoc[]>> = {};

    for (const [corpus, shardFile] of Object.entries(manifest.corpora || {})) {
      if (!shardFile) continue;
      const chunkRaw = await fs.readFile(path.join(ragDir, shardFile), 'utf8');
      const chunks = JSON.parse(chunkRaw) as Array<Record<string, unknown>>;
      const docs: RagChunkDoc[] = chunks.map((c) => {
        const tags = Array.isArray((c as Record<string, unknown>).tags)
          ? ((c as Record<string, unknown>).tags as unknown[]).map((tag) => String(tag))
          : undefined;
        const extraText = [
          c.type,
          c.severity,
          c.symptom,
          c.root_cause,
          c.fix,
          c.code_before,
          c.code_after,
          Array.isArray(c.related_commands) ? c.related_commands.join(' ') : '',
          Array.isArray(c.affected_files) ? c.affected_files.join(' ') : '',
        ]
          .map((value) => String(value || ''))
          .join(' ');

        return {
          ...c,
          id: String(c.id || ''),
          corpus: corpus as RagCorpus,
          title: String(c.title || ''),
          body: String(c.body || ''),
          tags,
          source: typeof c.source === 'string' ? c.source : undefined,
          pathHint: typeof c.pathHint === 'string' ? c.pathHint : undefined,
          text: `${String(c.title || '')} ${String(c.body || '')} ${String((tags || []).join(' '))} ${extraText}`.trim(),
        };
      });
      docsByCorpus[corpus as RagCorpus] = docs;
      byCorpus[corpus as RagCorpus] = new Bm25Index<RagChunkDoc>(docs);
    }
    return new RagIndexes(byCorpus, docsByCorpus);
  })();
  return _ragPromise;
}

export async function getRagIndexes(): Promise<RagIndexes> {
  return initRagIndexes();
}
