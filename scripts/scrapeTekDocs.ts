/**
 * scrapeTekDocs.ts
 * Scrapes public Tektronix technical documents from tek.com and builds
 * a RAG index (tek_docs_index.json) in the same format as other corpora.
 *
 * Manifest shape (scripts/tek_doc_urls.json):
 *   Either a flat array of URLs (legacy):
 *     ["https://www.tek.com/...", "https://www.tek.com/..."]
 *   OR a family-organized manifest (preferred):
 *     {
 *       "$schema": "tek-docs.v2",
 *       "shared": ["https://www.tek.com/..."],
 *       "families": {
 *         "MSO2":   ["https://www.tek.com/..."],
 *         "MSO6B":  ["https://www.tek.com/..."],
 *         "DPO7000":["https://www.tek.com/..."]
 *       }
 *     }
 *
 * When a URL is under families[KEY], chunks from that URL are authoritatively
 * tagged with that family (so retrieval with products:["MSO6"] surfaces them).
 * "shared" URLs get keyword-inferred family tags (same rules as scrapeTekVideos).
 *
 * Usage:
 *   npx tsx scripts/scrapeTekDocs.ts           # scrape all
 *   npx tsx scripts/scrapeTekDocs.ts --family MSO6   # scrape only one family
 *   npx tsx scripts/scrapeTekDocs.ts --only-shared   # skip per-family, just shared
 *
 * Output: public/rag/tek_docs_index.json
 * Then re-run: npx tsx scripts/buildRagIndex.ts  (or just update manifest manually)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.resolve(SCRIPT_DIR, '../public/rag/tek_docs_index.json');
const MANIFEST_FILE = path.resolve(SCRIPT_DIR, '../public/rag/manifest.json');
const URL_LIST_FILE = path.resolve(SCRIPT_DIR, 'tek_doc_urls.json');

// ── Types ─────────────────────────────────────────────────────────────────────
interface DocsManifest {
  $schema?: string;
  note?: string;
  lastUpdated?: string;
  shared: string[];
  families: Record<string, string[]>;
}

interface RagChunk {
  id: string;
  corpus: string;
  title: string;
  body: string;
  tags: string[];
  source: string;
}

interface CliOpts {
  onlyFamily: string | null;
  onlyShared: boolean;
}

// ── Product family rules (same approach as scrapeTekVideos.ts) ────────────────
// Order matters — more specific first. Applied to title + body text to
// infer product tags for "shared" URLs, and to augment family-keyed URLs
// with extra families they happen to reference.
interface FamilyRule { family: string; test: RegExp; }
const FAMILY_RULES: FamilyRule[] = [
  { family: 'MSO6B', test: /\b(6\s*Series\s*B\s*MSO|MSO(?:64|66|68)B|6-Series-B)\b/i },
  { family: 'MSO6',  test: /\b(6\s*Series\s*MSO|MSO(?:64|66|68)(?!B)|6-Series-MSO)\b/i },
  { family: 'MSO5B', test: /\b(5\s*Series\s*B\s*MSO|MSO5[468]B)\b/i },
  { family: 'MSO5',  test: /\b(5\s*Series\s*MSO|MSO5[468](?!B)|5-Series-MSO)\b/i },
  { family: 'MSO4B', test: /\b(4\s*Series\s*B\s*MSO|MSO4[46]B)\b/i },
  { family: 'MSO4',  test: /\b(4\s*Series\s*MSO|MSO4[46](?!B)|4-Series-MSO)\b/i },
  { family: 'MSO2',  test: /\b(2\s*Series\s*MSO|MSO2[24]|2-Series-MSO)\b/i },
  { family: 'MDO3',  test: /\b(3\s*Series\s*MDO|MDO3(?!000))\b/i },
  { family: 'MDO4',  test: /\b(4\s*Series\s*MDO|MDO4(?!000))\b/i },
  { family: 'MDO3000', test: /\bMDO3\d{3}\b/i },
  { family: 'MDO4000', test: /\bMDO4\d{3}[A-C]?\b/i },
  { family: 'DPO70000', test: /\bDPO70\d{3}(?:C|DX|SX)?\b|\b70000\s*Series\b/i },
  { family: 'DPO7000',  test: /\b7\s*Series\s*DPO\b|\bDPO7(?!0)/i },
  { family: 'DPO5000',  test: /\bDPO5\d{3}B?\b|\bMSO5\d{3}B?\b/i },
  { family: 'DPO4000',  test: /\b(MSO\/DPO|DPO)4\d{3}B?\b/i },
  { family: 'DPO3000',  test: /\b(MSO\/DPO|DPO)3\d{3}B?\b/i },
  { family: 'DPO2000',  test: /\b(MSO\/DPO|DPO)2\d{3}B?\b/i },
];

function inferFamilies(text: string): string[] {
  const out = new Set<string>();
  for (const r of FAMILY_RULES) if (r.test.test(text)) out.add(r.family);
  return Array.from(out);
}

// ── CLI ───────────────────────────────────────────────────────────────────────
function parseArgs(argv: string[]): CliOpts {
  const opts: CliOpts = { onlyFamily: null, onlyShared: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--family') opts.onlyFamily = argv[++i] || null;
    else if (a === '--only-shared') opts.onlyShared = true;
    else if (a === '--help' || a === '-h') {
      console.log(`usage: npx tsx scripts/scrapeTekDocs.ts
  (no flags)                  scrape all — shared + every family bucket
  --family <KEY>              scrape only one family bucket (e.g. MSO2, DPO7000)
  --only-shared               scrape only the shared bucket, skip per-family`);
      process.exit(0);
    }
  }
  return opts;
}

// ── Manifest loader ───────────────────────────────────────────────────────────
function loadManifest(): DocsManifest {
  const raw = fs.readFileSync(URL_LIST_FILE, 'utf8');
  const parsed = JSON.parse(raw);

  // Legacy: flat array
  if (Array.isArray(parsed)) {
    console.log(`Legacy flat-array manifest detected (${parsed.length} URLs → all treated as "shared")`);
    return { shared: parsed, families: {} };
  }

  // Modern: object
  const manifest: DocsManifest = {
    $schema: parsed.$schema,
    note: parsed.note,
    lastUpdated: parsed.lastUpdated,
    shared: Array.isArray(parsed.shared) ? parsed.shared : [],
    families: (parsed.families && typeof parsed.families === 'object') ? parsed.families : {},
  };
  console.log(`Manifest: ${manifest.shared.length} shared + ${Object.keys(manifest.families).length} family buckets (${Object.values(manifest.families).reduce((a: number, v) => a + (Array.isArray(v) ? v.length : 0), 0)} family-specific URLs)`);
  return manifest;
}

// ── HTML extraction ───────────────────────────────────────────────────────────
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Strip tek.com page chrome (feedback widget, nav, footer) so body
// snippets in retrieval aren't polluted with boilerplate.
const BOILERPLATE_PATTERNS: RegExp[] = [
  /Whether positive or negative,[\s\S]*?experience\.?/gi,
  /Let us know if you[' ]?re[\s\S]*?feedback\./gi,
  /We[' ]?ll use your feedback[\s\S]*?\./gi,
  /Was this information helpful\??/gi,
  /Submit\s+Thank you for your feedback\.?/gi,
  /Accept all cookies/gi,
  /Cookie preferences/gi,
  /Sign in to (?:your|my) (?:account|TekCloud)/gi,
];

function scrubBoilerplate(text: string): string {
  let out = text;
  for (const p of BOILERPLATE_PATTERNS) out = out.replace(p, ' ');
  return out.replace(/\s{2,}/g, ' ').trim();
}

function extractArticleText(html: string): { title: string; body: string } {
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const rawTitle = titleMatch ? stripHtml(titleMatch[1]) : '';

  const articlePatterns = [
    /<article[\s\S]*?>([\s\S]*?)<\/article>/i,
    /<div[^>]*class="[^"]*field--name-body[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*resource-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*(?:content|article|body|main|document)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
  ];

  let rawBody = '';
  for (const pattern of articlePatterns) {
    const match = html.match(pattern);
    if (match && match[1].length > 500) { rawBody = match[1]; break; }
  }

  if (!rawBody) {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    rawBody = bodyMatch ? bodyMatch[1] : html;
  }

  const body = scrubBoilerplate(stripHtml(rawBody).replace(/\s{3,}/g, '\n\n').trim());
  return { title: rawTitle, body };
}

function chunkText(text: string, maxWords = 400, overlap = 50): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + maxWords, words.length);
    chunks.push(words.slice(start, end).join(' '));
    start += maxWords - overlap;
    if (end === words.length) break;
  }
  return chunks;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
}

function docTypeFromUrl(url: string): string {
  if (url.includes('/technical-brief/')) return 'technical-brief';
  if (url.includes('/application-note/')) return 'application-note';
  if (url.includes('/primer/')) return 'primer';
  if (url.includes('/white-paper/') || url.includes('/whitepaper/')) return 'white-paper';
  if (url.includes('/how-guide/') || url.includes('/how-to-guide/')) return 'how-guide';
  if (url.includes('/datasheet')) return 'datasheet';
  if (url.includes('/faqs/')) return 'faq';
  if (url.includes('/blog/')) return 'blog';
  if (url.includes('/manual/')) return 'manual';
  return 'document';
}

// ── Fetcher ───────────────────────────────────────────────────────────────────
async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TekAutomate-RAG-Scraper/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) { console.warn(`  ✗ HTTP ${res.status} — skipping`); return null; }
    return await res.text();
  } catch (err) {
    console.warn(`  ✗ Fetch error: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

// ── Chunk builder ─────────────────────────────────────────────────────────────
interface ScrapeJob {
  url: string;
  authoritativeFamilies: string[]; // explicit from manifest bucket
}

async function scrapeOne(job: ScrapeJob, seen: Set<string>): Promise<RagChunk[]> {
  const slug = job.url.split('/').pop() || 'unknown';
  console.log(`→ ${slug}${job.authoritativeFamilies.length > 0 ? ` [${job.authoritativeFamilies.join(',')}]` : ''}`);

  const html = await fetchPage(job.url);
  if (!html) return [];

  const { title, body } = extractArticleText(html);
  if (body.length < 200) { console.warn('  ✗ Extracted body too short — skipping'); return []; }

  const docSlug = slugify(slug);
  const docType = docTypeFromUrl(job.url);

  // Build family tag list: authoritative (from manifest) + inferred from content.
  const inferred = inferFamilies(`${title} ${body}`);
  const familyTags = Array.from(new Set<string>([...job.authoritativeFamilies, ...inferred]));

  const textChunks = chunkText(body);
  const baseTags = [docSlug, docType, 'tektronix', 'tek_com', ...familyTags];
  console.log(`  ✓ "${title || slug}" — ${body.length} chars → ${textChunks.length} chunk(s), families=[${familyTags.join(',') || 'none'}]`);

  const out: RagChunk[] = [];
  textChunks.forEach((chunkBody, i) => {
    const id = `tek_${docSlug}_p${i + 1}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      corpus: 'tek_docs',
      title: title || slug,
      body: chunkBody,
      tags: [...baseTags],
      source: job.url,
    });
  });
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv);
  const manifest = loadManifest();

  // Build job list respecting CLI scope
  const jobs: ScrapeJob[] = [];
  if (!opts.onlyFamily) {
    for (const url of manifest.shared) jobs.push({ url, authoritativeFamilies: [] });
  }
  if (!opts.onlyShared) {
    for (const [fam, urls] of Object.entries(manifest.families)) {
      if (opts.onlyFamily && fam !== opts.onlyFamily) continue;
      for (const url of urls || []) jobs.push({ url, authoritativeFamilies: [fam] });
    }
  }

  if (jobs.length === 0) {
    console.error('No URLs to scrape under the current filter. Exiting.');
    process.exit(1);
  }
  console.log(`\nScraping ${jobs.length} tek.com document URLs…\n`);

  const chunks: RagChunk[] = [];
  const seen = new Set<string>();
  let ok = 0, fail = 0;

  for (const [i, job] of jobs.entries()) {
    const produced = await scrapeOne(job, seen);
    if (produced.length > 0) { chunks.push(...produced); ok++; } else fail++;
    if ((i + 1) % 25 === 0) {
      console.log(`[progress] ${i + 1}/${jobs.length} ok=${ok} fail=${fail} chunks=${chunks.length}`);
    }
    await new Promise((r) => setTimeout(r, 800)); // polite delay
  }

  if (chunks.length === 0) { console.error('\nNo chunks produced — nothing to write.'); process.exit(1); }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(chunks, null, 2), 'utf8');
  console.log(`\n✅ Wrote ${chunks.length} chunks → ${OUT_FILE}`);

  if (fs.existsSync(MANIFEST_FILE)) {
    const manifestRag = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
    manifestRag.corpora = manifestRag.corpora || {};
    manifestRag.counts = manifestRag.counts || {};
    manifestRag.corpora['tek_docs'] = 'tek_docs_index.json';
    manifestRag.counts['tek_docs'] = chunks.length;
    manifestRag.generatedAt = new Date().toISOString();
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifestRag, null, 2), 'utf8');
    console.log(`✅ Updated RAG manifest (${chunks.length} tek_docs chunks)`);
  }

  // Quick family breakdown report
  const byFamily: Record<string, number> = {};
  for (const c of chunks) {
    const fams = c.tags.filter((t) => /^MSO|^MDO|^DPO|^TBS|^TDS/.test(t));
    if (fams.length === 0) { byFamily['general'] = (byFamily['general'] || 0) + 1; continue; }
    for (const f of fams) byFamily[f] = (byFamily[f] || 0) + 1;
  }
  console.log(`\nChunks by family:`);
  for (const [fam, n] of Object.entries(byFamily).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${fam.padEnd(12)} ${n}`);
  }
  console.log(`\n[done] jobs=${jobs.length} ok=${ok} fail=${fail} chunks=${chunks.length}`);
  console.log('Next: rebuild indexed RAG via: npx tsx scripts/buildRagIndex.ts');
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
