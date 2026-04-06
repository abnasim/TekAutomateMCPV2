import type { CommandIndex, CommandRecord } from './commandIndex';
import { getCommandIndex } from './commandIndex';
import type { RagCorpus, RagIndexes } from './ragIndex';
import { getToolRegistry, type MicroTool, type MicroToolResult, type MicroToolSchema, type ToolCategory } from './toolRegistry';
import { getToolSearchEngine } from './toolSearch';
import { materializeScpiCommand } from '../tools/materializeScpiCommand';
import { verifyScpiCommands } from '../tools/verifyScpiCommands';
import { TOOL_HANDLERS, getToolDefinitions } from '../tools/index';

export interface TemplateEntry {
  id: string;
  name: string;
  description: string;
  backend: string;
  deviceType: string;
  tags: string[];
  steps: unknown[];
}

export interface HydrationSources {
  commandIndex?: CommandIndex;
  ragIndexes?: RagIndexes;
  templates?: TemplateEntry[];
  usageStats?: Array<{ id: string; usageCount: number; lastUsedAt: number }>;
}

export interface HydrationReport {
  scpiCommands: number;
  templates: number;
  ragChunks: number;
  shortcuts: number;
  total: number;
  durationMs: number;
}

function buildActionsJson(summary: string, actions: Array<Record<string, unknown>>, warnings: string[] = []): string {
  return `ACTIONS_JSON: ${JSON.stringify({ summary, warnings, actions })}`;
}

