import { getRuntimeContextState } from './runtimeContextStore';
import { enqueueLiveAction, type LiveActionResultEnvelope, type LiveActionToolName } from './liveActionBridge';

export interface RuntimeBackedEndpoint {
  executorUrl: string;
  visaResource: string;
  backend: string;
  liveMode?: boolean;
  deviceId?: string;
  deviceMap?: Record<string, string>;
  deviceCount?: number;
  autoSelectedDeviceId?: string;
  deviceIdSource?: 'explicit' | 'auto' | 'unknown';
}

export function withRuntimeInstrumentDefaults<T extends Record<string, unknown>>(input: T): T & RuntimeBackedEndpoint {
  const runtime = getRuntimeContextState();
  const instrument = runtime.instrument;
  const inputDeviceMap =
    (input as Record<string, unknown>).device_map && typeof (input as Record<string, unknown>).device_map === 'object'
      ? ((input as Record<string, unknown>).device_map as Record<string, string>)
      : undefined;
  const effectiveDeviceMap = inputDeviceMap || instrument.deviceMap || undefined;
  const deviceKeys = effectiveDeviceMap ? Object.keys(effectiveDeviceMap) : [];
  const explicitDeviceId =
    typeof (input as Record<string, unknown>).deviceId === 'string' && (input as Record<string, unknown>).deviceId
      ? (input as Record<string, unknown>).deviceId
      : undefined;
  const runtimeDeviceId = instrument.deviceId || undefined;
  const runtimeDeviceIdSource = instrument.deviceIdSource || undefined;
  const selectedDeviceId = explicitDeviceId || runtimeDeviceId || (deviceKeys.length > 0 ? deviceKeys[0] : undefined);
  let autoSelectedDeviceId = !explicitDeviceId && !runtimeDeviceId && deviceKeys.length > 0 ? deviceKeys[0] : undefined;
  if (!explicitDeviceId && runtimeDeviceId && runtimeDeviceIdSource === 'auto') {
    autoSelectedDeviceId = runtimeDeviceId;
  }
  const deviceIdSource: 'explicit' | 'auto' | 'unknown' | undefined =
    explicitDeviceId
      ? 'explicit'
      : runtimeDeviceId
        ? runtimeDeviceIdSource || 'unknown'
        : autoSelectedDeviceId
          ? 'auto'
          : undefined;
  return {
    executorUrl:
      typeof input.executorUrl === 'string' && input.executorUrl
        ? input.executorUrl
        : instrument.executorUrl || '',
    visaResource:
      typeof input.visaResource === 'string' && input.visaResource
        ? input.visaResource
        : instrument.visaResource || '',
    backend:
      typeof input.backend === 'string' && input.backend
        ? input.backend
        : instrument.backend,
    liveMode:
      typeof input.liveMode === 'boolean'
        ? input.liveMode
        : instrument.liveMode,
    deviceId: selectedDeviceId,
    deviceMap: effectiveDeviceMap,
    deviceCount: deviceKeys.length || undefined,
    autoSelectedDeviceId,
    deviceIdSource,
    ...input,
  } as T & RuntimeBackedEndpoint;
}

export function shouldBridgeToTekAutomate(input: {
  executorUrl?: unknown;
  liveMode?: unknown;
}): boolean {
  const runtime = getRuntimeContextState();
  const requestedLiveMode =
    typeof input.liveMode === 'boolean'
      ? input.liveMode
      : runtime.instrument.liveMode;
  return Boolean(
    requestedLiveMode
      && runtime.instrument.connected
      && runtime.liveSession.sessionKey
  );
}

export async function dispatchLiveActionThroughTekAutomate(
  toolName: LiveActionToolName,
  args: Record<string, unknown>,
  timeoutMs?: number,
): Promise<LiveActionResultEnvelope> {
  const runtime = getRuntimeContextState();
  return enqueueLiveAction({
    toolName,
    args,
    sessionKey: runtime.liveSession.sessionKey,
    timeoutMs,
  });
}
