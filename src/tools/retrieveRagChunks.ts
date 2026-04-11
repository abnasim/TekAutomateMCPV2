import { getRagIndexes, type RagCorpus } from '../core/ragIndex';
import type { ToolResult } from '../core/schemas';

interface RetrieveRagChunksInput {
  corpus: RagCorpus;
  query: string;
  topK?: number;
  modelFamily?: string;
}

export async function retrieveRagChunks(
  input: RetrieveRagChunksInput
): Promise<ToolResult<unknown[]>> {
  const q = (input.query || '').trim();
  if (!q) {
    return { ok: true, data: [], sourceMeta: [], warnings: ['Empty query'] };
  }
  const rag = await getRagIndexes();
  const chunks = rag.search(input.corpus, q, input.topK || 5, input.modelFamily);
  return {
    ok: true,
    data: chunks.map((c) => {
      const { text, ...rest } = c;
      return rest;
    }),
    sourceMeta: chunks.map((c) => ({
      file: c.source || `rag:${c.corpus}`,
      commandId: c.id,
      section: c.pathHint,
    })),
    warnings: chunks.length ? [] : ['No RAG chunks matched query'],
  };
}
