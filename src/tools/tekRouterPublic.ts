import { browseScpiCommands } from './browseScpiCommands';
import { getCommandByHeader } from './getCommandByHeader';
import { searchScpi } from './searchScpi';
import { verifyScpiCommands } from './verifyScpiCommands';
import { findMatchingLessonsSync, saveLesson } from './lessons';

interface TekRouterPublicInput extends Record<string, unknown> {
  action?: string;
  args?: Record<string, unknown>;
  modelFamily?: string;
  query?: string;
  kind?: string;
}

function mergeArgs(input: TekRouterPublicInput): Record<string, unknown> {
  const nested = input.args && typeof input.args === 'object' ? input.args : {};
  const merged = { ...nested, ...input };
  delete (merged as Record<string, unknown>).args;
  return merged as Record<string, unknown>;
}

export async function tekRouterPublic(input: TekRouterPublicInput) {
  const action = String(input.action || '').trim().toLowerCase();
  const args = mergeArgs(input);
  delete args.action;

  switch (action) {
    case 'search': {
      const query = String(args.query || input.query || '').trim();
      const result = await searchScpi({
        ...(args as any),
        query,
        modelFamily: String(args.modelFamily || input.modelFamily || ''),
      });
      // ── Lessons side-channel ──────────────────────────────────────
      // Surface any tag-matching lessons alongside (but explicitly separate
      // from) the SCPI results. Never ranking-boost; the AI reads these as
      // reference notes, not executable commands.
      if (result && typeof result === 'object' && (result as any).ok !== false) {
        const lessons = findMatchingLessonsSync(query, 3);
        if (lessons.length > 0) {
          // Attach at the TOP LEVEL of the ToolResult envelope (sibling of
          // `data`, not under it). searchScpi returns data as an array, and
          // named properties on arrays don't survive JSON.stringify — any
          // data-level attachment would silently vanish on serialisation.
          (result as unknown as Record<string, unknown>).lessons = {
            _note: 'Reference lessons (NOT executable — read and apply to your reasoning; do not dispatch as tools).',
            count: lessons.length,
            entries: lessons.map((l) => ({
              id: l.id,
              lesson: l.lesson,
              observation: l.observation,
              implication: l.implication,
              tags: l.tags,
              modelFamily: l.modelFamily,
            })),
          };
        }
      }
      return result;
    }
    case 'lookup': {
      const header = String(args.header || '').trim();
      return getCommandByHeader({
        ...(args as any),
        header,
        family: String(args.family || args.modelFamily || input.modelFamily || ''),
      });
    }
    case 'browse':
      return browseScpiCommands({
        ...(args as any),
        modelFamily: String(args.modelFamily || input.modelFamily || ''),
      });
    case 'verify':
      return verifyScpiCommands({
        ...(args as any),
        modelFamily: String(args.modelFamily || input.modelFamily || ''),
      });
    case 'save': {
      // Only "lesson" save is supported on the public surface. Anything
      // else (step-sequence shortcuts, etc.) is routed through internal
      // tek_router.create and is NOT reachable from external clients.
      const kind = String(args.kind || input.kind || 'lesson').trim().toLowerCase();
      if (kind !== 'lesson') {
        return {
          ok: false,
          data: {
            error: 'UNSUPPORTED_KIND',
            message: `tek_router{save} only supports kind:"lesson". Received kind:"${kind}". Executable shortcuts/workflows are NOT saveable via the public MCP — use the TekAutomate web UI.`,
          },
          sourceMeta: [],
          warnings: [`Rejected save with kind=${kind}`],
        };
      }
      return saveLesson(args as any);
    }
    default:
      return null;
  }
}
