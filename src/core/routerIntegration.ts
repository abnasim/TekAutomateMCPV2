import { tekRouter, TEK_ROUTER_TOOL_DEFINITION, type RouterRequest } from './toolRouter';
import { hydrateAllTools, type HydrationReport, type HydrationSources } from './toolHydrator';
import { getToolRegistry } from './toolRegistry';
import { getToolSearchEngine } from './toolSearch';
import { getSemanticSearchEngine } from './semanticSearch';
import { loadProviderManifests } from './providerLoader';
import { getCommandIndex } from './commandIndex';
import { getRagIndexes } from './ragIndex';
import { getTemplateIndex, type TemplateDoc } from './templateIndex';
import { resolveProvidersDir } from './paths';
import { promises as fs } from 'fs';
import * as path from 'path';

const DATA_DIR = 'data';
const USAGE_STATS_FILE = 'router_usage_stats.json';
const RUNTIME_SHORTCUTS_FILE = 'runtime_shortcuts.json';
const BUILTIN_SHORTCUT_IDS = new Set([
  'shortcut:measurement',
  'shortcut:fastframe',
  'shortcut:screenshot',
  'shortcut:save_waveform',
  'shortcut:scpi_search',
  'shortcut:validate_flow',
  'shortcut:scpi_verify',
  'shortcut:bus_decode',
  'shortcut:status_decode',
]);
let hydrationReport: HydrationReport | null = null;
let providersDir: string | null = null;
let loadedProviderToolIds: string[] = [];
let persistenceTimerStarted = false;

function isRouterEnabled(): boolean {
  // Enable router by default, allow explicit disable
  const disabled = String(process.env.MCP_ROUTER_DISABLED || '').trim() === 'true';
  return !disabled;
}

function toTemplateEntries(docs: TemplateDoc[]) {
  return docs.map((doc) => ({
    id: doc.id,
    name: doc.name,
    description: doc.description,
    backend: 'template',
    deviceType: 'workflow',
    tags: [],
    steps: doc.steps,
  }));
}

async function persistUsageStats(statsPath: string): Promise<void> {
  const registry = getToolRegistry();
  const stats = registry.exportUsageStats();
  if (!stats.length) return;
  try {
    await fs.mkdir(path.dirname(statsPath), { recursive: true });
    await fs.writeFile(statsPath, JSON.stringify(stats, null, 2), 'utf8');
  } catch (err) {
    console.error('[MCP:router] Failed to persist usage stats:', err);
  }
}

async function loadPersistedUsageStats(
  statsPath: string,
  sources: HydrationSources & { usageStats?: Array<{ id: string; usageCount: number; lastUsedAt: number; successCount?: number; failureCount?: number }> }
): Promise<void> {
  try {
    const raw = await fs.readFile(statsPath, 'utf8');
    const stats = JSON.parse(raw);
    if (Array.isArray(stats)) {
      sources.usageStats = stats;
      console.log(`[MCP:router] Loaded ${stats.length} persisted usage stats`);
    }
  } catch {
    // No persisted stats yet.
  }
}

function ensurePersistenceLoop(statsPath: string): void {
  if (persistenceTimerStarted) return;
  persistenceTimerStarted = true;
  const timer = setInterval(() => {
    persistUsageStats(statsPath);
    if (_shortcutsDirty) persistRuntimeShortcuts();
  }, 5 * 60 * 1000);
  timer.unref?.();
}

async function prepareSemanticIndex(): Promise<void> {
  const semanticEngine = getSemanticSearchEngine();
  if (!semanticEngine.isEnabled()) return;
  const indexed = await semanticEngine.prepareIndex(getToolRegistry().all());
  if (!indexed) {
    console.warn('[MCP:router] Semantic search disabled because embeddings failed or Ollama was unreachable.');
  }
}

let _shortcutsDirty = false;

export function markShortcutsDirty(): void {
  _shortcutsDirty = true;
}

export async function persistRuntimeShortcuts(): Promise<void> {
  try {
    const registry = getToolRegistry();
    const allTools = registry.all();

    // Filter to runtime shortcuts only (exclude builtins)
    const runtimeShortcuts = allTools.filter(tool =>
      tool.category === 'shortcut' &&
      !BUILTIN_SHORTCUT_IDS.has(tool.id) &&
      tool.steps
    );

    const shortcutsData = runtimeShortcuts.map(tool => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      triggers: tool.triggers,
      tags: tool.tags,
      category: tool.category,
      steps: tool.steps,
      createdAt: Date.now(),
    }));

    const dataPath = path.resolve(process.cwd(), DATA_DIR);
    await fs.mkdir(dataPath, { recursive: true });

    const shortcutsPath = path.join(dataPath, RUNTIME_SHORTCUTS_FILE);
    await fs.writeFile(shortcutsPath, JSON.stringify(shortcutsData, null, 2));

    _shortcutsDirty = false;
    console.log(`[PERSIST] Saved ${runtimeShortcuts.length} runtime shortcuts`);
  } catch (error) {
    console.error('[PERSIST] Failed to persist runtime shortcuts:', error);
  }
}

