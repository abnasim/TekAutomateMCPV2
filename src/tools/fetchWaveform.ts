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

import { fetchWaveformProxy, type WaveformParams } from '../core/instrumentProxy';
import type { ToolResult } from '../core/schemas';
import { withRuntimeInstrumentDefaults } from './liveToolSupport';

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
  const stop       = Math.max(0, Math.floor(Number(input.stop  ?? 0)));
  const timeoutMs  = Math.min(Math.max(Number(input.timeoutMs ?? 30000), 5000), 120000);

  const params: WaveformParams = { channel, format, downsample, width, start, stop, timeoutMs };
  return fetchWaveformProxy(merged as any, params);
}
