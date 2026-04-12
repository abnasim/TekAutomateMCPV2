import type { ToolResult } from '../core/schemas';
import { getCurrentWorkflowState, getLiveSessionState, getWorkflowForSession } from './runtimeContextStore';

export async function getCurrentWorkflow(input?: Record<string, unknown>): Promise<ToolResult<Record<string, unknown>>> {
  const liveSession = getLiveSessionState();

  // Prefer the connection-bound sessionKey injected at MCP session creation time.
  // This key is unique per browser tab (sessionStorage) so each ChatKit conversation
  // is isolated — no cross-tab workflow bleed even when multiple browsers are open.
  const connectionKey = typeof input?.__connectionSessionKey === 'string' && input.__connectionSessionKey
    ? input.__connectionSessionKey
    : null;
  const sessionKey = connectionKey ?? liveSession.sessionKey ?? null;

  // Look up THIS browser's workflow by its sessionKey first.
  // Falls back to the global slot (legacy / no-sessionKey path).
  const workflow = (sessionKey ? getWorkflowForSession(sessionKey) : null) ?? getCurrentWorkflowState();

  return {
    ok: true,
    data: {
      ...(workflow as unknown as Record<string, unknown>),
      sessionKey,
    },
    sourceMeta: [],
    warnings: [],
  };
}
