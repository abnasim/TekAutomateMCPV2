import type { ToolResult } from '../core/schemas';

export interface StagedWorkflowProposal {
  id: string;
  createdAt: string;
  summary: string;
  findings: string[];
  suggestedFixes: string[];
  actions: unknown[];
}

interface StageWorkflowProposalInput {
  summary?: unknown;
  findings?: unknown[];
  suggestedFixes?: unknown[];
  actions?: unknown[];
}

let lastWorkflowProposal: StagedWorkflowProposal | null = null;

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

export function getLastWorkflowProposal(): StagedWorkflowProposal | null {
  return lastWorkflowProposal;
}

export async function stageWorkflowProposal(
  input: StageWorkflowProposalInput
): Promise<ToolResult<Record<string, unknown>>> {
  const actions = Array.isArray(input.actions) ? input.actions : [];
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
      warnings: [
        'Proposal was not staged because no actions were provided.',
      ],
    };
  }

  const proposal: StagedWorkflowProposal = {
    id: createProposalId(),
    createdAt: new Date().toISOString(),
    summary: cleanSummary(input.summary),
    findings: toStringList(input.findings),
    suggestedFixes: toStringList(input.suggestedFixes),
    actions,
  };

  lastWorkflowProposal = proposal;

  return {
    ok: true,
    data: {
      ok: true,
      proposalId: proposal.id,
      createdAt: proposal.createdAt,
      actionCount: actions.length,
      summary: proposal.summary,
    },
    sourceMeta: [],
    warnings: [],
  };
}
