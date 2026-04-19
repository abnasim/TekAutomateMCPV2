/**
 * fetchTekForumThreads.ts — scrape my.tek.com/en/tektalk (read-only archive)
 * and append engineer-to-engineer Q&A threads to the tek_docs corpus.
 *
 * Forum structure:
 *   - Category listing:  /en/tektalk/<category>?page=N   (20 threads/page)
 *   - Thread page:       /en/tektalk/<category>/<uuid>   (OP + replies, full HTML)
 *
 * The forum is now read-only — content is stable, no moving target. We
 * iterate each category's listing pages to enumerate thread UUIDs, then
 * fetch each thread individually, extract OP + replies, chunk per thread,
 * product-tag via the same FAMILY_RULES as scrapeTekDocs, and APPEND to
 * public/rag/tek_docs_index.json. Re-run buildRagIndex.ts to re-shard.
 *
 * Idempotent: skips thread UUIDs already present in the index by id prefix.
 *
 * Usage:
 *   npx tsx scripts/fetchTekForumThreads.ts                         # all default categories
 *   npx tsx scripts/fetchTekForumThreads.ts --category oscilloscopes
 *   npx tsx scripts/fetchTekForumThreads.ts --max-pages 5           # cap per category
 *   npx tsx scripts/fetchTekForumThreads.ts --dry-run               # enumerate only, no thread fetch
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.resolve(SCRIPT_DIR, '../public/rag/tek_docs_index.json');
const MANIFEST_FILE = path.resolve(SCRIPT_DIR, '../public/rag/manifest.json');

const FORUM_BASE = 'https://my.tek.com/en/tektalk';
const USER_AGENT = 'Mozilla/5.0 (compatible; TekAutomate-RAG-Scraper/1.0; +archive forum ingest)';
const POLITE_DELAY_MS = 700;

// ── Categories — mapped to default product tags where the category inherently
// implies a product family. General categories get no default tag; we rely
// on per-thread title/body inference.
interface ForumCategory {
  slug: string;
  title: string;
  defaultProducts?: string[];
  maxPagesHint?: number; // informational, not strict
}

const CATEGORIES: ForumCategory[] = [
  { slug: 'oscilloscopes',       title: 'Oscilloscopes', maxPagesHint: 34 },
  { slug: 'probes',              title: 'Probes', maxPagesHint: 15 },
  { slug: 'software',            title: 'Software', maxPagesHint: 25 },
  { slug: 'signal-gen',          title: 'Signal Generators', maxPagesHint: 10 },
  { slug: 'real-time-spec-analyzer', title: 'Real-Time Spectrum Analyzer', maxPagesHint: 5 },
  { slug: 'documentation',       title: 'Documentation', maxPagesHint: 5 },
  { slug: 'general-discussion',  title: 'General Discussion', maxPagesHint: 15 },
];

// ── Types ─────────────────────────────────────────────────────────────────────
interface RagChunk {
  id: string;
  corpus: string;
  title: string;
  body: string;
  tags: string[];
  source: string;
}

interface CliOpts {
  onlyCategory: string | null;
  maxPages: number;
  dryRun: boolean;
}

// ── Product family rules (copied from scrapeTekDocs.ts FAMILY_RULES) ─────────
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
  const opts: CliOpts = { onlyCategory: null, maxPages: 50, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--category') opts.onlyCategory = argv[++i] || null;
    else if (a === '--max-pages') opts.maxPages = Math.max(1, Number(argv[++i]) || 50);
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--help' || a === '-h') {
      console.log(`usage: npx tsx scripts/fetchTekForumThreads.ts
  --category <slug>     scrape only one category (oscilloscopes, probes, software, ...)
  --max-pages N         cap listing pagination per category (default 50)
  --dry-run             enumerate thread UUIDs only, no per-thread fetch`);
      process.exit(0);
    }
  }
  return opts;
}

// ── HTML helpers ──────────────────────────────────────────────────────────────
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

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) { console.warn(`  ✗ HTTP ${res.status} — ${url}`); return null; }
    return await res.text();
  } catch (err) {
    console.warn(`  ✗ fetch error: ${err instanceof Error ? err.message : err} — ${url}`);
    return null;
  }
}

// ── Enumerate thread UUIDs in a category (paginated) ──────────────────────────
const UUID_RE = /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi;

function extractThreadUuids(listingHtml: string, categorySlug: string): string[] {
  // Pull UUIDs only from links that look like /en/tektalk/<slug>/<UUID>.
  const pattern = new RegExp(
    `/en/tektalk/${categorySlug}/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`,
    'gi',
  );
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(listingHtml)) !== null) out.add(m[1].toLowerCase());
  return Array.from(out);
}

async function enumerateThreadUuids(category: ForumCategory, maxPages: number): Promise<string[]> {
  const all = new Set<string>();
  let emptyStreak = 0;
  for (let page = 1; page <= maxPages; page++) {
    const url = `${FORUM_BASE}/${category.slug}?page=${page}`;
    const html = await fetchPage(url);
    await new Promise((r) => setTimeout(r, POLITE_DELAY_MS));
    if (!html) { emptyStreak++; if (emptyStreak >= 3) break; continue; }
    const beforeSize = all.size;
    const uuids = extractThreadUuids(html, category.slug);
    for (const u of uuids) all.add(u);
    const added = all.size - beforeSize;
    if (added === 0) {
      emptyStreak++;
      if (emptyStreak >= 2) { console.log(`  [${category.slug}] page ${page}: no new UUIDs, stopping enumeration`); break; }
    } else {
      emptyStreak = 0;
      console.log(`  [${category.slug}] page ${page}: ${uuids.length} uuids (total ${all.size})`);
    }
  }
  return Array.from(all);
}

// ── Parse a thread page ───────────────────────────────────────────────────────
interface ParsedThread {
  title: string;
  body: string; // concatenated OP + replies, with "Reply N by ..." markers
  posterCount: number;
}

/**
 * Extract the content of the first balanced <div>…</div> starting at
 * `openIdx`. Handles nested <div> correctly, unlike greedy regex.
 * Returns {end, inner} or null if unbalanced/EOF.
 */
