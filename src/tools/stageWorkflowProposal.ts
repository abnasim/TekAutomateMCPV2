import type { ToolResult } from '../core/schemas';
import { getLiveSessionState } from './runtimeContextStore';
import { pushLiveProposal } from './liveActionBridge';

export interface StagedWorkflowProposal {
  id: string;
  createdAt: string;
  summary: string;
  findings: string[];
  suggestedFixes: string[];
  actions: unknown[];
  sessionKey: string;
}

interface StageWorkflowProposalInput {
  summary?: unknown;
  findings?: unknown[];
  suggestedFixes?: unknown[];
  actions?: unknown[];
  sessionKey?: unknown;
}

// Keyed by sessionKey — supports multiple concurrent users on the same public MCP.
// Falls back to 'default' when no sessionKey is provided (legacy / single-user).
const proposalsBySession = new Map<string, StagedWorkflowProposal>();
const MAX_SESSIONS = 500; // guard against unbounded growth

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function cleanSummary(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

function createProposalId(): string {
  return `proposal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function getLastWorkflowProposal(sessionKey?: string): StagedWorkflowProposal | null {
  const key = String(sessionKey || '').trim() || 'default';
  return proposalsBySession.get(key) ?? null;
}

// Workflow step types the agent sends — NOT the same as AI action types.
// When the agent passes steps instead of AI actions, we wrap them as replace_flow
// so the browser's normalizeAiActions can handle them correctly.
const STEP_TYPES = new Set([
  'connect', 'disconnect', 'query', 'write', 'set_and_query', 'sleep',
  'comment', 'python', 'save_waveform', 'save_screenshot', 'error_check',
  'group', 'tm_device_command', 'recall',
]);

function normalizeActions(raw: unknown[]): unknown[] {
  if (raw.length === 0) return raw;
  const firstType = raw[0] && typeof raw[0] === 'object'
    ? String((raw[0] as Record<string, unknown>).type || '')
    : '';
  // If actions look like workflow steps, wrap as replace_flow so the browser
  // can apply them — normalizeAiActions doesn't know step types like 'write'.
  if (STEP_TYPES.has(firstType)) {
    return [{
      action_type: 'replace_flow',
      confidence: 'high',
      payload: { steps: raw },
    }];
  }
  return raw;
}

export async function stageWorkflowProposal(
  input: StageWorkflowProposalInput
): Promise<ToolResult<Record<string, unknown>>> {
  const actions = normalizeActions(Array.isArray(input.actions) ? input.actions : []);
  if (actions.length === 0) {
    return {
      ok: false,
      data: {
        ok: false,
        error:
          'stage_workflow_proposal requires a non-empty actions array. ' +
          'Copy build_or_edit_workflow.data.actions directly into this tool call.',
        actionCount: 0,
      },
      sourceMeta: [],
      warnings: ['Proposal was not staged because no actions were provided.'],
    };
  }

  // Priority: explicit agent-passed key → connection-bound key → global state → 'default'
  // __connectionSessionKey is injected by the MCP handler and bound to this specific
  // ChatKit conversation — using it prevents other browsers' key-pushes from interfering.
  const connectionKey = typeof (input as any).__connectionSessionKey === 'string'
    ? String((input as any).__connectionSessionKey).trim()
    : '';
  const sessionKey =
    String(input.sessionKey || '').trim() ||
    connectionKey ||
    getLiveSessionState().sessionKey ||
    'default';

  const proposal: StagedWorkflowProposal = {
    id: createProposalId(),
    createdAt: new Date().toISOString(),
    summary: cleanSummary(input.summary),
    findings: toStringList(input.findings),
    suggestedFixes: toStringList(input.suggestedFixes),
    actions,
    sessionKey,
  };

  // Evict oldest entry if we hit the cap (prevents unbounded memory growth)
  if (proposalsBySession.size >= MAX_SESSIONS) {
    const oldestKey = proposalsBySession.keys().next().value;
    if (oldestKey !== undefined) proposalsBySession.delete(oldestKey);
  }

  proposalsBySession.set(sessionKey, proposal);

  // Push via live bridge — only to the explicit sessionKey.
  // The agent receives sessionKey via additional_instructions injected at session
  // creation, so it always passes the right key. Broadcasting to all sessions
  // breaks isolation (every browser sees every proposal).
  if (sessionKey !== 'default') {
    pushLiveProposal(proposal, sessionKey);
  }

  return {
    ok: true,
    data: {
      ok: true,
      proposalId: proposal.id,
      createdAt: proposal.createdAt,
      actionCount: actions.length,
      summary: proposal.summary,
      sessionKey,
    },
    sourceMeta: [],
    warnings: [],
  };
}
