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
  | 'pyvisa_tekhsi'
  | 'tek_docs';

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

  search(corpus: RagCorpus, query: string, topK = 5, modelFamily?: string): RagChunkDoc[] {
    const docs = this.docsByCorpus[corpus] || [];
    const index = this.byCorpus[corpus];
    if (!index) return [];

    // For tek_docs, apply model-family filtering the same way SCPI does:
    // - Chunks with no model-specific tags → always included (general content)
    // - Chunks with model-specific tags → only included if tags match the requested family
    // - No modelFamily requested → all chunks pass
    const filteredDocs = (corpus === 'tek_docs' && modelFamily)
      ? docs.filter((doc) => tekDocsFamilyMatches(doc, modelFamily))
      : docs;

    const normalizedQuery = normalizeRagText(query);

    // Product-family soft boost/penalty for tek_docs (works even without explicit modelFamily)
    const productScore = corpus === 'tek_docs'
      ? (doc: RagChunkDoc) => scoreProductMatch(doc, normalizedQuery)
      : (_doc: RagChunkDoc) => 0;

    const exactMatches = filteredDocs
      .map((doc) => ({ doc, score: scoreExactMatch(doc, normalizedQuery) + productScore(doc) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.doc);

    // BM25 search over filtered set
    const filteredIndex = corpus === 'tek_docs' && modelFamily && filteredDocs.length !== docs.length
      ? new Bm25Index<RagChunkDoc>(filteredDocs)
      : index;

    const bm25Raw = filteredIndex.search(query, Math.max(topK * 4, 12));

    // Re-rank BM25 results with product boost/penalty so wrong-family chunks sink
    const bm25Matches = corpus === 'tek_docs'
      ? bm25Raw
          .map((s) => ({ doc: s.doc, score: s.score + productScore(s.doc) }))
          .sort((a, b) => b.score - a.score)
          .map((s) => s.doc)
      : bm25Raw.map((s) => s.doc);

    // Merge exact + BM25, deduplicating by doc ID.
    // Also cap per-source-URL at 2 chunks so a single datasheet can't occupy all topK slots.
    const merged = new Map<string, RagChunkDoc>();
    const sourceCount = new Map<string, number>();
    const MAX_PER_SOURCE = 2;

    const addDoc = (doc: RagChunkDoc): boolean => {
      if (merged.has(doc.id)) return false;
      const src = doc.source || '';
      const count = sourceCount.get(src) ?? 0;
      if (src && count >= MAX_PER_SOURCE) return false;
      merged.set(doc.id, doc);
      if (src) sourceCount.set(src, count + 1);
      return true;
    };

    for (const doc of exactMatches) {
      addDoc(doc);
      if (merged.size >= topK) break;
    }
    for (const doc of bm25Matches) {
      addDoc(doc);
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

// ---------------------------------------------------------------------------
// tek_docs model-family filtering + product-alias score boosting
// ---------------------------------------------------------------------------
//
// Two complementary mechanisms work together:
//
//  1. HARD FILTER (tekDocsFamilyMatches)
//     When a modelFamily is explicitly passed to search(), chunks tagged for a
//     different instrument family are excluded entirely — same pattern as SCPI
//     commandIndex familyMatches().  Chunks with no model-specific tags always
//     pass (general content).
//
//  2. SOFT BOOST (scoreProductMatch)
//     When the query itself contains a product alias (e.g. "mso64b bandwidth"),
//     we boost chunks that carry the matching tag (+5) and penalise chunks
//     tagged for a different model family (-3).  This prevents BM25 from
//     elevating a 5-Series datasheet when the user asked about the 6-Series B.
//
// ---------------------------------------------------------------------------

/** Normalized forms of every model-specific tag that appears in tek_docs. */
const TEK_DOCS_MODEL_TAGS = new Set([
  '2SERIESMSO', '3SERIESMDO',
  '4SERIESMSO', '4SERIESBMSO',
  '5SERIESMSO', '5SERIESBMSO',
  '6SERIESMSO', '6SERIESBMSO',
  '7SERIESDPO',
  'DPO4000', 'DPO5000', 'DPO7000', 'DPO70000', 'DPO70000SX',
  'MDO3000', 'MDO4000',
  'MSO2', 'MSO3',
  'MSO4', 'MSO44', 'MSO46',
  'MSO5', 'MSO54', 'MSO56', 'MSO58',
  'MSO6', 'MSO64',
  'TBS1000', 'TBS2000',
]);

function normalizeTekTag(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Expand a requested model-family string into the set of tag keys it should match. */
function tekDocsRequestedBuckets(family: string): Set<string> {
  const n = normalizeTekTag(family);
  const out = new Set<string>();
  out.add(n);

  if (/MSO6|6SERIES/.test(n))  { out.add('MSO6'); out.add('MSO64'); out.add('6SERIESMSO'); out.add('6SERIESBMSO'); }
  if (/MSO5|5SERIES/.test(n))  { out.add('MSO5'); out.add('MSO54'); out.add('MSO56'); out.add('MSO58'); out.add('5SERIESMSO'); out.add('5SERIESBMSO'); }
  if (/MSO4|4SERIES/.test(n))  { out.add('MSO4'); out.add('MSO44'); out.add('MSO46'); out.add('4SERIESMSO'); out.add('4SERIESBMSO'); }
  if (/MSO2|2SERIES/.test(n))  { out.add('MSO2'); out.add('2SERIESMSO'); }
  if (/MSO3|3SERIES|MDO3/.test(n)) { out.add('MSO3'); out.add('3SERIESMDO'); out.add('MDO3000'); }
  if (/MDO4/.test(n))          { out.add('MDO4000'); }
  if (/DPO5|5K/.test(n))       { out.add('DPO5000'); }
  if (/DPO7000(?!0)|7K/.test(n)) { out.add('DPO7000'); }
  if (/DPO70000|70K/.test(n))  { out.add('DPO70000'); out.add('DPO70000SX'); }
  if (/DPO4|4K/.test(n))       { out.add('DPO4000'); }
  if (/7SERIES/.test(n))       { out.add('7SERIESDPO'); }
  if (/TBS1/.test(n))          { out.add('TBS1000'); }
  if (/TBS2/.test(n))          { out.add('TBS2000'); }

  return out;
}

/**
 * Returns true when a tek_docs chunk should be included for the requested model family.
 * General-purpose chunks (no instrument-specific tags) always pass through.
 */
function tekDocsFamilyMatches(doc: RagChunkDoc, modelFamily: string): boolean {
  const modelTags = (doc.tags || [])
    .map((t) => normalizeTekTag(t))
    .filter((t) => TEK_DOCS_MODEL_TAGS.has(t));

  // No model-specific tags → general content, always include
  if (modelTags.length === 0) return true;

  // Model-specific content → check if any tag matches the requested family
  const requested = tekDocsRequestedBuckets(modelFamily);
  return modelTags.some((tag) => requested.has(tag));
}

// ---------------------------------------------------------------------------
// Product-alias soft scoring — boosts/demotes chunks by product family match
// when the query contains a recognizable product alias (e.g. "mso64b", "6 series b").
// Keys are already lowercase with spaces matching normalizeRagText output.
// Values are the raw tag strings as they appear in tek_docs_index.json.
// ---------------------------------------------------------------------------

const PRODUCT_ALIASES: Record<string, string[]> = {
  // 6 Series B MSO (specific)
  'mso68b':       ['6_SERIES_B_MSO'],
  'mso66b':       ['6_SERIES_B_MSO'],
  'mso64b':       ['6_SERIES_B_MSO'],
  '6 series b':   ['6_SERIES_B_MSO'],
  '6b mso':       ['6_SERIES_B_MSO'],
  // 6 Series MSO (generic)
  'mso64':        ['6_SERIES_MSO', 'MSO64'],
  'mso6':         ['6_SERIES_MSO', '6_SERIES_B_MSO'],
  '6 series':     ['6_SERIES_MSO', '6_SERIES_B_MSO'],
  // 5 Series B MSO (specific)
  'mso58b':       ['5_SERIES_B_MSO'],
  'mso56b':       ['5_SERIES_B_MSO'],
  'mso54b':       ['5_SERIES_B_MSO'],
  '5 series b':   ['5_SERIES_B_MSO'],
  '5b mso':       ['5_SERIES_B_MSO'],
  // 5 Series MSO (generic)
  'mso58':        ['5_SERIES_MSO', 'MSO58'],
  'mso56':        ['5_SERIES_MSO', 'MSO56'],
  'mso54':        ['5_SERIES_MSO', 'MSO54'],
  'mso5':         ['5_SERIES_MSO', '5_SERIES_B_MSO'],
  '5 series':     ['5_SERIES_MSO', '5_SERIES_B_MSO'],
  // 4 Series B MSO (specific)
  'mso46b':       ['4_SERIES_B_MSO'],
  'mso44b':       ['4_SERIES_B_MSO'],
  '4 series b':   ['4_SERIES_B_MSO'],
  '4b mso':       ['4_SERIES_B_MSO'],
  // 4 Series MSO (generic)
  'mso46':        ['4_SERIES_MSO', 'MSO46'],
  'mso44':        ['4_SERIES_MSO', 'MSO44'],
  'mso4':         ['4_SERIES_MSO', '4_SERIES_B_MSO'],
  '4 series':     ['4_SERIES_MSO', '4_SERIES_B_MSO'],
  // 3 / 2 Series
  '3 series':     ['3_SERIES_MDO'],
  'mdo3000':      ['3_SERIES_MDO', 'MDO3000'],
  'mdo4000':      ['MDO4000'],
  '2 series':     ['2_SERIES_MSO'],
  'mso2':         ['2_SERIES_MSO', 'MSO2'],
  // 7 Series DPO
  '7 series':     ['7_SERIES_DPO'],
  // DPO legacy
  'dpo70000sx':   ['DPO70000SX'],
  'dpo70000':     ['DPO70000'],
  'dpo7000':      ['DPO7000'],
  'dpo5000':      ['DPO5000'],
  'dpo4000':      ['DPO4000'],
  // TBS
  'tbs1000':      ['TBS1000'],
  'tbs2000':      ['TBS2000'],
};

/** Alias keys sorted longest-first so the most specific match wins. */
const SORTED_ALIAS_KEYS = Object.keys(PRODUCT_ALIASES).sort((a, b) => b.length - a.length);

/**
 * Returns a score adjustment for a tek_docs chunk based on product-family signals
 * detected in the normalized query.
 *   +5  → chunk is tagged for the exact product family mentioned in the query
 *   -3  → chunk is tagged for a *different* model family (wrong product family)
 *    0  → no product alias found in query, or chunk has no model-specific tags
 */
function scoreProductMatch(doc: RagChunkDoc, normalizedQuery: string): number {
  // Find the most specific (longest) alias present in the query
  const matchedKey = SORTED_ALIAS_KEYS.find((key) => normalizedQuery.includes(key));
  if (!matchedKey) return 0;

  const requiredTags = PRODUCT_ALIASES[matchedKey];
  const docTags = doc.tags || [];

  // Boost: doc has one of the required tags → it's the right product family
  if (requiredTags.some((tag) => docTags.includes(tag))) return 5;

  // Penalty: doc has model-specific tags, but none match → wrong product family
  const hasOtherModelTags = docTags.some((tag) => TEK_DOCS_MODEL_TAGS.has(normalizeTekTag(tag)));
  if (hasOtherModelTags) return -3;

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
