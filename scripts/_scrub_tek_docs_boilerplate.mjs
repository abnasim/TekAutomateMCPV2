// Post-processing scrubber — strips tek.com page-chrome boilerplate from
// tek_docs_index.json chunk bodies that the scraper missed.
//
// Run: node scripts/_scrub_tek_docs_boilerplate.mjs
//      npx tsx scripts/buildRagIndex.ts   (to re-shard)
//
// Why post-process instead of re-scrape: re-scraping takes 30-50 min of
// polite delays. Applying text scrubs to existing bodies is ~100ms and
// produces equivalent results.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.resolve(here, '..', 'public', 'rag', 'tek_docs_index.json');

// Patterns to strip. Each is a RegExp applied with /g + /i flags.
const PATTERNS = [
  // tek.com page chrome block that leads every app-note/primer/whitepaper.
  // Structure: "WORD Feedback Have feedback? We'd love to hear your thoughts.
  // Let us know ... Tell us what you think Tektronix <TITLE> <TITLE> Please
  // Login/register ... Login × Download File <ACTUAL BODY>"
  // We strip from "WORD Feedback" through the end-of-chrome marker. Different
  // page types have different markers:
  //   - App notes / primers / whitepapers: "Download File " sits right before body
  //   - FAQs: "Answer :" sits right before the answer text
  //   - Manuals: the repeated section heading is the first real content
  // We keep the 1,500-char cap so we don't over-strip.
  /WORD Feedback[\s\S]{0,1500}?(?:Download File|Answer\s*:)\s*/gi,
  // Shorter variant without "WORD Feedback" prefix (some pages)
  /Have feedback\?\s+We[' ]?d love to hear your thoughts[\s\S]{0,1200}?(?:Download File|Answer\s*:)\s*/gi,
  // Login/register chrome that appears mid-body on some pages
  /Please Login\/register to save starred items to Your Library\.\s*Login\s*[×x]\s*Download File\s*/gi,
  // Tell us what you think widget (abbreviated form)
  /Tell us what you think Tektronix\s+[A-Z][\w\s\-:,&]{5,150}\1?\s*Please Login\/register[\s\S]{0,200}?Download File\s*/gi,
  // tek.com right-rail nav / "Contact us" block (appears on MANY pages)
  /Contact us\s+Request Services\s+Quote\s+Parts Ordering\s+Request Sales Contact\s+Request Technical Support[\s\S]{0,500}?(?:Need help on product se[a-z]*\?)?/gi,
  /Request Services\s+Quote\s+Parts Ordering\s+Request Sales Contact\s+Request Technical Support[\s\S]{0,300}?/gi,
  // "Need help on product selection?" CTA block in various shapes
  /Need help on product selection\?[\s\S]{0,400}?(?:Chat with Sales|Contact a Tektronix|learn more|Call us at|Feedback)/gi,
  /Chat with Sales\s+Available[\s\S]{0,300}?PST/gi,
  /Call us at\s+Available[\s\S]{0,300}?PST/gi,
  /(?:Available\s+6:00 AM\s+[-–]\s+5:00 PM PST[\s\S]{0,200})/gi,
  /Chat with an Expert[\s\S]{0,200}?available/gi,
  // Newsletter / sign-up CTAs
  /Join our (?:newsletter|email list)[\s\S]{0,200}?subscribe/gi,
  // "Manuals, Datasheets, Software and more:" menu block
  /Manuals[,\s]+Datasheets[,\s]+Software and more:[\s\S]{0,200}/gi,
  // Generic support-link cluster
  /Product support\s+Documentation\s+Software\s+Service/gi,
  // Feedback widget
  /Whether positive or negative,[\s\S]{0,200}?experience\.?/gi,
  /Let us know if you[' ]?re[\s\S]{0,200}?feedback\./gi,
  /We[' ]?ll use your feedback[\s\S]{0,200}?\./gi,
  /Was this information helpful\??/gi,
  /Submit\s+Thank you for your feedback\.?/gi,
  // Cookie/login chrome
  /Accept all cookies/gi,
  /Cookie preferences/gi,
  /Sign in to (?:your|my) (?:account|TekCloud)/gi,
  // Breadcrumb / nav path lists
  /Home\s*\/\s*Support\s*\/\s*Documents\s*\/\s*/gi,
  /Product support\s+Documentation\s+Software\s+Service\s+/gi,
  // "Need help on product selection?" CTA block
  /Need help on product selection\?[\s\S]{0,200}?(?:Contact a Tektronix (?:representative|expert)|learn more)\.?/gi,
  // Common footer-y phrase clusters seen in empty-body pages
  /Request Technical Support\s+Return Material Authorization\s+/gi,
  /Manuals, Datasheets, Software and more:?/gi,
];

const raw = fs.readFileSync(INDEX_PATH, 'utf-8');
const chunks = JSON.parse(raw);
if (!Array.isArray(chunks)) {
  console.error('tek_docs_index.json is not an array');
  process.exit(1);
}

let touched = 0;
let dropped = 0;
let totalCharsBefore = 0;
let totalCharsAfter = 0;
const kept = [];
for (const c of chunks) {
  if (!c || typeof c.body !== 'string') { kept.push(c); continue; }
  totalCharsBefore += c.body.length;
  let cleaned = c.body;
  for (const p of PATTERNS) cleaned = cleaned.replace(p, ' ');
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
  totalCharsAfter += cleaned.length;

  if (cleaned.length < 80) {
    // After scrub, body is essentially just chrome. Drop it.
    dropped++;
    continue;
  }
  if (cleaned !== c.body) touched++;
  c.body = cleaned;
  kept.push(c);
}

fs.writeFileSync(INDEX_PATH, JSON.stringify(kept, null, 2));
console.log(`chunks input=${chunks.length} kept=${kept.length} touched=${touched} dropped=${dropped}`);
console.log(`total body chars: ${totalCharsBefore.toLocaleString()} → ${totalCharsAfter.toLocaleString()}  (${((totalCharsAfter/totalCharsBefore)*100).toFixed(1)}% retained)`);
console.log(`Run:  npx tsx scripts/buildRagIndex.ts`);
