import { promises as fs } from 'fs';
import * as path from 'path';
import { Bm25Index } from './bm25';
import { resolveCommandsDir } from './paths';

export interface TmMethodDoc {
  id: string;
  modelRoot: string;
  methodPath: string;
  signature: string;
  usageExample: string;
  text: string;
}

/** Compact index entry (from tm_devices_compact.json) */
interface CompactEntry {
  p: string;  // method path
  d: string;  // description
  u: string;  // usage example
  f: string[]; // model families
}

/**
 * Fuzzy model filter: normalise both sides and check for substring inclusion.
 * Handles "MSO56" → matches both MSO5 and MSO6 families.
 * Also handles wildcard families like "MSO4*" from the compact index.
 */
function familyMatches(families: string[], filter?: string): boolean {
  if (!filter) return true;
  const f = filter.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!f) return true;
  for (const fam of families) {
    const famLower = fam.toLowerCase().replace(/[^a-z0-9*]/g, '');
    // Wildcard: "MSO4*" matches "mso4", "mso4b", "mso4k"
    if (famLower.endsWith('*')) {
      const base = famLower.slice(0, -1);
      if (f.startsWith(base)) return true;
    }
    if (famLower.includes(f) || f.includes(famLower)) return true;
  }
  // Expanded digit match: "mso56" → try "mso5" and "mso6"
  const m = f.match(/^([a-z]+)(\d{2,})$/);
  if (m) {
    const alpha = m[1];
    for (const d of m[2]) {
      const probe = alpha + d;
      for (const fam of families) {
        const famLower = fam.toLowerCase().replace(/[^a-z0-9*]/g, '');
        if (famLower.startsWith(probe) || famLower.replace(/\*$/, '') === probe) return true;
      }
    }
  }
  return false;
}

// Legacy model root matching (for backward compat)
function modelMatches(modelRoot: string, filter?: string): boolean {
  if (!filter) return true;
  const root = modelRoot.toLowerCase().replace(/[^a-z0-9]/g, '');
  const f = filter.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!f) return true;
  if (root.includes(f)) return true;
  const m = f.match(/^([a-z]+)(\d{2,})$/);
  if (m) {
    for (const d of m[2]) {
      if (root.includes(m[1] + d)) return true;
    }
  }
  return false;
}

export class TmDevicesIndex {
  readonly docs: TmMethodDoc[];
  private readonly bm25: Bm25Index<TmMethodDoc>;

  constructor(docs: TmMethodDoc[]) {
    this.docs = docs;
    this.bm25 = new Bm25Index<TmMethodDoc>(docs);
  }

  search(query: string, model?: string, limit = 10): Array<TmMethodDoc & { availableForModel: boolean }> {
    let pool: TmMethodDoc[];
    if (model) {
      pool = this.docs.filter((d) => modelMatches(d.modelRoot, model));
    } else {
      pool = this.docs;
    }
    const usingFilteredPool = pool.length > 0;
    if (!usingFilteredPool) pool = this.docs;

    const poolIndex = new Bm25Index<TmMethodDoc>(pool);
    const results = poolIndex.search(query, Math.max(limit * 3, 20));
    const out: Array<TmMethodDoc & { availableForModel: boolean }> = [];
    for (const r of results) {
      const availableForModel = usingFilteredPool
        ? modelMatches(r.doc.modelRoot, model)
        : false;
      out.push({ ...r.doc, availableForModel });
      if (out.length >= limit) break;
    }
    return out;
  }

  getByMethodPath(methodPath: string, model?: string): TmMethodDoc | null {
    const requested = String(methodPath || '').trim().toLowerCase();
    if (!requested) return null;
    const exact = this.docs
      .filter((doc) => doc.methodPath.toLowerCase() === requested && modelMatches(doc.modelRoot, model))
      .sort((a, b) => `${a.modelRoot}:${a.methodPath}`.localeCompare(`${b.modelRoot}:${b.methodPath}`));
    if (exact.length) return exact[0];
    const fallback = this.docs
      .filter((doc) => doc.methodPath.toLowerCase() === requested)
      .sort((a, b) => `${a.modelRoot}:${a.methodPath}`.localeCompare(`${b.modelRoot}:${b.methodPath}`));
    return fallback[0] || null;
  }
}

