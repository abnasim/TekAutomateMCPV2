/**
 * Smoke test for cross-corpus retrieve with forum-heavy queries.
 * Run: npx tsx scripts/smokeRetrieveForumAware.ts
 *
 * Uses the same knowledge{retrieve} fan-out but with queries phrased the way
 * a user asking about something would phrase it — expects at least some
 * forum Q&A chunks to surface in the top tek_docs hits.
 */

import { knowledge } from '../src/tools/knowledge';

async function main() {
  const queries = [
    // Pure SCPI/remote-control questions — forum-heavy territory
    { query: 'cannot send SCPI commands timeout' },
    { query: 'VISA labview connection oscilloscope', products: ['MSO4'] },
    { query: 'fetch waveform python', products: ['MSO6'] },
    { query: 'MDO4104C reference level measurement' },
  ];

  for (const q of queries) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`QUERY: "${q.query}"  products=${JSON.stringify(q.products || [])}`);
    console.log('='.repeat(80));
    const result = await knowledge({
      action: 'retrieve',
      query: q.query,
      products: q.products,
      topK: 15,
    });
    if (!result.ok) { console.log('FAIL:', JSON.stringify(result, null, 2)); continue; }
    const data: any = result.data;
    console.log(`by_source: ${JSON.stringify(data.by_source)}`);

    // Count how many tek_docs hits are from forum (source starts with my.tek.com)
    const forumHits = data.hits.filter((h: any) => h.source === 'tek_docs' && typeof h.url === 'string' && h.url.includes('my.tek.com/en/tektalk'));
    console.log(`tek_docs forum hits: ${forumHits.length}`);
    for (const h of forumHits.slice(0, 5)) {
      const snip = (h.snippet || '').slice(0, 140).replace(/\n/g, ' ');
      console.log(`  [rank=${h.rank}]  ${h.title.slice(0, 90)}`);
      console.log(`    ${snip}${snip.length >= 140 ? '…' : ''}`);
      console.log(`    ${h.url}`);
    }

    console.log(`--- top 5 overall fused hits ---`);
    for (const h of data.hits.slice(0, 5)) {
      const snip = (h.snippet || '').slice(0, 100).replace(/\n/g, ' ');
      console.log(`  [${h.source} rank=${h.rank}]  ${h.title.slice(0, 70)}  — ${snip}`);
    }
  }
}

main().catch((err) => { console.error('[fatal]', err); process.exit(1); });
