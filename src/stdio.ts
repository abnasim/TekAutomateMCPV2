/**
 * MCP Stdio Transport Entry Point
 *
 * Exposes the same tools as the HTTP server but over the standard
 * MCP stdio protocol, so Claude Code, Claude Desktop, VS Code (Copilot),
 * Cursor, and any other MCP-compatible client can use TekAutomate tools
 * natively.
 *
 * Launch (direct — this is the ONLY supported way):
 *   npx tsx <absolute-path>/src/stdio.ts
 *
 * MCP client config example (Claude Desktop, Cursor, VS Code, etc.):
 *   {
 *     "mcpServers": {
 *       "tekautomate": {
 *         "command": "npx",
 *         "args": ["-y", "tsx", "C:/path/to/mcp-server/src/stdio.ts"]
 *       }
 *     }
 *   }
 *
 * DO NOT launch via `npm run start:stdio` or any other `npm run` wrapper.
 * npm prints a script banner (`> pkg@ver name` / `> tsx src/stdio.ts`) to
 * stdout BEFORE node starts, and stdio MCP reserves stdout for JSON-RPC
 * frames only. The banner corrupts the stream and clients reject every
 * frame with "Unexpected token" errors.
 *
 * Nothing in the existing HTTP server is modified — this is an
 * additive, parallel entry point.
 */

// Redirect stray console.log/info/warn to stderr BEFORE any other import
// executes, so stdout stays clean for JSON-RPC frames.
import './consoleShim.js';

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { initCommandIndex } from './core/commandIndex.js';
import { initTmDevicesIndex } from './core/tmDevicesIndex.js';
import { initRagIndexes } from './core/ragIndex.js';
import { initTemplateIndex } from './core/templateIndex.js';
import { initProviderCatalog, providerSupplementsEnabled } from './core/providerCatalog.js';
import { bootRouter } from './core/routerIntegration.js';
import { getSlimToolDefinitions, isLiveInstrumentEnabled, runTool } from './tools/index.js';
import { listPersonalityResources, readPersonalityByUri } from './tools/personality.js';
import { getInstrumentInfoState } from './tools/runtimeContextStore.js';
import { getLastWorkflowProposal } from './tools/stageWorkflowProposal.js';

function sanitizeToolResultForExternalMcp(toolName: string, result: unknown): unknown {
  if (toolName !== 'capture_screenshot' || !result || typeof result !== 'object') return result;
  const record = result as Record<string, unknown>;
  const data = record.data && typeof record.data === 'object'
    ? (record.data as Record<string, unknown>)
    : null;
  const source = data ?? record;

  const sanitizedData: Record<string, unknown> = {
    ok: source.ok === false ? false : true,
    captured: true,
  };

  if (typeof source.capturedAt === 'string') sanitizedData.capturedAt = source.capturedAt;
  if (typeof source.scopeType === 'string') sanitizedData.scopeType = source.scopeType;
  if (typeof source.sizeBytes === 'number') sanitizedData.sizeBytes = source.sizeBytes;
  if (typeof source.originalSizeBytes === 'number') sanitizedData.originalSizeBytes = source.originalSizeBytes;
  if (typeof source.analysisSizeBytes === 'number') sanitizedData.analysisSizeBytes = source.analysisSizeBytes;
  if (typeof source.mimeType === 'string') sanitizedData.mimeType = source.mimeType;
  if (typeof source.originalMimeType === 'string') sanitizedData.originalMimeType = source.originalMimeType;
  if (typeof source.analysisMimeType === 'string') sanitizedData.analysisMimeType = source.analysisMimeType;

  return {
    ...(record.ok === false ? { ok: false } : { ok: true }),
    data: sanitizedData,
    sourceMeta: Array.isArray(record.sourceMeta) ? record.sourceMeta : [],
    warnings: Array.isArray(record.warnings) ? record.warnings : [],
  };
}

