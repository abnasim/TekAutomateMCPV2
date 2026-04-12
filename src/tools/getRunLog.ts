import type { ToolResult } from '../core/schemas';
import { getRunLogState, getLiveSessionState } from './runtimeContextStore';

export async function getRunLog(input?: Record<string, unknown>): Promise<ToolResult<Record<string, unknown>>> {
  const connectionKey = typeof input?.__connectionSessionKey === 'string' && input.__connectionSessionKey
    ? input.__connectionSessionKey as string : null;
  const liveSession = getLiveSessionState();
  const sessionKey = connectionKey ?? liveSession.sessionKey ?? null;
  return {
    ok: true,
    data: getRunLogState(sessionKey) as unknown as Record<string, unknown>,
    sourceMeta: [],
    warnings: [],
  };
}
