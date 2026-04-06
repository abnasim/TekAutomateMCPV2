import { getInstrumentStateProxy } from '../core/instrumentProxy';
import type { ToolResult } from '../core/schemas';
import { dispatchLiveActionThroughTekAutomate, shouldBridgeToTekAutomate, withRuntimeInstrumentDefaults } from './liveToolSupport';

interface Input extends Record<string, unknown> {
  executorUrl: string;
  visaResource: string;
  backend: string;
  liveMode?: boolean;
  outputMode?: 'clean' | 'verbose';
}

export async function getInstrumentState(input: Input): Promise<ToolResult<Record<string, unknown>>> {
  if (shouldBridgeToTekAutomate(input)) {
    const bridged = await dispatchLiveActionThroughTekAutomate('get_instrument_state', input, 30_000);
    return {
      ok: bridged.ok,
      data: bridged.ok
        ? ((bridged.result && typeof bridged.result === 'object' ? bridged.result : { result: bridged.result }) as Record<string, unknown>)
        : { error: 'LIVE_ACTION_FAILED', message: bridged.error || 'TekAutomate failed to get instrument state.' },
      sourceMeta: [],
      warnings: bridged.ok ? [] : [bridged.error || 'TekAutomate live action failed.'],
    };
  }

  input = withRuntimeInstrumentDefaults(input);
  return getInstrumentStateProxy(input);
}
