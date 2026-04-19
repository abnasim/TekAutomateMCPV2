/**
 * Quality evaluation for knowledge{action:"retrieve"} cross-corpus fan-out.
 * Run: npx tsx scripts/evalKnowledgeQuality.ts
 *
 * Runs a curated set of real-world scope-engineer queries spanning:
 *  - Baseline / easy topics
 *  - Product-specific queries (with products[] filter)
 *  - Remote automation / forum-shaped questions
 *  - Measurement / analysis topics
 *  - Diagnostic / troubleshooting
 *  - Hard / specific (edge of corpus)
 *  - Potentially weak areas (we may lack coverage)
 *
 * For each query, prints:
 *  - by_source counts (how corpora contributed)
 *  - Top 5 fused hits: source, title, snippet, url
 *  - Auto-flags: TITLE_MATCH, PRODUCT_MATCH, DIVERSITY, FORUM/VIDEO presence
 *
 * Final scoreboard rolls up pass/fail rates per evaluation axis.
 */

import { knowledge } from '../src/tools/knowledge';

// ── Evaluation axes ──────────────────────────────────────────────────────────
interface QueryCase {
  category: string;
  query: string;
  products?: string[];
  // Expected signals — used to auto-grade
  expectKeywords?: string[];        // at least one should appear in top-3 title+snippet
  expectForumPresence?: boolean;    // should we expect forum hits?
  expectVideoPresence?: boolean;    // should we expect video hits?
  expectProductInTop3?: boolean;    // should top-3 reference the product family?
}

const CASES: QueryCase[] = [
  // ── Baseline: should return strong results across corpora
  { category: 'baseline', query: 'I2C bus decode setup', products: ['MSO6'],
    expectKeywords: ['i2c', 'bus', 'decode'], expectProductInTop3: true },
  { category: 'baseline', query: 'trigger on rising edge', products: ['MSO5'],
    expectKeywords: ['trigger', 'edge'] },
  { category: 'baseline', query: 'capture waveform to USB drive', products: ['MSO2'],
    expectKeywords: ['waveform', 'save', 'usb'] },

  // ── Product-specific: force product filter to pull family-tagged content
  { category: 'product-specific', query: 'MSO44 USB connection labview', products: ['MSO4'],
    expectKeywords: ['mso44', 'labview', 'usb'], expectForumPresence: true },
  { category: 'product-specific', query: 'MDO4104C reference level reading', products: ['MDO4000'],
    expectKeywords: ['mdo4104c', 'reference', 'level'], expectForumPresence: true },
  { category: 'product-specific', query: '6 Series B MSO clipping warnings', products: ['MSO6B'],
    expectKeywords: ['clipping', '6 series'] },
  { category: 'product-specific', query: '2 Series portable battery runtime', products: ['MSO2'],
    expectKeywords: ['2 series', 'battery'] },

  // ── Remote automation: SCPI + forum-heavy
  { category: 'automation', query: 'Python PyVISA query timeout oscilloscope',
    expectKeywords: ['pyvisa', 'timeout', 'python'], expectForumPresence: true },
  { category: 'automation', query: 'fetch waveform binary transfer CURVe',
    expectKeywords: ['curve', 'waveform', 'binary'] },
  { category: 'automation', query: 'OPC polling after long command',
    expectKeywords: ['opc', 'wait', 'polling'] },
  { category: 'automation', query: 'tm_devices python library connect scope',
    expectKeywords: ['tm_devices', 'python', 'connect'] },

  // ── Measurement / analysis
  { category: 'measurement', query: 'jitter measurement setup eye diagram',
    expectKeywords: ['jitter', 'eye'] },
  { category: 'measurement', query: 'rise time measurement accuracy',
    expectKeywords: ['rise', 'time'] },
  { category: 'measurement', query: 'spectrum view frequency domain analysis',
    expectKeywords: ['spectrum', 'frequency'] },
  { category: 'measurement', query: 'mask testing eye diagram failure',
    expectKeywords: ['mask', 'eye'] },

  // ── Diagnostic / troubleshooting
  { category: 'diagnostic', query: 'measurement returns 9.9E37 invalid',
    expectKeywords: ['9.9e37', '9.9', 'measurement'] },
  { category: 'diagnostic', query: 'decoded bus shows wrong values threshold',
    expectKeywords: ['decode', 'threshold'] },
  { category: 'diagnostic', query: 'scope flat line no signal waveform',
    expectKeywords: ['signal', 'flat'] },

  // ── Hard / specific
  { category: 'hard', query: 'double pulse test SiC GaN wide bandgap',
    expectKeywords: ['double pulse', 'sic', 'gan', 'wide bandgap'] },
  { category: 'hard', query: 'FastFrame segmented memory acquisition',
    expectKeywords: ['fastframe', 'segmented'] },
  { category: 'hard', query: 'DDR3 memory bus electrical verification',
    expectKeywords: ['ddr', 'memory'] },

  // ── Edge cases — may be weak
  { category: 'edge', query: 'DPO70000SX optical PAM4 compliance', products: ['DPO70000'],
    expectKeywords: ['pam4', 'optical'] },
  { category: 'edge', query: 'MDO3000 spectrum analyzer DVM', products: ['MDO3000'],
    expectKeywords: ['mdo3000', 'dvm', 'spectrum'], expectForumPresence: true },
];

