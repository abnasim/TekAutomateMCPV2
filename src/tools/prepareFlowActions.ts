import { normalizeActionsJsonPayload } from '../core/actionNormalizer';
import type { ToolResult } from '../core/schemas';
import { validateActionPayload } from './validateActionPayload';

interface PrepareFlowActionsInput {
  summary?: string;
  actions?: unknown[];
  findings?: unknown[];
  suggestedFixes?: unknown[];
  currentWorkflow?: Array<Record<string, unknown>>;
  selectedStepId?: string | null;
  backend?: string;
  modelFamily?: string;
}

function cleanSummary(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

function applySelectedStepFallback(
  actions: Array<Record<string, unknown>>,
  selectedStepId?: string | null
): Array<Record<string, unknown>> {
  const target = String(selectedStepId || '').trim();
  if (!target) return actions;

  return actions.map((action) => {
    if (String(action.type || action.action_type || '') !== 'insert_step_after') return action;
    if (typeof action.targetStepId === 'string' && action.targetStepId.trim()) return action;
    if (typeof action.target_step_id === 'string' && action.target_step_id.trim()) return action;
    return { ...action, targetStepId: target };
  });
}

export async function prepareFlowActions(
  input: PrepareFlowActionsInput
): Promise<ToolResult<Record<string, unknown>>> {
  const normalized = normalizeActionsJsonPayload({
    summary: input.summary,
    findings: input.findings,
    suggestedFixes: input.suggestedFixes,
    actions: Array.isArray(input.actions) ? input.actions : [],
  });

  const normalizedActions = applySelectedStepFallback(
    Array.isArray(normalized.actions) ? (normalized.actions as Array<Record<string, unknown>>) : [],
    input.selectedStepId
  );

  const preparedPayload = {
    ...normalized,
    summary: cleanSummary(normalized.summary),
    actions: normalizedActions,
  };
  const preparedRecord = preparedPayload as Record<string, unknown>;
  const preparedFindings = Array.isArray(preparedRecord.findings) ? (preparedRecord.findings as string[]) : [];
  const preparedSuggestedFixes = Array.isArray(preparedRecord.suggestedFixes) ? (preparedRecord.suggestedFixes as string[]) : [];

  const validation = await validateActionPayload({
    actionsJson: preparedPayload,
    originalSteps: Array.isArray(input.currentWorkflow) ? input.currentWorkflow : [],
  });

  const validationData = validation.data || { valid: true, errors: [], fixHints: [] };
  const applyMode =
    normalizedActions.length === 1 && String(normalizedActions[0]?.type || normalizedActions[0]?.action_type || '') === 'replace_flow'
      ? 'replace_flow'
      : 'incremental';

  return {
    ok: validationData.valid,
    data: {
      ok: validationData.valid,
      summary: preparedPayload.summary,
      findings: preparedFindings,
      suggestedFixes: preparedSuggestedFixes,
      actions: normalizedActions,
      warnings: validationData.fixHints || [],
      errors: validationData.errors || [],
      applyMode,
      context: {
        selectedStepId: input.selectedStepId || null,
        backend: input.backend || null,
        modelFamily: input.modelFamily || null,
      },
    },
    sourceMeta: [],
    warnings: validationData.fixHints || [],
  };
}