function buildExternalMcpToolContent(toolName: string, result: unknown) {
  if (!result || typeof result !== 'object') {
    return [{ type: 'text' as const, text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }];
  }

  const record = result as Record<string, unknown>;
  const data = record.data && typeof record.data === 'object'
    ? (record.data as Record<string, unknown>)
    : null;
  const source = data ?? record;
  const imageContent = source.imageContent && typeof source.imageContent === 'object'
    ? (source.imageContent as Record<string, unknown>)
    : null;

  // NOTE: localPath alone is NOT a screenshot signal — other tools (e.g.
  // instrument_live{waveform} with saveLocal:true) also return localPath for
  // saved CSVs. Real screenshots always also carry imageContent / imageUrl /
  // base64 / analysisBase64, so matching on those is sufficient.
  const isScreenshotLike = toolName === 'capture_screenshot'
    || (toolName === 'instrument_live' && Boolean(imageContent || source.imageUrl || source.base64 || source.analysisBase64));

  // ── Local-file path (stdio/direct mode) ────────────────────────────────────
  // When the capture saved the image locally, return a compact text block that
  // tells Claude Code to use its Read tool.  Embedding the full base64 PNG in a
  // single JSON-RPC line (potentially 2-10 MB) causes "error decoding response
  // body" in both Claude Desktop and Claude Code's MCP readline parser.
  if (isScreenshotLike && source.localPath && typeof source.localPath === 'string') {
    const meta: Record<string, unknown> = {
      ok: source.ok === false ? false : true,
      captured: true,
      localPath: source.localPath,
      _hint: 'Screenshot saved locally. Use the Read tool to open this file and view the oscilloscope image.',
    };
    if (typeof source.capturedAt === 'string') meta.capturedAt = source.capturedAt;
    if (typeof source.scopeType === 'string') meta.scopeType = source.scopeType;
    if (typeof source.sizeBytes === 'number') meta.sizeBytes = source.sizeBytes;
    if (typeof source.mimeType === 'string') meta.mimeType = source.mimeType;
    return [{ type: 'text' as const, text: JSON.stringify(meta, null, 2) }];
  }

  // ── imageContent present but no localPath — save to disk, never embed base64 ─
  // Embedding base64 PNG in a single JSON-RPC line causes "error decoding
  // response body" in Claude Code / Claude Desktop readline parsers and inflates
  // AI token usage.  Always write to a temp file and return a localPath pointer.
  if (isScreenshotLike && imageContent && imageContent.type === 'image') {
    const b64 = String(imageContent.data || '');
    const mimeStr = String(imageContent.mimeType || source.mimeType || 'image/png');
    const ext = mimeStr.includes('jpeg') ? 'jpg' : 'png';
    let savedPath: string | null = null;
    if (b64) {
      try {
        const dir = path.join(os.tmpdir(), 'tekautomate');
        fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, `screenshot_${Date.now()}.${ext}`);
        fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
        savedPath = filePath;
      } catch {
        // fall through to error text
      }
    }
    const meta: Record<string, unknown> = {
      ok: source.ok === false ? false : true,
      captured: true,
    };
    if (typeof source.capturedAt === 'string') meta.capturedAt = source.capturedAt;
    if (typeof source.scopeType === 'string') meta.scopeType = source.scopeType;
    if (typeof source.sizeBytes === 'number') meta.sizeBytes = source.sizeBytes;
    if (typeof source.mimeType === 'string') meta.mimeType = source.mimeType;
    if (savedPath) {
      meta.localPath = savedPath;
      meta._hint = 'Screenshot saved locally. Use the Read tool to open this file and view the oscilloscope image.';
    } else {
      meta.error = 'Screenshot captured but could not be saved to local temp directory.';
    }
    return [{ type: 'text' as const, text: JSON.stringify(meta, null, 2) }];
  }

  // ── Non-screenshot tool result ─────────────────────────────────────────────
  if (!isScreenshotLike) {
    const safeResult = sanitizeToolResultForExternalMcp(toolName, result);
    const text = typeof safeResult === 'string'
      ? safeResult
      : JSON.stringify(safeResult, null, 2);
    return [{ type: 'text' as const, text }];
  }
}

// ── env ──────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env'), quiet: true });

// ── main ─────────────────────────────────────────────────────────────

