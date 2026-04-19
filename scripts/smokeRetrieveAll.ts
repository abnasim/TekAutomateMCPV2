/**
 * Smoke test for knowledge{action:"retrieve"} cross-corpus fan-out.
 * Run: npx tsx scripts/smokeRetrieveAll.ts
 *
 * Calls knowledge with a real query that should produce hits across
 * multiple corpora (videos, tek_docs, scpi, possibly templates/lessons),
 * then prints the fused top hits + by_source counts. No instrument
 * connection needed — everything reads from static indexes.
 */

import { knowledge } from '../src/tools/knowledge';

async function main() {
  const queries = [
    { query: 'mso2 i2c decode', products: ['MSO2'] },
    { query: 'trigger level setup', products: ['MSO6'] },
    { query: 'mask testing', products: ['MSO4'] },
  ];

  for (const q of queries) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`QUERY: "${q.query}"  products=${JSON.stringify(q.products)}`);
    console.log('='.repeat(80));
    const result = await knowledge({
      action: 'retrieve',
      query: q.query,
      products: q.products,
      topK: 10,
    });
    if (!result.ok) {
      console.log('FAIL:', JSON.stringify(result, null, 2));
      continue;
    }
    const data: any = result.data;
    console.log(`by_source: ${JSON.stringify(data.by_source)}`);
    console.log(`total hits: ${data.total} (of ${data.allHitsCount} merged)`);
    console.log(`--- top ${data.hits.length} fused hits ---`);
    for (const h of data.hits) {
      const snip = (h.snippet || '').slice(0, 120).replace(/\n/g, ' ');
      console.log(`  [${h.source} rank=${h.rank} score=${h.fusedScore.toFixed(5)}]  ${h.title.slice(0, 80)}`);
      console.log(`    ${snip}${snip.length >= 120 ? '…' : ''}`);
    }
    if (result.warnings?.length) console.log(`warnings: ${JSON.stringify(result.warnings)}`);
  }
}

main().catch((err) => { console.error('[fatal]', err); process.exit(1); });
