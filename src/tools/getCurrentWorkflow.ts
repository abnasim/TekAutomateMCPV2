import type { ToolResult } from '../core/schemas';
import { getCurrentWorkflowState, getLiveSessionState } from './runtimeContextStore';

export async function getCurrentWorkflow(input?: Record<string, unknown>): Promise<ToolResult<Record<string, unknown>>> {
  const workflow = getCurrentWorkflowState();
  const liveSession = getLiveSessionState();

  // Prefer the connection-bound sessionKey injected by the MCP handler.
  // This is captured at MCP session creation time and is isolated per ChatKit
  // conversation — immune to other browsers pushing their keys to shared state.
  const connectionKey = typeof input?.__connectionSessionKey === 'string' && input.__connectionSessionKey
    ? input.__connectionSessionKey
    : null;
  const sessionKey = connectionKey ?? liveSession.sessionKey ?? null;

  return {
    ok: true,
    data: {
      ...(workflow as unknown as Record<string, unknown>),
      // sessionKey returned to agent so it can pass it back in workflow_ui{stage}.
      // Always matches the browser that created THIS ChatKit conversation.
      sessionKey,
    },
    sourceMeta: [],
    warnings: [],
  };
}
