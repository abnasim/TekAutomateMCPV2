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

// ── Waveform fetch ─────────────────────────────────────────────────────────

export interface WaveformParams {
  channel: string;         // CH1, CH2, CH3, CH4, MATH1, REF1 etc.
  format: 'stats' | 'csv' | 'both';
  downsample: number;      // LTTB target points
  width: 1 | 2;            // 1=int8 (8-bit), 2=int16 (12-bit full ADC precision)
  start: number;           // DATa:STARt record point
  stop: number;            // DATa:STOP (0 = full record)
  timeoutMs: number;
}

/** Build the ordered SCPI command list for a waveform fetch (ASCII encoding). */
export function buildWaveformCommands(p: WaveformParams): string[] {
  const stopCmd = p.stop === 0 ? 'DATa:STOP 10000' : `DATa:STOP ${p.stop}`;
  return [
    `DATa:SOUrce ${p.channel}`,
    'DATa:ENCdg ASCIi',
    `DATa:WIDth ${p.width}`,
    `DATa:STARt ${p.start}`,
    stopCmd,
    'WFMOutpre:NR_Pt?',
    'WFMOutpre:YMUlt?',
    'WFMOutpre:YOFf?',
    'WFMOutpre:YZEro?',
    'WFMOutpre:XINcr?',
    'WFMOutpre:PT_Off?',
    'WFMOutpre:XUNit?',
    'WFMOutpre:YUNit?',
    'CURVe?',
  ];
}

/** LTTB downsampling — pure TypeScript, no numpy needed. */
function lttb(t: Float64Array, v: Float64Array, nOut: number): [Float64Array, Float64Array] {
  const n = t.length;
  if (nOut >= n || nOut < 3) return [t, v];
  const idxs: number[] = [0];
  const bkt = (n - 2) / (nOut - 2);
  let a = 0;
  for (let i = 1; i < nOut - 1; i++) {
    const avgS = Math.floor((i + 1) * bkt) + 1;
    const avgE = Math.min(Math.floor((i + 2) * bkt) + 1, n);
    let sumT = 0, sumV = 0;
    for (let j = avgS; j < avgE; j++) { sumT += t[j]; sumV += v[j]; }
    const cnt  = avgE - avgS || 1;
    const at   = sumT / cnt;
    const av   = sumV / cnt;
    const rs   = Math.floor(i * bkt) + 1;
    const re   = Math.min(Math.floor((i + 1) * bkt) + 1, n);
    let maxArea = -1, best = rs;
    const ta = t[a], va = v[a];
    for (let j = rs; j < re; j++) {
      const area = Math.abs((ta - at) * (v[j] - va) - (ta - t[j]) * (av - va)) * 0.5;
      if (area > maxArea) { maxArea = area; best = j; }
    }
    idxs.push(best);
    a = best;
  }
  idxs.push(n - 1);
  const tOut = new Float64Array(idxs.length);
  const vOut = new Float64Array(idxs.length);
  for (let i = 0; i < idxs.length; i++) { tOut[i] = t[idxs[i]]; vOut[i] = v[idxs[i]]; }
  return [tOut, vOut];
}

/**
 * Process CURVe? ASCII response + preamble queries into a waveform result.
 * Called by fetchWaveformProxy (direct) and fetchWaveform bridge path.
 */
