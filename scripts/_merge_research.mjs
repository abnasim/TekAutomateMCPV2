// One-shot merge of per-family research output into tek_doc_urls.json.
// Run: node scripts/_merge_research.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(here, 'tek_doc_urls.json');
const researchFiles = [
  '_research_mso2_4_4b.json',
  '_research_mso5_5b_6_6b.json',
  '_research_mdo.json',
  '_research_dpo.json',
];

const m = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
if (Array.isArray(m)) {
  console.error('tek_doc_urls.json is still a flat array; convert to v2 first');
  process.exit(1);
}
m.families ||= {};

const stats = {};
for (const f of researchFiles) {
  const p = path.join(here, f);
  if (!fs.existsSync(p)) { console.warn(`missing ${f}, skipping`); continue; }
  const payload = JSON.parse(fs.readFileSync(p, 'utf-8'));
  for (const [fam, urls] of Object.entries(payload)) {
    if (!Array.isArray(urls)) continue;
    const existing = new Set(m.families[fam] || []);
    let added = 0;
    for (const u of urls) {
      if (typeof u !== 'string' || !u.trim()) continue;
      const url = u.trim();
      if (!existing.has(url)) { existing.add(url); added++; }
    }
    m.families[fam] = Array.from(existing);
    stats[fam] = { total: m.families[fam].length, added };
  }
}

m.lastUpdated = new Date().toISOString().slice(0, 10);
fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n');

const sharedCount = Array.isArray(m.shared) ? m.shared.length : 0;
const famTotal = Object.values(m.families).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0);
console.log(`shared: ${sharedCount}`);
console.log(`families (${Object.keys(m.families).length}):`);
for (const [fam, s] of Object.entries(stats).sort((a, b) => b[1].total - a[1].total)) {
  console.log(`  ${fam.padEnd(10)} total=${String(s.total).padStart(3)}  added=${s.added}`);
}
console.log(`family URL total: ${famTotal}`);
console.log(`grand total scrape targets: ${sharedCount + famTotal}`);
