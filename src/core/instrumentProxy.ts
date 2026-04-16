import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve project root relative to this file: mcp-server/src/core/ → up 3 dirs
const _projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
import type { InstrumentOutputMode, ToolResult } from './schemas';
import { decodeCommandStatus, decodeStatusFromText } from './statusDecoder';

interface Endpoint {
  executorUrl: string;
  visaResource: string;
  backend: string;
  liveMode?: boolean;
  outputMode?: InstrumentOutputMode;
  scopeType?: 'modern' | 'legacy';
  modelFamily?: string;
  deviceDriver?: string;
}

function buildExecutorHeaders(endpoint: Endpoint): Record<string, string> {
  return { 'Content-Type': 'application/json' };
}

interface RunPythonResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
  combinedOutput: string;
  transcript: Array<{ stream: string; line: string; timestamp?: number }>;
  durationSec?: number;
  resultData?: unknown;
}

function resolveOutputMode(endpoint: Endpoint): InstrumentOutputMode {
  return endpoint.outputMode === 'clean' ? 'clean' : 'verbose';
}

function isLiveModeEnabled(endpoint: Endpoint): boolean {
  return endpoint.liveMode === true;
}

function inferScopeType(endpoint: Endpoint): 'modern' | 'legacy' {
  if (endpoint.scopeType === 'modern' || endpoint.scopeType === 'legacy') return endpoint.scopeType;
  const hint = `${endpoint.modelFamily || ''} ${endpoint.deviceDriver || ''}`.toLowerCase();
  return /\b(dpo|5k|7k|70k)\b/.test(hint) ? 'legacy' : 'modern';
}

function buildRuntimeDetails(run: RunPythonResult, mode: InstrumentOutputMode): Record<string, unknown> {
  const base: Record<string, unknown> = {
    outputMode: mode,
    durationSec: run.durationSec,
  };
  if (mode === 'clean') {
    base.runtimeSummary = {
      hasStdout: Boolean(run.stdout),
      hasStderr: Boolean(run.stderr),
      hasError: Boolean(run.error),
      transcriptLines: run.transcript.length,
    };
    return base;
  }
  base.rawStdout = run.stdout;
  base.rawStderr = run.stderr;
  base.error = run.error;
  base.combinedOutput = run.combinedOutput;
  base.transcript = run.transcript;
  return base;
}

export function formatVerboseProbeResult(
  command: string,
  data: Record<string, unknown>,
  mode: InstrumentOutputMode
): string {
  const response = typeof data.response === 'string' ? data.response : '';
  const stderr = typeof data.stderr === 'string' ? data.stderr : '';
  const error = typeof data.error === 'string' ? data.error : '';
  const decoded = Array.isArray(data.decodedStatus) ? data.decodedStatus.map((item) => String(item)) : [];
  if (mode === 'clean') {
    return decoded.length > 0
      ? `${command}: ${response}\nDecoded:\n- ${decoded.join('\n- ')}`.trim()
      : `${command}: ${response}`.trim();
  }

  const sections = [`Command: ${command}`];
  if (response) sections.push(`Query response:\n${response}`);
  if (typeof data.rawStdout === 'string' && data.rawStdout) sections.push(`stdout:\n${data.rawStdout}`);
  if (stderr) sections.push(`stderr:\n${stderr}`);
  if (error) sections.push(`error:\n${error}`);
  if (decoded.length > 0) sections.push(`Decoded:\n- ${decoded.join('\n- ')}`);
  if (typeof data.combinedOutput === 'string' && data.combinedOutput) {
    sections.push(`Combined runtime output:\n${data.combinedOutput}`);
  }
  return sections.join('\n\n').trim();
}

