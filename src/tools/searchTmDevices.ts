import { getTmDevicesIndex } from '../core/tmDevicesIndex';
import type { ToolResult } from '../core/schemas';

interface SearchTmDevicesInput {
  query: string;
  model?: string;
  limit?: number;
}

function methodPathCandidates(raw: string): string[] {
  const q = String(raw || '').trim();
  if (!q) return [];
  const candidates = new Set<string>([q]);
  candidates.add(q.replace(/\[\d+\]/g, '[x]'));
  candidates.add(q.replace(/\bch\d+\b/gi, 'ch[x]'));
  return Array.from(candidates).filter(Boolean);
}

// Timeout wrapper — tm_devices index can be slow to load (14MB tree + 28MB docs)
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export async function searchTmDevices(
  input: SearchTmDevicesInput
): Promise<ToolResult<unknown[]>> {
  const q = (input.query || '').trim();
  if (!q) {
    return { ok: true, data: [], sourceMeta: [], warnings: ['Empty query'] };
  }

  let index;
  try {
    index = await withTimeout(getTmDevicesIndex(), 15000, 'tm_devices index load');
  } catch (err) {
    return {
      ok: false,
      data: [],
      sourceMeta: [],
      warnings: [`tm_devices index unavailable: ${err instanceof Error ? err.message : String(err)}. The tm_devices tree is very large — try again after server fully starts.`],
    };
  }

  const limit = input.limit || 10;
  const directDocs = (q.includes('.') || /\[[x0-9]+\]/i.test(q))
    ? methodPathCandidates(q)
        .map((candidate) => index.getByMethodPath(candidate, input.model))
        .filter((doc): doc is NonNullable<typeof doc> => Boolean(doc))
        .map((doc) => ({ ...doc, availableForModel: true }))
    : [];
  const fuzzyDocs = index.search(q, input.model, limit);
  const seen = new Set<string>();
  const docs = [...directDocs, ...fuzzyDocs].filter((doc) => {
    const key = `${doc.modelRoot}:${doc.methodPath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
  return {
    ok: true,
    data: docs.map((d) => ({
      modelRoot: d.modelRoot,
      methodPath: d.methodPath,
      signature: d.signature,
      description: d.text,
      usageExample: d.usageExample,
      availableForModel: d.availableForModel,
      warning: d.availableForModel ? undefined : 'Method unavailable for requested model',
    })),
    sourceMeta: docs.map((d) => ({
      file: 'tm_devices_full_tree.json',
      commandId: d.methodPath,
      section: d.modelRoot,
    })),
    warnings: docs.length ? [] : ['No tm_devices methods matched query'],
  };
}