let _tmPromise: Promise<TmDevicesIndex> | null = null;

/**
 * Load tm_devices index — tries compact file first (~4MB), falls back to full files (~44MB).
 */
export async function initTmDevicesIndex(options?: {
  commandsDir?: string;
}): Promise<TmDevicesIndex> {
  if (_tmPromise) return _tmPromise;
  _tmPromise = (async () => {
    const commandsDir = options?.commandsDir || resolveCommandsDir();
    const compactPath = path.join(commandsDir, 'tm_devices_compact.json');

    // Try compact index first (pre-built, deduplicated, ~4MB)
    try {
      const raw = await fs.readFile(compactPath, 'utf8');
      const entries = JSON.parse(raw) as CompactEntry[];
      const docs: TmMethodDoc[] = entries.map((e) => ({
        id: e.p.toLowerCase(),
        modelRoot: e.f.join(','),
        methodPath: e.p,
        signature: `${e.p}()`,
        usageExample: e.u || e.d,
        text: `${e.f.join(' ')} ${e.p} ${e.d} ${e.u}`.trim(),
      }));
      console.log(`[tm_devices] Loaded compact index: ${docs.length} methods from ${(raw.length / 1024 / 1024).toFixed(1)}MB`);
      return new TmDevicesIndex(docs);
    } catch {
      // Compact file not found — fall through to full files
    }

    // Fallback: full tree + docstrings (legacy path, ~44MB)
    console.log('[tm_devices] Compact index not found, loading full tree (slow)...');
    const treePath = path.join(commandsDir, 'tm_devices_full_tree.json');
    const docsPath = path.join(commandsDir, 'tm_devices_docstrings.json');
    const treeRaw = await fs.readFile(treePath, 'utf8');
    const tree = JSON.parse(treeRaw) as Record<string, unknown>;
    let docstrings: Record<string, unknown> = {};
    try {
      docstrings = JSON.parse(await fs.readFile(docsPath, 'utf8')) as Record<string, unknown>;
    } catch { docstrings = {}; }

    function walk(node: unknown, prefix: string[], out: string[]): void {
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === 'cmd_syntax') continue;
        if (value === 'METHOD') { out.push([...prefix, key].join('.')); continue; }
        walk(value, [...prefix, key], out);
      }
    }

    function rootToShortName(root: string): string {
      const cls = root.split('.')[1] || root;
      return cls.replace(/Commands$/, '');
    }

    const docs: TmMethodDoc[] = [];
    for (const [root, rootNode] of Object.entries(tree)) {
      const methods: string[] = [];
      walk(rootNode, [], methods);
      const shortName = rootToShortName(root);
      const modelDocstrings = (docstrings[shortName] || {}) as Record<string, unknown>;
      methods.forEach((methodPath) => {
        const parts = methodPath.split('.');
        const parentPath = parts.length > 1 ? parts.slice(0, -1).join('.') : methodPath;
        const ds = modelDocstrings[parentPath];
        const dsEntry = ds && typeof ds === 'object' ? (ds as Record<string, unknown>) : null;
        const description = dsEntry ? String(dsEntry.description || '') : '';
        const usageArr = Array.isArray(dsEntry?.usage) ? (dsEntry!.usage as string[]) : [];
        const usageExample = usageArr.slice(0, 2).join(' ');
        const text = `${shortName} ${methodPath} ${description} ${usageExample}`.trim();
        docs.push({
          id: `${root}.${methodPath}`.toLowerCase(),
          modelRoot: root,
          methodPath,
          signature: `${methodPath}()`,
          usageExample: usageExample || description,
          text,
        });
      });
    }
    console.log(`[tm_devices] Loaded full tree: ${docs.length} methods`);
    return new TmDevicesIndex(docs);
  })();
  return _tmPromise;
}

export async function getTmDevicesIndex(): Promise<TmDevicesIndex> {
  return initTmDevicesIndex();
}
