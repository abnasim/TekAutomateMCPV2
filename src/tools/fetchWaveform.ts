/**
 * fetch_waveform — Waveform data offload tool.
 *
 * Fetches CURVe? binary from the live scope, scales it with numpy on the
 * executor, and returns a lean JSON payload to Claude.  Binary data NEVER
 * enters Claude's context — only processed stats and/or a downsampled CSV.
 *
 * Token savings vs raw ASCII CURVe?:
 *   1M-point record  →  ~2,500,000 tokens raw  vs  ~200 (stats) / ~6,250 (CSV)
 *   384× reduction, 99.7% token savings
 */

import { buildWaveformCode, fetchWaveformProxy, type WaveformParams } from '../core/instrumentProxy';
import type { ToolResult } from '../core/schemas';
import { dispatchLiveActionThroughTekAutomate, shouldBridgeToTekAutomate, withRuntimeInstrumentDefaults } from './liveToolSupport';

const VALID_FORMATS = new Set(['stats', 'csv', 'both']);
const VALID_CHANNELS = /^(CH[1-4]|MATH[1-4]|REF[1-8]|D[0-9]|D1[0-5])$/i;

export interface FetchWaveformInput extends Record<string, unknown> {
  channel?:    string;
  format?:     'stats' | 'csv' | 'both';
  downsample?: number;
  width?:      1 | 2;
  start?:      number;
  stop?:       number;
  timeoutMs?:  number;
  executorUrl?: string;
  visaResource?: string;
  backend?: string;
  liveMode?: boolean;
}

export async function fetchWaveform(input: FetchWaveformInput): Promise<ToolResult<unknown>> {
  const merged = withRuntimeInstrumentDefaults(input);

  if (!merged.executorUrl) {
    return {
      ok: false,
      data: { error: 'NO_INSTRUMENT', message: 'No instrument connected. Connect to a scope first.' },
      sourceMeta: [],
      warnings: ['No executorUrl — instrument not connected.'],
    };
  }
  if (!merged.liveMode) {
    return {
      ok: false,
      data: { error: 'NOT_LIVE', message: 'liveMode must be true to fetch waveforms.' },
      sourceMeta: [],
      warnings: ['liveMode is not enabled.'],
    };
  }

  const channel = String(input.channel ?? 'CH1').toUpperCase();
  if (!VALID_CHANNELS.test(channel)) {
    return {
      ok: false,
      data: { error: 'INVALID_CHANNEL', message: `Unknown channel: ${channel}. Use CH1-CH4, MATH1-MATH4, REF1-REF8.` },
      sourceMeta: [],
      warnings: [`Invalid channel: ${channel}`],
    };
  }

  const fmt = String(input.format ?? 'stats');
  const format = VALID_FORMATS.has(fmt) ? (fmt as WaveformParams['format']) : 'stats';

  const rawWidth = Number(input.width ?? 2);
  const width: 1 | 2 = rawWidth === 1 ? 1 : 2;

  const downsample = Math.min(Math.max(Number(input.downsample ?? 1000), 10), 50000);
  const start      = Math.max(1, Math.floor(Number(input.start ?? 1)));

  // Smart default stop:
  //   stats only  → 10 000 pts (fast, plenty for accurate stats + clipping detection)
  //   csv / both  → 0 = full record (need shape fidelity before LTTB downsampling)
  // User can always override by passing stop explicitly.
  const stopDefault = (input.stop !== undefined && input.stop !== null)
    ? Math.max(0, Math.floor(Number(input.stop)))
    : (format === 'stats' ? 10000 : 0);
  const stop      = stopDefault;
  const timeoutMs  = Math.min(Math.max(Number(input.timeoutMs ?? 30000), 5000), 120000);

  const params: WaveformParams = { channel, format, downsample, width, start, stop, timeoutMs };

  // ── Hosted mode: route through TekAutomate browser bridge ──
  // In hosted/Railway mode the executor (192.168.x.x) is unreachable from the
  // server. The bridge dispatcher passes toolName straight to the executor
  // action — 'run_python' is already handled natively, so no frontend changes
  // are needed.
  if (shouldBridgeToTekAutomate(input)) {
    const code = buildWaveformCode(merged.visaResource || '', params);
    const timeoutBridge = timeoutMs + 20_000;
    const bridged = await dispatchLiveActionThroughTekAutomate(
      'run_python',
      { code, scope_visa: merged.visaResource || '', timeout_sec: Math.ceil(timeoutMs / 1000) + 15 },
      timeoutBridge,
    );

    if (!bridged.ok) {
      return {
        ok: false,
        data: { error: 'BRIDGE_FAILED', message: bridged.error || 'TekAutomate bridge failed to run waveform fetch.' },
        sourceMeta: [],
        warnings: [bridged.error || 'Bridge error'],
      };
    }

    // Executor returns { ok, stdout, stderr, result_data, ... }
    // Our Python code prints JSON to stdout — find and parse it.
    const payload = bridged.result && typeof bridged.result === 'object'
      ? bridged.result as Record<string, unknown>
      : {};
    const stdout = typeof payload.stdout === 'string' ? payload.stdout : '';
    const jsonLine = stdout.split(/\r?\n/).map(l => l.trim()).find(l => l.startsWith('{') && l.endsWith('}'));
    if (!jsonLine) {
      return {
        ok: false,
        data: { error: 'NO_WAVEFORM_OUTPUT', message: payload.error || payload.stderr || 'No waveform JSON in executor output', stdout: stdout.slice(0, 500) },
        sourceMeta: [],
        warnings: ['Waveform fetch produced no output via bridge'],
      };
    }
    try {
      const parsed = JSON.parse(jsonLine) as Record<string, unknown>;
      return {
        ok:         parsed.ok === true,
        data:       parsed,
        sourceMeta: [],
        warnings:   parsed.ok ? [] : [String(parsed.error || 'Waveform fetch error')],
      };
    } catch {
      return {
        ok: false,
        data: { error: 'PARSE_ERROR', raw: jsonLine.slice(0, 500) },
        sourceMeta: [],
        warnings: ['Could not parse waveform JSON from bridge'],
      };
    }
  }

  // ── Direct mode: executor is reachable (local mcp-server) ──
  return fetchWaveformProxy(merged as any, params);
}
