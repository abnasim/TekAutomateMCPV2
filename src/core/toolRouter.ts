import {
  type MicroTool,
  type ToolCategory,
  type ToolSearchHit,
  getToolRegistry,
} from './toolRegistry';
import { getToolSearchEngine, type ToolSearchOptions } from './toolSearch';
import { executeBuild, type BuildRequest } from './buildAction';
import { getSemanticSearchEngine } from './semanticSearch';
import { validateTool } from './toolValidation';

export interface RouterRequest {
  action: 'search' | 'exec' | 'info' | 'list' | 'search_exec' | 'build' | 'create' | 'update' | 'delete';
  query?: string;
  toolId?: string;
  args?: Record<string, unknown>;
  categories?: ToolCategory[];
  limit?: number;
  offset?: number;
  debug?: boolean;
  context?: BuildRequest['context'];
  buildNew?: boolean;
  instrumentId?: string;
  toolName?: string;
  toolDescription?: string;
  toolTriggers?: string[];
  toolTags?: string[];
  toolCategory?: ToolCategory;
  modelFamily?: string;
  toolSchema?: {
    type?: 'object';
    properties?: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
  toolSteps?: Array<Record<string, unknown>>;
}

export interface RouterSearchResult {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  score: number;
  matchStage: 'trigger' | 'keyword' | 'semantic';
  schema: {
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
  debug?: {
    bm25Score?: number;
    semanticScore?: number;
    usageBoost?: number;
    recencyBoost?: number;
  };
}

export interface RouterResponse {
  ok: boolean;
  action: string;
  results?: Array<RouterSearchResult | Record<string, unknown>>;
  data?: unknown;
  knowledge?: unknown;
  blindSpotHint?: string;
  paging?: {
    offset: number;
    limit: number;
    returned: number;
    nextOffset?: number;
    hasMore: boolean;
  };
  text?: string;
  warnings?: string[];
  error?: string;
  timing?: unknown;
  durationMs?: number;
}

function serializeHit(hit: ToolSearchHit, debug = false): RouterSearchResult {
  return {
    id: hit.tool.id,
    name: hit.tool.name,
    description: hit.tool.description,
    category: hit.tool.category,
    score: Math.round(hit.score * 100) / 100,
    matchStage: hit.matchStage,
    schema: {
      properties: hit.tool.schema.properties,
      required: hit.tool.schema.required,
    },
    ...(debug ? { debug: hit.debug } : {}),
  };
}

export async function tekRouter(request: RouterRequest): Promise<RouterResponse> {
  const startedAt = Date.now();

  switch (request.action) {
    case 'search':
      return handleSearch(request, startedAt);
    case 'exec':
      return handleExec(request, startedAt);
    case 'info':
      return handleInfo(request, startedAt);
    case 'list':
      return handleList(startedAt);
    case 'search_exec':
      return handleSearchExec(request, startedAt);
    case 'build':
      return handleBuild(request, startedAt);
    case 'create':
      return handleCreate(request, startedAt);
    case 'update':
      return handleUpdate(request, startedAt);
    case 'delete':
      return handleDelete(request, startedAt);
    default:
      return {
        ok: false,
        action: String(request.action),
        error: `Unknown action "${String(request.action)}". Valid actions: search, exec, info, list, search_exec, build, create, update, delete`,
        durationMs: Date.now() - startedAt,
      };
  }
}

function normalizeList(values: string[] | undefined, fallback: string[] = []): string[] {
  const items = Array.isArray(values) ? values : fallback;
  return Array.from(new Set(items.map((value) => String(value || '').trim()).filter(Boolean)));
}

async function rebuildRouterIndexes(): Promise<void> {
  getToolSearchEngine().rebuildIndex();
  await getSemanticSearchEngine().prepareIndex(getToolRegistry().all());
}

async function persistShortcutMutation(): Promise<void> {
  try {
    const { markShortcutsDirty, persistRuntimeShortcuts } = await import('./routerIntegration');
    markShortcutsDirty();
    await persistRuntimeShortcuts();
  } catch {
    // Best-effort persistence.
  }
}

function buildTemplateHandler(
  toolName: string,
  toolDescription: string,
  toolCategory: ToolCategory,
  toolSteps: Array<Record<string, unknown>>
): MicroTool['handler'] {
  return async () => {
    // Return saved steps as REFERENCE material, not a definitive flow.
    // The AI should adapt these commands to the current scope context
    // (channels, settings, signal type) rather than replaying them verbatim.
    const stepsDescription = toolSteps.map((s, i) => {
      const tool = s.tool || s.type || 'step';
      const args = s.args || s.params || {};
      return `  ${i + 1}. ${tool}: ${JSON.stringify(args)}`;
    }).join('\n');
    return {
      ok: true,
      data: { toolName, toolDescription, toolCategory, steps: toolSteps },
      text: `[Saved shortcut: ${toolName}]\n${toolDescription}\n\nReference steps (adapt to current scope context — do NOT replay verbatim):\n${stepsDescription}\n\nUse these as a GUIDE. Check current scope state and modify commands as needed for the active channels, signal type, and settings.`,
    };
  };
}

export function buildManagedTool(req: RouterRequest, existing?: MicroTool): MicroTool {
  const name = String(req.toolName || existing?.name || '').trim();
  const id = String(req.toolId || existing?.id || (name ? `shortcut:${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}_${Date.now()}` : '')).trim();
  const description = String(req.toolDescription || existing?.description || '').trim();
  const category = (req.toolCategory || existing?.category || 'template') as ToolCategory;
  const schema = {
    type: 'object' as const,
    properties: req.toolSchema?.properties || existing?.schema.properties || {},
    required: req.toolSchema?.required || existing?.schema.required,
  };
  const steps = Array.isArray(req.toolSteps) ? req.toolSteps : [];
  const triggers = normalizeList(req.toolTriggers, existing?.triggers || [name, id]);
  const tags = normalizeList(req.toolTags, existing?.tags || [category, 'runtime']);
  const handler =
    steps.length > 0
      ? buildTemplateHandler(name, description, category, steps)
      : existing?.handler ||
        (async () => ({
          ok: true,
          data: { toolId: id, args: {} },
          text: `${name} executed.`,
        }));

  return {
    id,
    name,
    description,
    triggers,
    tags,
    category,
    schema,
    handler,
    usageCount: existing?.usageCount || 0,
    lastUsedAt: existing?.lastUsedAt || 0,
    successCount: existing?.successCount || 0,
    failureCount: existing?.failureCount || 0,
    autoGenerated: existing?.autoGenerated ?? false,
    steps: steps.length > 0 ? steps : existing?.steps,
  };
}

async function handleSearch(req: RouterRequest, startedAt: number): Promise<RouterResponse> {
  if (!req.query?.trim()) {
    return {
      ok: false,
      action: 'search',
      error: 'Missing required field: query',
      durationMs: Date.now() - startedAt,
    };
  }

  // ── Stage timings ──────────────────────────────────────────────
  let scpiMs = 0;
  let routerMs = 0;
  let ragMs = 0;

  // Direct SCPI command search via command index (header + description + tags)
  let scpiCommands: Array<Record<string, unknown>> = [];
  let scpiPaging: RouterResponse['paging'];
  try {
    const scpiStart = Date.now();
    const { getCommandIndex } = await import('./commandIndex');
    const { serializeCommandSearchResult } = await import('../tools/commandResultShape');
    const cmdIdx = await getCommandIndex();
    const offset = Math.max(0, req.offset ?? 0);
    const limit = req.limit ?? 10;
    const results = cmdIdx.searchByQuery(req.query, req.modelFamily, limit + 1, undefined, offset);
    scpiCommands = results.map((cmd: any) => {
      const summary = serializeCommandSearchResult(cmd);
      return {
        id: cmd.commandId || cmd.header || '',
        name: cmd.header || '',
        description: cmd.shortDescription || cmd.description || '',
        category: 'scpi',
        score: 10,
        matchStage: 'command_index',
        ...summary,
      };
    });
    const hasMore = scpiCommands.length > limit;
    if (hasMore) {
      scpiCommands = scpiCommands.slice(0, limit);
    }
    scpiPaging = {
      offset,
      limit,
      returned: scpiCommands.length,
      hasMore,
    };
    scpiMs = Date.now() - scpiStart;
  } catch { /* non-fatal */ }

  // Router's own BM25/trigger search for shortcuts and templates
  const routerStart = Date.now();
  const engine = getToolSearchEngine();
  const routerHits = await engine.searchCompound(req.query, {
    limit: 3,
    categories: req.categories,
  });
  const familyHint = (req.modelFamily || '').toUpperCase();
  const filteredRouterHits = routerHits.filter((hit) => {
    const toolId = (hit.tool.id || '').toLowerCase();
    if (!familyHint.includes('DPO') && toolId.includes('dpojet')) return false;
    return true;
  });
  const routerResults = filteredRouterHits
    .filter((hit) => hit.tool.category === 'shortcut' || hit.tool.category === 'template' || hit.tool.category === 'instrument')
    .map((hit) => serializeHit(hit, req.debug === true));
  routerMs = Date.now() - routerStart;

  let results = [...scpiCommands, ...routerResults];

  // ── Explorer injection (5%) ────────────────────────────────────
  // Surface a least-used tool to encourage discovery of underused features
  if (results.length >= 3) {
    const resultIds = new Set(results.map((r: any) => r.id || r.name));
    const registry = getToolRegistry();
    const allTools = registry.all()
      .filter(t => !resultIds.has(t.id) && !t.id.startsWith('rag:') && t.category !== 'composite')
      .sort((a, b) => a.usageCount - b.usageCount);
    if (allTools.length > 0) {
      const explorer = allTools[0];
      results[results.length - 1] = {
        id: explorer.id,
        name: explorer.name,
        description: explorer.description,
        category: explorer.category,
        score: 0.1,
        matchStage: 'explorer',
        explorer: true,
      };
    }
  }

  // RAG knowledge — only for question-like queries
  let knowledge: Array<{ corpus: string; title: string; body: string }> | undefined;
  const isQuestion = /\b(why|how|what|explain|error|fail|timeout|issue|problem|debug)\b/i.test(req.query);
  if (isQuestion) {
    try {
      const ragStart = Date.now();
      const { retrieveRagChunks } = await import('../tools/retrieveRagChunks');
      const ragResults: Array<{ corpus: string; title: string; body: string }> = [];
      const wantsScopeProcedure = /\b(clipping|clip|9\.91e\+37|overshoot|ringing|signal integrity|probe comp|probe compensation|setup scope|auto ?setup|autoset|optimize display)\b/i.test(req.query);
      const ragCorpora = wantsScopeProcedure
        ? (['scope_logic', 'errors', 'app_logic', 'scpi'] as const)
        : (['errors', 'app_logic', 'scpi'] as const);
      for (const corpus of ragCorpora) {
        const res = await retrieveRagChunks({ corpus, query: req.query, topK: 1 });
        if (res.ok && Array.isArray(res.data)) {
          for (const chunk of res.data) {
            const c = chunk as { title?: string; body?: string };
            if (c.body && c.body.length > 30) {
              ragResults.push({ corpus, title: c.title || '', body: c.body.slice(0, 300) });
            }
          }
        }
      }
      if (ragResults.length > 0) knowledge = ragResults;
      ragMs = Date.now() - ragStart;
    } catch { /* non-fatal */ }
  }

  // ── Blind spot prevention ──────────────────────────────────────
  // When no results found, show available categories so AI can refine
  let blindSpotHint: string | undefined;
  if (results.length === 0) {
    try {
      const { GROUP_NAMES } = await import('./commandGroups');
      const registry = getToolRegistry();
      const shortcutCount = registry.all().filter(t => t.category === 'shortcut').length;
      const builtinCount = registry.all().filter(t => t.id.startsWith('builtin:')).length;
      blindSpotHint =
        `No results for "${req.query}". Try a different query.\n` +
        `Available SCPI groups: ${GROUP_NAMES.join(', ')}\n` +
        `Shortcuts: ${shortcutCount}, Builtin tools: ${builtinCount}\n` +
        `Tip: use more specific SCPI terms, or try action:"search_exec" with query:"browse scpi commands" args:{group:"GroupName"}`;
    } catch { /* non-fatal */ }
  }

  // ── Timing transparency ────────────────────────────────────────
  const totalMs = Date.now() - startedAt;
  const timing = `${totalMs}ms (SCPI:${scpiMs}ms + Router:${routerMs}ms${ragMs ? ` + RAG:${ragMs}ms` : ''})`;

  return {
    ok: true,
    action: 'search',
    results,
    paging: scpiPaging,
    knowledge,
    blindSpotHint,
    timing,
    text: results.length
      ? `Found ${results.length} result(s) for "${req.query}" in ${timing}.`
      : blindSpotHint || `No results for "${req.query}" (${timing}).`,
    durationMs: totalMs,
  };
}

async function handleExec(req: RouterRequest, startedAt: number): Promise<RouterResponse> {
  if (!req.toolId?.trim()) {
    return {
      ok: false,
      action: 'exec',
      error: 'Missing required field: toolId',
      durationMs: Date.now() - startedAt,
    };
  }

  const registry = getToolRegistry();
  const tool = registry.get(req.toolId);
  if (!tool) {
    return {
      ok: false,
      action: 'exec',
      error: `Tool not found: "${req.toolId}". Use action:"search" to find the right tool ID.`,
      durationMs: Date.now() - startedAt,
    };
  }

  try {
    const result = await tool.handler(req.args || {});
    registry.recordUsage(req.toolId);
    if (result.ok) registry.recordSuccess(req.toolId);
    else registry.recordFailure(req.toolId);
    return {
      ok: result.ok,
      action: 'exec',
      data: result.data,
      text: result.text,
      warnings: result.warnings,
      error: result.error,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    registry.recordFailure(req.toolId);
    return {
      ok: false,
      action: 'exec',
      error: `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - startedAt,
    };
  }
}

async function handleInfo(req: RouterRequest, startedAt: number): Promise<RouterResponse> {
  if (!req.toolId?.trim()) {
    return {
      ok: false,
      action: 'info',
      error: 'Missing required field: toolId',
      durationMs: Date.now() - startedAt,
    };
  }

  const registry = getToolRegistry();
  const tool = registry.get(req.toolId);
  if (!tool) {
    return {
      ok: false,
      action: 'info',
      error: `Tool not found: "${req.toolId}"`,
      durationMs: Date.now() - startedAt,
    };
  }

  return {
    ok: true,
    action: 'info',
    data: {
      id: tool.id,
      name: tool.name,
      description: tool.description,
      category: tool.category,
      triggers: tool.triggers,
      tags: tool.tags,
      schema: tool.schema,
      usageCount: tool.usageCount,
    },
    durationMs: Date.now() - startedAt,
  };
}

async function handleList(startedAt: number): Promise<RouterResponse> {
  const registry = getToolRegistry();
  const all = registry.all();
  const byCat: Record<string, number> = {};
  for (const tool of all) {
    byCat[tool.category] = (byCat[tool.category] || 0) + 1;
  }

  return {
    ok: true,
    action: 'list',
    data: {
      totalTools: all.length,
      categories: byCat,
    },
    text: `${all.length} tools across ${Object.keys(byCat).length} categories.`,
    durationMs: Date.now() - startedAt,
  };
}

// ── Intent normalization ────────────────────────────────────────
// Map common AI phrasings to the correct trigger phrase.
// The AI doesn't need to know exact triggers — close enough works.
const QUERY_ALIASES: Array<{ pattern: RegExp; trigger: string }> = [
  // Search variants
  { pattern: /\b(find|search|look\s*up|lookup)\s*(scpi|command)/i, trigger: 'search scpi commands' },
  { pattern: /\bsearch\s*for\b/i, trigger: 'search scpi commands' },
  { pattern: /\bfind\s*(a|the)?\s*command/i, trigger: 'search scpi commands' },
  // Exact lookup variants
  { pattern: /\b(get|lookup|look\s*up|fetch)\s*(command\s*)?(by\s*)?header/i, trigger: 'get command by header' },
  { pattern: /\bexact\s*(header|lookup|command)/i, trigger: 'get command by header' },
  { pattern: /\bheader\s*lookup/i, trigger: 'get command by header' },
  // Browse variants
  { pattern: /\bbrowse\s*(scpi|commands?|group)/i, trigger: 'browse scpi commands' },
  { pattern: /\blist\s*(commands?\s*in|all)\s*group/i, trigger: 'browse scpi commands' },
  { pattern: /\bexplore\s*(group|commands?)/i, trigger: 'browse scpi commands' },
  // Verify variants
  { pattern: /\bverify\s*(scpi|command|this)/i, trigger: 'verify scpi commands' },
  { pattern: /\bcheck\s*(if\s*)?(command|valid|scpi)/i, trigger: 'verify scpi commands' },
  { pattern: /\bvalidate\s*(command|scpi)/i, trigger: 'verify scpi commands' },
  // List groups
  { pattern: /\blist\s*(command\s*)?groups/i, trigger: 'list command groups' },
  { pattern: /\bshow\s*(all\s*)?groups/i, trigger: 'list command groups' },
  { pattern: /\bwhat\s*groups/i, trigger: 'list command groups' },
  // Materialize
  { pattern: /\b(materialize|build\s*command|concrete\s*command)/i, trigger: 'materialize scpi command' },
  // RAG
  { pattern: /\b(rag|knowledge|docs)\b/i, trigger: 'retrieve rag chunks' },
  // Known failures
  { pattern: /\b(known\s*failure|error\s*fix|common\s*error)/i, trigger: 'known failures' },
];

// Auto-detect intent from args shape when query is vague or missing
function inferQueryFromArgs(args: Record<string, unknown>): string | null {
  if (typeof args.header === 'string' && args.header.includes(':')) {
    return 'get command by header';
  }
  if (Array.isArray(args.commands)) {
    return 'verify scpi commands';
  }
  if (typeof args.group === 'string') {
    return 'browse scpi commands';
  }
  if (typeof args.query === 'string' && !args.header) {
    return 'search scpi commands';
  }
  if (Array.isArray(args.headers)) {
    return 'batch header lookup';
  }
  if (typeof args.corpus === 'string') {
    return 'retrieve rag chunks';
  }
  return null;
}

// Map "browse trigger" → group:"Trigger", "browse measurement" → group:"Measurement"
const BROWSE_GROUP_ALIASES: Record<string, string> = {
  trigger: 'Trigger', measurement: 'Measurement', math: 'Math', display: 'Display',
  cursor: 'Cursor', horizontal: 'Horizontal', vertical: 'Vertical', bus: 'Bus',
  power: 'Power', spectrum: 'Spectrum view', mask: 'Mask', histogram: 'Histogram',
  plot: 'Plot', zoom: 'Zoom', digital: 'Digital', acquisition: 'Acquisition',
  save: 'Save and Recall', recall: 'Save and Recall', search: 'Search and Mark',
  waveform: 'Waveform Transfer', callout: 'Callout', afg: 'AFG', dvm: 'DVM',
};

function normalizeQuery(query: string, args: Record<string, unknown>): string {
  const q = query.trim();

  // 1. Shape-based inference FIRST — most reliable
  const inferred = inferQueryFromArgs(args);
  if (inferred) return inferred;

  // 2. Alias matching SECOND — catch common AI phrasings
  for (const { pattern, trigger } of QUERY_ALIASES) {
    if (pattern.test(q)) return trigger;
  }

  // 3. Browse + group inference — "browse trigger" → browse scpi commands + args.group
  const browseMatch = q.match(/\bbrowse\s+(\w+)/i);
  if (browseMatch) {
    const groupKey = browseMatch[1].toLowerCase();
    const group = BROWSE_GROUP_ALIASES[groupKey];
    if (group) {
      args.group = group;
      return 'browse scpi commands';
    }
  }

  return q;
}

// Self-healing error response — tells AI exactly how to fix the call
function selfHealingError(
  action: string,
  message: string,
  expectedQuery: string,
  howToFix: string,
  example: Record<string, unknown>,
  startedAt: number
): RouterResponse {
  return {
    ok: false,
    action,
    error: message,
    data: { expected_query: expectedQuery, how_to_fix: howToFix, example },
    durationMs: Date.now() - startedAt,
  };
}

async function handleSearchExec(req: RouterRequest, startedAt: number): Promise<RouterResponse> {
  const args = req.args || {};

  // ── No query? Try to infer from args shape ──
  if (!req.query?.trim()) {
    const inferred = inferQueryFromArgs(args);
    if (inferred) {
      req.query = inferred;
    } else {
      return selfHealingError(
        'search_exec',
        'Missing required field: query. Could not infer intent from args.',
        'search scpi commands',
        'Set query to a trigger phrase, or pass args that indicate intent (args.header, args.query, args.commands, args.group).',
        { action: 'search_exec', query: 'search scpi commands', args: { query: 'edge trigger level' } },
        startedAt
      );
    }
  }

  // ── Normalize query — map AI phrasings to correct triggers ──
  const originalQuery = req.query;
  req.query = normalizeQuery(req.query, args);

  // ── Validate args for known tools and return helpful errors ──
  const queryLower = req.query.toLowerCase().trim();
  if (queryLower.includes('get command by header') && !args.header) {
    return selfHealingError(
      'search_exec',
      'This looks like an exact header lookup, but args.header is missing.',
      'get command by header',
      'Pass the SCPI header in args.header.',
      { action: 'search_exec', query: 'get command by header', args: { header: 'CH<x>:SCAle' } },
      startedAt
    );
  }
  if (queryLower.includes('browse scpi') && !args.group && !args.filter) {
    return selfHealingError(
      'search_exec',
      'Browse requires a group name. Use "list command groups" first to see available groups.',
      'browse scpi commands',
      'Pass the group name in args.group.',
      { action: 'search_exec', query: 'browse scpi commands', args: { group: 'Trigger' } },
      startedAt
    );
  }
  if (queryLower.includes('verify scpi') && !Array.isArray(args.commands)) {
    return selfHealingError(
      'search_exec',
      'Verify requires an array of SCPI command strings in args.commands.',
      'verify scpi commands',
      'Pass commands as an array of strings.',
      { action: 'search_exec', query: 'verify scpi commands', args: { commands: ['CH1:SCAle 1.0', 'ACQuire:MODE?'] } },
      startedAt
    );
  }
  if (queryLower.includes('search scpi') && !args.query) {
    return selfHealingError(
      'search_exec',
      'Search requires a query string in args.query.',
      'search scpi commands',
      'Pass your search terms in args.query.',
      { action: 'search_exec', query: 'search scpi commands', args: { query: 'edge trigger level' } },
      startedAt
    );
  }
  if (queryLower.includes('retrieve rag') && !args.corpus) {
    return selfHealingError(
      'search_exec',
      'RAG retrieval requires args.corpus (scpi, app_logic, errors, templates).',
      'retrieve rag chunks',
      'Pass the corpus name in args.corpus.',
      { action: 'search_exec', query: 'retrieve rag chunks', args: { corpus: 'scpi', query: 'spectrum view' } },
      startedAt
    );
  }

  // ── Priority: check builtin MCP tools first ──────────────────
  const registry = getToolRegistry();
  let builtinMatch: MicroTool | null = null;
  let longestTrigger = 0;
  for (const tool of registry.all()) {
    if (!tool.id.startsWith('builtin:')) continue;
    for (const t of tool.triggers) {
      const tLower = t.toLowerCase();
      if (queryLower.includes(tLower) && tLower.length > longestTrigger) {
        builtinMatch = tool;
        longestTrigger = tLower.length;
      }
    }
  }

  if (builtinMatch) {
    try {
      const toolStart = Date.now();
      const mergedArgs = { ...req.args };
      if (req.modelFamily && !mergedArgs.modelFamily) {
        mergedArgs.modelFamily = req.modelFamily;
      }
      const result = await builtinMatch.handler(mergedArgs);
      const toolMs = Date.now() - toolStart;
      registry.recordUsage(builtinMatch.id);
      if (result.ok) registry.recordSuccess(builtinMatch.id);
      else registry.recordFailure(builtinMatch.id);
      const totalMs = Date.now() - startedAt;
      // Structure search results as best_match + alternatives when data is an array.
      // Skip for list/browse/directory actions where the full array IS the result.
      let structuredData = result.data;
      const isDirectoryResult = /list|browse|group/i.test(builtinMatch.name);
      if (Array.isArray(result.data) && result.data.length > 0 && !isDirectoryResult) {
        structuredData = {
          best_match: result.data[0],
          alternatives: result.data.slice(1, 5),
          total: result.data.length,
        };
      }
      return {
        ok: result.ok,
        action: 'search_exec',
        data: structuredData,
        text: result.text ? `[${builtinMatch.name}] ${result.text}` : `Executed ${builtinMatch.name} successfully.`,
        warnings: result.warnings,
        error: result.error,
        timing: `${totalMs}ms (match:${totalMs - toolMs}ms + exec:${toolMs}ms)`,
        durationMs: totalMs,
      };
    } catch (err) {
      registry.recordFailure(builtinMatch.id);
      return {
        ok: false,
        action: 'search_exec',
        error: `Builtin tool "${builtinMatch.id}" failed: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  // ── Fall through to general search engine — return top 5 ─────
  const searchStart = Date.now();
  const engine = getToolSearchEngine();
  const hits = await engine.search(req.query, {
    limit: req.limit ?? 10,
    categories: req.categories,
  });
  const searchMs = Date.now() - searchStart;

  // ── Blind spot prevention ──────────────────────────────────────
  if (!hits.length) {
    let blindSpotHint = `No tools found for "${req.query}".`;
    try {
      const { GROUP_NAMES } = await import('./commandGroups');
      const shortcutCount = registry.all().filter(t => t.category === 'shortcut').length;
      blindSpotHint +=
        `\nAvailable SCPI groups: ${GROUP_NAMES.join(', ')}` +
        `\nShortcuts: ${shortcutCount}` +
        `\nTip: try "search scpi commands" with a different query, or "browse scpi commands" with a group name.`;
    } catch { /* non-fatal */ }
    return {
      ok: false,
      action: 'search_exec',
      error: blindSpotHint,
      durationMs: Date.now() - startedAt,
    };
  }

  const top = hits[0];
  if (top.score < 5.0) {
    return {
      ok: true,
      action: 'search_exec',
      results: hits.map((hit) => serializeHit(hit, req.debug === true)),
      text: `Found ${hits.length} result(s) for "${req.query}". Top: ${top.tool.name} (score: ${top.score.toFixed(2)}). Use action:"exec" with the tool ID and args to proceed.`,
      durationMs: Date.now() - startedAt,
    };
  }

  try {
    // Ensure modelFamily flows through to builtin tool handlers
    const mergedArgs = { ...req.args };
    if (req.modelFamily && !mergedArgs.modelFamily) {
      mergedArgs.modelFamily = req.modelFamily;
    }
    const result = await top.tool.handler(mergedArgs);
    const registry = getToolRegistry();
    registry.recordUsage(top.tool.id);
    if (result.ok) registry.recordSuccess(top.tool.id);
    else registry.recordFailure(top.tool.id);
    // Structure search results as best_match + alternatives when data is an array.
    // BUT skip structuring for list/directory actions (list command groups, browse)
    // where the full array IS the intended result.
    let structuredData = result.data;
    const isListAction = /list|browse|group/i.test(builtinMatch.name);
    if (Array.isArray(result.data) && result.data.length > 0 && !isListAction) {
      structuredData = {
        best_match: result.data[0],
        alternatives: result.data.slice(1, 5),
        total: result.data.length,
      };
    }
    const alternatives = hits.slice(1).map((hit) => serializeHit(hit, req.debug === true));
    return {
      ok: result.ok,
      action: 'search_exec',
      data: structuredData,
      results: alternatives.length > 0 ? alternatives : undefined,
      text: result.text
        ? `[${top.tool.name}] ${result.text}${alternatives.length > 0 ? ` (${alternatives.length} alternative(s) available)` : ''}`
        : `Executed ${top.tool.name} successfully.`,
      warnings: result.warnings,
      error: result.error,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    getToolRegistry().recordFailure(top.tool.id);
    return {
      ok: false,
      action: 'search_exec',
      results: hits.map((hit) => serializeHit(hit, req.debug === true)),
      error: `Auto-exec of "${top.tool.id}" failed: ${err instanceof Error ? err.message : String(err)}. See results for alternatives.`,
      durationMs: Date.now() - startedAt,
    };
  }
}

async function handleCreate(req: RouterRequest, startedAt: number): Promise<RouterResponse> {
  const registry = getToolRegistry();
  const tool = buildManagedTool(req);
  const validation = validateTool(tool);
  if (!validation.valid) {
    return {
      ok: false,
      action: 'create',
      error: validation.reason,
      durationMs: Date.now() - startedAt,
    };
  }
  if (registry.has(tool.id)) {
    return {
      ok: false,
      action: 'create',
      error: `Tool already exists: "${tool.id}"`,
      durationMs: Date.now() - startedAt,
    };
  }
  registry.register(tool);
  await rebuildRouterIndexes();
  await persistShortcutMutation();
  return {
    ok: true,
    action: 'create',
    data: { toolId: tool.id },
    text: `Registered tool ${tool.id}.`,
    durationMs: Date.now() - startedAt,
  };
}

async function handleUpdate(req: RouterRequest, startedAt: number): Promise<RouterResponse> {
  if (!req.toolId?.trim()) {
    return {
      ok: false,
      action: 'update',
      error: 'Missing required field: toolId',
      durationMs: Date.now() - startedAt,
    };
  }
  const registry = getToolRegistry();
  const existing = registry.get(req.toolId);
  if (!existing) {
    return {
      ok: false,
      action: 'update',
      error: `Tool not found: "${req.toolId}"`,
      durationMs: Date.now() - startedAt,
    };
  }
  const tool = buildManagedTool(req, existing);
  const validation = validateTool(tool);
  if (!validation.valid) {
    return {
      ok: false,
      action: 'update',
      error: validation.reason,
      durationMs: Date.now() - startedAt,
    };
  }
  registry.register(tool);
  await rebuildRouterIndexes();
  await persistShortcutMutation();
  return {
    ok: true,
    action: 'update',
    data: { toolId: tool.id },
    text: `Updated tool ${tool.id}.`,
    durationMs: Date.now() - startedAt,
  };
}

async function handleDelete(req: RouterRequest, startedAt: number): Promise<RouterResponse> {
  if (!req.toolId?.trim()) {
    return {
      ok: false,
      action: 'delete',
      error: 'Missing required field: toolId',
      durationMs: Date.now() - startedAt,
    };
  }
  const registry = getToolRegistry();
  const removed = registry.unregister(req.toolId);
  if (!removed) {
    return {
      ok: false,
      action: 'delete',
      error: `Tool not found: "${req.toolId}"`,
      durationMs: Date.now() - startedAt,
    };
  }
  await rebuildRouterIndexes();
  await persistShortcutMutation();
  return {
    ok: true,
    action: 'delete',
    data: { toolId: req.toolId, deleted: true },
    text: `Deleted tool ${req.toolId}.`,
    durationMs: Date.now() - startedAt,
  };
}

async function handleBuild(req: RouterRequest, startedAt: number): Promise<RouterResponse> {
  if (!req.query?.trim()) {
    return {
      ok: false,
      action: 'build',
      error: 'Missing required field: query',
      durationMs: Date.now() - startedAt,
    };
  }

  const result = await executeBuild({
    query: req.query,
    context: req.context,
    buildNew: req.buildNew,
    instrumentId: req.instrumentId,
  });

  return {
    ok: result.ok,
    action: 'build',
    data: result.data,
    text: result.text,
    warnings: result.warnings,
    error: result.error,
    durationMs: Date.now() - startedAt,
  };
}

export const TEK_ROUTER_TOOL_DEFINITION = {
  name: 'tek_router',
  description:
    'TekAutomate SCPI gateway. Pick an action — each one dispatches to a specialized internal handler:\n\n' +

    '• action:"search" — keyword search over the SCPI database. Cheapest; returns header + description + examples.\n' +
    '• action:"lookup" — exact header lookup (header:"TRIGger:A:EDGE:SOUrce") for full syntax + valid values.\n' +
    '• action:"browse" — drill into a command group (group:"Trigger", optional filter:...) to enumerate commands.\n' +
    '• action:"verify" — validate fully-formed SCPI strings (commands:[...]) before sending.\n' +
    '• action:"build" — natural-language workflow builder (query:"set up jitter measurement on CH1").\n\n' +

    '## Recommended chain:\n' +
    '1. search / browse → find candidate commands\n' +
    '2. lookup → exact syntax + valid values for the header you picked\n' +
    '3. verify → confirm your strings parse cleanly before sending\n' +
    '4. instrument_live{send} → execute on the scope (live deployments only; on public/hosted, stage via workflow_ui{stage} instead)\n\n' +

    '## SCPI syntax rules:\n' +
    '• Mnemonics are mixed-case: uppercase = required, lowercase = optional. Send the full form (TRIGger:A:EDGE:SOUrce) OR the short form (TRIG:A:EDGE:SOU) — never mid-case.\n' +
    '• After writes, verify with a query-back. set+query commands must be confirmed; set-only commands verify via a related query or screenshot.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['search', 'exec', 'info', 'list', 'search_exec', 'build', 'create', 'update', 'delete'],
        description: 'Operation to run.',
      },
      query: {
        type: 'string',
        description: 'Natural language query for search, search_exec, or build.',
      },
      toolId: {
        type: 'string',
        description: 'Tool ID from router search results.',
      },
      args: {
        type: 'object',
        description: 'Arguments for tool execution.',
      },
      categories: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional category filter.',
      },
      limit: {
        type: 'number',
        description: 'Maximum search results to return (default 10).',
      },
      offset: {
        type: 'number',
        description: 'Result offset for pagination (default 0).',
      },
      debug: {
        type: 'boolean',
        description: 'Include match trace details such as BM25, semantic, and usage boosts.',
      },
      context: {
        type: 'object',
        description: 'Optional flow context for build: backend, deviceType, modelFamily, steps, selectedStepId, alias.',
      },
      buildNew: {
        type: 'boolean',
        description: 'For build: true creates replace_flow, false inserts into the current flow.',
      },
      instrumentId: {
        type: 'string',
        description: 'Instrument alias to use for generated connect/disconnect steps.',
      },
      toolName: {
        type: 'string',
        description: 'Tool name for create or update action.',
      },
      toolDescription: {
        type: 'string',
        description: 'Tool description for create or update action.',
      },
      toolTriggers: {
        type: 'array',
        items: { type: 'string' },
        description: 'Trigger phrases for create or update action.',
      },
      toolTags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Search tags for create or update action.',
      },
      toolCategory: {
        type: 'string',
        description: 'Tool category for create or update action.',
      },
      toolSchema: {
        type: 'object',
        description: 'Input schema for create or update action.',
      },
      toolSteps: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
        },
        description: 'Step sequence for template-style tools created or updated through the router.',
      },
    },
    required: ['action'],
    additionalProperties: false,
  },
};