async function runPython(
  endpoint: Endpoint,
  code: string,
  timeoutSec = 60
): Promise<RunPythonResult> {
  try {
    const res = await fetch(`${endpoint.executorUrl.replace(/\/$/, '')}/run`, {
      method: 'POST',
      headers: buildExecutorHeaders(endpoint),
      body: JSON.stringify({
        protocol_version: 1,
        action: 'run_python',
        code,
        timeout_sec: timeoutSec,
        scope_visa: endpoint.visaResource,
      }),
    });
    const json = (await res.json()) as Record<string, unknown>;
    return {
      ok: json.ok === true,
      stdout: typeof json.stdout === 'string' ? json.stdout : '',
      stderr: typeof json.stderr === 'string' ? json.stderr : '',
      error: typeof json.error === 'string' ? json.error : undefined,
      combinedOutput: typeof json.combined_output === 'string' ? json.combined_output : '',
      transcript: Array.isArray(json.transcript)
        ? (json.transcript as Array<{ stream: string; line: string; timestamp?: number }>)
        : [],
      durationSec: typeof json.duration_sec === 'number' ? json.duration_sec : undefined,
      resultData: json.result_data,
    };
  } catch (err) {
    return {
      ok: false,
      stdout: '',
      stderr: '',
      error: err instanceof Error ? err.message : 'Executor unreachable',
      combinedOutput: '',
      transcript: [],
      resultData: undefined,
    };
  }
}

async function runExecutorAction(
  endpoint: Endpoint,
  action: string,
  payload: Record<string, unknown>,
  timeoutSec = 60
): Promise<RunPythonResult> {
  try {
    const res = await fetch(`${endpoint.executorUrl.replace(/\/$/, '')}/run`, {
      method: 'POST',
      headers: buildExecutorHeaders(endpoint),
      body: JSON.stringify({
        protocol_version: 1,
        action,
        timeout_sec: timeoutSec,
        scope_visa: endpoint.visaResource,
        liveMode: endpoint.liveMode === true,
        ...payload,
      }),
    });
    const json = (await res.json()) as Record<string, unknown>;
    // The executor HTTP server flattens result_data into the top-level response body
    // for capture_screenshot and send_scpi actions. Check both json.result_data
    // AND the top-level json for payload fields like base64, responses, etc.
    const resultData = json.result_data ??
      (typeof json.base64 === 'string' ? json : undefined) ??
      (Array.isArray(json.responses) ? json : undefined);
    return {
      ok: json.ok === true,
      stdout: typeof json.stdout === 'string' ? json.stdout : '',
      stderr: typeof json.stderr === 'string' ? json.stderr : '',
      error: typeof json.error === 'string' ? json.error : undefined,
      combinedOutput: typeof json.combined_output === 'string' ? json.combined_output : '',
      transcript: Array.isArray(json.transcript)
        ? (json.transcript as Array<{ stream: string; line: string; timestamp?: number }>)
        : [],
      durationSec: typeof json.duration_sec === 'number' ? json.duration_sec : undefined,
      resultData,
    };
  } catch (err) {
    return {
      ok: false,
      stdout: '',
      stderr: '',
      error: err instanceof Error ? err.message : 'Executor unreachable',
      combinedOutput: '',
      transcript: [],
      resultData: undefined,
    };
  }
}

export async function getInstrumentStateProxy(endpoint: Endpoint): Promise<ToolResult<Record<string, unknown>>> {
  if (!isLiveModeEnabled(endpoint)) {
    return { ok: false, data: {}, sourceMeta: [], warnings: ['live instrument mode is disabled'] };
  }
  // Use send_scpi action instead of runPython to avoid opening a second VISA session
  // that conflicts with the worker's cached session (causes TekScopePC crashes)
  const run = await runExecutorAction(endpoint, 'send_scpi', {
    commands: ['*IDN?', '*ESR?', 'ALLEV?'],
    timeout_ms: 10000,
  }, 45);
  if (!run.ok) {
    return { ok: false, data: {}, sourceMeta: [], warnings: ['code_executor not reachable'] };
  }
  const payload = run.resultData && typeof run.resultData === 'object'
    ? run.resultData as Record<string, unknown>
    : null;
  const responses = Array.isArray(payload?.responses) ? payload.responses as Array<Record<string, unknown>> : [];
  const idnResp = responses.find((r) => String(r.command || '').includes('IDN'));
  const esrResp = responses.find((r) => String(r.command || '').includes('ESR'));
  const allevResp = responses.find((r) => String(r.command || '').includes('ALLEV'));
  const statusText = [
    idnResp ? `IDN: ${idnResp.response}` : '',
    esrResp ? `ESR: ${esrResp.response}` : '',
    allevResp ? `ALLEV: ${allevResp.response}` : '',
  ].filter(Boolean).join('\n');
  return {
    ok: true,
    data: {
      idn: idnResp?.response,
      esr: esrResp?.response,
      allev: allevResp?.response,
      responses,
      decodedStatus: decodeStatusFromText(statusText),
      ...buildRuntimeDetails(run, resolveOutputMode(endpoint)),
    },
    sourceMeta: [],
    warnings: [],
  };
}

