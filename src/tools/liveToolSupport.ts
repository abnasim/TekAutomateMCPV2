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
  // Env vars act as a hard override for local direct-executor mode (EXECUTOR_URL set in .env)
  // In local mode (not Railway), fall back to localhost:8765 — the default executor port
  const isHosted = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_NAME);
  const localFallback = isHosted ? '' : 'http://localhost:8765';
  const envExecutorUrl = process.env.EXECUTOR_URL || instrument.executorUrl || localFallback;
  const envVisaResource = process.env.VISA_RESOURCE || '';
  return {
    ...input,
    executorUrl:
      typeof input.executorUrl === 'string' && input.executorUrl
        ? input.executorUrl
        : instrument.executorUrl || envExecutorUrl,
    visaResource:
      typeof input.visaResource === 'string' && input.visaResource
        ? input.visaResource
        : instrument.visaResource || envVisaResource,
    backend:
      typeof input.backend === 'string' && input.backend
        ? input.backend
        : instrument.backend,
    liveMode:
      typeof input.liveMode === 'boolean'
        ? input.liveMode
        : instrument.liveMode || Boolean(envExecutorUrl),
  } as T & RuntimeBackedEndpoint;
}

export function shouldBridgeToTekAutomate(input: {
  executorUrl?: unknown;
  liveMode?: unknown;
  [key: string]: unknown;
}): boolean {
  // If EXECUTOR_URL is set in env, we're in direct local mode — never bridge through browser
  if (process.env.EXECUTOR_URL) return false;

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
