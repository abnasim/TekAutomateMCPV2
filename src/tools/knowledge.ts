import { getFirmware } from './firmware';
import { getTemplateExamples } from './getTemplateExamples';
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
      // Special-case corpora that aren't RAG indexes — direct handlers
      // read their own stores.
      const corpus = typeof args.corpus === 'string' ? args.corpus.toLowerCase() : '';
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
