/**
 * fetch_waveform — Waveform data offload tool.
 *
 * Uses send_scpi (ASCII encoding) to fetch CURVe? data, then processes it
 * entirely on the MCP server — no Python, no numpy, no binary decoding.
 *
 * Token savings: CURVe? data (up to 10K pts) is processed server-side;
 * only the lean JSON result (stats / downsampled CSV) is returned to Claude.
 *   stats only  → ~200 tokens   (min/max/mean/std/Vpp + clipping flag)
 *   csv 1K pts  → ~6,250 tokens (LTTB downsampled, shape-preserving)
 */

import { buildWaveformCommands, fetchWaveformProxy, processWaveformScpiResponses, type WaveformParams } from '../core/instrumentProxy';
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
  saveLocal?:  boolean;
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

  // stop=0 (or not provided) → auto: buildWaveformCommands will query HORizontal:MODE:RECOrdlength?
  // and set DATa:STOP to the full record length. User can pass an explicit stop to cap transfer.
  const stop = (input.stop !== undefined && input.stop !== null && Number(input.stop) > 0)
    ? Math.floor(Number(input.stop))
    : 0;
  const timeoutMs = Math.min(Math.max(Number(input.timeoutMs ?? 30000), 5000), 120000);

  const saveLocal = Boolean(input.saveLocal);

  // Derive a filesystem-safe scope identifier from the VISA resource string.
  // e.g. "TCPIP0::192.168.1.138::inst0::INSTR" → "192.168.1.138"
  //      "TCPIP::10.0.0.5::4000::SOCKET"       → "10.0.0.5"
  //      "USB0::0x0699::..."                    → "USB0_0x0699"
  const rawVisa = String(merged.visaResource || '');
  const scopeIdMatch = rawVisa.match(/TCPIP\d*::([^:]+)/i) || rawVisa.match(/^([^:]+)/);
  const scopeId = scopeIdMatch
    ? scopeIdMatch[1].replace(/[^a-zA-Z0-9._\-]/g, '_')
    : 'scope';

  const params: WaveformParams = { channel, format, downsample, width, start, stop, timeoutMs, saveLocal, scopeId };

  // ── Hosted mode: route through TekAutomate browser bridge via send_scpi ──
  // send_scpi IS supported by the bridge (in fC set). We build the full command
  // list, bridge it, then process the responses server-side.
  if (shouldBridgeToTekAutomate(input)) {
    const commands = buildWaveformCommands(params);
    const timeoutBridge = timeoutMs + 20_000;

    const bridged = await dispatchLiveActionThroughTekAutomate(
      'send_scpi',
      { commands, timeout_ms: timeoutMs },
      timeoutBridge,
    );

    if (!bridged.ok) {
      return {
        ok: false,
        data: { error: 'BRIDGE_FAILED', message: bridged.error || 'TekAutomate bridge failed to execute waveform SCPI.' },
        sourceMeta: [],
        warnings: [bridged.error || 'Bridge error'],
      };
    }

    // Bridge returns ToolResult envelope: { ok, data: { responses:[...], ... }, sourceMeta, warnings }
    const envelope = bridged.result && typeof bridged.result === 'object'
      ? bridged.result as Record<string, unknown>
      : {};
    const payload = (envelope.data && typeof envelope.data === 'object')
      ? envelope.data as Record<string, unknown>
      : envelope;

    const responses = Array.isArray(payload.responses)
      ? (payload.responses as Array<{ command: string; response: string }>)
      : [];

    if (!responses.length) {
      return {
        ok: false,
        data: { error: 'NO_RESPONSES', message: 'Bridge returned no SCPI responses', payloadKeys: Object.keys(payload) },
        sourceMeta: [],
        warnings: ['Waveform SCPI bridge returned no responses'],
      };
    }

    return processWaveformScpiResponses(responses, params);
  }

  // ── Direct mode: executor is reachable (local mcp-server) ──
  return fetchWaveformProxy(merged as any, params);
}
