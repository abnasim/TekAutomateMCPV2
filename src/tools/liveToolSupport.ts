import { getRuntimeContextState, getInstrumentInfoState } from './runtimeContextStore';
import { enqueueLiveAction, type LiveActionResultEnvelope, type LiveActionToolName } from './liveActionBridge';

export interface RuntimeBackedEndpoint {
  executorUrl: string;
  visaResource: string;
  backend: string;
  liveMode?: boolean;
}

export function withRuntimeInstrumentDefaults<T extends Record<string, unknown>>(input: T): T & RuntimeBackedEndpoint {
  const connectionKey = typeof (input as any).__connectionSessionKey === 'string' && (input as any).__connectionSessionKey
    ? (input as any).__connectionSessionKey as string : null;
  const instrument = getInstrumentInfoState(connectionKey);
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
    ...input,
  } as T & RuntimeBackedEndpoint;
}

export function shouldBridgeToTekAutomate(input: {
  executorUrl?: unknown;
  liveMode?: unknown;
  [key: string]: unknown;
}): boolean {
  const runtime = getRuntimeContextState();
  const connectionKey = typeof (input as any).__connectionSessionKey === 'string' && (input as any).__connectionSessionKey
    ? (input as any).__connectionSessionKey as string : null;
  const instrument = getInstrumentInfoState(connectionKey);
  const requestedLiveMode =
    typeof input.liveMode === 'boolean'
      ? input.liveMode
      : instrument.liveMode;
  return Boolean(
    requestedLiveMode
      && instrument.connected
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
