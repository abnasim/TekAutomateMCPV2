/**
 * MCP Stdio Transport Entry Point
 *
 * Exposes the same tools as the HTTP server but over the standard
 * MCP stdio protocol, so Claude Code, Claude Desktop, VS Code (Copilot),
 * Cursor, and any other MCP-compatible client can use TekAutomate tools
 * natively.
 *
 * Usage:
 *   npx tsx mcp-server/src/stdio.ts
 *
 * Nothing in the existing HTTP server is modified — this is an
 * additive, parallel entry point.
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Server } from '@modelcontextprotocol/sdk/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { initCommandIndex } from './core/commandIndex.js';
import { initTmDevicesIndex } from './core/tmDevicesIndex.js';
import { initRagIndexes } from './core/ragIndex.js';
import { initTemplateIndex } from './core/templateIndex.js';
import { initProviderCatalog, providerSupplementsEnabled } from './core/providerCatalog.js';
import { bootRouter } from './core/routerIntegration.js';
import { getSlimToolDefinitions, runTool } from './tools/index.js';

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

  const isScreenshotLike = toolName === 'capture_screenshot'
    || (toolName === 'instrument_live' && Boolean(imageContent || source.imageUrl || source.base64 || source.analysisBase64));

  if (!isScreenshotLike || !imageContent || imageContent.type !== 'image') {
    const safeResult = sanitizeToolResultForExternalMcp(toolName, result);
    const text = typeof safeResult === 'string'
      ? safeResult
      : JSON.stringify(safeResult, null, 2);
    return [{ type: 'text' as const, text }];
  }

  const metadata: Record<string, unknown> = {
    ok: source.ok === false ? false : true,
    captured: true,
  };
  if (typeof source.capturedAt === 'string') metadata.capturedAt = source.capturedAt;
  if (typeof source.scopeType === 'string') metadata.scopeType = source.scopeType;
  if (typeof source.sizeBytes === 'number') metadata.sizeBytes = source.sizeBytes;
  if (typeof source.mimeType === 'string') metadata.mimeType = source.mimeType;
  if (typeof source.originalMimeType === 'string') metadata.originalMimeType = source.originalMimeType;
  if (typeof source.originalSizeBytes === 'number') metadata.originalSizeBytes = source.originalSizeBytes;

  return [
    {
      type: 'image' as const,
      data: String(imageContent.data || ''),
      mimeType: String(imageContent.mimeType || source.mimeType || 'image/png'),
    },
    {
      type: 'text' as const,
      text: JSON.stringify(metadata),
    },
  ];
}

// ── env ──────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env') });

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
    { capabilities: { tools: {} } },
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