// ── Grading ──────────────────────────────────────────────────────────────────
interface GradeResult {
  query: string;
  category: string;
  pass: {
    titleKeywordMatch: boolean;
    productInTop3: boolean;
    forumPresence: boolean;
    videoPresence: boolean;
    diversity: boolean;
    anyHits: boolean;
  };
  byProduct: Record<string, number>;
  sources: string[];
  topTitles: string[];
  diversity: number;
  flags: string[];
}

function normLower(s: unknown): string {
  return typeof s === 'string' ? s.toLowerCase() : '';
}

function hitKeywordMatch(hits: any[], keywords: string[] | undefined): boolean {
  if (!keywords || keywords.length === 0) return true;
  const hay = hits.slice(0, 3).map((h) =>
    [normLower(h.title), normLower(h.snippet)].join(' '),
  ).join(' ');
  return keywords.some((k) => hay.includes(k.toLowerCase()));
}

function productInHits(hits: any[], products: string[] | undefined): boolean {
  if (!products || products.length === 0) return true;
  const prodsLower = products.map((p) => p.toLowerCase());
  for (const h of hits.slice(0, 3)) {
    const hay = [
      normLower(h.title),
      normLower(h.snippet),
      ...(Array.isArray(h.tags) ? h.tags.map(normLower) : []),
      ...(Array.isArray(h.products) ? h.products.map(normLower) : []),
    ].join(' ');
    if (prodsLower.some((p) => hay.includes(p))) return true;
  }
  return false;
}

function isForumHit(h: any): boolean {
  return typeof h.url === 'string' && h.url.includes('my.tek.com/en/tektalk');
}

