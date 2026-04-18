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
      // Surface any tag/token-matching lessons alongside (but explicitly
      // separate from) the SCPI results. Never ranking-boost; the AI reads
      // these as reference notes, not executable commands.
      //
      // Caller can widen the cap via lessonsLimit (default 3, max 10) to
      // avoid silent truncation on topics with many saved lessons. When
      // the returned set is smaller than the total match count, the
      // payload includes totalMatching + hasMore + moreHint so the agent
      // knows to fetch the rest via knowledge{retrieve, corpus:"lessons"}
      // instead of assuming it got everything.
      if (result && typeof result === 'object' && (result as any).ok !== false) {
        const rawCap = Number(args.lessonsLimit ?? input.lessonsLimit);
        const lessonsLimit = Number.isFinite(rawCap) && rawCap > 0
          ? Math.min(Math.floor(rawCap), 10)
          : 3;
        const { entries, totalMatching } = findMatchingLessonsSync(query, lessonsLimit);
        if (entries.length > 0) {
          // Attach at the TOP LEVEL of the ToolResult envelope (sibling of
          // `data`, not under it). searchScpi returns data as an array, and
          // named properties on arrays don't survive JSON.stringify — any
          // data-level attachment would silently vanish on serialisation.
          const hasMore = totalMatching > entries.length;
          (result as unknown as Record<string, unknown>).lessons = {
            _note: 'Reference lessons (NOT executable — read and apply to your reasoning; do not dispatch as tools).',
            count: entries.length,
            totalMatching,
            hasMore,
            ...(hasMore
              ? {
                  moreHint: `${totalMatching - entries.length} more matched. For the full set, call knowledge{action:"retrieve", corpus:"lessons", query:"${query}"} — or pass lessonsLimit up to 10 on this search call.`,
                }
              : {}),
            entries: entries.map((l) => ({
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