export async function loadRuntimeShortcuts(): Promise<void> {
  try {
    const shortcutsPath = path.resolve(process.cwd(), DATA_DIR, RUNTIME_SHORTCUTS_FILE);
    
    try {
      const data = await fs.readFile(shortcutsPath, 'utf8');
      const shortcutsData = JSON.parse(data);
      
      if (!Array.isArray(shortcutsData)) {
        console.warn('[LOAD] Invalid shortcuts data format, expected array');
        return;
      }
      
      const registry = getToolRegistry();
      let loaded = 0;
      
      for (const shortcutData of shortcutsData) {
        // Skip if already exists (builtins loaded first)
        if (registry.has(shortcutData.id)) {
          continue;
        }
        
        // Rebuild the tool using buildTemplateHandler
        const { buildManagedTool } = await import('./toolRouter');
        const tool = buildManagedTool({
          action: 'create',
          toolId: shortcutData.id,
          toolName: shortcutData.name,
          toolDescription: shortcutData.description,
          toolCategory: shortcutData.category,
          toolTriggers: shortcutData.triggers,
          toolTags: shortcutData.tags,
          toolSteps: shortcutData.steps,
        });
        
        registry.register(tool);
        loaded++;
      }
      
      console.log(`[LOAD] Loaded ${loaded} runtime shortcuts`);
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        console.log('[LOAD] No runtime shortcuts file found (first run)');
      } else {
        console.error('[LOAD] Failed to load runtime shortcuts:', error);
      }
    }
  } catch (error) {
    console.error('[LOAD] Error setting up runtime shortcuts:', error);
  }
}

export async function bootRouter(
  sources: HydrationSources & { providersDir?: string } = {}
): Promise<HydrationReport> {
  const statsPath = path.resolve(process.cwd(), DATA_DIR, USAGE_STATS_FILE);
  await loadPersistedUsageStats(statsPath, sources);

  const commandIndex = sources.commandIndex || (await getCommandIndex());
  const ragIndexes = sources.ragIndexes || (await getRagIndexes());
  const templates =
    sources.templates ||
    toTemplateEntries((await getTemplateIndex()).all());

  hydrationReport = await hydrateAllTools({
    commandIndex,
    ragIndexes,
    templates,
    usageStats: sources.usageStats,
  });

  providersDir = resolveProvidersDir(sources.providersDir);
  await reloadProviderTools();
  await prepareSemanticIndex();
  
  // Load runtime shortcuts after all tools are loaded
  await loadRuntimeShortcuts();

  ensurePersistenceLoop(statsPath);
  return hydrationReport;
}

export async function bootRouterMinimal(
  sources: { providersDir?: string } = {}
): Promise<HydrationReport> {
  const statsPath = path.resolve(process.cwd(), DATA_DIR, USAGE_STATS_FILE);
  const hydrationSources: HydrationSources & { providersDir?: string } = {};
  await loadPersistedUsageStats(statsPath, hydrationSources);

  hydrationReport = await hydrateAllTools({
    usageStats: hydrationSources.usageStats,
    templates: [],
  });

  providersDir = resolveProvidersDir(sources.providersDir);
  await reloadProviderTools();
  await prepareSemanticIndex();
  await loadRuntimeShortcuts();

  ensurePersistenceLoop(statsPath);
  return hydrationReport;
}

export async function reloadProviderTools(customProvidersDir?: string): Promise<{
  loaded: number;
  registered: number;
  rejected: number;
}> {
  const registry = getToolRegistry();
  providersDir = resolveProvidersDir(customProvidersDir || providersDir || undefined);

  for (const toolId of loadedProviderToolIds) {
    registry.unregister(toolId);
  }
  loadedProviderToolIds = [];

  const providerTools = await loadProviderManifests(providersDir);
  const result = registry.registerBatch(providerTools);
  loadedProviderToolIds = providerTools.map((tool) => tool.id).filter((toolId) => registry.has(toolId));

  getToolSearchEngine().rebuildIndex();
  await prepareSemanticIndex();

  if (providerTools.length > 0) {
    console.log(`[MCP:router] Loaded ${result.registered}/${providerTools.length} provider tools from ${providersDir}`);
  }

  return {
    loaded: providerTools.length,
    registered: result.registered,
    rejected: result.rejected.length,
  };
}

export function getRouterHealth(): Record<string, unknown> {
  const registry = getToolRegistry();
  const categories: Record<string, number> = {};
  for (const tool of registry.all()) {
    categories[tool.category] = (categories[tool.category] || 0) + 1;
  }
  return {
    ok: true,
    enabled: isRouterEnabled(),
    totalTools: registry.size(),
    hydrationReport,
    categories,
    registrationErrors: registry.getRegistrationErrors(),
    semanticEnabled: String(process.env.MCP_SEMANTIC_ENABLED || '').trim() === 'true',
    providersDir,
    loadedProviderTools: loadedProviderToolIds.length,
  };
}

export async function createRouterHandler(body: RouterRequest): Promise<Record<string, unknown>> {
  return (await tekRouter(body)) as unknown as Record<string, unknown>;
}

export async function createReloadProvidersHandler(body?: { providersDir?: string }): Promise<Record<string, unknown>> {
  const result = await reloadProviderTools(body?.providersDir);
  return {
    ok: true,
    action: 'reload_providers',
    ...result,
  };
}

export function getRouterTools(): Array<{
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}> {
  return [
    {
      name: TEK_ROUTER_TOOL_DEFINITION.name,
      description: TEK_ROUTER_TOOL_DEFINITION.description,
      parameters: TEK_ROUTER_TOOL_DEFINITION.parameters,
    },
  ];
}

export function getAnthropicRouterTools(): Array<Record<string, unknown>> {
  return [
    {
      name: TEK_ROUTER_TOOL_DEFINITION.name,
      description: TEK_ROUTER_TOOL_DEFINITION.description,
      input_schema: TEK_ROUTER_TOOL_DEFINITION.parameters,
    },
  ];
}

export async function dispatchRouterTool(
  name: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  if (!isRouterEnabled() || name !== 'tek_router') return null;
  return createRouterHandler(args as unknown as RouterRequest);
}