export async function probeCommandProxy(
  endpoint: Endpoint,
  command: string
): Promise<ToolResult<Record<string, unknown>>> {
  if (!isLiveModeEnabled(endpoint)) {
    return { ok: false, data: {}, sourceMeta: [], warnings: ['live instrument mode is disabled'] };
  }
  const run = await runExecutorAction(endpoint, 'send_scpi', { commands: [command], timeout_ms: 5000 }, 45);
  if (!run.ok) {
    return { ok: false, data: {}, sourceMeta: [], warnings: ['code_executor not reachable'] };
  }
  const mode = resolveOutputMode(endpoint);
  const directPayload =
    run.resultData && typeof run.resultData === 'object'
      ? (run.resultData as { responses?: Array<{ response?: string }> })
      : null;
  const response = directPayload?.responses?.[0]?.response;
  return {
    ok: true,
    data: {
      response: typeof response === 'string' ? response : run.stdout.trim(),
      stderr: run.stderr.trim(),
      error: run.error,
      decodedStatus: decodeCommandStatus(command, typeof response === 'string' ? response : run.stdout.trim()),
      ...buildRuntimeDetails(run, mode),
    },
    sourceMeta: [],
    warnings: [],
  };
}

export async function getVisaResourcesProxy(endpoint: Endpoint): Promise<ToolResult<Record<string, unknown>>> {
  if (!isLiveModeEnabled(endpoint)) {
    return { ok: false, data: {}, sourceMeta: [], warnings: ['live instrument mode is disabled'] };
  }
  const code = `import pyvisa
rm = pyvisa.ResourceManager()
print(list(rm.list_resources()))
`;
  const run = await runPython(endpoint, code, 45);
  if (!run.ok) {
    return { ok: false, data: {}, sourceMeta: [], warnings: ['code_executor not reachable'] };
  }
  return {
    ok: true,
    data: {
      resources: run.stdout.trim(),
      stderr: run.stderr.trim(),
      error: run.error,
      ...buildRuntimeDetails(run, resolveOutputMode(endpoint)),
    },
    sourceMeta: [],
    warnings: [],
  };
}

export async function getEnvironmentProxy(endpoint: Endpoint): Promise<ToolResult<Record<string, unknown>>> {
  if (!isLiveModeEnabled(endpoint)) {
    return { ok: false, data: {}, sourceMeta: [], warnings: ['live instrument mode is disabled'] };
  }
  const code = `import pyvisa, tm_devices, sys
print("pyvisa:", pyvisa.__version__)
print("tm_devices:", tm_devices.__version__)
print("python:", sys.version)
`;
  const run = await runPython(endpoint, code, 45);
  if (!run.ok) {
    return { ok: false, data: {}, sourceMeta: [], warnings: ['code_executor not reachable'] };
  }
  return {
    ok: true,
    data: {
      environment: run.stdout.trim(),
      stderr: run.stderr.trim(),
      error: run.error,
      ...buildRuntimeDetails(run, resolveOutputMode(endpoint)),
    },
    sourceMeta: [],
    warnings: [],
  };
}

