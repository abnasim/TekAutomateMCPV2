import type { ToolResult } from '../core/schemas';
import { listInstrumentsProxy } from '../core/instrumentProxy';
import { dispatchLiveActionThroughTekAutomate, shouldBridgeToTekAutomate, withRuntimeInstrumentDefaults } from './liveToolSupport';

interface Input extends Record<string, unknown> {
  executorUrl?: string;
  visaResource?: string;
  backend?: string;
  liveMode?: boolean;
  queryIdn?: boolean;
  probe_idn?: boolean;
  deviceId?: string;
  device_map?: Record<string, string>;
}

export async function listInstruments(input: Input = {}): Promise<ToolResult<Record<string, unknown>>> {
  if (shouldBridgeToTekAutomate(input)) {
    const bridged = await dispatchLiveActionThroughTekAutomate('list_instruments', input, 30_000);
    return {
      ok: bridged.ok,
      data: bridged.ok
        ? ((bridged.result && typeof bridged.result === 'object' ? bridged.result : { result: bridged.result }) as Record<string, unknown>)
        : { error: 'LIVE_ACTION_FAILED', message: bridged.error || 'TekAutomate failed to list instruments.' },
      sourceMeta: [],
      warnings: bridged.ok ? [] : [bridged.error || 'TekAutomate live action failed.'],
    };
  }

  const endpoint = withRuntimeInstrumentDefaults(input);
  return listInstrumentsProxy({
    ...endpoint,
    deviceId: input.deviceId,
    deviceMap: input.device_map,
  });
}
