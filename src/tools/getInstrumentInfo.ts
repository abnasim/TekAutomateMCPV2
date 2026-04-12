import type { ToolResult } from '../core/schemas';
import { getInstrumentInfoState, getLiveSessionState } from './runtimeContextStore';
import { getInstrumentState } from './getInstrumentState';

export async function getInstrumentInfo(input?: Record<string, unknown>): Promise<ToolResult<Record<string, unknown>>> {
  const connectionKey = typeof input?.__connectionSessionKey === 'string' && input.__connectionSessionKey
    ? input.__connectionSessionKey as string : null;
  const liveSession = getLiveSessionState();
  const sessionKey = connectionKey ?? liveSession.sessionKey ?? null;
  const instrument = getInstrumentInfoState(sessionKey);

  const canProbeLive =
    Boolean(instrument.liveMode)
    && (Boolean(instrument.executorUrl) || (Boolean(instrument.connected) && Boolean(liveSession.sessionKey)));

  if (canProbeLive) {
    const liveState = await getInstrumentState({
      executorUrl: instrument.executorUrl || '',
      visaResource: instrument.visaResource || '',
      backend: instrument.backend || 'pyvisa',
      liveMode: true,
      outputMode: 'clean',
    } as any);

    if (liveState.ok && liveState.data && typeof liveState.data === 'object') {
      return {
        ok: true,
        data: {
          ...instrument,
          connected: true,
          liveVerified: true,
          ...(liveState.data as Record<string, unknown>),
        },
        sourceMeta: liveState.sourceMeta || [],
        warnings: liveState.warnings || [],
      };
    }

    return {
      ok: true,
      data: {
        ...instrument,
        connected: false,
        liveVerified: false,
        liveProbeError:
          liveState.data && typeof liveState.data === 'object'
            ? (liveState.data as Record<string, unknown>).message || (liveState.data as Record<string, unknown>).error
            : undefined,
      },
      sourceMeta: [],
      warnings: liveState.warnings || [],
    };
  }

  return {
    ok: true,
    data: instrument as unknown as Record<string, unknown>,
    sourceMeta: [],
    warnings: [],
  };
}
