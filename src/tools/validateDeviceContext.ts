import type { ToolResult } from '../core/schemas';

interface ValidateDeviceContextInput {
  steps: Array<Record<string, unknown>>;
}

function classifyCommand(command: string): 'scope' | 'smu_psu' | 'tekexp' | 'unknown' {
  const c = command.toUpperCase();
  if (/^(CH\d+:|ACQ(UIRE)?|MEAS(U(RE(MENT)?)?)|DATA:)/.test(c)) return 'scope';
  if (/(^|:)(SOURCE|OUTPUT|MEASURE)(:|$)/.test(c)) return 'smu_psu';
  if (c.startsWith('TEKEXP:')) return 'tekexp';
  return 'unknown';
}

export async function validateDeviceContext(
  input: ValidateDeviceContextInput
): Promise<ToolResult<unknown[]>> {
  const fixes: Array<Record<string, unknown>> = [];
  const steps = Array.isArray(input.steps) ? input.steps : [];
  for (const step of steps) {
    const type = String(step.type || '');
    if (!['query', 'write', 'set_and_query'].includes(type)) continue;
    const params = (step.params || {}) as Record<string, unknown>;
    const command = String(params.command || '');
    if (!command) continue;
    const expected = classifyCommand(command);
    const bound = String(params.boundDeviceId || params.DEVICE_CONTEXT || '').toLowerCase();
    if (expected === 'scope' && /(smu|psu|tekexp)/.test(bound)) {
      fixes.push({
        stepId: step.id,
        issue: 'Scope command bound to non-scope context',
        suggested: { param: 'boundDeviceId', value: 'scope' },
      });
    }
    if (expected === 'smu_psu' && /(scope|tekexp)/.test(bound)) {
      fixes.push({
        stepId: step.id,
        issue: 'SMU/PSU command bound to scope/tekexp context',
        suggested: { param: 'boundDeviceId', value: 'smu' },
      });
    }
    if (expected === 'tekexp' && !/tekexp/.test(bound)) {
      fixes.push({
        stepId: step.id,
        issue: 'TekExpress command bound to non-tekexp context',
        suggested: { param: 'boundDeviceId', value: 'tekexp' },
      });
    }
  }
  return {
    ok: true,
    data: fixes,
    sourceMeta: [],
    warnings: fixes.length ? [] : ['No device-context issues found'],
  };
}
