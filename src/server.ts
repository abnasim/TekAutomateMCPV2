import http from 'http';
import { initCommandIndex } from './core/commandIndex';
import { initProviderCatalog, providerSupplementsEnabled } from './core/providerCatalog';
import { initTmDevicesIndex } from './core/tmDevicesIndex';
import { initRagIndexes } from './core/ragIndex';
import { initTemplateIndex } from './core/templateIndex';
import { runToolLoop } from './core/toolLoop';
import { getToolDefinitions, getMcpExposedTools, runTool } from './tools/index';
import type { McpChatRequest } from './core/schemas';
import { getLastWorkflowProposal } from './tools/stageWorkflowProposal';
import { getRuntimeContextState, updateRuntimeContext } from './tools/runtimeContextStore';
import { completeLiveAction, getPendingLiveActionCount, waitForNextLiveAction } from './tools/liveActionBridge';
import { bootRouter, createReloadProvidersHandler, createRouterHandler, getRouterHealth } from './core/routerIntegration';
import { getCommandIndex } from './core/commandIndex';
import { getRagIndexes } from './core/ragIndex';
import { getTemplateIndex } from './core/templateIndex';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let lastAiDebug: Record<string, unknown> | null = null;

function sanitizeToolResultForExternalMcp(toolName: string, result: unknown): unknown {
  return result;
}
const REQUEST_LOG_DIR = path.join(__dirname, 'logs', 'requests');
const MAX_LOG_FILES = 500;
let startupState: 'starting' | 'ready' | 'error' = 'starting';
let startupError: string | null = null;
let startupInitPromise: Promise<void> | null = null;

function ensureLogDir() {
  fs.mkdirSync(REQUEST_LOG_DIR, { recursive: true });
}

function rotateLogs() {
  const files = fs.readdirSync(REQUEST_LOG_DIR).map((name) => {
    const full = path.join(REQUEST_LOG_DIR, name);
    const stat = fs.statSync(full);
    return { name, time: stat.mtimeMs };
  });
  if (files.length <= MAX_LOG_FILES) return;
  const excess = files.length - MAX_LOG_FILES;
  files
    .sort((a, b) => a.time - b.time)
    .slice(0, excess)
    .forEach((f) => {
      try {
        fs.unlinkSync(path.join(REQUEST_LOG_DIR, f.name));
      } catch {
        // ignore
      }
    });
}

function flattenStepTypes(steps: unknown[]): string[] {
  const types: string[] = [];
  const walk = (items: unknown[]) => {
    items.forEach((s) => {
      if (!s || typeof s !== 'object') return;
      const step = s as Record<string, unknown>;
      if (step.type) types.push(String(step.type));
      if (Array.isArray(step.children)) walk(step.children);
    });
  };
  walk(steps || []);
  return Array.from(new Set(types));
}

function extractActionsJson(text: string): Record<string, unknown> | null {
  // FIX BUG-004: Previous regex was too greedy, matching from first { to last }
  // This causes it to consume text after the JSON object
  try {
    // Step 1: Find ACTIONS_JSON marker
    const actionJsonMatch = text.match(/ACTIONS_JSON:\s*/i);
    if (!actionJsonMatch) {
      return null;
    }

    // Step 2: Start from marker position
    const startIdx = actionJsonMatch.index! + actionJsonMatch[0].length;
    let jsonText = text.substring(startIdx).trim();

    // Step 3: Remove code block markers if present
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.substring('```json'.length);
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.substring('```'.length);
    }

    // Step 4: Find matching braces (non-greedy: find first complete JSON object)
    let braceCount = 0;
    let endIdx = -1;
    for (let i = 0; i < jsonText.length; i += 1) {
      const ch = jsonText[i];
      if (ch === '{') braceCount += 1;
      else if (ch === '}') {
        braceCount -= 1;
        if (braceCount === 0) {
          endIdx = i + 1;
          break;
        }
      }
    }

    if (endIdx === -1) {
      console.warn('[POST_CHECK] Could not find complete JSON object in ACTIONS_JSON');
      return null;
    }

    // Step 5: Parse the JSON
    const jsonStr = jsonText.substring(0, endIdx);
    const parsed = JSON.parse(jsonStr);

    // Step 6: Validate structure (should be object)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      console.warn('[POST_CHECK] ACTIONS_JSON is not an object:', typeof parsed);
      return null;
    }

    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.warn('[POST_CHECK] Invalid JSON in ACTIONS_JSON:', error.message);
    } else {
      console.warn('[POST_CHECK] Error parsing ACTIONS_JSON:', error);
    }
    return null;
  }
}

function logRequest(payload: {
  requestId: string;
  startedAt: number;
  req: McpChatRequest;
  result?: { text: string; displayText?: string; errors: string[]; warnings?: string[] };
  ok: boolean;
}) {
  ensureLogDir();
  rotateLogs();
  const { req, result, requestId, startedAt } = payload;
  const safeReq = ((req || {}) as Partial<McpChatRequest>);
  const flowContext =
    safeReq.flowContext && typeof safeReq.flowContext === 'object'
      ? safeReq.flowContext
      : ({
          backend: '(unknown)',
          host: '(unknown)',
          connectionType: '(unknown)',
          modelFamily: '(unknown)',
          steps: [],
          selectedStepId: null,
          executionSource: 'steps',
        } as McpChatRequest['flowContext']);
  const actionsJson = result ? extractActionsJson(result.text) : null;
  const actions = actionsJson && Array.isArray(actionsJson.actions) ? (actionsJson.actions as unknown[]) : [];
  const logEntry = {
    timestamp: new Date().toISOString(),
    requestId,
    provider: safeReq.provider,
    model: safeReq.model,
    outputMode: safeReq.outputMode,
    deviceType: flowContext.deviceType,
    modelFamily: flowContext.modelFamily,
    backend: flowContext.backend,
    userMessage: safeReq.userMessage,
    flowContext: {
      stepCount: Array.isArray(flowContext.steps) ? flowContext.steps.length : 0,
      stepTypes: flattenStepTypes(Array.isArray(flowContext.steps) ? flowContext.steps : []),
      validationErrors: flowContext.validationErrors || [],
    },
    scpiContextHits: Array.isArray(safeReq.scpiContext) ? safeReq.scpiContext.length : 0,
    toolCalls: [],
    postCheck: {
      errors: result?.errors || [],
      warnings: result?.warnings || [],
      autoRepairTriggered: false,
    },
    response: result
      ? {
          text: result.text,
          actionsJson,
          stepCount: actions.length,
          stepTypes: actions.map((a: any) => a?.type).filter(Boolean),
        }
      : null,
    durationMs: Date.now() - startedAt,
    ok: payload.ok,
  };
  const file = path.join(REQUEST_LOG_DIR, `${Date.now()}_${requestId}.json`);
  try {
    fs.writeFileSync(file, JSON.stringify(logEntry, null, 2), 'utf8');
  } catch {
    // ignore logging errors
  }
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(raw || '{}') as Record<string, unknown>;
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end(JSON.stringify(payload));
}