export async function sendScpiProxy(
  endpoint: Endpoint,
  commands: string[],
  timeoutMs = 5000
): Promise<ToolResult<Record<string, unknown>>> {
  if (!isLiveModeEnabled(endpoint)) {
    return { ok: false, data: {}, sourceMeta: [], warnings: ['live instrument mode is disabled'] };
  }
  const run = await runExecutorAction(endpoint, 'send_scpi', { commands, timeout_ms: timeoutMs }, Math.max(45, Math.ceil((timeoutMs * Math.max(commands.length, 1)) / 1000) + 5));
  if (!run.ok) {
    // Include per-command responses so AI can see which specific commands failed
    const failPayload = run.resultData && typeof run.resultData === 'object'
      ? run.resultData as Record<string, unknown>
      : {};
    return {
      ok: false,
      data: {
        commandsSent: commands,
        ...failPayload,
        stdout: run.stdout.trim(),
        stderr: run.stderr.trim(),
        error: run.error || 'Executor returned ok=false',
        combinedOutput: run.combinedOutput,
      },
      sourceMeta: [],
      warnings: ['send_scpi failed — check responses array for per-command errors'],
    };
  }
  const directPayload =
    ((run as unknown as Record<string, unknown>).base64 && typeof (run as unknown as Record<string, unknown>).base64 === 'string'
      ? (run as unknown as Record<string, unknown>)
      : null) ??
    (run.resultData && typeof run.resultData === 'object'
      ? (run.resultData as Record<string, unknown>)
      : null);
  // Check for errors buried in the result even when ok=true
  const hasError = Boolean(run.error) || Boolean(run.stderr.trim());
  const warnings: string[] = [];
  if (hasError) warnings.push('Executor returned warnings/errors — check stderr and error fields');
  return {
    ok: !run.error,
    data: {
      commandsSent: commands,
      ...(directPayload || {}),
      stdout: run.stdout.trim(),
      stderr: run.stderr.trim(),
      error: run.error,
      ...buildRuntimeDetails(run, resolveOutputMode(endpoint)),
    },
    sourceMeta: [],
    warnings,
  };
}

export async function captureScreenshotProxy(endpoint: Endpoint): Promise<ToolResult<Record<string, unknown>>> {
  if (!isLiveModeEnabled(endpoint)) {
    return { ok: false, data: {}, sourceMeta: [], warnings: ['live instrument mode is disabled'] };
  }
  const scopeType = inferScopeType(endpoint);
  const run = await runExecutorAction(endpoint, 'capture_screenshot', { scope_type: scopeType }, 90);
  if (!run.ok) {
    return { ok: false, data: {}, sourceMeta: [], warnings: ['code_executor not reachable'] };
  }
  const directPayload =
    ((run as unknown as Record<string, unknown>).base64 && typeof (run as unknown as Record<string, unknown>).base64 === 'string'
      ? (run as unknown as Record<string, unknown>)
      : null) ??
    (run.resultData && typeof run.resultData === 'object'
      ? (run.resultData as Record<string, unknown>)
      : null);
  const marker = !directPayload
    ? run.stdout
        .split(/\r?\n/)
        .find((line) => line.startsWith('__TEKA_CAPTURE__'))
    : null;
  if (!directPayload && !marker) {
    return {
      ok: false,
      data: {
        stderr: run.stderr.trim(),
        error: run.error,
        ...buildRuntimeDetails(run, resolveOutputMode(endpoint)),
      },
      sourceMeta: [],
      warnings: ['capture_screenshot returned no image payload'],
    };
  }
  try {
    const parsed = (directPayload ??
      JSON.parse(marker!.replace('__TEKA_CAPTURE__', '').trim())) as Record<string, unknown>;
    // Keep base64 and mimeType at top level of data for extractImageFromToolResult.
    // Omit dataUrl to avoid duplicating the (potentially large) base64 blob.
    // Use lean runtime details (omit verbose stdout/stderr/transcript) since the
    // image itself is the primary content and verbose details just bloat the payload.
    const mode = resolveOutputMode(endpoint);
    const leanRuntime: Record<string, unknown> = {
      outputMode: mode,
      durationSec: run.durationSec,
    };
    if (run.error) leanRuntime.error = run.error;
    return {
      ok: true,
      data: {
        ...parsed,
        ...leanRuntime,
      },
      sourceMeta: [],
      warnings: [],
    };
  } catch {
    return {
      ok: false,
      data: {
        stderr: run.stderr.trim(),
        error: run.error,
        ...buildRuntimeDetails(run, resolveOutputMode(endpoint)),
      },
      sourceMeta: [],
      warnings: ['capture_screenshot returned invalid JSON payload'],
    };
  }
}