function sanitizeToolId(prefix: string, raw: string): string {
  const normalized = String(raw || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/["',]/g, '')
    .replace(/[{}]/g, '')
    .replace(/[<>]/g, 'x');
  return `${prefix}:${normalized}`;
}

function createReplaceFlowAction(steps: Array<Record<string, unknown>>, summary: string): MicroToolResult {
  const action = {
    type: 'replace_flow',
    steps,
  };
  return {
    ok: true,
    data: action,
    text: buildActionsJson(summary, [action]),
  };
}

function scpiTriggers(record: CommandRecord): string[] {
  const header = record.header.toLowerCase();
  const clean = header.replace(/<[^>]+>/g, '').replace(/\{[^}]+\}/g, '');
  const lastSeg = header.split(':').pop() || '';
  return Array.from(new Set([header, clean, lastSeg].filter((value) => value && value.length >= 2)));
}

function scpiDescription(record: CommandRecord): string {
  const parts = [record.shortDescription || record.description];
  if (record.commandType === 'both') parts.push('(set/query)');
  if (record.commandType === 'set') parts.push('(set only)');
  if (record.commandType === 'query') parts.push('(query only)');
  if (record.families.length) parts.push(`[${record.families.slice(0, 3).join(', ')}]`);
  return parts.join(' ');
}

function scpiSchema(record: CommandRecord): MicroToolSchema {
  const properties: MicroToolSchema['properties'] = {
    commandType: {
      type: 'string',
      description: 'set or query',
      enum: record.commandType === 'both' ? ['set', 'query'] : [record.commandType],
    },
    family: {
      type: 'string',
      description: 'Optional model family filter',
    },
    concreteHeader: {
      type: 'string',
      description: 'Concrete header such as CH1:SCALE used to infer placeholder bindings',
    },
    value: {
      type: 'string',
      description: 'Single set value when materializing a command',
    },
  };
  const required: string[] = [];

  for (const arg of record.arguments) {
    const enumValues = Array.isArray(arg.validValues?.values) ? arg.validValues.values.map(String) : undefined;
    properties[arg.name || `arg_${Object.keys(properties).length}`] = {
      type: 'string',
      description: arg.description || arg.name,
      ...(enumValues?.length ? { enum: enumValues } : {}),
    };
    if (arg.required) required.push(arg.name);
  }

  return {
    type: 'object',
    properties,
    required: required.length ? required : undefined,
  };
}

function extractFlowIssuesFromSteps(steps: unknown[], commandIndex: CommandIndex, family?: string): string[] {
  const issues: string[] = [];
  const flat = Array.isArray(steps) ? steps : [];
  for (const item of flat) {
    if (!item || typeof item !== 'object') continue;
    const step = item as Record<string, unknown>;
    const type = String(step.type || '').toLowerCase();
    if (!['write', 'query', 'set_and_query'].includes(type)) continue;
    const params = step.params && typeof step.params === 'object' ? (step.params as Record<string, unknown>) : {};
    const command = String(params.command || '').trim();
    if (!command) continue;
    const header = command.split(/\s+/)[0] || '';
    const entry =
      commandIndex.getByHeader(header, family) ||
      commandIndex.getByHeader(header.toUpperCase(), family) ||
      commandIndex.getByHeaderPrefix(header, family);
    if (!entry) {
      issues.push(`Unverified header: ${header}`);
    }
  }
  return issues;
}

function createScpiLookupHandler(record: CommandRecord) {
  return async (args: Record<string, unknown>): Promise<MicroToolResult> => {
    const shouldMaterialize =
      typeof args.value !== 'undefined' ||
      typeof args.concreteHeader === 'string' ||
      typeof args.commandType === 'string';

    if (!shouldMaterialize) {
      return {
        ok: true,
        data: {
          header: record.header,
          commandId: record.commandId,
          commandType: record.commandType,
          syntax: record.syntax,
          arguments: record.arguments,
          group: record.group,
          description: record.description,
        },
        text: `${record.header} - ${record.shortDescription || record.description}`,
      };
    }

    const materialized = await materializeScpiCommand({
      header: record.header,
      concreteHeader: typeof args.concreteHeader === 'string' ? args.concreteHeader : undefined,
      family: typeof args.family === 'string' ? args.family : undefined,
      commandType: args.commandType === 'query' ? 'query' : args.commandType === 'set' ? 'set' : undefined,
      value: typeof args.value !== 'undefined' ? (args.value as string | number | boolean) : undefined,
      placeholderBindings:
        args.placeholderBindings && typeof args.placeholderBindings === 'object'
          ? (args.placeholderBindings as Record<string, string | number | boolean>)
          : undefined,
      argumentBindings:
        args.argumentBindings && typeof args.argumentBindings === 'object'
          ? (args.argumentBindings as Record<string, string | number | boolean>)
          : undefined,
      arguments: Array.isArray(args.arguments)
        ? (args.arguments as Array<string | number | boolean>)
        : undefined,
    });

    if (!materialized.ok || !materialized.data) {
      return {
        ok: false,
        error: materialized.warnings.join('; ') || 'Failed to materialize command.',
        warnings: materialized.warnings,
      };
    }

    const command = String((materialized.data as Record<string, unknown>).command || '');
    const verification = await verifyScpiCommands({
      commands: [command],
      modelFamily: typeof args.family === 'string' ? args.family : undefined,
      requireExactSyntax: true,
    });

    return {
      ok: true,
      data: {
        materialized: materialized.data,
        verification: verification.data,
      },
      text: command,
      warnings: [...materialized.warnings, ...verification.warnings],
    };
  };
}

export function hydrateScpiCommands(commandIndex: CommandIndex): MicroTool[] {
  return commandIndex.getEntries().map((record) => ({
    id: sanitizeToolId('scpi', record.header),
    name: record.header,
    description: scpiDescription(record),
    triggers: scpiTriggers(record),
    tags: [...record.tags, record.group, record.category, ...record.families],
    category: 'scpi_lookup',
    schema: scpiSchema(record),
    handler: createScpiLookupHandler(record),
    usageCount: 0,
    lastUsedAt: 0,
    autoGenerated: true,
  }));
}

function createTemplateHandler(template: TemplateEntry) {
  return async (): Promise<MicroToolResult> => {
    const steps = Array.isArray(template.steps) ? (template.steps as Array<Record<string, unknown>>) : [];
    return createReplaceFlowAction(
      steps,
      `Applied template ${template.name}.`
    );
  };
}

export function hydrateTemplates(templates: TemplateEntry[]): MicroTool[] {
  return templates.map((template) => ({
    id: sanitizeToolId('template', template.id),
    name: template.name,
    description: `${template.description} [${template.backend}/${template.deviceType}]`,
    triggers: Array.from(new Set([template.id.toLowerCase(), template.name.toLowerCase()])),
    tags: [...template.tags, template.backend, template.deviceType],
    category: 'template' as ToolCategory,
    schema: {
      type: 'object',
      properties: {},
    },
    handler: createTemplateHandler(template),
    usageCount: 0,
    lastUsedAt: 0,
    autoGenerated: true,
  }));
}

export function hydrateRagCorpus(ragIndexes: RagIndexes, corpus: RagCorpus): MicroTool[] {
  return ragIndexes.getCorpus(corpus).map((doc) => ({
    id: sanitizeToolId(`rag:${corpus}`, doc.id),
    name: doc.title,
    description: `${doc.title || doc.id} ${doc.body || doc.text || corpus} ${corpus}`.trim().slice(0, 200),
    triggers: [doc.id.toLowerCase(), doc.title.toLowerCase()],
    tags: [corpus, doc.source || '', doc.pathHint || ''].filter(Boolean),
    category: 'rag',
    schema: {
      type: 'object',
      properties: {
        fullText: { type: 'boolean', description: 'Return the full chunk body.' },
      },
    },
    handler: async (args) => ({
      ok: true,
      data: {
        id: doc.id,
        corpus,
        title: doc.title,
        body: args.fullText === false ? doc.body.slice(0, 500) : doc.body,
      },
      text: `${doc.title}: ${doc.body.slice(0, 300)}`,
    }),
    usageCount: 0,
    lastUsedAt: 0,
    autoGenerated: true,
  }));
}

export function hydrateBuiltinShortcuts(): MicroTool[] {
  return [
    {
      id: 'shortcut:measurement',
      name: 'Add Measurements',
      description: 'Build a real measurement flow with delete-all, add-measurement, source binding, and optional query steps.',
      triggers: ['measurement', 'measure', 'frequency', 'amplitude', 'rms', 'pk2pk'],
      tags: ['measurement', 'scope', 'analysis'],
      category: 'shortcut',
      schema: {
        type: 'object',
        properties: {
          measurements: { type: 'string', description: 'Comma-separated measurement types.' },
          channel: { type: 'string', description: 'Measurement source channel.' },
          queryResults: { type: 'string', description: 'Whether to append result queries.' },
        },
        required: ['measurements'],
      },
      handler: async (args) => {
        const measurements = String(args.measurements || '')
          .split(',')
          .map((value) => value.trim().toUpperCase())
          .filter(Boolean);
        const channel = String(args.channel || 'CH1').toUpperCase();
        const queryResults = String(args.queryResults || 'true').toLowerCase() !== 'false';
        const steps: Array<Record<string, unknown>> = [
          { type: 'write', params: { command: 'MEASUrement:DELETEALL' } },
        ];
        measurements.forEach((measurement, index) => {
          const slot = `MEAS${index + 1}`;
          steps.push({ type: 'write', params: { command: 'MEASUrement:ADDMEAS' } });
          steps.push({ type: 'write', params: { command: `MEASUrement:${slot}:TYPe ${measurement}` } });
          steps.push({ type: 'write', params: { command: `MEASUrement:${slot}:SOUrce1 ${channel}` } });
          if (queryResults) {
            steps.push({
              type: 'query',
              params: {
                command: `MEASUrement:${slot}:RESUlts:CURRentacq:MEAN?`,
                saveAs: `${channel.toLowerCase()}_${measurement.toLowerCase()}`,
              },
            });
          }
        });
        return createReplaceFlowAction(steps, `Built measurement flow for ${channel}.`);
      },
      usageCount: 0,
      lastUsedAt: 0,
    },
    {
      id: 'shortcut:fastframe',
      name: 'FastFrame Acquisition',
      description: 'Build a FastFrame setup flow with state, frame count, and acquired-frame query.',
      triggers: ['fastframe', 'fast frame', 'segmented memory'],
      tags: ['fastframe', 'acquisition'],
      category: 'shortcut',
      schema: {
        type: 'object',
        properties: {
          frameCount: { type: 'string', description: 'Number of frames.' },
        },
      },
      handler: async (args) => {
        const frameCount = Number(args.frameCount || 10);
        return createReplaceFlowAction(
          [
            { type: 'write', params: { command: 'HORizontal:FASTframe:STATE ON' } },
            { type: 'write', params: { command: `HORizontal:FASTframe:COUNt ${frameCount}` } },
            { type: 'query', params: { command: 'ACQuire:NUMFRAMESACQuired?', saveAs: 'fastframe_acquired_frames' } },
          ],
          `Built FastFrame flow for ${frameCount} frames.`
        );
      },
      usageCount: 0,
      lastUsedAt: 0,
    },
    {
      id: 'shortcut:screenshot',
      name: 'Save Screenshot',
      description: 'Build a flow that captures a screenshot from the instrument.',
      triggers: ['screenshot', 'screen capture', 'save screen'],
      tags: ['screenshot', 'capture'],
      category: 'shortcut',
      schema: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Screenshot filename.' },
        },
      },
      handler: async (args) =>
        createReplaceFlowAction(
          [
            {
              type: 'save_image',
              params: {
                filename: String(args.filename || 'screenshot.png'),
              },
            },
          ],
          'Built screenshot flow.'
        ),
      usageCount: 0,
      lastUsedAt: 0,
    },
    {
      id: 'shortcut:save_waveform',
      name: 'Save Waveform',
      description: 'Build a flow that saves waveform data to a local file.',
      triggers: ['save waveform', 'waveform save', 'export waveform'],
      tags: ['waveform', 'save'],
      category: 'shortcut',
      schema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'Waveform source channel.' },
          filename: { type: 'string', description: 'Destination filename.' },
        },
      },
      handler: async (args) =>
        createReplaceFlowAction(
          [
            {
              type: 'save_waveform',
              params: {
                source: String(args.source || 'CH1'),
                filename: String(args.filename || 'waveform.wfm'),
              },
            },
          ],
          'Built waveform save flow.'
        ),
      usageCount: 0,
      lastUsedAt: 0,
    },
    {
      id: 'shortcut:scpi_search',
      name: 'Search SCPI Commands',
      description: 'Search the real command index by keyword or exact header.',
      triggers: ['scpi search', 'find command', 'search commands'],
      tags: ['scpi', 'search'],
      category: 'scpi_search',
      schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query or exact header.' },
          family: { type: 'string', description: 'Optional model family filter.' },
          limit: { type: 'string', description: 'Maximum results.' },
        },
        required: ['query'],
      },
      handler: async (args) => {
        const index = await getCommandIndex();
        const query = String(args.query || '').trim();
        const family = typeof args.family === 'string' ? args.family : undefined;
        const direct = index.getByHeader(query, family) || index.getByHeader(query.toUpperCase(), family);
        const matches = direct ? [direct] : index.searchByQuery(query, family, Number(args.limit || 10));
        return {
          ok: true,
          data: matches.map((entry) => ({
            header: entry.header,
            description: entry.shortDescription || entry.description,
            commandId: entry.commandId,
          })),
          text: `Found ${matches.length} SCPI command(s) for "${query}".`,
        };
      },
      usageCount: 0,
      lastUsedAt: 0,
    },
    {
      id: 'shortcut:validate_flow',
      name: 'Validate Flow',
      description: 'Validate write/query step headers in a flow against the real command index.',
      triggers: ['validate flow', 'check flow', 'review flow'],
      tags: ['validate', 'flow', 'scpi'],
      category: 'validator',
      schema: {
        type: 'object',
        properties: {
          steps: { type: 'string', description: 'Flow steps to validate.' },
          family: { type: 'string', description: 'Optional model family filter.' },
        },
      },
      handler: async (args) => {
        const index = await getCommandIndex();
        const issues = extractFlowIssuesFromSteps(
          Array.isArray(args.steps) ? args.steps : [],
          index,
          typeof args.family === 'string' ? args.family : undefined
        );
        return {
          ok: true,
          data: { valid: issues.length === 0, issues },
          text: issues.length ? `Flow has ${issues.length} validation issue(s).` : 'Flow validation passed.',
          warnings: issues,
        };
      },
      usageCount: 0,
      lastUsedAt: 0,
    },
    {
      id: 'shortcut:scpi_verify',
      name: 'Verify SCPI Commands',
      description: 'Verify materialized SCPI command strings against the real command index.',
      triggers: ['verify scpi', 'verify commands', 'scpi verify'],
      tags: ['verify', 'scpi'],
      category: 'scpi_verify',
      schema: {
        type: 'object',
        properties: {
          commands: { type: 'string', description: 'Command strings to verify.' },
          modelFamily: { type: 'string', description: 'Optional model family filter.' },
        },
        required: ['commands'],
      },
      handler: async (args) => {
        const result = await verifyScpiCommands({
          commands: Array.isArray(args.commands) ? args.commands.map(String) : [],
          modelFamily: typeof args.modelFamily === 'string' ? args.modelFamily : undefined,
          requireExactSyntax: true,
        });
        return {
          ok: result.ok,
          data: result.data,
          warnings: result.warnings,
          text: `Verified ${Array.isArray(result.data) ? result.data.length : 0} command(s).`,
        };
      },
      usageCount: 0,
      lastUsedAt: 0,
    },
    {
      id: 'shortcut:bus_decode',
      name: 'Configure Bus Decode',
      description: 'Build a lightweight bus decode flow.',
      triggers: ['bus decode', 'configure bus', 'decode i2c', 'decode spi', 'decode can', 'i2c decode', 'spi decode', 'can decode', 'setup i2c', 'setup spi', 'setup can'],
      tags: ['bus', 'decode'],
      category: 'shortcut',
      schema: {
        type: 'object',
        properties: {
          busType: { type: 'string', description: 'Bus type.' },
          bus: { type: 'string', description: 'Bus slot.' },
        },
      },
      handler: async (args) =>
        createReplaceFlowAction(
          [
            {
              type: 'configure_bus',
              params: {
                busType: String(args.busType || 'I2C'),
                bus: String(args.bus || 'BUS1'),
              },
            },
          ],
          'Built bus decode flow.'
        ),
      usageCount: 0,
      lastUsedAt: 0,
    },
    {
      id: 'shortcut:status_decode',
      name: 'Decode Status Register',
      description: 'Build a flow that queries and decodes a status register.',
      triggers: ['status register', 'decode status', 'read esr', 'read stb', 'query allev', 'event status', 'error queue', 'status byte'],
      tags: ['status', 'register'],
      category: 'shortcut',
      schema: {
        type: 'object',
        properties: {
          register: { type: 'string', description: 'Register to query.' },
        },
      },
      handler: async (args) =>
        createReplaceFlowAction(
          [
            {
              type: 'query',
              params: {
                command: `*${String(args.register || 'ESR').toUpperCase()}?`,
                saveAs: 'status_register',
              },
            },
          ],
          'Built status decode flow.'
        ),
      usageCount: 0,
      lastUsedAt: 0,
    },
  ];
}