function getHealthPayload() {
  return {
    ok: startupState !== 'error',
    status: startupState,
    ...(startupError ? { startupError } : {}),
  };
}

function sendSseStart(res: http.ServerResponse) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
}

function sseWrite(res: http.ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
}

function parseProviderError(status: number, raw: string): { code: string; message: string; hint: string } {
  let code = `http_${status}`;
  let message = raw || `Provider error ${status}`;
  let type = '';
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const err = (j.error && typeof j.error === 'object' ? j.error : j) as Record<string, unknown>;
    code = String(err.code || err.type || code);
    message = String(err.message || message);
    type = String(err.type || '');
  } catch {
    // Keep defaults if body is not JSON.
  }

  const k = `${code} ${type} ${message}`.toLowerCase();
  let hint = 'Check provider/key/model configuration.';
  if (k.includes('insufficient_quota') || k.includes('quota')) {
    hint = 'Key is valid but project quota/budget is exhausted or not enabled for this key.';
  } else if (k.includes('invalid_api_key') || k.includes('authentication') || k.includes('unauthorized')) {
    hint = 'Invalid API key or provider mismatch.';
  } else if (k.includes('model_not_found') || k.includes('not_permitted') || k.includes('permission')) {
    hint = 'Model is not available for this key/account.';
  }
  return { code, message, hint };
}

