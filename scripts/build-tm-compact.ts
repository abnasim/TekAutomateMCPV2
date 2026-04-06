/**
 * Pre-process tm_devices JSON files into a compact index.
 *
 * Input:  tm_devices_full_tree.json (14MB) + tm_devices_docstrings.json (28MB)
 * Output: tm_devices_compact.json (~1-2MB)
 *
 * The compact index deduplicates methods (242K → ~15K unique) and stores
 * only method path, short description, and which model families support it.
 *
 * Run: npx tsx scripts/build-tm-compact.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMANDS_DIR = path.resolve(__dirname, '..', '..', 'public', 'commands');

interface CompactMethod {
  /** Deduplicated method path, e.g. "acquire.fastacq.palette.query" */
  p: string;
  /** Short description (first 150 chars) */
  d: string;
  /** Usage example (first 100 chars) */
  u: string;
  /** Model families that support this method, e.g. ["MSO4","MSO5","MSO6","DPO7"] */
  f: string[];
}

function walk(node: unknown, prefix: string[], out: string[]): void {
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'cmd_syntax') continue;
    if (value === 'METHOD') {
      out.push([...prefix, key].join('.'));
      continue;
    }
    walk(value, [...prefix, key], out);
  }
}

function rootToShortName(root: string): string {
  const cls = root.split('.')[1] || root;
  return cls.replace(/Commands$/, '').toUpperCase();
}

function main() {
  console.log('Reading tree...');
  const tree = JSON.parse(fs.readFileSync(path.join(COMMANDS_DIR, 'tm_devices_full_tree.json'), 'utf8'));
  console.log('Reading docstrings...');
  const docstrings = JSON.parse(fs.readFileSync(path.join(COMMANDS_DIR, 'tm_devices_docstrings.json'), 'utf8'));

  // Map: methodPath → { description, usage, families[] }
  const methodMap = new Map<string, { d: string; u: string; f: Set<string> }>();

  for (const [root, rootNode] of Object.entries(tree)) {
    const methods: string[] = [];
    walk(rootNode, [], methods);
    const shortName = rootToShortName(root);
    const modelDocstrings = (docstrings[shortName] || docstrings[shortName.replace(/\d[A-Z]?$/, '')] || {}) as Record<string, unknown>;

    for (const methodPath of methods) {
      const parts = methodPath.split('.');
      const parentPath = parts.length > 1 ? parts.slice(0, -1).join('.') : methodPath;
      const ds = modelDocstrings[parentPath];
      const dsEntry = ds && typeof ds === 'object' ? (ds as Record<string, unknown>) : null;
      const description = dsEntry ? String(dsEntry.description || '').slice(0, 150) : '';
      const usageArr = Array.isArray(dsEntry?.usage) ? (dsEntry!.usage as string[]) : [];
      const usage = usageArr.slice(0, 1).join(' ').slice(0, 100);

      const existing = methodMap.get(methodPath);
      if (existing) {
        existing.f.add(shortName);
        // Keep the longer description
        if (description.length > existing.d.length) existing.d = description;
        if (usage.length > existing.u.length) existing.u = usage;
      } else {
        methodMap.set(methodPath, { d: description, u: usage, f: new Set([shortName]) });
      }
    }
  }

  // Group families into family groups for compactness
  // e.g. MSO4, MSO4B, MSO4K, MSO4KB → "MSO4*"
  function compactFamilies(families: Set<string>): string[] {
    const arr = Array.from(families).sort();
    // Group by base family (strip trailing letter variants)
    const groups = new Map<string, string[]>();
    for (const f of arr) {
      const base = f.replace(/[BK]+$/i, '');
      if (!groups.has(base)) groups.set(base, []);
      groups.get(base)!.push(f);
    }
    // If all variants of a base are present, use base + "*"
    const result: string[] = [];
    for (const [base, variants] of groups) {
      if (variants.length >= 3) {
        result.push(base + '*');
      } else {
        result.push(...variants);
      }
    }
    return result;
  }

  // Build compact array
  const compact: CompactMethod[] = [];
  for (const [methodPath, info] of methodMap) {
    compact.push({
      p: methodPath,
      d: info.d,
      u: info.u,
      f: compactFamilies(info.f),
    });
  }

  // Sort by method path for consistency
  compact.sort((a, b) => a.p.localeCompare(b.p));

  const output = JSON.stringify(compact);
  const outPath = path.join(COMMANDS_DIR, 'tm_devices_compact.json');
  fs.writeFileSync(outPath, output);

  const sizeMB = (output.length / 1024 / 1024).toFixed(1);
  console.log(`\nDone!`);
  console.log(`  Models: ${Object.keys(tree).length}`);
  console.log(`  Total methods: ${Array.from(methodMap.values()).reduce((s, v) => s + v.f.size, 0)}`);
  console.log(`  Unique methods: ${compact.length}`);
  console.log(`  Dedup ratio: ${(1 - compact.length / 242092).toFixed(1)}x`);
  console.log(`  Output: ${outPath}`);
  console.log(`  Size: ${sizeMB}MB (was 44MB)`);
}

main();