async function main() {
  // All logs go to stderr so they don't corrupt the stdio JSON-RPC stream
  console.error('[tekautomate-mcp] Initializing indexes…');

  const initTasks = [
    initCommandIndex(),
    initTmDevicesIndex(),
    initRagIndexes(),
    initTemplateIndex(),
    ...(providerSupplementsEnabled() ? [initProviderCatalog()] : []),
  ];
  await Promise.all(initTasks);
  console.error('[tekautomate-mcp] Indexes ready');

  if (String(process.env.MCP_ROUTER_DISABLED || '').trim() !== 'true') {
    await bootRouter();
    console.error('[tekautomate-mcp] Router ready');
  }

  // ── Create low-level MCP server ──────────────────────────────────
  const server = new Server(
    { name: 'tekautomate', version: '3.2.0' },
    { capabilities: { tools: {}, resources: {} } },
  );

  // Only expose the slim MCP surface (gateway + live tools)
  // All other tools are routed internally via tek_router
  const toolDefs = getSlimToolDefinitions();
  const mcpTools = toolDefs.map((def) => ({
    name: def.name,
    description: def.description ?? def.name,
    inputSchema: {
      type: 'object' as const,
      properties: (def.parameters as any)?.properties ?? {},
      ...((def.parameters as any)?.required?.length
        ? { required: (def.parameters as any).required }
        : {}),
    },
  }));

  // ── resources/list handler ──────────────────────────────────────
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources: any[] = [
      {
        uri: 'tekautomate://deployment/mode',
        name: 'Deployment Mode',
        description: 'Tells the client which tools are available on this deployment and how to use them.',
        mimeType: 'application/json',
      },
      {
        uri: 'tekautomate://proposals/latest',
        name: 'Latest Staged Proposal',
        description: 'Most recent workflow proposal staged by the AI agent via workflow_ui{stage}.',
        mimeType: 'application/json',
      },
    ];
    if (isLiveInstrumentEnabled()) {
      resources.unshift({
        uri: 'tekautomate://instrument/profile',
        name: 'Instrument Profile',
        description: 'Active scope identity (family, firmware, options, transports) plus family-specific SCPI quirks.',
        mimeType: 'application/json',
      });
    }
    for (const p of listPersonalityResources()) {
      resources.push({
        uri: `tekautomate://${p.category}/${p.name}`,
        name: `${p.category === 'persona' ? 'Persona' : 'Base Prompt'}: ${p.name}`,
        description: p.bias ? p.bias : `${p.category} overlay`,
        mimeType: 'text/markdown',
      });
    }
    return { resources };
  });

  // ── resources/templates/list handler ────────────────────────────
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [
      {
        uriTemplate: 'tekautomate://proposals/session/{sessionKey}',
        name: 'Proposal by Session Key',
        description: 'Fetch the staged workflow proposal for a specific ChatKit session. {sessionKey} is the value returned by workflow_ui{current}.sessionKey.',
        mimeType: 'application/json',
      },
    ],
  }));

  // ── resources/read handler ──────────────────────────────────────
  // Per-family SCPI quirks attached to the instrument/profile resource.
  const STDIO_FAMILY_QUIRKS: Record<string, string[]> = {
    MSO2: [
      'SPI decode paths live under BUS:B<x>:SPI: (not BUS:B<x>:SERIAL:SPI:).',
      'Record length caps at 1M for 2-channel models.',
      'No AFG — do not attempt AFG:* commands.',
    ],
    MSO4: [
      'Supports up to 6 analog channels; verify channel count from profile.channels.',
      'SV: (Spectrum View) requires the BW option — check profile.options.',
    ],
    MSO5: [
      'Digital channels require the MSO option; gated on profile.options.',
      'Extended record length requires RL option.',
    ],
    MSO6: [
      'Bandwidth upgrades are license-gated — see profile.options for BW entries.',
      'Supports 4/6/8 channel configurations; confirm via profile.channels.',
    ],
  };

  function buildStdioInstrumentProfile(): Record<string, unknown> | null {
    const state = getInstrumentInfoState(null);
    if (!state || !state.visaResource) return null;
    const visa = state.visaResource;
    const transportType = /::SOCKET$/i.test(visa) ? 'socket' : /::INSTR$/i.test(visa) ? 'vxi11' : 'other';
    const family = state.modelFamily || null;
    const quirks = family && STDIO_FAMILY_QUIRKS[family] ? STDIO_FAMILY_QUIRKS[family] : [];
    return {
      connected: Boolean(state.connected),
      family,
      deviceDriver: state.deviceDriver,
      backend: state.backend,
      executorUrl: state.executorUrl,
      transports: [
        { visaResource: visa, type: transportType, active: true },
      ],
      devices: Array.isArray(state.devices) ? state.devices : [],
      quirks,
      note: 'Identity fields (model/serial/firmware/options/channels) populate after a live probe. Call instrument_live{context} or send *IDN? + *OPT? to fill them in.',
    };
  }

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri: string = (request.params as any)?.uri ?? '';

    // tekautomate://deployment/mode
    if (uri === 'tekautomate://deployment/mode') {
      const liveEnabled = isLiveInstrumentEnabled();
      const availableTools = getSlimToolDefinitions().map((def: any) => def.name);
      const payload = liveEnabled
        ? {
            mode: 'live',
            liveInstrumentEnabled: true,
            availableTools,
            guidance: [
              'Live instrument control is ENABLED on this deployment.',
              'Use instrument_live{send} to run SCPI, {context} for identity, {screenshot} for visual verification.',
              'Always verify configuration changes with a query-back or screenshot.',
              'After every write batch, append *ESR? and ALLEV? — non-zero ESR means the batch failed.',
            ],
          }
        : {
            mode: 'public',
            liveInstrumentEnabled: false,
            availableTools,
            guidance: [
              'Live instrument control is DISABLED on this deployment.',
              'Use knowledge{retrieve} and tek_router for all SCPI lookups.',
              'Stage proposals via workflow_ui{stage} — the user runs them locally.',
              'Do NOT attempt instrument_live:* — it is not exposed and will fail.',
            ],
          };
      return {
        contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(payload, null, 2) }],
      };
    }

    // tekautomate://instrument/profile  (live-mode only)
    if (uri === 'tekautomate://instrument/profile') {
      if (!isLiveInstrumentEnabled()) {
        throw new Error('Instrument profile is not available — live instrument is disabled on this deployment.');
      }
      const profile = buildStdioInstrumentProfile();
      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(profile ?? { connected: false, note: 'No instrument connected yet.' }, null, 2),
        }],
      };
    }

    // tekautomate://proposals/latest  OR  tekautomate://proposals/session/{key}
    if (uri === 'tekautomate://proposals/latest' || uri.startsWith('tekautomate://proposals/session/')) {
      const sessionKey = uri.startsWith('tekautomate://proposals/session/')
        ? decodeURIComponent(uri.slice('tekautomate://proposals/session/'.length))
        : undefined;
      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(getLastWorkflowProposal(sessionKey) ?? null, null, 2),
        }],
      };
    }

    // tekautomate://persona/<name>  OR  tekautomate://base/<name>
    if (uri.startsWith('tekautomate://persona/') || uri.startsWith('tekautomate://base/')) {
      const loaded = readPersonalityByUri(uri);
      if (!loaded) throw new Error(`Personality overlay not found: ${uri}`);
      return {
        contents: [{
          uri,
          mimeType: 'text/markdown',
          text: loaded.markdown,
        }],
      };
    }

    throw new Error(`Unknown resource URI: ${uri}`);
  });

  // ── tools/list handler ───────────────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: mcpTools,
  }));

  // ── tools/call handler ───────────────────────────────────────────
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const result = await runTool(name, (args as Record<string, unknown>) ?? {});
      return {
        content: buildExternalMcpToolContent(name, result),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: `Error: ${msg}` }],
        isError: true,
      };
    }
  });

  console.error(`[tekautomate-mcp] Registered ${mcpTools.length} tools via stdio`);

  // ── Connect stdio transport ──────────────────────────────────────
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[tekautomate-mcp] Stdio transport connected — ready for requests');
}

main().catch((err) => {
  console.error('[tekautomate-mcp] Fatal:', err);
  process.exit(1);
});

