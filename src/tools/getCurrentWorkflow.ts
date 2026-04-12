import type { ToolResult } from '../core/schemas';
import { getCurrentWorkflowState, getLiveSessionState, getWorkflowForSession, getMostRecentWorkflow } from './runtimeContextStore';

export async function getCurrentWorkflow(input?: Record<string, unknown>): Promise<ToolResult<Record<string, unknown>>> {
  const liveSession = getLiveSessionState();

  // Prefer the connection-bound sessionKey injected at MCP session creation time.
  // This key is unique per browser tab (sessionStorage) so each ChatKit conversation
  // is isolated — no cross-tab workflow bleed even when multiple browsers are open.
  const connectionKey = typeof input?.__connectionSessionKey === 'string' && input.__connectionSessionKey
    ? input.__connectionSessionKey
    : null;
  const sessionKey = connectionKey ?? liveSession.sessionKey ?? null;

  // 1. Exact session match (chatkit key == push key) — ideal case
  // 2. Most-recently-pushed session — handles key mismatch (live:... vs chatkit:...)
  //    Browser pushes under live:... key; MCP reads with chatkit:... key. Both valid
  //    but different — fall through to the freshest available session data.
  // 3. Global slot — legacy / first-push-before-any-session path
  const workflow =
    (sessionKey ? getWorkflowForSession(sessionKey) : null)
    ?? getMostRecentWorkflow()
    ?? getCurrentWorkflowState();

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