export function processWaveformScpiResponses(
  responses: Array<{ command: string; response: string }>,
  p: WaveformParams,
): ToolResult<unknown> {
  const get = (key: string): string => {
    const r = responses.find(r => r.command.toUpperCase().includes(key.toUpperCase()));
    return r?.response?.trim() ?? '';
  };

  const yMult = parseFloat(get('YMUlt')) || 0;
  const yOff  = parseFloat(get('YOFf'))  || 0;
  const yZero = parseFloat(get('YZEro')) || 0;
  const xIncr = parseFloat(get('XINcr')) || 0;
  const ptOff = parseFloat(get('PT_Off')) || 0;
  const xUnit = get('XUNit').replace(/"/g, '') || 's';
  const yUnit = get('YUNit').replace(/"/g, '') || 'V';

  if (!yMult || !xIncr) {
    return {
      ok: false,
      data: { error: 'BAD_PREAMBLE', message: 'WFMOutpre queries returned unusable values', responses: responses.slice(0, 10) },
      sourceMeta: [],
      warnings: ['Preamble parse failed — check channel source and scope state'],
    };
  }

  // Parse CURVe? ASCII: "12,34,-56,78,..." (comma or space separated)
  // Strip raw response immediately — it must never appear in any output or error path.
  const curveR = responses.find(r => /CURVe/i.test(r.command));
  const rawStr = curveR?.response?.trim() ?? '';
  if (curveR) curveR.response = '';
  if (!rawStr) {
    return {
      ok: false,
      data: { error: 'NO_CURVE_DATA', message: 'CURVe? returned empty response' },
      sourceMeta: [],
      warnings: ['CURVe? response was empty — scope may not be acquiring'],
    };
  }

  const rawNums = rawStr.split(/[,\s]+/).filter(Boolean);
  const n = rawNums.length;
  const maxRail = p.width === 2 ? 32767 : 127;
  const minRail = p.width === 2 ? -32768 : -128;

  const voltage = new Float64Array(n);
  const tAxis   = new Float64Array(n);
  let minV = Infinity, maxV = -Infinity, sumV = 0, sumV2 = 0;
  let clipHigh = 0, clipLow = 0;

  for (let i = 0; i < n; i++) {
    const raw = parseInt(rawNums[i], 10);
    const v   = (raw - yOff) * yMult + yZero;
    voltage[i] = v;
    tAxis[i]   = (i - ptOff) * xIncr;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
    sumV  += v;
    sumV2 += v * v;
    if (raw >= maxRail) clipHigh++;
    if (raw <= minRail) clipLow++;
  }

  const r9 = (x: number) => Math.round(x * 1e9) / 1e9;
  const meanV = sumV / n;
  const stdV  = Math.sqrt(Math.max(0, sumV2 / n - meanV * meanV));
  const clipping = clipHigh > 0 || clipLow > 0;

  const stats = {
    n_points_captured: n,
    min_v:   r9(minV),
    max_v:   r9(maxV),
    mean_v:  r9(meanV),
    std_v:   r9(stdV),
    pk_pk_v: r9(maxV - minV),
    t_start: tAxis[0],
    t_end:   tAxis[n - 1],
    x_incr:  xIncr,
    x_unit:  xUnit,
    y_unit:  yUnit,
    clipping,
    clip_high_count: clipHigh,
    clip_low_count:  clipLow,
  };

  const clipWarning = clipping
    ? `⚠️ CLIPPING DETECTED on ${p.channel}! ${clipHigh + clipLow} of ${n} samples hit the ADC rail. Reduce vertical scale or channel offset immediately — measurements are invalid while clipping.`
    : undefined;

  const result: Record<string, unknown> = {
    ok:               true,
    channel:          p.channel,
    stats,
    n_points_returned: 0,
    ...(clipWarning ? { CLIPPING: clipWarning } : {}),
  };

  if (p.format === 'csv' || p.format === 'both') {
    const [tDs, vDs] = lttb(tAxis, voltage, p.downsample);
    result.n_points_returned = tDs.length;
    const lines = [`${xUnit},${yUnit}`];
    for (let i = 0; i < tDs.length; i++) {
      lines.push(`${tDs[i].toExponential(9)},${vDs[i].toPrecision(6)}`);
    }
    result.csv = lines.join('\n');
  }

  return {
    ok:         true,
    data:       result,
    sourceMeta: [],
    warnings:   clipping ? [clipWarning!] : [],
  };
}

/** @deprecated — kept so TypeScript doesn't error on old callers; remove after next sync */
export function buildWaveformCode(visa: string, p: WaveformParams): string {
  // JSON.stringify produces a properly-escaped Python string literal for the VISA address.
  const visaLit = JSON.stringify(visa);
  const dtype = p.width === 2 ? 'h' : 'b';   // signed int16 or int8

  return `
import json, sys

try:
    import pyvisa
    import numpy as np

    def lttb(t, v, n_out):
        n = len(t)
        if n_out >= n or n_out < 3:
            return t, v
        idx = [0]
        bkt = (n - 2) / (n_out - 2)
        a = 0
        for i in range(1, n_out - 1):
            avg_s = int((i + 1) * bkt) + 1
            avg_e = min(int((i + 2) * bkt) + 1, n)
            at = float(np.mean(t[avg_s:avg_e]))
            av = float(np.mean(v[avg_s:avg_e]))
            rs = int(i * bkt) + 1
            re = int((i + 1) * bkt) + 1
            ta, va = float(t[a]), float(v[a])
            areas = np.abs((ta - at) * (v[rs:re] - va) - (ta - t[rs:re]) * (av - va)) * 0.5
            m = rs + int(np.argmax(areas))
            idx.append(m)
            a = m
        idx.append(n - 1)
        return t[np.array(idx)], v[np.array(idx)]

    rm = pyvisa.ResourceManager()
    scope = rm.open_resource(${visaLit})
    scope.timeout = ${p.timeoutMs}
    scope.write_termination = "\\n"
    scope.read_termination = "\\n"
    try:
        scope.write("DATa:SOUrce ${p.channel}")
        scope.write("DATa:ENCdg SRIBinary")
        scope.write("DATa:WIDth ${p.width}")
        nr_pt = int(scope.query("WFMOutpre:NR_Pt?").strip())
        actual_stop = nr_pt if ${p.stop} == 0 else min(${p.stop}, nr_pt)
        scope.write("DATa:STARt ${p.start}")
        scope.write("DATa:STOP " + str(actual_stop))
        y_mult = float(scope.query("WFMOutpre:YMUlt?").strip())
        y_off  = float(scope.query("WFMOutpre:YOFf?").strip())
        y_zero = float(scope.query("WFMOutpre:YZEro?").strip())
        x_incr = float(scope.query("WFMOutpre:XINcr?").strip())
        pt_off = float(scope.query("WFMOutpre:PT_Off?").strip())
        x_unit = scope.query("WFMOutpre:XUNit?").strip().strip('"')
        y_unit = scope.query("WFMOutpre:YUNit?").strip().strip('"')
        raw = scope.query_binary_values("CURVe?", datatype="${dtype}", container=np.ndarray, is_big_endian=True)
        n_pts = int(len(raw))
        voltage = (raw.astype(np.float32) - y_off) * y_mult + y_zero
        t_axis  = (np.arange(n_pts, dtype=np.float32) - pt_off) * x_incr
        stats = {
            "n_points_captured": n_pts,
            "min_v":   round(float(np.min(voltage)),  9),
            "max_v":   round(float(np.max(voltage)),  9),
            "mean_v":  round(float(np.mean(voltage)), 9),
            "std_v":   round(float(np.std(voltage)),  9),
            "pk_pk_v": round(float(np.max(voltage) - np.min(voltage)), 9),
            "t_start": round(float(t_axis[0]),  15),
            "t_end":   round(float(t_axis[-1]), 15),
            "x_incr":  float(x_incr),
            "x_unit":  x_unit,
            "y_unit":  y_unit,
        }
        max_rail = 32767 if ${p.width} == 2 else 127
        min_rail = -32768 if ${p.width} == 2 else -128
        clip_high = int(np.sum(raw >= max_rail))
        clip_low  = int(np.sum(raw <= min_rail))
        clipping  = clip_high > 0 or clip_low > 0
        stats["clipping"]        = clipping
        stats["clip_high_count"] = clip_high
        stats["clip_low_count"]  = clip_low
        clip_warning = ("⚠️ CLIPPING DETECTED on ${p.channel}! " +
            str(clip_high + clip_low) + " of " + str(n_pts) + " samples hit the ADC rail. " +
            "Reduce vertical scale or channel offset immediately — measurements are invalid while clipping.") if clipping else None
        result = {"ok": True, "channel": "${p.channel}", "stats": stats, "n_points_returned": 0,
                  **({"CLIPPING": clip_warning} if clipping else {})}
        if "${p.format}" in ("csv", "both"):
            t_ds, v_ds = lttb(t_axis, voltage, ${p.downsample})
            n_ds = int(len(t_ds))
            result["n_points_returned"] = n_ds
            lines = [x_unit + "," + y_unit]
            for ti, vi in zip(t_ds.tolist(), v_ds.tolist()):
                lines.append("%.9g,%.6g" % (ti, vi))
            result["csv"] = "\\n".join(lines)
        print(json.dumps(result))
    finally:
        try: scope.close()
        except: pass
        try: rm.close()
        except: pass
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e), "channel": "${p.channel}"}))
`.trim();
}

export async function fetchWaveformProxy(
  endpoint: Endpoint,
  params: WaveformParams,
): Promise<ToolResult<unknown>> {
  if (!isLiveModeEnabled(endpoint)) {
    return { ok: false, data: {}, sourceMeta: [], warnings: ['live instrument mode is disabled'] };
  }

  const commands = buildWaveformCommands(params);
  // Give generous timeout — CURVe? on large records can be slow
  const timeoutMs = params.timeoutMs;
  const run = await runExecutorAction(
    endpoint,
    'send_scpi',
    { commands, timeout_ms: timeoutMs },
    Math.max(60, Math.ceil(timeoutMs / 1000) + 15),
  );

  if (!run.ok) {
    return {
      ok: false,
      data: { error: 'SCPI_FAILED', message: run.error || 'Executor send_scpi failed', stderr: run.stderr.slice(0, 400) },
      sourceMeta: [],
      warnings: [run.error || 'Waveform SCPI fetch failed'],
    };
  }

  const resultData = run.resultData && typeof run.resultData === 'object'
    ? run.resultData as Record<string, unknown>
    : {};
  const responses = Array.isArray(resultData.responses)
    ? (resultData.responses as Array<{ command: string; response: string }>)
    : [];

  if (!responses.length) {
    return {
      ok: false,
      data: { error: 'NO_RESPONSES', message: 'Executor returned no SCPI responses', stdout: run.stdout.slice(0, 400) },
      sourceMeta: [],
      warnings: ['Waveform SCPI returned no responses'],
    };
  }

  return processWaveformScpiResponses(responses, params);
}
