import { getCurrentWorkflow } from './getCurrentWorkflow';
import { getRunLog } from './getRunLog';
import { stageWorkflowProposal } from './stageWorkflowProposal';

interface WorkflowUiInput extends Record<string, unknown> {
  action?: string;
  args?: Record<string, unknown>;
}

function mergeArgs(input: WorkflowUiInput): Record<string, unknown> {
  const nested = input.args && typeof input.args === 'object' ? input.args : {};
  const merged = { ...nested, ...input };
  delete (merged as Record<string, unknown>).args;
  return merged as Record<string, unknown>;
}

export async function workflowUi(input: WorkflowUiInput) {
  const action = String(input.action || '').trim().toLowerCase();
  const args = mergeArgs(input);
  delete args.action;

  switch (action) {
    case 'current':
      return getCurrentWorkflow(input);
    case 'stage':
      return stageWorkflowProposal(args as any);
    case 'logs':
      return getRunLog(input);
    default:
      return {
        ok: false,
        data: null,
        sourceMeta: [],
        warnings: ['Unknown workflow_ui action. Use one of: current, stage, logs.'],
      };
  }
}