// ── Hydrate built-in MCP tools so tek_router can route to them ───────
// These are the 25+ tools hidden from the MCP surface but need to be
// findable via tek_router's search/search_exec actions.
const MCP_TOOL_TRIGGERS: Record<string, string[]> = {
  search_scpi: ['search scpi', 'find scpi', 'scpi search', 'command search'],
  get_command_by_header: ['get command by header', 'exact header lookup', 'single header lookup'],
  get_commands_by_header_batch: ['batch header lookup', 'batch headers', 'multiple headers', 'headers batch', 'get commands by header batch'],
  get_command_group: ['command group', 'group commands', 'feature area commands'],
  list_command_groups: ['list command groups', 'all groups', 'available groups', 'show groups'],
  browse_scpi_commands: ['browse scpi', 'browse commands', 'drill down commands'],
  verify_scpi_commands: ['verify scpi', 'check scpi', 'validate scpi syntax'],
  materialize_scpi_command: ['materialize scpi', 'build scpi string', 'concrete scpi'],
  materialize_scpi_commands: ['batch materialize', 'materialize multiple'],
  finalize_scpi_commands: ['finalize scpi', 'build and verify scpi'],
  materialize_tm_devices_call: ['materialize tm devices', 'tm devices python call'],
  search_tm_devices: ['search tm devices', 'tm devices lookup', 'python method search'],
  retrieve_rag_chunks: ['retrieve rag', 'knowledge base', 'documentation search'],
  check_scope_logic: ['scope logic', 'scope procedure', 'fix clipping', 'setup decode', 'signal integrity', 'trigger stabilization', 'probe compensation', 'auto setup scope'],
  search_known_failures: ['known failures', 'known errors', 'common problems'],
  get_template_examples: ['template examples', 'workflow examples', 'example flows'],
  validate_action_payload: ['validate actions', 'validate payload', 'validate action payload', 'check actions json'],
  validate_device_context: ['validate device context', 'device context check'],
  get_policy: ['get policy', 'policy rules', 'output format rules'],
  list_valid_step_types: ['valid step types', 'step types', 'block types'],
  get_block_schema: ['block schema', 'block definition', 'block fields'],
  save_learned_workflow: ['save workflow', 'save learned', 'create shortcut'],
  probe_command: ['probe command', 'test single command', 'try command'],
  get_instrument_state: ['instrument state', 'instrument identity', 'scope id'],
  get_visa_resources: ['visa resources', 'list instruments', 'connected instruments'],
  get_environment: ['runtime environment', 'executor environment'],
};

