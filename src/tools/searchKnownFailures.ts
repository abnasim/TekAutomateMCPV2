import { getRagIndexes } from '../core/ragIndex';
import type { ToolResult } from '../core/schemas';

interface SearchKnownFailuresInput {
  query: string;
  limit?: number;
}

function extractFailureFields(body: string): {
  symptom: string;
  root_cause: string;
  fix: string;
  code_before: string;
  code_after: string;
} {
  const lines = body.split(/\r?\n/).map((l) => l.trim());
  const first = lines[0] || '';
  const second = lines[1] || '';
  return {
    symptom: first || body.slice(0, 120),
    root_cause: second || '',
    fix: lines.slice(2, 5).join(' '),
    code_before: '',
    code_after: '',
  };
}

export async function searchKnownFailures(
  input: SearchKnownFailuresInput
): Promise<ToolResult<unknown[]>> {
  const q = (input.query || '').trim();
  if (!q) return { ok: true, data: [], sourceMeta: [], warnings: ['Empty query'] };
  const rag = await getRagIndexes();
  const chunks = rag.search('errors', q, input.limit || 5);
  return {
    ok: true,
    data: chunks.map((c) => ({
      id: c.id,
      title: c.title,
      ...extractFailureFields(c.body),
      affected_files: [c.pathHint].filter(Boolean),
    })),
    sourceMeta: chunks.map((c) => ({
      file: c.source || 'rag:errors',
      commandId: c.id,
      section: c.pathHint,
    })),
    warnings: chunks.length ? [] : ['No known failures matched query'],
  };
}