export async function createServer(port = 8787): Promise<http.Server> {
  const routerDisabled = String(process.env.MCP_ROUTER_DISABLED || '').trim() === 'true';
  startupInitPromise = (async () => {
    startupState = 'starting';
    startupError = null;
    const startInit = Date.now();
    console.log('[SERVER] Initializing all indexes...');

    const initTasks: Promise<unknown>[] = [
      initCommandIndex(),
      initTmDevicesIndex(),
      initRagIndexes(),
      initTemplateIndex(),
    ];
    const names = ['CommandIndex', 'TmDevicesIndex', 'RagIndexes', 'TemplateIndex'];
    if (providerSupplementsEnabled()) {
      initTasks.push(initProviderCatalog());
      names.push('ProviderCatalog');
    }

    const results = await Promise.allSettled(initTasks);
    const failures = results
      .map((r, i) => r.status === 'rejected' ? { index: i, error: r.reason } : null)
      .filter((f): f is { index: number; error: unknown } => Boolean(f));

    if (failures.length > 0) {
      const failedNames = failures.map((f) => names[f.index]).join(', ');
      const error = new Error(`[CRITICAL] Initialization failed: ${failedNames}`);
      startupState = 'error';
      startupError = error.message;
      console.error(error.message);
      for (const failure of failures) {
        console.error(`  ${names[failure.index]}: ${failure.error}`);
      }
      throw error;
    }

    console.log(`✅ All indexes initialized in ${Date.now() - startInit}ms`);

    if (!routerDisabled) {
      try {
        const commandIndex = await getCommandIndex();
        const ragIndexes = await getRagIndexes();
        const templates = (await getTemplateIndex()).all().map((doc) => ({
          id: doc.id,
          name: doc.name,
          description: doc.description,
          backend: 'template',
          deviceType: 'workflow',
          tags: [],
          steps: doc.steps,
        }));
        const report = await bootRouter({ commandIndex, ragIndexes, templates });
        console.log(`[MCP:router] ${report.total} tools in ${report.durationMs}ms`);
      } catch (error) {
        startupState = 'error';
        startupError = error instanceof Error ? error.message : String(error);
        console.error('[MCP:router] Boot failed:', error);
        throw error;
      }
    }
    startupState = 'ready';
  })().catch((error) => {
    startupState = 'error';
    startupError = error instanceof Error ? error.message : String(error);
    throw error;
  });

  // ── MCP Protocol Server (Streamable HTTP for Claude Web / Desktop) ──
  // SDK is loaded lazily so the server still boots without @modelcontextprotocol/sdk installed.
  let _mcpSdk: {
    Server: any;
    StreamableHTTPServerTransport: any;
    CallToolRequestSchema: any;
    ListToolsRequestSchema: any;
  } | null = null;

  async function getMcpSdk() {
    if (_mcpSdk) return _mcpSdk;
    try {
      const [serverMod, transportMod, typesMod] = await Promise.all([
        import('@modelcontextprotocol/sdk/server'),
        import('@modelcontextprotocol/sdk/server/streamableHttp.js'),
        import('@modelcontextprotocol/sdk/types.js'),
      ]);
      _mcpSdk = {
        Server: serverMod.Server,
        StreamableHTTPServerTransport: transportMod.StreamableHTTPServerTransport,
        CallToolRequestSchema: typesMod.CallToolRequestSchema,
        ListToolsRequestSchema: typesMod.ListToolsRequestSchema,
      };
      return _mcpSdk;
    } catch {
      return null;
    }
  }

  async function createMcpProtocolServer() {
    const sdk = await getMcpSdk();
    if (!sdk) throw new Error('MCP SDK not installed. Run: npm install @modelcontextprotocol/sdk');
    const mcp = new sdk.Server(
      { name: 'tekautomate', version: '3.2.0' },
      { capabilities: { tools: {} } },
    );
    mcp.setRequestHandler(sdk.ListToolsRequestSchema, async () => {
      if (startupInitPromise) {
        try { await startupInitPromise; } catch { /* degrade gracefully */ }
      }
      // Slim MCP surface — only gateway + live tools exposed
      const toolDefs = getMcpExposedTools();
      const mcpTools = toolDefs.map((def: any) => ({
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
      console.log(`[MCP] list_tools count=${mcpTools.length} startup=ready`);
      return { tools: mcpTools };
    });
    mcp.setRequestHandler(sdk.CallToolRequestSchema, async (request: any) => {
      if (startupInitPromise) {
        try { await startupInitPromise; } catch { /* degrade gracefully */ }
      }
      const { name, arguments: args } = request.params;
      try {
        const result = await runTool(name, (args as Record<string, unknown>) ?? {});
        const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    });
    return mcp;
  }

  // Per-session MCP transport map
  const mcpTransports = new Map<string, any>();

  // ── HTML Tools Page ───────────────────────────────────────────────
  function buildToolsHtml(): string {
    const toolDefs = getToolDefinitions();
    const toolCards = toolDefs.map((def) => {
      const props = (def.parameters as any)?.properties ?? {};
      const required = (def.parameters as any)?.required ?? [];
      const paramRows = Object.entries(props).map(([key, schema]: [string, any]) => {
        const isReq = required.includes(key);
        const typeStr = Array.isArray(schema.type) ? schema.type.join(' | ') : (schema.type || 'any');
        const enumStr = schema.enum ? ` <code>${schema.enum.join(' | ')}</code>` : '';
        return `<tr>
          <td><code>${key}</code>${isReq ? '<span class="req">*</span>' : ''}</td>
          <td><code>${typeStr}</code>${enumStr}</td>
          <td>${schema.description || ''}</td>
        </tr>`;
      }).join('');
      return `<div class="tool-card" id="tool-${def.name}">
        <h3>${def.name}</h3>
        <p class="desc">${(def.description ?? '').replace(/\n/g, '<br>')}</p>
        ${Object.keys(props).length > 0 ? `<table><thead><tr><th>Parameter</th><th>Type</th><th>Description</th></tr></thead><tbody>${paramRows}</tbody></table>` : '<p class="no-params">No parameters</p>'}
        <details><summary>Example curl</summary><pre>curl -X POST ${process.env.MCP_PUBLIC_URL || 'https://tekautomate-mcp-production.up.railway.app'}/tools/execute \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({ tool: def.name, args: Object.fromEntries(required.map((r: string) => [r, '<value>'])) })}'</pre></details>
      </div>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TekAutomate MCP Server - Tools &amp; API</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f172a;color:#e2e8f0;line-height:1.6;padding:0}
header{background:linear-gradient(135deg,#1e293b,#334155);padding:2rem;border-bottom:1px solid #475569}
header h1{font-size:1.8rem;font-weight:700;color:#fff}
header p{color:#94a3b8;margin-top:0.25rem}
.badge{display:inline-block;background:#3b82f6;color:#fff;font-size:0.7rem;padding:2px 8px;border-radius:99px;margin-left:8px;vertical-align:middle}
.container{max-width:1100px;margin:0 auto;padding:1.5rem}
.section{margin-bottom:2rem}
.section h2{font-size:1.3rem;color:#f1f5f9;margin-bottom:1rem;padding-bottom:0.5rem;border-bottom:1px solid #334155}
.setup-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:1rem;margin-bottom:1.5rem}
.setup-card{background:#1e293b;border:1px solid #334155;border-radius:8px;padding:1.25rem}
.setup-card h4{color:#60a5fa;margin-bottom:0.5rem;font-size:0.95rem}
.setup-card pre{background:#0f172a;padding:0.75rem;border-radius:6px;font-size:0.75rem;overflow-x:auto;color:#a5b4fc;border:1px solid #1e293b}
.setup-card .label{font-size:0.7rem;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.25rem}
.endpoints{display:grid;gap:0.5rem}
.endpoint{background:#1e293b;border:1px solid #334155;border-radius:6px;padding:0.75rem 1rem;display:flex;gap:1rem;align-items:center}
.endpoint .method{font-weight:700;font-size:0.75rem;padding:2px 8px;border-radius:4px;min-width:50px;text-align:center}
.method.get{background:#059669;color:#fff}.method.post{background:#3b82f6;color:#fff}
.endpoint code{color:#e2e8f0;font-size:0.85rem}
.endpoint .ep-desc{color:#94a3b8;font-size:0.8rem;margin-left:auto}
.tool-card{background:#1e293b;border:1px solid #334155;border-radius:8px;padding:1.25rem;margin-bottom:1rem}
.tool-card h3{color:#60a5fa;font-size:1rem;margin-bottom:0.5rem;font-family:monospace}
.tool-card .desc{color:#94a3b8;font-size:0.85rem;margin-bottom:0.75rem}
.tool-card table{width:100%;border-collapse:collapse;font-size:0.8rem}
.tool-card th{text-align:left;color:#64748b;font-weight:600;padding:4px 8px;border-bottom:1px solid #334155;font-size:0.7rem;text-transform:uppercase}
.tool-card td{padding:4px 8px;border-bottom:1px solid #1e293b;color:#cbd5e1}
.tool-card td code{color:#a5b4fc;font-size:0.8rem}
.req{color:#f87171;margin-left:2px}
.no-params{color:#64748b;font-size:0.8rem;font-style:italic}
details{margin-top:0.75rem}
summary{cursor:pointer;color:#60a5fa;font-size:0.8rem}
details pre{margin-top:0.5rem;font-size:0.75rem;background:#0f172a;padding:0.75rem;border-radius:6px;color:#a5b4fc;border:1px solid #334155;overflow-x:auto}
.stats{display:flex;gap:1.5rem;margin:1rem 0}
.stat{background:#1e293b;border:1px solid #334155;border-radius:8px;padding:0.75rem 1.25rem;text-align:center}
.stat .num{font-size:1.5rem;font-weight:700;color:#60a5fa}
.stat .lbl{font-size:0.7rem;color:#94a3b8;text-transform:uppercase}
#search{width:100%;padding:0.6rem 1rem;background:#1e293b;border:1px solid #334155;border-radius:8px;color:#e2e8f0;font-size:0.9rem;margin-bottom:1rem}
#search:focus{outline:none;border-color:#3b82f6}
</style>
</head>
<body>
<header>
  <h1>TekAutomate MCP Server <span class="badge">v3.2.0</span></h1>
  <p>AI orchestration layer for Tektronix test equipment automation</p>
</header>
<div class="container">

<div class="stats">
  <div class="stat"><div class="num">${toolDefs.length}</div><div class="lbl">Tools</div></div>
  <div class="stat"><div class="num">9,300+</div><div class="lbl">SCPI Commands</div></div>
  <div class="stat"><div class="num">2</div><div class="lbl">Transports</div></div>
</div>

<div class="section">
  <h2>Remote — No Install Needed</h2>
  <p style="color:#94a3b8;font-size:0.85rem;margin-bottom:1rem">Connect via Streamable HTTP. No local files or Node.js required.</p>
  <div class="setup-grid">
    <div class="setup-card">
      <h4>Claude Web (claude.ai)</h4>
      <div class="label">Settings &gt; Connectors &gt; Add Custom Connector</div>
      <pre>Name: TekAutomate
URL:  ${process.env.MCP_PUBLIC_URL || 'https://tekautomate-mcp-production.up.railway.app'}/mcp

No OAuth — leave Advanced settings blank</pre>
    </div>
    <div class="setup-card">
      <h4>Claude Desktop / Code / VS Code / Cursor</h4>
      <div class="label">Use type: "http" — config file varies by client</div>
      <pre>{
  "mcpServers": {
    "tekautomate": {
      "type": "http",
      "url": "${process.env.MCP_PUBLIC_URL || 'https://tekautomate-mcp-production.up.railway.app'}/mcp"
    }
  }
}

Config file locations:
  Desktop:       ~/.claude/claude_desktop_config.json
  Claude Code:   .mcp.json (project root)
  VS Code:       .vscode/mcp.json
  Cursor:        .cursor/mcp.json</pre>
    </div>
  </div>
</div>

<div class="section">
  <h2>Local — Run from Cloned Repo (STDIO)</h2>
  <p style="color:#94a3b8;font-size:0.85rem;margin-bottom:1rem">Requires the TekAutomate repo cloned locally + Node.js. Replace <code>/path/to/TekAutomate</code> with your actual folder path.</p>
  <div class="setup-grid">
    <div class="setup-card">
      <h4>Claude Desktop / Claude Code</h4>
      <div class="label">~/.claude/claude_desktop_config.json or .mcp.json</div>
      <pre>{
  "mcpServers": {
    "tekautomate": {
      "command": "npx",
      "args": ["tsx", "mcp-server/src/stdio.ts"],
      "cwd": "/path/to/TekAutomate"
    }
  }
}</pre>
    </div>
    <div class="setup-card">
      <h4>VS Code / Cursor</h4>
      <div class="label">.vscode/mcp.json</div>
      <pre>{
  "servers": {
    "tekautomate": {
      "command": "npx",
      "args": ["tsx", "mcp-server/src/stdio.ts"],
      "cwd": "/path/to/TekAutomate"
    }
  }
}</pre>
    </div>
  </div>
</div>

<div class="section">
  <h2>Local HTTP Server (localhost:8787)</h2>
  <p style="color:#94a3b8;font-size:0.85rem;margin-bottom:1rem">If you have the MCP server running locally via <code>npm start</code>, use this URL instead of the hosted one.</p>
  <div class="setup-grid">
    <div class="setup-card">
      <h4>Any MCP Client</h4>
      <div class="label">Same config as Remote, but with localhost URL</div>
      <pre>{
  "mcpServers": {
    "tekautomate": {
      "type": "http",
      "url": "http://localhost:8787/mcp"
    }
  }
}</pre>
    </div>
  </div>
</div>

<div class="section">
  <h2>API Endpoints</h2>
  <div class="endpoints">
    <div class="endpoint"><span class="method get">GET</span><code>/</code><span class="ep-desc">This page — tools &amp; API reference</span></div>
    <div class="endpoint"><span class="method get">GET</span><code>/health</code><span class="ep-desc">Health check</span></div>
    <div class="endpoint"><span class="method post">POST</span><code>/mcp</code><span class="ep-desc">MCP Streamable HTTP transport (for Claude Web, Desktop)</span></div>
    <div class="endpoint"><span class="method get">GET</span><code>/tools/list</code><span class="ep-desc">List all tool definitions as JSON</span></div>
    <div class="endpoint"><span class="method post">POST</span><code>/tools/execute</code><span class="ep-desc">Execute a tool: {"tool":"name","args":{...}}</span></div>
    <div class="endpoint"><span class="method post">POST</span><code>/ai/chat</code><span class="ep-desc">Main AI orchestration endpoint</span></div>
    <div class="endpoint"><span class="method post">POST</span><code>/ai/router</code><span class="ep-desc">Router-based tool dispatch</span></div>
    <div class="endpoint"><span class="method get">GET</span><code>/ai/debug/last</code><span class="ep-desc">Last request debug bundle</span></div>
  </div>
</div>

<div class="section">
  <h2>Tools (${toolDefs.length})</h2>
  <input id="search" placeholder="Filter tools..." oninput="filterTools(this.value)" />
  ${toolCards}
</div>

</div>
<script>
function filterTools(q) {
  q = q.toLowerCase();
  document.querySelectorAll('.tool-card').forEach(c => {
    c.style.display = (c.id + ' ' + c.textContent).toLowerCase().includes(q) ? '' : 'none';
  });
}
</script>
</body></html>`;
  }

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
      res.end();
      return;
    }

    // ── GET / — Tools & API reference page ────────────────────────
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.end(buildToolsHtml());
      return;
    }

    // ── /mcp — MCP Streamable HTTP transport ──────────────────────
    if (req.url === '/mcp' || req.url?.startsWith('/mcp?') || (req.method === 'POST' && req.url === '/')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id');
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

      const accept = req.headers['accept'] || '';
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      const clientSupportsSSE = String(accept).includes('text/event-stream');
      console.log(`[MCP] method=${req.method} session=${sessionId || 'none'} accept=${accept || 'none'} sse=${clientSupportsSSE}`);

      let body: string | undefined;
      if (req.method === 'POST') {
        body = await new Promise<string>((resolve, reject) => {
          const chunks: Buffer[] = [];
          req.on('data', (chunk) => chunks.push(chunk));
          req.on('end', () => resolve(Buffer.concat(chunks).toString()));
          req.on('error', reject);
        });
      }

      if (clientSupportsSSE && (req.method === 'POST' || req.method === 'GET' || req.method === 'DELETE')) {
        try {
          const sdk = await getMcpSdk();
          if (!sdk) {
            sendJson(res, 501, { error: 'MCP SDK not installed.' });
            return;
          }

          if (sessionId && mcpTransports.has(sessionId)) {
            const transport = mcpTransports.get(sessionId)!;
            await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
          } else if (req.method === 'POST') {
            const newSessionId = `tek-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const transport = new sdk.StreamableHTTPServerTransport({
              sessionIdGenerator: () => newSessionId,
            });
            const mcpServer = await createMcpProtocolServer();
            await mcpServer.connect(transport);
            transport.onclose = () => {
              if (transport.sessionId) {
                mcpTransports.delete(transport.sessionId);
                console.log(`[MCP] session closed: ${transport.sessionId}`);
              }
            };
            await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
            if (transport.sessionId) {
              mcpTransports.set(transport.sessionId, transport);
              console.log(`[MCP] new session: ${transport.sessionId}`);
            }
          } else if (req.method === 'DELETE') {
            sendJson(res, 200, { ok: true });
          } else {
            sendJson(res, 400, { error: 'No valid session. POST to /mcp to initialize.' });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[MCP:sse] Error: ${msg}`);
          if (!res.headersSent) sendJson(res, 500, { error: `MCP transport error: ${msg}` });
        }
        return;
      }

      if (req.method === 'POST' && body) {
        try {
          const rpc = JSON.parse(body) as { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
          const rpcId = rpc.id ?? null;
          const method = rpc.method || '';
          console.log(`[MCP:json] method=${method} id=${rpcId}`);

          if (startupInitPromise) {
            try { await startupInitPromise; } catch { }
          }

          if (method === 'initialize') {
            const jsonRes = {
              jsonrpc: '2.0',
              id: rpcId,
              result: {
                protocolVersion: '2024-11-05',
                capabilities: { tools: {} },
                serverInfo: { name: 'tekautomate', version: '3.2.0' },
              },
            };
            sendJson(res, 200, jsonRes);
          } else if (method === 'notifications/initialized') {
            res.statusCode = 204;
            res.end();
          } else if (method === 'tools/list') {
            const toolDefs = getMcpExposedTools();
            const tools = toolDefs.map((def: any) => ({
              name: def.name,
              description: def.description ?? def.name,
              inputSchema: {
                type: 'object' as const,
                properties: (def.parameters as any)?.properties ?? {},
                ...((def.parameters as any)?.required?.length ? { required: (def.parameters as any).required } : {}),
              },
            }));
            sendJson(res, 200, { jsonrpc: '2.0', id: rpcId, result: { tools } });
          } else if (method === 'tools/call') {
            const toolName = rpc.params?.name as string;
            const toolArgs = (rpc.params?.arguments as Record<string, unknown>) ?? {};
            console.log(`[MCP:json] call_tool name=${toolName} args=${JSON.stringify(toolArgs).slice(0, 200)}`);
            try {
              const result = await runTool(toolName, toolArgs);
              const safeResult = sanitizeToolResultForExternalMcp(toolName, result);
              const text = typeof safeResult === 'string' ? safeResult : JSON.stringify(safeResult, null, 2);
              sendJson(res, 200, {
                jsonrpc: '2.0',
                id: rpcId,
                result: { content: [{ type: 'text', text }] },
              });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`[MCP:json] tool error: ${msg}`);
              sendJson(res, 200, {
                jsonrpc: '2.0',
                id: rpcId,
                result: { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true },
              });
            }
          } else {
            sendJson(res, 200, {
              jsonrpc: '2.0',
              id: rpcId,
              error: { code: -32601, message: `Method not found: ${method}` },
            });
          }
        } catch (err) {
          console.error(`[MCP:json] parse error: ${err instanceof Error ? err.message : String(err)}`);
          sendJson(res, 200, {
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error' },
          });
        }
        return;
      }

      sendJson(res, 405, { error: 'POST to /mcp with JSON-RPC body.' });
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, getHealthPayload());
      return;
    }

    if (!routerDisabled && req.method === 'GET' && req.url === '/ai/router/health') {
      // FIX BUG-005: getRouterHealth() can return undefined, causing malformed JSON
      const health = getRouterHealth();
      if (!health) {
        sendJson(res, 503, { ok: false, status: 'initializing', message: 'Router still initializing' });
      } else {
        sendJson(res, 200, health);
      }
      return;
    }

    if (!routerDisabled && req.method === 'POST' && req.url === '/ai/router') {
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const result = await createRouterHandler(body as any);
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : 'Router error' });
      }
      return;
    }

    if (!routerDisabled && req.method === 'POST' && req.url === '/ai/router/reload-providers') {
      try {
        const body = (await readJsonBody(req)) as { providersDir?: string };
        const result = await createReloadProvidersHandler(body);
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : 'Router reload error' });
      }
      return;
    }

    if (req.method === 'GET' && req.url === '/ai/debug/last') {
      sendJson(res, 200, { ok: true, debug: lastAiDebug });
      return;
    }

    if (req.method === 'GET' && req.url === '/workflow-proposals/latest') {
      sendJson(res, 200, { ok: true, proposal: getLastWorkflowProposal() });
      return;
    }

    if (req.method === 'GET' && req.url === '/runtime-context/latest') {
      sendJson(res, 200, { ok: true, context: getRuntimeContextState() });
      return;
    }

    if (req.method === 'POST' && req.url === '/runtime-context') {
      try {
        const body = await readJsonBody(req);
        const context = updateRuntimeContext({
          workflow: body.workflow,
          instrument: body.instrument,
          runLog: body.runLog,
          liveSession: body.liveSession,
        });
        sendJson(res, 200, { ok: true, context });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (req.method === 'GET' && req.url?.startsWith('/live-actions/next')) {
      try {
        const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const sessionKey = requestUrl.searchParams.get('sessionKey') || '';
        const timeoutMs = Number(requestUrl.searchParams.get('timeoutMs') || '25000');
        const action = await waitForNextLiveAction(sessionKey, Number.isFinite(timeoutMs) ? timeoutMs : 25000);
        sendJson(res, 200, {
          ok: true,
          action,
          pendingCount: getPendingLiveActionCount(sessionKey),
        });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (req.method === 'POST' && req.url === '/live-actions/result') {
      try {
        const body = await readJsonBody(req);
        const accepted = completeLiveAction({
          id: String(body.id || ''),
          sessionKey: typeof body.sessionKey === 'string' ? body.sessionKey : null,
          ok: body.ok !== false,
          result: body.result,
          error: typeof body.error === 'string' ? body.error : undefined,
        });
        sendJson(res, accepted ? 200 : 404, {
          ok: accepted,
          id: String(body.id || ''),
          error: accepted ? undefined : 'Live action not found.',
        });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    // ── Tool endpoints: browser calls these directly, AI proxy not needed ──

    if (req.method === 'GET' && req.url === '/tools/list') {
      const tools = getToolDefinitions();
      sendJson(res, 200, { ok: true, tools });
      return;
    }

    // Disconnect live VISA session — call before switching away from live mode
    if (req.method === 'POST' && req.url === '/tools/disconnect') {
      try {
        const body = (await readJsonBody(req)) as {
          instrumentEndpoint?: { executorUrl: string; visaResource: string };
        };
        const ep = body?.instrumentEndpoint;
        if (!ep?.executorUrl || !ep?.visaResource) {
          sendJson(res, 400, { ok: false, error: 'Missing instrumentEndpoint (executorUrl, visaResource)' });
          return;
        }
        const execRes = await fetch(`${ep.executorUrl.replace(/\/$/, '')}/run`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            protocol_version: 1,
            action: 'disconnect',
            scope_visa: ep.visaResource,
          }),
        });
        const json = (await execRes.json()) as Record<string, unknown>;
        sendJson(res, 200, { ok: json.ok === true, disconnected: ep.visaResource });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : 'Disconnect failed' });
      }
      return;
    }

    if (req.method === 'POST' && req.url === '/tools/execute') {
      try {
        const body = (await readJsonBody(req)) as {
          tool: string;
          args: Record<string, unknown>;
          instrumentEndpoint?: {
            executorUrl: string;
            visaResource: string;
            backend: string;
            liveMode?: boolean;
            outputMode?: 'clean' | 'verbose';
          };
          flowContext?: {
            modelFamily?: string;
            deviceDriver?: string;
          };
        };
        const toolName = String(body.tool || '').trim();
        if (!toolName) {
          sendJson(res, 400, { ok: false, error: 'Missing tool name' });
          return;
        }
        // Inject instrument endpoint for live tools
        let args = body.args || {};
        const liveTools = ['get_instrument_state', 'probe_command', 'send_scpi', 'capture_screenshot', 'get_visa_resources', 'get_environment', 'discover_scpi'];
        if (liveTools.includes(toolName) && body.instrumentEndpoint) {
          args = {
            executorUrl: body.instrumentEndpoint.executorUrl,
            visaResource: body.instrumentEndpoint.visaResource,
            backend: body.instrumentEndpoint.backend,
            liveMode: body.instrumentEndpoint.liveMode === true,
            outputMode: body.instrumentEndpoint.outputMode || 'verbose',
            modelFamily: body.flowContext?.modelFamily,
            deviceDriver: body.flowContext?.deviceDriver,
            ...args,
          };
        }
        const result = await runTool(toolName, args);
        const safeResult = sanitizeToolResultForExternalMcp(toolName, result);
        sendJson(res, 200, { ok: true, tool: toolName, result: safeResult });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : 'Tool execution error' });
      }
      return;
    }

    if (req.method === 'POST' && req.url === '/ai/responses-proxy') {
      let sseStarted = false;
      const startedAt = Date.now();
      try {
        const body = (await readJsonBody(req)) as {
          apiKey?: string;
          model?: string;
          input?: unknown[];
          systemPrompt?: string;
        };
        const serverKey = process.env.OPENAI_SERVER_API_KEY;
        const vectorStoreId = process.env.COMMAND_VECTOR_STORE_ID;
        if (!serverKey) {
          sendJson(res, 500, { ok: false, error: 'OPENAI_SERVER_API_KEY not configured on server' });
          return;
        }
        if (!body?.input) {
          sendJson(res, 400, { ok: false, error: 'Missing input' });
          return;
        }
        const requestBody: Record<string, unknown> = {
          model: body.model || 'gpt-4o',
          input: body.input,
          stream: true,
        };
        if (vectorStoreId) {
          requestBody.tools = [{ type: 'file_search', vector_store_ids: [vectorStoreId] }];
        }
        // Use server key — owns the vector store. User's apiKey is for authentication
        // to this service only; OpenAI is billed to the server account.
        const openaiRes = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serverKey}`,
          },
          body: JSON.stringify(requestBody),
        });
        if (!openaiRes.ok) {
          const errText = await openaiRes.text();
          sendJson(res, openaiRes.status, { ok: false, error: `OpenAI error ${openaiRes.status}: ${errText}` });
          return;
        }
        lastAiDebug = {
          timestamp: new Date().toISOString(),
          route: '/ai/responses-proxy',
          request: {
            model: body.model || 'gpt-4o',
            inputCount: Array.isArray(body.input) ? body.input.length : 0,
          },
          timings: {
            totalMs: Date.now() - startedAt,
          },
        };
        // Proxy the SSE stream directly to the client
        sendSseStart(res);
        sseStarted = true;
        const reader = openaiRes.body?.getReader();
        if (!reader) {
          sseWrite(res, 'error', { ok: false, error: 'No response body' });
          sseWrite(res, 'done', '[DONE]');
          res.end();
          return;
        }
        const decoder = new TextDecoder();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          // Write raw SSE chunks through — client parser handles them
          res.write(chunk);
        }
        res.end();
      } catch (err) {
        lastAiDebug = {
          timestamp: new Date().toISOString(),
          route: '/ai/responses-proxy',
          error: err instanceof Error ? err.message : 'Server error',
          timings: {
            totalMs: Date.now() - startedAt,
          },
        };
        if (sseStarted) {
          sseWrite(res, 'error', { ok: false, error: err instanceof Error ? err.message : 'Server error' });
          res.end();
        } else {
          sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : 'Server error' });
        }
      }
      return;
    }

    if (req.method === 'POST' && req.url === '/ai/chat') {
      const startedAt = Date.now();
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        const body = (await readJsonBody(req)) as unknown as McpChatRequest;
        const normalizedUserMessage = typeof body?.userMessage === 'string' ? body.userMessage.trim() : '';
        const mode = body?.mode === 'mcp_only' ? 'mcp_only' : 'mcp_ai';
        if (mode === 'mcp_only') {
          body.provider = (body.provider || 'openai') as McpChatRequest['provider'];
          body.model = body.model || 'gpt-5.4-mini';
          body.apiKey = body.apiKey || '__mcp_only__';
        }
        if (!normalizedUserMessage || !body?.provider || !body?.model || (mode !== 'mcp_only' && !body?.apiKey)) {
          sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
          return;
        }
        body.userMessage = normalizedUserMessage;
        const hasAssistantRoute = typeof body.openaiAssistantId === 'string' && body.openaiAssistantId.trim().length > 0;
        console.log(`[MCP] /ai/chat requestId=${requestId} openaiAssistantId=${hasAssistantRoute ? '(set)' : '(none)'} userMessageLen=${body.userMessage?.length ?? 0}`);
        const result = await runToolLoop(body);
        lastAiDebug = {
          timestamp: new Date().toISOString(),
          route: '/ai/chat',
          request: {
            ...body,
            apiKey: '[redacted]',
            instrumentEndpoint: body.instrumentEndpoint
              ? {
                  ...body.instrumentEndpoint,
                  visaResource: '[redacted]',
                }
              : undefined,
          },
          response: {
            text: result.text,
            displayText: result.displayText,
            errors: result.errors,
          },
          prompts: result.debug
            ? {
                promptFileText: result.debug.promptFileText,
                systemPrompt: result.debug.systemPrompt,
                userPrompt: result.debug.userPrompt,
                developerPrompt: (result.debug as Record<string, unknown>).developerPrompt,
                providerRequest: (result.debug as Record<string, unknown>).providerRequest,
                shortcutResponse: result.debug.shortcutResponse,
                resolutionPath: (result.debug as Record<string, unknown>).resolutionPath,
              }
            : undefined,
          tools: result.debug
            ? {
                available: result.debug.toolDefinitions,
                trace: result.debug.toolTrace,
              }
            : undefined,
          rawOutput: (result.debug as Record<string, unknown>).rawOutput,
          timings: {
            totalMs: Date.now() - startedAt,
            ...(result.metrics || {}),
          },
        };
        logRequest({
          requestId,
          startedAt,
          req: body,
          result,
          ok: true,
        });
        sendJson(res, 200, {
          ok: true,
          text: result.text,
          displayText: result.displayText,
          commands: result.commands, // Include commands for apply card
          screenshots: (result as any).screenshots, // Live mode screenshots for UI update
          openaiThreadId: result.assistantThreadId,
          errors: result.errors,
          warnings: result.warnings,
          metrics: result.metrics,
        });
      } catch (err) {
        lastAiDebug = {
          timestamp: new Date().toISOString(),
          route: '/ai/chat',
          error: err instanceof Error ? err.message : 'Server error',
          timings: {
            totalMs: Date.now() - startedAt,
          },
        };
        const body = {} as McpChatRequest;
        try {
          Object.assign(body, await readJsonBody(req));
        } catch {
          /* ignore */
        }
        logRequest({
          requestId,
          startedAt,
          req: body,
          result: err instanceof Error ? { text: err.message, errors: [err.message] } : undefined,
          ok: false,
        });
        sendJson(res, 500, {
          ok: false,
          error: err instanceof Error ? err.message : 'Server error',
        });
      }
      return;
    }

    // ── ChatKit session endpoint ──
    // Creates a ChatKit session via the OpenAI API, returns client_secret for frontend.
    if (req.method === 'POST' && req.url === '/chatkit/session') {
      try {
        const body = (await readJsonBody(req)) as {
          apiKey?: string;
          workflowId?: string;
          userId?: string;
        };
        const apiKey = String(body?.apiKey || process.env.OPENAI_API_KEY || '').trim();
        const workflowId = String(body?.workflowId || process.env.CHATKIT_WORKFLOW_ID || '').trim();
        const userId = String(body?.userId || 'tekautomate-user').trim();
        if (!apiKey) {
          sendJson(res, 400, { ok: false, error: 'Missing apiKey (or set OPENAI_API_KEY env var).' });
          return;
        }
        if (!workflowId) {
          sendJson(res, 400, { ok: false, error: 'Missing workflowId (or set CHATKIT_WORKFLOW_ID env var).' });
          return;
        }
        // Call OpenAI ChatKit Sessions API
        const sessionRes = await fetch('https://api.openai.com/v1/chatkit/sessions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'OpenAI-Beta': 'chatkit_beta=v1',
          },
          body: JSON.stringify({
            workflow: { id: workflowId },
            user: userId,
            chatkit_configuration: {
              file_upload: {
                enabled: true,
              },
            },
          }),
        });
        if (!sessionRes.ok) {
          const errText = await sessionRes.text();
          sendJson(res, sessionRes.status, { ok: false, error: `ChatKit session creation failed: ${errText}` });
          return;
        }
        const sessionData = await sessionRes.json() as {
          client_secret?: string | { value?: string };
          clientSecret?: string;
          id?: string;
        };
        const clientSecret = typeof sessionData.client_secret === 'string'
          ? sessionData.client_secret
          : sessionData.client_secret?.value || sessionData.clientSecret || '';
        sendJson(res, 200, {
          ok: true,
          clientSecret,
          sessionId: sessionData.id || '',
        });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : 'ChatKit session error' });
      }
      return;
    }

    if (req.method === 'POST' && req.url === '/ai/key-test') {
      try {
        const body = (await readJsonBody(req)) as {
          provider?: 'openai' | 'anthropic';
          apiKey?: string;
          model?: string;
        };
        const provider = body?.provider;
        const apiKey = String(body?.apiKey || '').trim();
        const model = String(body?.model || '').trim();
        if (!provider || !apiKey || !model) {
          sendJson(res, 400, { ok: false, error: 'Missing provider, apiKey, or model.' });
          return;
        }

        if (provider === 'openai') {
          const openaiRes = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model,
              input: 'ping',
              max_output_tokens: 16,
            }),
          });
          if (!openaiRes.ok) {
            const raw = await openaiRes.text();
            const parsed = parseProviderError(openaiRes.status, raw);
            sendJson(res, openaiRes.status, { ok: false, provider, model, ...parsed });
            return;
          }
        } else {
          console.log(`[KEY-TEST] Testing Anthropic: model=${model} keyPrefix=${apiKey.slice(0, 10)}...`);
          try {
            const anthBase = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
            const anthRes = await fetch(`${anthBase}/v1/messages`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify({
                model,
                max_tokens: 16,
                messages: [{ role: 'user', content: 'ping' }],
              }),
            });
            if (!anthRes.ok) {
              const raw = await anthRes.text();
              console.log(`[KEY-TEST] Anthropic error ${anthRes.status}: ${raw.slice(0, 500)}`);
              const parsed = parseProviderError(anthRes.status, raw);
              sendJson(res, anthRes.status, { ok: false, provider, model, ...parsed });
              return;
            }
            console.log('[KEY-TEST] Anthropic: OK');
          } catch (anthErr) {
            console.log(`[KEY-TEST] Anthropic fetch error: ${anthErr instanceof Error ? anthErr.message : String(anthErr)}`);
            sendJson(res, 502, {
              ok: false,
              provider,
              model,
              error: `Cannot reach Anthropic API: ${anthErr instanceof Error ? anthErr.message : String(anthErr)}`,
            });
            return;
          }
        }

        sendJson(res, 200, {
          ok: true,
          provider,
          model,
          reachable: true,
          message: 'Provider/key/model accepted.',
        });
      } catch (err) {
        sendJson(res, 500, {
          ok: false,
          error: err instanceof Error ? err.message : 'Server error',
        });
      }
      return;
    }

    if (req.method === 'POST' && req.url === '/ai/models') {
      try {
        const body = (await readJsonBody(req)) as {
          provider?: 'openai' | 'anthropic';
          apiKey?: string;
        };
        const provider = body?.provider;
        const apiKey = String(body?.apiKey || '').trim();
        if (!provider || !apiKey) {
          sendJson(res, 400, { ok: false, error: 'Missing provider or apiKey.' });
          return;
        }

        if (provider === 'openai') {
          const modelsRes = await fetch('https://api.openai.com/v1/models', {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
          });
          const raw = await modelsRes.text();
          if (!modelsRes.ok) {
            const parsed = parseProviderError(modelsRes.status, raw);
            sendJson(res, modelsRes.status, { ok: false, provider, ...parsed });
            return;
          }
          let ids: string[] = [];
          try {
            const json = JSON.parse(raw) as { data?: Array<{ id?: string }> };
            ids = (json.data || [])
              .map((m) => String(m?.id || '').trim())
              .filter(Boolean)
              .sort((a, b) => a.localeCompare(b));
          } catch {
            ids = [];
          }
          sendJson(res, 200, { ok: true, provider, models: ids });
          return;
        }

        const anthBase2 = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
        const anthRes = await fetch(`${anthBase2}/v1/models`, {
          method: 'GET',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
        });
        const anthRaw = await anthRes.text();
        if (!anthRes.ok) {
          const parsed = parseProviderError(anthRes.status, anthRaw);
          sendJson(res, anthRes.status, { ok: false, provider, ...parsed });
          return;
        }
        let ids: string[] = [];
        try {
          const json = JSON.parse(anthRaw) as { data?: Array<{ id?: string }> };
          ids = (json.data || [])
            .map((m) => String(m?.id || '').trim())
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b));
        } catch {
          ids = [];
        }
        sendJson(res, 200, { ok: true, provider, models: ids });
      } catch (err) {
        sendJson(res, 500, {
          ok: false,
          error: err instanceof Error ? err.message : 'Server error',
        });
      }
      return;
    }

    sendJson(res, 404, { ok: false, error: 'Not found' });
  });

  await new Promise<void>((resolve) => {
    server.listen(port, () => resolve());
  });
  return server;
}