// Tools that depend on heavy indexes (tm_devices: 14MB+28MB JSON)
// Exclude from builtin hydration to prevent OOM/hang on resource-limited hosts
const HEAVY_INDEX_TOOLS = new Set([
  'search_tm_devices',
  'materialize_tm_devices_call',
]);

export function hydrateBuiltinMcpTools(): MicroTool[] {
  const toolDefs = getToolDefinitions();
  const tools: MicroTool[] = [];

  for (const def of toolDefs) {
    // Skip tek_router itself (it's the gateway, not a routable tool)
    if (def.name === 'tek_router') continue;
    // Skip tools with heavy index dependencies that can crash limited hosts
    if (HEAVY_INDEX_TOOLS.has(def.name)) continue;

    const handler = (TOOL_HANDLERS as Record<string, Function>)[def.name];
    if (!handler) continue;

    const triggers = MCP_TOOL_TRIGGERS[def.name] || [def.name.replace(/_/g, ' ')];
    const tool: MicroTool = {
      id: `builtin:${def.name}`,
      name: def.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      description: def.description?.slice(0, 200) || def.name,
      triggers,
      tags: ['builtin', 'mcp_tool', def.name],
      category: 'composite' as ToolCategory,
      schema: {
        type: 'object',
        properties: (def.parameters as any)?.properties ?? {},
        required: (def.parameters as any)?.required,
      },
      handler: async (args: Record<string, unknown>) => {
        const result = await handler(args);
        const r = result as Record<string, unknown>;
        return {
          ok: r.ok !== false,
          data: r.data ?? r,
          text: typeof r.text === 'string' ? r.text : undefined,
          warnings: Array.isArray(r.warnings) ? r.warnings : [],
          error: typeof r.error === 'string' ? r.error : undefined,
        } as MicroToolResult;
      },
      usageCount: 0,
      lastUsedAt: 0,
      successCount: 0,
      failureCount: 0,
    };
    tools.push(tool);
  }

  return tools;
}