function gradeOne(c: QueryCase, hits: any[], bySource: Record<string, number>): GradeResult {
  const hasVideo = bySource.videos > 0;
  const hasForum = hits.some(isForumHit);
  const distinctSources = new Set(hits.map((h) => h.source)).size;

  const flags: string[] = [];
  if (c.expectForumPresence && !hasForum) flags.push('NO_FORUM_EXPECTED');
  if (c.expectVideoPresence && !hasVideo) flags.push('NO_VIDEO_EXPECTED');

  const keywordMatch = hitKeywordMatch(hits, c.expectKeywords);
  const prodMatch = c.expectProductInTop3
    ? productInHits(hits, c.products)
    : (c.products && c.products.length > 0 ? productInHits(hits, c.products) : true);

  return {
    query: c.query,
    category: c.category,
    pass: {
      titleKeywordMatch: keywordMatch,
      productInTop3: prodMatch,
      forumPresence: !c.expectForumPresence || hasForum,
      videoPresence: !c.expectVideoPresence || hasVideo,
      diversity: distinctSources >= 2,
      anyHits: hits.length > 0,
    },
    byProduct: {},
    sources: Array.from(new Set(hits.map((h) => h.source as string))),
    topTitles: hits.slice(0, 5).map((h) => `[${h.source}] ${h.title}`),
    diversity: distinctSources,
    flags,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const results: GradeResult[] = [];
  const categoryTotals: Record<string, { total: number; passed: number }> = {};

  for (const c of CASES) {
    console.log(`\n${'='.repeat(84)}`);
    console.log(`[${c.category.toUpperCase()}]  "${c.query}"  products=${JSON.stringify(c.products || [])}`);
    console.log('='.repeat(84));

    const r = await knowledge({
      action: 'retrieve',
      query: c.query,
      products: c.products,
      topK: 10,
    });
    if (!r.ok) {
      console.log('FAIL:', JSON.stringify(r).slice(0, 200));
      continue;
    }
    const d: any = r.data;
    console.log(`by_source: ${JSON.stringify(d.by_source)}  total=${d.total}`);
    for (let i = 0; i < Math.min(d.hits.length, 5); i++) {
      const h = d.hits[i];
      const snip = (h.snippet || '').slice(0, 110).replace(/\s+/g, ' ');
      const urlTag = isForumHit(h) ? ' ★FORUM' : (h.source === 'videos' ? ' ★VIDEO' : '');
      console.log(`  ${(i + 1).toString().padStart(2)}. [${h.source.padEnd(9)} rank=${h.rank}]${urlTag}  ${h.title.slice(0, 80)}`);
      console.log(`        ${snip}${snip.length >= 110 ? '…' : ''}`);
    }

    const grade = gradeOne(c, d.hits, d.by_source);
    results.push(grade);

    const passChecks = Object.entries(grade.pass).filter(([, v]) => v).length;
    const totalChecks = Object.keys(grade.pass).length;
    const marker = passChecks === totalChecks ? '✅' : passChecks >= totalChecks - 1 ? '⚠️' : '❌';
    console.log(`\n  ${marker} GRADE: ${passChecks}/${totalChecks}  sources=[${grade.sources.join(',')}]  diversity=${grade.diversity}  flags=[${grade.flags.join(',')}]`);

    categoryTotals[c.category] = categoryTotals[c.category] || { total: 0, passed: 0 };
    categoryTotals[c.category].total++;
    if (passChecks === totalChecks) categoryTotals[c.category].passed++;
  }

  // ── Scoreboard ─────────────────────────────────────────────────────────────
  console.log(`\n\n${'='.repeat(84)}`);
  console.log('SCOREBOARD');
  console.log('='.repeat(84));

  const axes: Array<keyof GradeResult['pass']> = [
    'anyHits', 'titleKeywordMatch', 'productInTop3', 'forumPresence', 'videoPresence', 'diversity',
  ];
  console.log('\nPer-axis pass rate:');
  for (const a of axes) {
    const passed = results.filter((r) => r.pass[a]).length;
    const pct = Math.round((passed / results.length) * 100);
    const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
    console.log(`  ${a.padEnd(20)} ${bar} ${passed}/${results.length} (${pct}%)`);
  }

  console.log('\nPer-category pass rate (all-axes-pass):');
  for (const [cat, stats] of Object.entries(categoryTotals)) {
    const pct = Math.round((stats.passed / stats.total) * 100);
    const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
    console.log(`  ${cat.padEnd(20)} ${bar} ${stats.passed}/${stats.total} (${pct}%)`);
  }

  const perfectOnes = results.filter((r) => Object.values(r.pass).every((v) => v)).length;
  console.log(`\nQueries with ALL axes passing: ${perfectOnes}/${results.length}`);

  // Source contribution analysis
  console.log('\nSource contribution (across all queries):');
  const srcCounts: Record<string, number> = { tek_docs: 0, videos: 0, scpi: 0, lessons: 0, failures: 0, templates: 0, forum: 0 };
  for (const r of results) for (const s of r.sources) srcCounts[s] = (srcCounts[s] || 0) + 1;
  for (const [s, n] of Object.entries(srcCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s.padEnd(12)} contributed to ${n}/${results.length} queries`);
  }

  // Flag summary
  const allFlags = results.flatMap((r) => r.flags);
  if (allFlags.length > 0) {
    console.log('\nFlagged issues:');
    const counts: Record<string, number> = {};
    for (const f of allFlags) counts[f] = (counts[f] || 0) + 1;
    for (const [f, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${f.padEnd(22)} ×${n}`);
    }
  } else {
    console.log('\nNo flagged issues.');
  }
}

main().catch((err) => { console.error('[fatal]', err); process.exit(1); });