function extractBalancedDiv(html: string, openIdx: number): { end: number; inner: string } | null {
  // openIdx points at the '<' of the opening <div ...>. Advance past '>'.
  const openEnd = html.indexOf('>', openIdx);
  if (openEnd < 0) return null;
  let depth = 1;
  let i = openEnd + 1;
  const openRe = /<div\b[^>]*>/gi;
  const closeRe = /<\/div\s*>/gi;
  while (depth > 0 && i < html.length) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const openMatch = openRe.exec(html);
    const closeMatch = closeRe.exec(html);
    if (!closeMatch) return null;
    if (openMatch && openMatch.index < closeMatch.index) {
      depth++;
      i = openMatch.index + openMatch[0].length;
    } else {
      depth--;
      i = closeMatch.index + closeMatch[0].length;
      if (depth === 0) {
        return { end: i, inner: html.slice(openEnd + 1, closeMatch.index) };
      }
    }
  }
  return null;
}

function parseThread(html: string): ParsedThread | null {
  // Title: <h1> first, fall back to <title>. Strip " · Tektronix Community".
  const titleMatch =
    html.match(/<h1[^>]*>([\s\S]{1,500}?)<\/h1>/i) ||
    html.match(/<title>([\s\S]{1,500}?)<\/title>/i);
  const title = titleMatch
    ? stripHtml(titleMatch[1]).replace(/\s*·\s*Tektronix Community\s*$/i, '').trim()
    : '';

  // TekTalk thread page layout:
  //   <div class="forum-post"> … <div class="post-content">BODY</div> … </div>
  // One <div class="forum-post"> per post (OP + each reply).
  // Greedy <div> regex won't close correctly due to nesting, so walk
  // manually with a balanced-div extractor.
  const postStartRe = /<div\s+[^>]*class="[^"]*\bpost-content\b[^"]*"[^>]*>/gi;
  const bodyParts: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = postStartRe.exec(html)) !== null) {
    const extracted = extractBalancedDiv(html, m.index);
    if (!extracted) continue;
    postStartRe.lastIndex = extracted.end; // skip past this post to find the next
    const t = stripHtml(extracted.inner);
    if (t.length > 20) bodyParts.push(t);
  }

  // Fallback: if post-content containers weren't found, try forum-post wrappers.
  if (bodyParts.length === 0) {
    const wrapperRe = /<div\s+[^>]*class="[^"]*\bforum-post\b[^"]*"[^>]*>/gi;
    let w: RegExpExecArray | null;
    while ((w = wrapperRe.exec(html)) !== null) {
      const ex = extractBalancedDiv(html, w.index);
      if (!ex) continue;
      wrapperRe.lastIndex = ex.end;
      const t = stripHtml(ex.inner);
      if (t.length > 40) bodyParts.push(t);
    }
  }

  if (bodyParts.length === 0) return null;
  const body = bodyParts.join('\n\n---\n\n');
  if (body.length < 100) return null;
  return { title, body, posterCount: bodyParts.length };
}

// ── Scrubbing: drop page chrome that slipped into article regions ─────────────
const BOILERPLATE: RegExp[] = [
  /Skip to main content/gi,
  /Sign in\s*\|\s*Register/gi,
  /Help & Support/gi,
  /The TekTalk community forum is now read-only[\s\S]{0,200}?reference purpose only\.?/gi,
  /Want to open a support ticket\?[\s\S]{0,200}?support-case/gi,
  /©\s*\d{4}\s*Tektronix[\s\S]{0,100}/gi,
  /Privacy\s*Policy[\s\S]{0,150}/gi,
  /Need help on product selection\?[\s\S]{0,300}?(?:Chat with Sales|Contact a Tektronix|learn more)/gi,
  /Chat with Sales\s+Available[\s\S]{0,200}?PST/gi,
];