export async function hydrateAllTools(sources: HydrationSources): Promise<HydrationReport> {
  const startedAt = Date.now();
  const registry = getToolRegistry();
  let scpiCount = 0;
  let templateCount = 0;
  let ragCount = 0;

  if (sources.commandIndex) {
    const scpiTools = hydrateScpiCommands(sources.commandIndex);
    registry.registerBatch(scpiTools);
    scpiCount = scpiTools.length;
  }

  if (sources.templates?.length) {
    const templateTools = hydrateTemplates(sources.templates);
    registry.registerBatch(templateTools);
    templateCount = templateTools.length;
  }

  if (sources.ragIndexes) {
    // Do not register every RAG chunk as a first-class tool.
    // Large corpora can create tens of thousands of synthetic tools and exhaust
    // startup memory, while retrieve_rag_chunks and router-managed auto-RAG
    // already provide the actual retrieval path AI uses.
    ragCount = 0;
  }

  const shortcuts = hydrateBuiltinShortcuts();
  registry.registerBatch(shortcuts);

  // Register built-in MCP tools so tek_router can route to them
  const builtinMcpTools = hydrateBuiltinMcpTools();
  registry.registerBatch(builtinMcpTools);

  if (sources.usageStats?.length) {
    registry.importUsageStats(sources.usageStats);
  }

  getToolSearchEngine().rebuildIndex();

  const durationMs = Date.now() - startedAt;
  const total = registry.size();
  console.log(
    `[MCP:router] Hydrated ${total} tools in ${durationMs}ms (${scpiCount} SCPI, ${templateCount} templates, ${ragCount} RAG, ${shortcuts.length} shortcuts, ${builtinMcpTools.length} builtin)`
  );

  return {
    scpiCommands: scpiCount,
    templates: templateCount,
    ragChunks: ragCount,
    shortcuts: shortcuts.length,
    total,
    durationMs,
  };
}
