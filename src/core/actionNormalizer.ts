type JsonRecord = Record<string, unknown>;

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

const STEP_TYPE_ALIASES: Record<string, string> = {
  scpi_write: 'write',
  scpi_query: 'query',
  visa_write: 'write',
  visa_query: 'query',
  visa_set_and_query: 'set_and_query',
  wait_seconds: 'sleep',
  wait: 'sleep',
  delay: 'sleep',
  tm_devices_command: 'tm_device_command',
  tmdevices_command: 'tm_device_command',
  tm_command: 'tm_device_command',
};

const WAVEFORM_EXTENSIONS = new Set(['bin', 'csv', 'wfm', 'mat']);

function toRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function toTextList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item;
      const obj = toRecord(item);
      if (!obj) return String(item);
      return (
        (typeof obj.issue === 'string' && obj.issue) ||
        (typeof obj.detail === 'string' && obj.detail) ||
        (typeof obj.note === 'string' && obj.note) ||
        (typeof obj.title === 'string' && obj.title) ||
        JSON.stringify(obj)
      );
    })
    .filter(Boolean);
}

export function parseJsonValueString(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  const first = trimmed[0];
  if (first !== '{' && first !== '[') return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function canonicalStepType(value: unknown): string {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  const mapped = STEP_TYPE_ALIASES[raw] || raw;
  return VALID_STEP_TYPES.has(mapped) ? mapped : raw;
}

function pickText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function humanizeType(type: string): string {
  return String(type || '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function basenameFromPath(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || trimmed;
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeWaveformFormat(value: unknown): string {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  return WAVEFORM_EXTENSIONS.has(raw) ? raw : '';
}

function getWaveformExtension(format: string): string {
  return `.${normalizeWaveformFormat(format) || 'bin'}`;
}

function ensureWaveformFilename(filename: string, format: string): string {
  const trimmed = basenameFromPath(filename);
  if (!trimmed) return '';
  if (/\.[a-z0-9]+$/i.test(trimmed)) return trimmed;
  return `${trimmed}${getWaveformExtension(format)}`;
}

function inferChannelFromText(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value || '').toUpperCase();
    const match = text.match(/\bCH([1-8])\b/);
    if (match) return `CH${match[1]}`;
  }
  return '';
}

function sanitizeIdentifier(text: string, fallback = 'result'): string {
  const cleaned = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\b(query|read|get|fetch|current|value|values|result|results|save as|variable)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  if (!cleaned) return fallback;
  return /^[a-z_]/.test(cleaned) ? cleaned : `v_${cleaned}`;
}

function inferQuerySaveAs(step: JsonRecord, params: JsonRecord): string {
  const explicit = pickText(
    params.saveAs,
    params.outputVariable,
    step.saveAs,
    step.outputVariable,
    step.variable
  );
  if (explicit) return sanitizeIdentifier(explicit, 'result');

  const label = pickText(step.label, step.name, step.title);
  if (label) {
    const candidate = sanitizeIdentifier(label, '');
    if (candidate) return candidate;
  }

  const command = pickText(params.command, params.query, step.command);
  if (/\*IDN\?/i.test(command)) return 'idn';
  if (/\bALLEV\?/i.test(command)) return 'errors';
  if (/\*ESR\?/i.test(command)) return 'esr';
  if (/\*OPC\?/i.test(command)) return 'opc';

  const measMatch = command.match(/MEAS(?:UREMENT)?:MEAS(\d+)/i);
  if (measMatch) return `meas${measMatch[1]}_result`;

  const header = command.split(/[?\s]/)[0] || '';
  return sanitizeIdentifier(header.replace(/:/g, '_'), 'result');
}

function normalizeStep(raw: unknown): JsonRecord | null {
  const parsed = parseJsonValueString(raw);
  const step = toRecord(parsed);
  if (!step) return null;

  const type = canonicalStepType(step.type || step.stepType || '');
  const params =
    step.params && typeof step.params === 'object' && !Array.isArray(step.params)
      ? ({ ...(step.params as JsonRecord) } as JsonRecord)
      : {};
  const label = pickText(step.label, step.name, step.title);

  if (!params.command && typeof step.command === 'string') {
    params.command = step.command;
  }
  if (!params.command && typeof params.query === 'string') {
    params.command = params.query;
  }
  if (!params.code && typeof step.code === 'string') {
    params.code = step.code;
  }
  if (!params.code && typeof params.command === 'string' && type === 'tm_device_command') {
    params.code = params.command;
    delete params.command;
  }
  if (!params.format && typeof params.fileFormat === 'string') {
    params.format = String(params.fileFormat).toLowerCase();
  }
  if (!params.format && typeof step.format === 'string') {
    params.format = String(step.format).toLowerCase();
  }
  if (!params.filename && typeof step.filename === 'string') {
    params.filename = step.filename;
  }
  if (!params.filename && typeof params.file_path === 'string') {
    params.filename = params.file_path;
  }
  if (!params.filename && typeof params.filePath === 'string' && type !== 'recall') {
    params.filename = params.filePath;
  }
  if (!params.filename && typeof step.file_path === 'string') {
    params.filename = step.file_path;
  }
  if (!params.filename && typeof step.filePath === 'string' && type !== 'recall') {
    params.filename = step.filePath;
  }
  if (!params.source && typeof step.source === 'string') {
    params.source = step.source;
  }
  if (!params.source && typeof params.channel === 'string') {
    params.source = params.channel;
  }
  if (!params.method && typeof step.method === 'string') {
    params.method = step.method;
  }
  if (!params.scopeType && typeof step.scopeType === 'string') {
    params.scopeType = step.scopeType;
  }
  if (type === 'python' && typeof params.code !== 'string' && typeof params.source === 'string') {
    params.code = params.source;
    delete params.source;
  }

  const normalized: JsonRecord = {
    ...step,
    type,
    params,
  };

  if (label) {
    normalized.label = label;
  } else if (type) {
    normalized.label = humanizeType(type);
  }
  delete normalized.name;
  delete normalized.title;

  if (type === 'connect') {
    const instrumentId = pickText(params.instrumentId, step.instrumentId);
    if (!Array.isArray(params.instrumentIds)) {
      params.instrumentIds = instrumentId ? [instrumentId] : [];
    }
    if (!Object.prototype.hasOwnProperty.call(params, 'printIdn')) {
      params.printIdn = true;
    }
  }

  if (type === 'disconnect') {
    const instrumentId = pickText(params.instrumentId, step.instrumentId);
    if (!Array.isArray(params.instrumentIds)) {
      params.instrumentIds = instrumentId ? [instrumentId] : [];
    }
  }

  if (type === 'sleep') {
    params.duration =
      parseOptionalNumber(params.duration) ??
      parseOptionalNumber(params.seconds) ??
      parseOptionalNumber(step.seconds) ??
      0.5;
  }

  if (type === 'query') {
    params.saveAs = inferQuerySaveAs(step, params);
  }

  if (type === 'save_screenshot') {
    const screenshotFilename = pickText(params.filename, step.filename);
    params.filename = basenameFromPath(screenshotFilename) || 'screenshot.png';
    params.scopeType = pickText(params.scopeType, step.scopeType) || 'modern';
    params.method = pickText(params.method, step.method) || 'pc_transfer';
  }

  if (type === 'save_waveform') {
    const filenameCandidate = pickText(params.filename, step.filename);
    const filenameBase = basenameFromPath(filenameCandidate);
    const extensionMatch = filenameBase.match(/\.([a-z0-9]+)$/i);
    const extensionFormat = extensionMatch ? normalizeWaveformFormat(extensionMatch[1]) : '';
    const explicitFormat = normalizeWaveformFormat(params.format);
    const format = extensionFormat || explicitFormat || 'bin';
    const source =
      inferChannelFromText(params.source, params.channel, params.trace, filenameBase, label) || 'CH1';
    params.source = source;
    params.format = format;
    params.filename =
      ensureWaveformFilename(filenameBase, format) || `${source.toLowerCase()}.${format}`;
  }

  if (type === 'recall') {
    if (!params.filePath) {
      const filePath = pickText(params.filePath, step.filePath, params.filename, step.filename);
      if (filePath) params.filePath = filePath;
    }
  }

  delete params.query;
  delete params.outputVariable;
  delete params.variable;
  delete params.seconds;
  delete params.file_path;
  if (type !== 'recall') {
    delete params.filePath;
  }
  delete params.fileFormat;
  delete params.channel;
  delete params.trace;

  if (type === 'group') {
    const rawChildren = Array.isArray(step.children)
      ? step.children
      : Array.isArray(params.steps)
        ? params.steps
        : [];
    if (normalized.params && typeof normalized.params === 'object' && !Array.isArray(normalized.params)) {
      delete (normalized.params as JsonRecord).steps;
    } else {
      normalized.params = {};
    }
    normalized.children = rawChildren
      .map((child) => normalizeStep(child))
      .filter((child): child is JsonRecord => Boolean(child));
  }

  return normalized;
}

function normalizeAction(raw: unknown): JsonRecord[] {
  const parsed = parseJsonValueString(raw);
  const action = toRecord(parsed);
  if (!action) return [];

  const type = String(action.action_type || action.type || '').trim();
  const payload = toRecord(action.payload) || {};
  const targetStepId =
    typeof action.targetStepId === 'string'
      ? action.targetStepId
      : typeof action.stepId === 'string'
        ? action.stepId
        : typeof action.target_step_id === 'string'
          ? action.target_step_id
          : null;

  if (type === 'set_step_param') {
    const param =
      typeof action.param === 'string'
        ? action.param
        : typeof payload.param === 'string'
          ? payload.param
          : '';
    const value = Object.prototype.hasOwnProperty.call(action, 'value')
      ? action.value
      : payload.value;
    if (param === 'params') {
      const paramsObject = toRecord(parseJsonValueString(value));
      if (!paramsObject) return [];
      return Object.entries(paramsObject).map(([childParam, childValue]) => ({
        type: 'set_step_param',
        targetStepId,
        param: childParam,
        value: childValue,
      }));
    }
    return [{
      type,
      targetStepId,
      param,
      value,
    }];
  }

  if (type === 'insert_step_after' || type === 'replace_step') {
    const rawNewStep = action.newStep ?? payload.newStep ?? payload.new_step;
    const newStep = normalizeStep(rawNewStep);
    const allowPython =
      action.allow_python === true ||
      action.allowPython === true ||
      payload.allow_python === true ||
      payload.allowPython === true;
    if (newStep && allowPython && newStep.type === 'python') {
      newStep.allow_python = true;
    }
    return [{
      type,
      targetStepId,
      newStep: newStep || parseJsonValueString(rawNewStep),
      ...(allowPython ? { allow_python: true } : {}),
    }];
  }

  if (type === 'move_step') {
    const targetGroupId =
      typeof action.targetGroupId === 'string'
        ? action.targetGroupId
        : typeof action.target_group_id === 'string'
          ? action.target_group_id
          : typeof payload.target_group_id === 'string'
            ? payload.target_group_id
            : null;
    const position =
      typeof action.position === 'number'
        ? action.position
        : typeof payload.position === 'number'
          ? payload.position
          : undefined;
    return [{
      type,
      targetStepId,
      targetGroupId,
      ...(position !== undefined ? { position } : {}),
    }];
  }

  if (type === 'replace_flow') {
    const flowCandidate = parseJsonValueString(action.flow ?? payload.flow);
    const flow = toRecord(flowCandidate);
    const flowStepsCandidate =
      Array.isArray(action.steps) ? action.steps : Array.isArray(payload.steps) ? payload.steps : null;
    const normalizedFlow =
      flow && Array.isArray(flow.steps)
        ? {
            ...flow,
            steps: (flow.steps as unknown[])
              .map((step) => normalizeStep(step))
              .filter((step): step is JsonRecord => Boolean(step)),
          }
        : flowStepsCandidate
          ? {
              name: 'Generated Flow',
              description: 'Generated by assistant',
              backend: 'pyvisa',
              deviceType: 'SCOPE',
              steps: flowStepsCandidate
                .map((step) => normalizeStep(step))
                .filter((step): step is JsonRecord => Boolean(step)),
            }
          : null;
    return normalizedFlow ? [{ type, flow: normalizedFlow }] : [];
  }

  if (type === 'remove_step' || type === 'add_error_check_after_step' || type === 'replace_sleep_with_opc_query') {
    return [{
      type,
      targetStepId,
    }];
  }

  return [action];
}

export function normalizeActionsJsonPayload(input: Record<string, unknown>): Record<string, unknown> {
  const result = toRecord(input.result) || {};
  const sourceActions = Array.isArray(input.actions)
    ? input.actions
    : Array.isArray(result.actions)
      ? result.actions
      : [];

  const normalizedActions = sourceActions.flatMap((action) => normalizeAction(action));

  return {
    summary:
      typeof input.summary === 'string'
        ? input.summary
        : typeof result.summary === 'string'
          ? result.summary
          : 'Proposed actionable fixes.',
    findings: toTextList(input.findings ?? result.findings),
    suggestedFixes: toTextList(input.suggestedFixes ?? result.suggestedFixes),
    actions: normalizedActions,
  };
}