function scrub(text: string): string {
  let out = text;
  for (const p of BOILERPLATE) out = out.replace(p, ' ');
  return out.replace(/\s{2,}/g, ' ').trim();
}

// ── Chunking ──────────────────────────────────────────────────────────────────
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

// ── Store I/O ─────────────────────────────────────────────────────────────────
function readStore(): RagChunk[] {
  try {
    const raw = fs.readFileSync(OUT_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* fresh */ }
  return [];
}

function writeStore(chunks: RagChunk[]) {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  const tmp = `${OUT_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(chunks, null, 2));
  fs.renameSync(tmp, OUT_FILE);
}

function updateRagManifestCount(newTekDocsCount: number) {
  if (!fs.existsSync(MANIFEST_FILE)) return;
  const m = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf-8'));
  m.counts = m.counts || {};
  m.counts['tek_docs'] = newTekDocsCount;
  m.generatedAt = new Date().toISOString();
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(m, null, 2));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv);
  const categories = opts.onlyCategory
    ? CATEGORIES.filter((c) => c.slug === opts.onlyCategory)
    : CATEGORIES;

  if (categories.length === 0) {
    console.error(`No category matches --category=${opts.onlyCategory}`);
    process.exit(1);
  }

  console.log(`[forum-scrape] categories: ${categories.map((c) => c.slug).join(', ')}`);
  console.log(`[forum-scrape] max-pages per category: ${opts.maxPages}`);

  // Load existing tek_docs index so we can dedupe by chunk id.
  const existing = readStore();
  const existingIds = new Set(existing.map((c) => c.id));
  console.log(`[forum-scrape] existing tek_docs chunks: ${existing.length}`);

  const newChunks: RagChunk[] = [];
  let totalThreadsScraped = 0;
  let totalFails = 0;

  for (const cat of categories) {
    console.log(`\n[category ${cat.slug}] enumerating threads…`);
    const uuids = await enumerateThreadUuids(cat, opts.maxPages);
    console.log(`[category ${cat.slug}] found ${uuids.length} unique thread UUIDs`);
    if (opts.dryRun) continue;

    for (const [idx, uuid] of uuids.entries()) {
      const id = `tekforum_${cat.slug}_${uuid.slice(0, 12)}`;
      // Skip if ANY chunk with this thread id-prefix already exists (re-runs idempotent)
      let alreadyHave = false;
      for (const eid of existingIds) {
        if (eid.startsWith(id)) { alreadyHave = true; break; }
      }
      if (alreadyHave) continue;

      const url = `${FORUM_BASE}/${cat.slug}/${uuid}`;
      const html = await fetchPage(url);
      await new Promise((r) => setTimeout(r, POLITE_DELAY_MS));
      if (!html) { totalFails++; continue; }

      const parsed = parseThread(html);
      if (!parsed || !parsed.title || parsed.body.length < 200) { totalFails++; continue; }

      const scrubbedBody = scrub(parsed.body);
      if (scrubbedBody.length < 200) { totalFails++; continue; }

      const familyTags = Array.from(new Set<string>([
        ...(cat.defaultProducts || []),
        ...inferFamilies(`${parsed.title} ${scrubbedBody}`),
      ]));

      const baseTags = [
        `tekforum_${cat.slug}`,
        'forum',
        'tektalk',
        'tektronix',
        'tek_com',
        cat.slug,
        ...familyTags,
      ];

      const pieces = chunkText(scrubbedBody);
      pieces.forEach((bodyPiece, i) => {
        const chunkId = `${id}_p${i + 1}`;
        if (existingIds.has(chunkId)) return;
        existingIds.add(chunkId);
        newChunks.push({
          id: chunkId,
          corpus: 'tek_docs',
          title: parsed.title,
          body: bodyPiece,
          tags: [...baseTags],
          source: url,
        });
      });

      totalThreadsScraped++;
      if ((idx + 1) % 25 === 0) {
        console.log(`  [${cat.slug}] thread ${idx + 1}/${uuids.length} | scraped=${totalThreadsScraped} fails=${totalFails} new_chunks=${newChunks.length}`);
      }
    }
    console.log(`[category ${cat.slug}] done: ${uuids.length} threads, new chunks in this cat so far: ${newChunks.length}`);

    // Persist after each category so long runs survive interruption
    const snapshot = [...existing, ...newChunks];
    writeStore(snapshot);
    updateRagManifestCount(snapshot.length);
  }

  console.log(`\n[done] threads_scraped=${totalThreadsScraped} fails=${totalFails} new_chunks=${newChunks.length}`);
  console.log(`tek_docs total: ${existing.length + newChunks.length}`);
  console.log(`Next: npx tsx scripts/buildRagIndex.ts   (re-shard with new chunks)`);
}

main().catch((err) => { console.error('[fatal]', err); process.exit(1); });