// ── Waveform fetch ────────────────────────────────────────────────────────────

export interface WaveformParams {
  channel:    string;
  format:     'stats' | 'csv' | 'both';
  downsample: number;
  width:      1 | 2;
  start:      number;
  stop:       number;
  timeoutMs:  number;
  saveLocal?: boolean; // save full-res CSV to disk; strip csv from MCP response (AI uses Read tool on localPath)
  scopeId?:   string;  // folder name under waveforms/ — derived from VISA resource (e.g. "192.168.1.138")
}

// Auto-stop default when the caller doesn't specify stop. ASCII CURVe? over
// VXI-11 handles ~10K points well inside the default 30s timeout; full records
// (500K–1M points) reliably time out, so we cap here. Callers who actually
// need the full record can pass an explicit stop value.
const AUTO_STOP_DEFAULT = 10_000;

export function buildWaveformCommands(params: WaveformParams): string[] {
  // stop=0 means "auto" — cap at AUTO_STOP_DEFAULT so ASCII transfer fits the
  // timeout. The scope silently clamps DATa:STOP to the actual record length,
  // and DATa:STOP? verifies what was accepted.
  const autoStop = params.stop === 0;
  const stopVal  = autoStop ? AUTO_STOP_DEFAULT : params.stop;
  return [
    `DATa:SOUrce ${params.channel}`,
    'DATa:ENCdg ASCii',
    `DATa:WIDth ${params.width}`,
    `DATa:STARt ${params.start}`,
    `DATa:STOP ${stopVal}`,
    'DATa:STOP?',   // verify setting was accepted
    '*OPC?',        // synchronisation barrier — scope processes all writes before responding
    // Query individual preamble fields for reliable parsing (WFMOutpre? format varies by firmware)
    'WFMOutpre:YMUlt?',
    'WFMOutpre:YOFf?',
    'WFMOutpre:YZEro?',
    'WFMOutpre:XINcr?',
    'WFMOutpre:XZEro?',
    'WFMOutpre:NR_Pt?',
    'CURVe?',
  ];
}

function parsePreamble(raw: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of raw.split(';')) {
    const m = part.trim().match(/^(\w+)\s+(.+)$/);
    if (!m) continue;
    const v = parseFloat(m[2]);
    if (!isNaN(v)) out[m[1].toUpperCase()] = v;
  }
  return out;
}

/** Largest-Triangle-Three-Buckets downsampling (shape-preserving). */
function lttb(data: number[], threshold: number): number[] {
  const n = data.length;
  if (n <= threshold) return data;
  const out: number[] = [data[0]];
  const bSize = (n - 2) / (threshold - 2);
  let a = 0;
  for (let i = 0; i < threshold - 2; i++) {
    const avgFrom = Math.floor((i + 1) * bSize) + 1;
    const avgTo   = Math.min(Math.floor((i + 2) * bSize) + 1, n);
    let avgY = 0;
    for (let j = avgFrom; j < avgTo; j++) avgY += data[j];
    avgY /= (avgTo - avgFrom);
    const rFrom = Math.floor(i * bSize) + 1;
    const rTo   = Math.min(Math.floor((i + 1) * bSize) + 1, n);
    const aY    = out[out.length - 1];
    let maxArea = -1, nextA = rFrom;
    for (let j = rFrom; j < rTo; j++) {
      const area = Math.abs((a - avgFrom) * (data[j] - aY) - (a - j) * (avgY - aY)) * 0.5;
      if (area > maxArea) { maxArea = area; nextA = j; }
    }
    out.push(data[nextA]);
    a = nextA;
  }
  out.push(data[n - 1]);
  return out;
}

