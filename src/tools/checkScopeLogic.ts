import { getRagIndexes } from '../core/ragIndex';
import type { ToolResult } from '../core/schemas';

interface CheckScopeLogicInput {
  query: string;
  topK?: number;
}

/**
 * Lightweight scope_logic lookup. Returns pre-checked procedures
 * for scope operations (clipping fix, decode setup, signal integrity, etc.).
 * AI calls this before starting multi-step scope work.
 */
export async function checkScopeLogic(
  input: CheckScopeLogicInput
): Promise<ToolResult<Record<string, unknown>>> {
  const q = (input.query || '').trim();
  if (!q) {
    return { ok: true, data: { procedures: [] }, sourceMeta: [], warnings: ['Empty query — no procedure matched.'] };
  }

  const rag = await getRagIndexes();
  const topK = input.topK || 2;
  const chunks = rag.search('scope_logic', q, topK);

  if (!chunks.length) {
    return {
      ok: true,
      data: { procedures: [], message: 'No matching scope_logic procedure found. Proceed with your own engineering judgment.' },
      sourceMeta: [],
      warnings: [],
    };
  }

  const procedures = chunks.map((c) => ({
    id: c.id,
    title: c.title,
    body: c.body,
    source: c.source,
  }));

  return {
    ok: true,
    data: {
      procedures,
      message: '## SCOPE_LOGIC — Follow these pre-checked procedures before acting.',
    },
    sourceMeta: chunks.map((c) => ({
      file: c.source || `rag:scope_logic`,
      commandId: c.id,
      section: c.pathHint,
    })),
    warnings: [],
  };
}
