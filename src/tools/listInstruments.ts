import type { ToolResult } from '../core/schemas';
import { listInstrumentsProxy } from '../core/instrumentProxy';
import { withRuntimeInstrumentDefaults } from './liveToolSupport';

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
  const endpoint = withRuntimeInstrumentDefaults(input);
  return listInstrumentsProxy({
    ...endpoint,
    deviceId: input.deviceId,
    deviceMap: input.device_map,
  });
}

