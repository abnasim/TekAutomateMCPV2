import { getFirmware } from './firmware';
import { getTemplateExamples } from './getTemplateExamples';
import { knowledgeRetrieveAll } from './knowledgeRetrieveAll';
import { retrieveLessons } from './lessons';
import { personality } from './personality';
import { retrieveRagChunks } from './retrieveRagChunks';
import { searchKnownFailures } from './searchKnownFailures';
import { retrieveVideos } from './videos';

interface KnowledgeInput extends Record<string, unknown> {
  action?: string;
  args?: Record<string, unknown>;
}

function mergeArgs(input: KnowledgeInput): Record<string, unknown> {
  const nested = input.args && typeof input.args === 'object' ? input.args : {};
  const merged = { ...nested, ...input };
  delete (merged as Record<string, unknown>).args;
  return merged as Record<string, unknown>;
}

export async function knowledge(input: KnowledgeInput) {
  const action = String(input.action || '').trim().toLowerCase();
  const args = mergeArgs(input);
  delete args.action;

  switch (action) {
    case 'retrieve': {
      const corpus = typeof args.corpus === 'string' ? args.corpus.trim().toLowerCase() : '';
      // Unified cross-corpus retrieval — fan out to every searchable
      // source and fuse via RRF. Default when no corpus is specified,
      // or explicit corpus:"all". This is the "return any knowledge we
      // have" mode — tek_docs + videos + scpi + lessons + failures +
      // templates, ranked together.
      if (!corpus || corpus === 'all') return knowledgeRetrieveAll(args as any);
      // Direct per-corpus handlers for stores that aren't RAG indexes.
      if (corpus === 'lessons') return retrieveLessons(args as any);
      if (corpus === 'videos') return retrieveVideos(args as any);
      return retrieveRagChunks(args as any);
    }
    case 'examples':
      return getTemplateExamples(args as any);
    case 'failures':
      return searchKnownFailures(args as any);
    case 'personality':
      return personality(args as any);
    case 'firmware':
      return getFirmware(args as any);
    default:
      return {
        ok: false,
        data: null,
        sourceMeta: [],
        warnings: ['Unknown knowledge action. Use one of: retrieve, examples, failures, personality, firmware.'],
      };
  }
}
