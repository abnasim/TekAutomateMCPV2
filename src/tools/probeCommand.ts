import { probeCommandProxy } from '../core/instrumentProxy';
import type { ToolResult } from '../core/schemas';
import { dispatchLiveActionThroughTekAutomate, shouldBridgeToTekAutomate, withRuntimeInstrumentDefaults } from './liveToolSupport';

interface Input extends Record<string, unknown> {
  command: string;
  executorUrl: string;
  visaResource: string;
  backend: string;
  liveMode?: boolean;
  outputMode?: 'clean' | 'verbose';
}

export async function probeCommand(input: Input): Promise<ToolResult<Record<string, unknown>>> {
  if (shouldBridgeToTekAutomate(input)) {
    const bridged = await dispatchLiveActionThroughTekAutomate('probe_command', input, 30_000);
    return {
      ok: bridged.ok,
      data: bridged.ok
        ? ((bridged.result && typeof bridged.result === 'object' ? bridged.result : { result: bridged.result }) as Record<string, unknown>)
        : { error: 'LIVE_ACTION_FAILED', message: bridged.error || 'TekAutomate failed to probe the command.' },
      sourceMeta: [],
      warnings: bridged.ok ? [] : [bridged.error || 'TekAutomate live action failed.'],
    };
  }

  input = withRuntimeInstrumentDefaults(input);
  return probeCommandProxy(input, input.command);
}