export function processWaveformScpiResponses(
  responses: Array<{ command: string; response: string }>,
  params: WaveformParams,
  baseUrl?: string,
): ToolResult<unknown> {
  const get = (pattern: RegExp) => responses.find(r => pattern.test(r.command))?.response ?? '';
  const curveRaw     = get(/^CURV/i);
  const dataStopResp = get(/^DATa:STOP\?/i);
  const verifiedStop = dataStopResp ? parseInt(dataStopResp, 10) : null;

  if (!curveRaw) {
    return {
      ok: false,
      data: {
        error: 'NO_CURVE_DATA',
        message: 'CURVe? returned no data.',
        diagnostics: {
          verifiedStop,
          responses: responses.map(r => ({ cmd: r.command, resp: r.response?.slice(0, 80) })),
        },
      },
      sourceMeta: [], warnings: ['No curve data'],
    };
  }

  // Use individual preamble field queries for reliable parsing — WFMOutpre? format
  // varies across firmware versions and may include quoted strings that break simple parsing.
  const parseF = (pattern: RegExp, fallback: number) => {
    const v = parseFloat(get(pattern));
    return isNaN(v) ? fallback : v;
  };
  const ymult = parseF(/WFMOutpre:YMUlt/i,  1);
  const yoff  = parseF(/WFMOutpre:YOFf/i,   0);
  const yzero = parseF(/WFMOutpre:YZEro/i,  0);
  const xincr = parseF(/WFMOutpre:XINcr/i,  1e-9);
  const xzero = parseF(/WFMOutpre:XZEro/i,  0);

  // Strip IEEE binary header if present: #<n><bytes><data>
  let raw = curveRaw.trim();
  if (raw.startsWith('#')) raw = raw.slice(2 + parseInt(raw[1], 10));

  const samples = raw.split(',').map(Number).filter(v => !isNaN(v));
  if (!samples.length) {
    return { ok: false, data: { error: 'PARSE_FAILED', message: 'Could not parse CURVe? as ASCII integers.' }, sourceMeta: [], warnings: ['CURVe? parse failed'] };
  }

  // Convert ADC counts → volts
  const volts = samples.map(s => (s - yoff) * ymult + yzero);

  let min = Infinity, max = -Infinity, sum = 0;
  for (const v of volts) { if (v < min) min = v; if (v > max) max = v; sum += v; }
  const mean = sum / volts.length;
  let variance = 0;
  for (const v of volts) variance += (v - mean) ** 2;
  const std = Math.sqrt(variance / volts.length);

  // Clipping detection was removed: the ADC-rail heuristic (sample == ±full-scale)
  // gave false positives on signals riding near a vertical rail even when the
  // analog front-end was not saturating, and false negatives on soft clipping.
  // The resulting CLIPPING flag misled the agent more often than it helped.
  // Inspect min/max/vpp against the set vertical scale for a manual check.
  const stats: Record<string, unknown> = {
    channel:       params.channel,
    nPoints:       volts.length,
    min:           +min.toFixed(6),
    max:           +max.toFixed(6),
    mean:          +mean.toFixed(6),
    std:           +std.toFixed(6),
    vpp:           +(max - min).toFixed(6),
    xincr,
    xzero,
    ...(verifiedStop !== null ? { verifiedDATaSTOP: verifiedStop } : {}),
  };

  // ── saveLocal: write full-res CSV to disk BEFORE any early returns ──────────
  // Must run before the `format === 'stats'` guard — when saveLocal is true the
  // caller wants the file regardless of the format they requested for the response.
  if (params.saveLocal) {
    const fullCsvLines = volts.map((v, i) => `${(xzero + i * xincr).toExponential(4)},${v.toFixed(6)}`);
    const fullCsv = `time_s,voltage_v\n${fullCsvLines.join('\n')}`;

    const scopeFolder = (params.scopeId || 'scope').replace(/[^a-zA-Z0-9._\-]/g, '_');
    const waveDir     = path.join(_projectRoot, 'waveforms', scopeFolder);
    const fileName    = `waveform_${params.channel}_${Date.now()}.csv`;
    const filePath    = path.join(waveDir, fileName);

    let localPath: string | null = null;
    let saveError: string | null = null;
    try {
      fs.mkdirSync(waveDir, { recursive: true });
      fs.writeFileSync(filePath, fullCsv, 'utf8');
      localPath = filePath;
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e);
    }

    // baseUrl is set by fetchWaveform ONLY when the caller passed
    // allowLargeDownload:true. Absent baseUrl → suppress downloadUrl. This is
    // the opt-in handshake: default saveLocal returns localPath only; remote
    // HTTP clients must explicitly acknowledge they can handle a multi-MB
    // download (code-execution sandbox, curl-to-disk, etc.) before the URL
    // is emitted.
    let downloadUrl: string | undefined;
    if (localPath && baseUrl) {
      const cleanBase = baseUrl.replace(/\/+$/, '');
      downloadUrl = `${cleanBase}/waveforms/${encodeURIComponent(scopeFolder)}/${encodeURIComponent(fileName)}`;
    }

    // File size (post-write) so agents can decide how to handle the bytes.
    let sizeBytes: number | undefined;
    if (localPath) {
      try { sizeBytes = fs.statSync(localPath).size; } catch { /* ignore */ }
    }

    const HINT_WITH_URL =
      '⚠ Full-resolution CSV. Can be 10s–100s of MB. Do NOT fetch downloadUrl directly into chat context — ' +
      'pipe through code-execution (curl → disk → numpy/pandas) or a file-read tool. ' +
      'If your client shares a filesystem with the server (stdio MCP on the same machine), open localPath with the Read tool instead.';

    const HINT_NO_URL =
      'Full-resolution CSV saved. localPath is usable only if your client shares a filesystem with the server (stdio MCP on same machine).' +
      ' For remote HTTP MCP clients with code-execution/curl, re-call with allowLargeDownload:true to receive a downloadUrl.' +
      ' For shape-only analysis (charts, trend checks), drop saveLocal and pass format:"csv" to get an LTTB-downsampled CSV inline (~1K points, safe for context).';

    const result: Record<string, unknown> = {
      ...stats,
      totalPoints: volts.length,
      ...(localPath
        ? {
            localPath,
            ...(sizeBytes !== undefined ? { sizeBytes } : {}),
            ...(downloadUrl ? { downloadUrl } : {}),
            _hint: downloadUrl ? HINT_WITH_URL : HINT_NO_URL,
          }
        : { saveLocalError: saveError || 'Unknown write error', savePath: filePath }),
    };
    return {
      ok: true,
      data: result,
      sourceMeta: [],
      warnings: saveError ? [`saveLocal write failed: ${saveError}`] : [],
    };
  }

  if (params.format === 'stats') {
    return { ok: true, data: stats, sourceMeta: [], warnings: [] };
  }

  // Inline path: LTTB-downsample for response
  const ds = lttb(volts, params.downsample);
  const ratio = volts.length / ds.length;
  const csvLines = ds.map((v, i) => `${(xzero + i * xincr * ratio).toExponential(4)},${v.toFixed(6)}`);
  const result: Record<string, unknown> = { ...stats, downsampledPoints: ds.length, csv: `time_s,voltage_v\n${csvLines.join('\n')}` };

  return { ok: true, data: result, sourceMeta: [], warnings: [] };
}

export async function fetchWaveformProxy(
  endpoint: Endpoint,
  params: WaveformParams,
  baseUrl?: string,
): Promise<ToolResult<unknown>> {
  const commands = buildWaveformCommands(params);
  const scpiResult = await sendScpiProxy(endpoint, commands, params.timeoutMs);
  if (!scpiResult.ok) return scpiResult;

  const responses = Array.isArray((scpiResult.data as Record<string, unknown>)?.responses)
    ? (scpiResult.data as Record<string, unknown>).responses as Array<{ command: string; response: string }>
    : [];

  return processWaveformScpiResponses(responses, params, baseUrl);
}
