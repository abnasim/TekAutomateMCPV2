import type { ToolResult } from '../core/schemas';
import { extractReplaceFlowSteps } from '../core/schemas';
import { parseJsonValueString } from '../core/actionNormalizer';

interface ValidateActionPayloadInput {
  actionsJson: Record<string, unknown>;
  originalSteps?: Array<Record<string, unknown>>;
}

const VALID_STEP_TYPES = new Set([
  'connect',
  'disconnect',
  'query',
  'write',
  'set_and_query',
  'recall',
  'sleep',
  'python',
  'save_waveform',
  'save_screenshot',
  'error_check',
  'comment',
  'group',
  'tm_device_command',
]);

function flattenSteps(steps: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const walk = (arr: Array<Record<string, unknown>>) => {
    arr.forEach((s) => {
      out.push(s);
      if (Array.isArray(s.children)) {
        walk(s.children as Array<Record<string, unknown>>);
      }
    });
  };
  walk(steps);
  return out;
}

function validateStep(step: Record<string, unknown>, errors: string[], path: string): void {
  const type = String(step.type || '');
  if (!VALID_STEP_TYPES.has(type)) {
    errors.push(`${path}: invalid step type ${type}`);
    return;
  }
  const params = (step.params || {}) as Record<string, unknown>;
  if (type === 'query' && (!params.saveAs || typeof params.saveAs !== 'string')) {
    errors.push(`${path}: query step missing saveAs`);
  }
  if (type === 'group') {
    if (!step.params || typeof step.params !== 'object' || Array.isArray(step.params)) {
      errors.push(`${path}: group must include params:{}`);
    }
    if (!Array.isArray(step.children)) {
      errors.push(`${path}: group must include children:[]`);
    }
  }
  if (type === 'recall') {
    const recallType = String(params.recallType || '').toUpperCase();
    const filePath = String(params.filePath || '');
    if (!['FACTORY', 'SETUP', 'SESSION', 'WAVEFORM'].includes(recallType)) {
      errors.push(`${path}: invalid recallType`);
    }
    if (recallType === 'SETUP' && filePath && !filePath.toLowerCase().endsWith('.set')) {
      errors.push(`${path}: SETUP recall file must end with .set`);
    }
    if (recallType === 'SESSION' && filePath && !filePath.toLowerCase().endsWith('.tss')) {
      errors.push(`${path}: SESSION recall file must end with .tss`);
    }
    if (recallType === 'WAVEFORM' && filePath && !filePath.toLowerCase().endsWith('.wfm')) {
      errors.push(`${path}: WAVEFORM recall file must end with .wfm`);
    }
  }
}

export async function validateActionPayload(
  input: ValidateActionPayloadInput
): Promise<ToolResult<{ valid: boolean; errors: string[]; fixHints: string[] }>> {
  const errors: string[] = [];
  const fixHints: string[] = [];
  const root = input.actionsJson || {};
  const actions = Array.isArray(root.actions) ? (root.actions as Array<Record<string, unknown>>) : [];

  const originalById = new Map<string, Record<string, unknown>>();
  (input.originalSteps || []).forEach((s) => {
    if (typeof s.id === 'string') originalById.set(s.id, s);
  });

  for (let i = 0; i < actions.length; i += 1) {
    const action = actions[i];
    if (
      typeof action.insert_step_after === 'object' ||
      typeof action.replace_step === 'object' ||
      typeof action.replace_flow === 'object'
    ) {
      errors.push(`actions[${i}]: invalid shorthand action shape (use type + payload/newStep)`);
      continue;
    }
    const type = String(action.action_type || action.type || '');
    if (type === 'replace_flow') {
      const steps = extractReplaceFlowSteps(action) || [];
      if (!steps.length) {
        errors.push(`actions[${i}]: replace_flow missing steps`);
        continue;
      }
      const flat = flattenSteps(steps);
      const ids = new Set<string>();
      flat.forEach((step, idx) => {
        validateStep(step, errors, `actions[${i}].steps[${idx}]`);
        const id = String(step.id || '');
        if (!id) {
          errors.push(`actions[${i}].steps[${idx}]: missing id`);
        } else if (ids.has(id)) {
          errors.push(`actions[${i}].steps[${idx}]: duplicate id ${id}`);
        } else {
          ids.add(id);
        }
      });
      if (steps[0]?.type !== 'connect') fixHints.push('Flow should start with connect.');
      if (steps[steps.length - 1]?.type !== 'disconnect') fixHints.push('Flow should end with disconnect.');
      continue;
    }
    if (type === 'replace_step' || type === 'insert_step_after') {
      const payload = (action.payload || {}) as Record<string, unknown>;
      const newStep = parseJsonValueString(action.newStep || payload.new_step || payload.newStep) as
        | Record<string, unknown>
        | undefined;
      if (!newStep) {
        errors.push(`actions[${i}]: ${type} missing payload.new_step`);
        continue;
      }
      validateStep(newStep, errors, `actions[${i}].payload.new_step`);
      if (type === 'insert_step_after') {
        const hasTarget =
          Object.prototype.hasOwnProperty.call(action, 'targetStepId') ||
          Object.prototype.hasOwnProperty.call(action, 'target_step_id');
        if (!hasTarget) {
          errors.push(`actions[${i}]: insert_step_after missing targetStepId`);
        }
      }
      if (String(newStep.type || '') === 'python') {
        const target = String(action.target_step_id || action.targetStepId || '');
        const original = target ? originalById.get(target) : null;
        const allowPython =
          action.allow_python === true ||
          action.allowPython === true ||
          payload.allow_python === true ||
          payload.allowPython === true ||
          (newStep as Record<string, unknown>).allow_python === true ||
          (newStep as Record<string, unknown>).allowPython === true;
        if ((!original || String(original.type || '') !== 'python') && !allowPython) {
          errors.push(`actions[${i}]: unexpected python substitution`);
        }
      }
    }
  }

  return {
    ok: true,
    data: { valid: errors.length === 0, errors, fixHints },
    sourceMeta: [],
    warnings: [],
  };
}
