import type { ToolResult } from '../core/schemas';

interface GetBlockSchemaInput {
  blockType: string;
}

const BLOCK_SCHEMAS: Record<string, { requiredFields: string[]; validValues?: Record<string, string[]> }> = {
  connect_scope: {
    requiredFields: ['DEVICE_NAME', 'BACKEND'],
    validValues: { BACKEND: ['pyvisa', 'tm_devices'] },
  },
  scpi_write: { requiredFields: ['DEVICE_CONTEXT', 'COMMAND'] },
  scpi_query: { requiredFields: ['DEVICE_CONTEXT', 'COMMAND', 'VARIABLE'] },
  recall: {
    requiredFields: ['DEVICE_CONTEXT', 'RECALL_TYPE', 'FILE_PATH', 'REFERENCE'],
    validValues: { RECALL_TYPE: ['FACTORY', 'SETUP', 'SESSION', 'WAVEFORM'] },
  },
  save: {
    requiredFields: ['DEVICE_CONTEXT', 'SAVE_TYPE', 'FILE_PATH'],
    validValues: { SAVE_TYPE: ['SETUP', 'SESSION', 'WAVEFORM', 'IMAGE'] },
  },
  save_screenshot: {
    requiredFields: ['DEVICE_CONTEXT', 'FILENAME', 'SCOPE_TYPE'],
    validValues: { SCOPE_TYPE: ['MODERN', 'LEGACY'] },
  },
  tm_devices_write: { requiredFields: ['CODE'] },
  tm_devices_query: { requiredFields: ['CODE', 'VARIABLE'] },
};

export async function getBlockSchema(
  input: GetBlockSchemaInput
): Promise<ToolResult<Record<string, unknown> | null>> {
  const type = (input.blockType || '').trim();
  if (!type) return { ok: false, data: null, sourceMeta: [], warnings: ['Missing blockType'] };
  const schema = BLOCK_SCHEMAS[type];
  if (!schema) {
    return { ok: false, data: null, sourceMeta: [], warnings: [`Unknown block type: ${type}`] };
  }
  return { ok: true, data: schema, sourceMeta: [], warnings: [] };
}
