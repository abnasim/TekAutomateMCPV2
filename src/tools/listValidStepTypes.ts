import type { ToolResult } from '../core/schemas';

interface ListValidStepTypesInput {
  mode: 'steps_json' | 'blockly_xml';
  backend?: string;
}

const STEPS_TYPES = [
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
];

const BLOCK_TYPES = [
  'connect_scope',
  'disconnect',
  'set_device_context',
  'scpi_write',
  'scpi_query',
  'recall',
  'save',
  'save_screenshot',
  'save_waveform',
  'wait_seconds',
  'wait_for_opc',
  'tm_devices_write',
  'tm_devices_query',
  'tm_devices_save_screenshot',
  'tm_devices_recall_session',
  'controls_for',
  'controls_if',
  'variables_set',
  'variables_get',
  'math_number',
  'math_arithmetic',
];

export async function listValidStepTypes(
  input: ListValidStepTypesInput
): Promise<ToolResult<string[]>> {
  const backend = (input.backend || '').toLowerCase();
  if (input.mode === 'blockly_xml') {
    const filtered =
      backend === 'tm_devices'
        ? BLOCK_TYPES.filter((b) => b.startsWith('tm_devices') || !['scpi_write', 'scpi_query'].includes(b))
        : BLOCK_TYPES;
    return { ok: true, data: filtered, sourceMeta: [], warnings: [] };
  }
  let out = [...STEPS_TYPES];
  if (backend === 'tm_devices') {
    out = out.filter((t) => !['write', 'query', 'save_screenshot', 'save_waveform'].includes(t));
  }
  return { ok: true, data: out, sourceMeta: [], warnings: [] };
}
