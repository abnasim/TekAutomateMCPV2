import type { MicroTool, ToolCategory } from './toolRegistry';

const ALLOWED_CATEGORIES = new Set<ToolCategory>([
  'scpi_search',
  'scpi_lookup',
  'scpi_materialize',
  'scpi_verify',
  'scpi_override',
  'shortcut',
  'template',
  'planner',
  'rag',
  'validator',
  'instrument',
  'flow_action',
  'composite',
]);

export interface ToolValidationResult {
  valid: boolean;
  reason: string;
}

export function validateTool(tool: MicroTool): ToolValidationResult {
  if (!tool || typeof tool !== 'object') {
    return { valid: false, reason: 'Tool must be an object.' };
  }

  const id = String(tool.id || '');
  if (!id.trim()) {
    return { valid: false, reason: 'Tool id is required.' };
  }
  if (/\s/.test(id)) {
    return { valid: false, reason: 'Tool id cannot contain whitespace.' };
  }

  if (!String(tool.name || '').trim()) {
    return { valid: false, reason: 'Tool name is required.' };
  }

  if (String(tool.description || '').trim().length < 10) {
    return { valid: false, reason: 'Tool description must be at least 10 characters.' };
  }

  if (typeof tool.handler !== 'function') {
    return { valid: false, reason: 'Tool handler must be a function.' };
  }

  if (!tool.schema || tool.schema.type !== 'object') {
    return { valid: false, reason: 'Tool schema.type must be "object".' };
  }

  if (!ALLOWED_CATEGORIES.has(tool.category)) {
    return { valid: false, reason: `Tool category "${String(tool.category)}" is not allowed.` };
  }

  if (!Array.isArray(tool.triggers) || tool.triggers.length === 0) {
    return { valid: false, reason: 'Tool must define at least one trigger.' };
  }

  const normalizedTriggers = tool.triggers
    .map((trigger) => String(trigger || '').trim().toLowerCase())
    .filter(Boolean);

  if (!normalizedTriggers.length) {
    return { valid: false, reason: 'Tool triggers cannot all be empty.' };
  }

  if (new Set(normalizedTriggers).size !== normalizedTriggers.length) {
    return { valid: false, reason: 'Tool triggers must be unique.' };
  }

  return { valid: true, reason: 'ok' };
}
