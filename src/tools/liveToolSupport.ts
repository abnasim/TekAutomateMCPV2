import { getRuntimeContextState } from './runtimeContextStore';
import { enqueueLiveAction, type LiveActionResultEnvelope, type LiveActionToolName } from './liveActionBridge';

export interface RuntimeBackedEndpoint {
  executorUrl: string;
  visaResource: string;
  backend: string;
  liveMode?: boolean;
}

export function withRuntimeInstrumentDefaults<T extends Record<string, unknown>>(input: T): T & RuntimeBackedEndpoint {
  const runtime = getRuntimeContextState();
  const instrument = runtime.instrument;
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
