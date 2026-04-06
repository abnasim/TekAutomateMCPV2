import { validateActionPayload } from '../tools/validateActionPayload';
import { verifyScpiCommands } from '../tools/verifyScpiCommands';
import { getCommandIndex } from './commandIndex';
import { extractReplaceFlowSteps } from './schemas';
import { normalizeActionsJsonPayload, parseJsonValueString } from './actionNormalizer';

function splitCommands(raw: string): string[] {
  return raw
    .split(/\s*;\s*/)
    .map((cmd) => cmd.split(/[\s,]/)[0].trim())
    .filter(Boolean);
}

const ALWAYS_VALID_PREFIXES = [
  '*',
];

export interface PostCheckResult {
  ok: boolean;
  text: string;
  errors: string[];
  warnings?: string[];
}

export interface PostCheckOptions {
  allowMissingActionsJson?: boolean;
  /** When true, use lenient pipeline for assistant output: normalize action shape before apply validation. */
  assistantMode?: boolean;
  /** Hosted Responses tool trace for this turn, used to hard-gate applyable SCPI output. */
  toolTrace?: Array<Record<string, unknown>>;
}

function rebuildTextWithActionsJson(text: string, actionsJson: Record<string, unknown>): string {
  const prose = text.replace(/ACTIONS_JSON:[\s\S]*$/i, '').trim();
  const block = `ACTIONS_JSON: ${JSON.stringify(actionsJson)}`;
  return prose ? `${prose}\n\n${block}` : block;
}

function isLongFlatFlow(steps: Array<Record<string, unknown>>): boolean {
  if (!Array.isArray(steps) || steps.length < 8) return false;
  const hasGroup = steps.some((s) => String(s.type || '').toLowerCase() === 'group');
  const hasNested = steps.some((s) => Array.isArray(s.children) && s.children.length > 0);
  return !hasGroup && !hasNested;
}

function classifyPhase(step: Record<string, unknown>): string {
  const type = String(step.type || '').toLowerCase();
  const params = (step.params || {}) as Record<string, unknown>;
  const cmd = String(params.command || '').toLowerCase();
  if (/measurement:immed:/.test(cmd)) return 'Measurements';
  if (type === 'query') return 'Read Results';
  if (type === 'save_screenshot' || type === 'save_waveform' || /save|hardcopy|filesystem|export/.test(cmd)) return 'Save Results';
  if (/\*rst|\*cls|recall|preset|clear/.test(cmd)) return 'Setup';
  if (/measurement:meas\d+:source\d?\b|measurement:addmeas\b|meas|measure/.test(cmd)) return 'Measurements';
  if (/math:|display:waveview\d+:math:|display:global:math\d+:state/.test(cmd)) return 'Math / Differential Setup';
  if (/display:waveview|ch\d|ref\d|bus/.test(cmd)) return 'Channel / Bus Configuration';
  if (/trig|trigger/.test(cmd)) return 'Trigger';
  if (/acq|acquire|horizontal:|hor:/.test(cmd)) return 'Acquisition';
  if (type === 'error_check') return 'Validation / Error Check';
  return 'Operation';
}

function groupFlatFlowSteps(steps: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const leadingConnect: Array<Record<string, unknown>> = [];
  const trailingDisconnect: Array<Record<string, unknown>> = [];
  const body: Array<Record<string, unknown>> = [];

  let i = 0;
  while (i < steps.length && String(steps[i].type || '').toLowerCase() === 'connect') {
    leadingConnect.push(steps[i]);
    i += 1;
  }
  let j = steps.length - 1;
  while (j >= i && String(steps[j].type || '').toLowerCase() === 'disconnect') {
    trailingDisconnect.unshift(steps[j]);
    j -= 1;
  }
  for (let k = i; k <= j; k += 1) body.push(steps[k]);

  const phaseOrder: string[] = [];
  const byPhase = new Map<string, Array<Record<string, unknown>>>();
  body.forEach((step) => {
    const phase = classifyPhase(step);
    if (!byPhase.has(phase)) {
      byPhase.set(phase, []);
      phaseOrder.push(phase);
    }
    byPhase.get(phase)!.push(step);
  });

  const canonicalPhaseOrder = [
    'Setup',
    'Channel / Bus Configuration',
    'Math / Differential Setup',
    'Trigger',
    'Acquisition',
    'Measurements',
    'Read Results',
    'Save Results',
    'Validation / Error Check',
    'Operation',
  ];
  const orderedPhases = [...phaseOrder].sort((left, right) => {
    const leftIdx = canonicalPhaseOrder.indexOf(left);
    const rightIdx = canonicalPhaseOrder.indexOf(right);
    const safeLeft = leftIdx === -1 ? canonicalPhaseOrder.length : leftIdx;
    const safeRight = rightIdx === -1 ? canonicalPhaseOrder.length : rightIdx;
    return safeLeft - safeRight;
  });

  const grouped = orderedPhases.map((phase, idx) => ({
    id: `g_auto_${idx + 1}`,
    type: 'group',
    label: phase,
    params: {},
    collapsed: false,
    children: byPhase.get(phase) || [],
  }));

  return [...leadingConnect, ...grouped, ...trailingDisconnect];
}

function upsertSuggestedFix(actionsJson: Record<string, unknown>, message: string): void {
  const current = Array.isArray(actionsJson.suggestedFixes) ? (actionsJson.suggestedFixes as unknown[]) : [];
  const next = current.map((x) => String(x));
  if (!next.includes(message)) next.push(message);
  actionsJson.suggestedFixes = next;
}

function upsertFinding(actionsJson: Record<string, unknown>, message: string): void {
  const current = Array.isArray(actionsJson.findings) ? (actionsJson.findings as unknown[]) : [];
  const next = current.map((x) => String(x));
  if (!next.includes(message)) next.push(message);
  actionsJson.findings = next;
}

function normalizeOpcCheckCommand(command: string): string {
  return String(command || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function isSingleSequenceStopAfterCommand(command: string): boolean {
  return /^ACQUIRE:STOPAFTER\s+SEQUENCE\b/.test(normalizeOpcCheckCommand(command));
}

function isAcquireStateRunCommand(command: string): boolean {
  return /^ACQUIRE:STATE\s+(RUN|ON|1)\b/.test(normalizeOpcCheckCommand(command));
}

function isManualOpcEligibleCommand(command: string, hasSingleSequence: boolean): boolean {
  const normalized = normalizeOpcCheckCommand(command);
  if (isAcquireStateRunCommand(normalized)) return hasSingleSequence;
  return (
    /^AUTOSET(\s|:).*EXECUTE\b/.test(normalized) ||
    /^CALIBRATE:INTERNAL(:START)?\b/.test(normalized) ||
    /^CALIBRATE:FACTORY\s+(START|CONTINUE|PREVIOUS)\b/.test(normalized) ||
    /^CH[1-8]:PROBE:(AUTOZERO|DEGAUSS)\s+EXECUTE\b/.test(normalized) ||
    /^DIAG:STATE\s+EXECUTE\b/.test(normalized) ||
    /^FACTORY\b/.test(normalized) ||
    /^RECALL:SETUP\b/.test(normalized) ||
    /^RECALL:WAVEFORM\b/.test(normalized) ||
    /^\*RST\b/.test(normalized) ||
    /^SAVE:IMAGE\b/.test(normalized) ||
    /^SAVE:SETUP\b/.test(normalized) ||
    /^SAVE:WAVEFORM\b/.test(normalized) ||
    /^TEKSECURE\b/.test(normalized) ||
    /^TRIGGER:A\s+SETLEVEL\b/.test(normalized)
  );
}

function sanitizeSuggestedFixes(actionsJson: Record<string, unknown>): boolean {
  const current = Array.isArray(actionsJson.suggestedFixes)
    ? (actionsJson.suggestedFixes as unknown[]).map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  if (!current.length) return false;

  const conversationalPattern =
    /^(if you tell me|if you share|if you provide|if you want,?\s*i can|i can .* if you|let me know and i can)\b/i;
  const filtered = current.filter((line) => !conversationalPattern.test(line));

  if (filtered.length === current.length) return false;
  actionsJson.suggestedFixes = filtered;
  return true;
}

function hasHostedToolCall(
  toolTrace: Array<Record<string, unknown>> | undefined,
  names: string[]
): boolean {
  if (!Array.isArray(toolTrace) || toolTrace.length === 0) return false;
  const allowed = new Set(names.map((name) => String(name)));
  return toolTrace.some((entry) => allowed.has(String(entry.name || '')));
}

function shouldHardGateHostedScpiApply(
  assistantMode: boolean,
  backend: string | undefined,
  commands: string[],
  toolTrace: Array<Record<string, unknown>> | undefined
): boolean {
  // Disabled by product decision: do not block apply based on hosted tool-call materialization/verification.
  void assistantMode;
  void backend;
  void commands;
  void toolTrace;
  return false;
}

function isHostedPreverifiedScpiCommand(command: string): boolean {
  const header = String(command || '')
    .split('?')[0]
    .trim()
    .split(/\s+/)[0]
    .toLowerCase();
  if (!header) return false;
  return (
    header.startsWith('ch') ||
    header.startsWith('trigger:a:') ||
    header.startsWith('trigger:b:') ||
    header.startsWith('horizontal:') ||
    header.startsWith('acquire:') ||
    header.startsWith('measurement:addmeas') ||
    /^measurement:meas\d+:source\d?$/i.test(header) ||
    /^measurement:meas\d+:results:currentacq:mean$/i.test(header) ||
    header.startsWith('*')
  );
}

function ensureReplaceFlowStepIds(actionsJson: Record<string, unknown>): boolean {
  const actions = Array.isArray(actionsJson.actions)
    ? (actionsJson.actions as Array<Record<string, unknown>>)
    : [];
  if (!actions.length) return false;

  let changed = false;

  actions.forEach((action, actionIndex) => {
    const actionType = String(action.action_type || action.type || '');
    if (actionType !== 'replace_flow') return;

    const steps = extractReplaceFlowSteps(action);
    if (!Array.isArray(steps) || !steps.length) return;

    let seq = 1;
    const seen = new Set<string>();

    const assignIds = (nodes: Array<Record<string, unknown>>, prefix = `s${actionIndex + 1}`) => {
      nodes.forEach((node) => {
        const type = String(node.type || '').toLowerCase();
        const isGroup = type === 'group';
        const basePrefix = isGroup ? `g${actionIndex + 1}` : prefix;
        const currentId = String(node.id || '').trim();
        const needsNewId = !currentId || seen.has(currentId);
        if (needsNewId) {
          let candidate = `${basePrefix}_${seq++}`;
          while (seen.has(candidate)) {
            candidate = `${basePrefix}_${seq++}`;
          }
          node.id = candidate;
          seen.add(candidate);
          changed = true;
        } else {
          seen.add(currentId);
        }

        if (Array.isArray(node.children) && node.children.length) {
          assignIds(node.children as Array<Record<string, unknown>>, `s${actionIndex + 1}`);
        }
      });
    };

    assignIds(steps);
  });

  return changed;
}

function ensureIncrementalActionStepIds(actionsJson: Record<string, unknown>): boolean {
  const actions = Array.isArray(actionsJson.actions)
    ? (actionsJson.actions as Array<Record<string, unknown>>)
    : [];
  if (!actions.length) return false;

  const seen = new Set<string>();
  let changed = false;
  let seq = 1;

  const nextId = (prefix = 's_fix'): string => {
    let candidate = `${prefix}_${seq++}`;
    while (seen.has(candidate)) {
      candidate = `${prefix}_${seq++}`;
    }
    seen.add(candidate);
    return candidate;
  };

  const reserveExistingIds = (nodes: Array<Record<string, unknown>>) => {
    nodes.forEach((node) => {
      const id = String(node.id || '').trim();
      if (id) seen.add(id);
      if (Array.isArray(node.children) && node.children.length) {
        reserveExistingIds(node.children as Array<Record<string, unknown>>);
      }
    });
  };

  actions.forEach((action) => {
    const actionType = String(action.action_type || action.type || '').toLowerCase();
    if (actionType !== 'replace_flow') return;
    const steps = extractReplaceFlowSteps(action);
    if (Array.isArray(steps) && steps.length) reserveExistingIds(steps);
  });

  const assignNodeIds = (node: Record<string, unknown>) => {
    const currentId = String(node.id || '').trim();
    if (!currentId || seen.has(currentId)) {
      node.id = nextId(String(node.type || '').toLowerCase() === 'group' ? 'g_fix' : 's_fix');
      changed = true;
    } else {
      seen.add(currentId);
    }
    if (Array.isArray(node.children) && node.children.length) {
      (node.children as Array<Record<string, unknown>>).forEach((child) => assignNodeIds(child));
    }
  };

  actions.forEach((action) => {
    const actionType = String(action.action_type || action.type || '').toLowerCase();
    if (actionType !== 'insert_step_after' && actionType !== 'replace_step') return;

    const payload =
      action.payload && typeof action.payload === 'object'
        ? (action.payload as Record<string, unknown>)
        : {};
    const newStep = parseJsonValueString(action.newStep || payload.new_step || payload.newStep) as
      | Record<string, unknown>
      | undefined;
    if (!newStep) return;

    assignNodeIds(newStep);

    if (typeof action.newStep === 'string' || Object.prototype.hasOwnProperty.call(action, 'newStep')) {
      action.newStep = newStep;
    } else if (Object.prototype.hasOwnProperty.call(payload, 'new_step')) {
      payload.new_step = newStep;
      action.payload = payload;
    } else if (Object.prototype.hasOwnProperty.call(payload, 'newStep')) {
      payload.newStep = newStep;
      action.payload = payload;
    }
  });

  return changed;
}

function ensureReplaceFlowUniqueSaveAs(actionsJson: Record<string, unknown>): boolean {
  const actions = Array.isArray(actionsJson.actions)
    ? (actionsJson.actions as Array<Record<string, unknown>>)
    : [];
  if (!actions.length) return false;

  let changed = false;
  const used = new Set<string>();

  const normalizeKey = (value: string): string => value.trim().toLowerCase();

  const dedupeName = (raw: string): string => {
    const base = raw.trim() || 'result';
    const baseKey = normalizeKey(base);
    if (!used.has(baseKey)) {
      used.add(baseKey);
      return base;
    }
    let idx = 2;
    let candidate = `${base}_${idx}`;
    while (used.has(normalizeKey(candidate))) {
      idx += 1;
      candidate = `${base}_${idx}`;
    }
    used.add(normalizeKey(candidate));
    changed = true;
    return candidate;
  };

  const visit = (nodes: Array<Record<string, unknown>>) => {
    nodes.forEach((node) => {
      const type = String(node.type || '').toLowerCase();
      const params =
        node.params && typeof node.params === 'object' && !Array.isArray(node.params)
          ? (node.params as Record<string, unknown>)
          : null;
      if (params && (type === 'query' || type === 'set_and_query')) {
        const current = typeof params.saveAs === 'string' ? params.saveAs : '';
        if (!current.trim()) {
          params.saveAs = dedupeName('result');
          changed = true;
        } else {
          const next = dedupeName(current);
          if (next !== current) params.saveAs = next;
        }
      }
      if (Array.isArray(node.children) && node.children.length) {
        visit(node.children as Array<Record<string, unknown>>);
      }
    });
  };

  actions.forEach((action) => {
    const actionType = String(action.action_type || action.type || '');
    if (actionType !== 'replace_flow') return;
    const steps = extractReplaceFlowSteps(action);
    if (Array.isArray(steps) && steps.length) visit(steps);
  });

  return changed;
}

function collectExistingSaveAsFromSteps(steps: Array<Record<string, unknown>>): Set<string> {
  const used = new Set<string>();
  const walk = (nodes: Array<Record<string, unknown>>) => {
    nodes.forEach((node) => {
      const params =
        node.params && typeof node.params === 'object' && !Array.isArray(node.params)
          ? (node.params as Record<string, unknown>)
          : null;
      if (params && typeof params.saveAs === 'string' && params.saveAs.trim()) {
        used.add(params.saveAs.trim().toLowerCase());
      }
      if (Array.isArray(node.children) && node.children.length) {
        walk(node.children as Array<Record<string, unknown>>);
      }
    });
  };
  walk(steps);
  return used;
}

function synthesizeApplyActionsFromSuggestions(
  actionsJson: Record<string, unknown>,
  originalSteps?: Array<Record<string, unknown>>
): boolean {
  const actions = Array.isArray(actionsJson.actions)
    ? (actionsJson.actions as Array<Record<string, unknown>>)
    : [];
  if (actions.length > 0) return false;
  if (!Array.isArray(originalSteps) || !originalSteps.length) return false;

  const suggestions = Array.isArray(actionsJson.suggestedFixes)
    ? (actionsJson.suggestedFixes as unknown[]).map((item) => String(item || '')).filter(Boolean)
    : [];
  if (!suggestions.length) return false;

  const wantsOpc = suggestions.some((line) => /\badd\b[\s\S]*\*?\s*opc\?/i.test(line) || /\badd\b[\s\S]*\bopc\b/i.test(line));
  if (!wantsOpc) return false;

  const flat: Array<Record<string, unknown>> = [];
  const flatten = (nodes: Array<Record<string, unknown>>) => {
    nodes.forEach((node) => {
      flat.push(node);
      if (Array.isArray(node.children) && node.children.length) {
        flatten(node.children as Array<Record<string, unknown>>);
      }
    });
  };
  flatten(originalSteps);

  const hasSingleSequence = flat.some((step) => {
    const type = String(step.type || '').toLowerCase();
    if (type !== 'write' && type !== 'set_and_query') return false;
    const params =
      step.params && typeof step.params === 'object' && !Array.isArray(step.params)
        ? (step.params as Record<string, unknown>)
        : null;
    return isSingleSequenceStopAfterCommand(String(params?.command || ''));
  });

  const hasOpcCapableOperation = flat.some((step) => {
    const type = String(step.type || '').toLowerCase();
    if (type !== 'write' && type !== 'set_and_query' && type !== 'query') return false;
    const params =
      step.params && typeof step.params === 'object' && !Array.isArray(step.params)
        ? (step.params as Record<string, unknown>)
        : null;
    const command = String(params?.command || '');
    if (!command) return false;
    return isManualOpcEligibleCommand(command, hasSingleSequence);
  });
  if (!hasOpcCapableOperation) return false;

  const pickTargetId = (): string => {
    const withId = flat.filter((step) => typeof step.id === 'string' && String(step.id || '').trim());
    const lastEligibleWrite = [...withId].reverse().find((step) => {
      const type = String(step.type || '').toLowerCase();
      if (type !== 'write' && type !== 'set_and_query') return false;
      const params =
        step.params && typeof step.params === 'object' && !Array.isArray(step.params)
          ? (step.params as Record<string, unknown>)
          : null;
      return isManualOpcEligibleCommand(String(params?.command || ''), hasSingleSequence);
    });
    if (lastEligibleWrite?.id) return String(lastEligibleWrite.id);

    const lastConnect = [...withId].reverse().find((step) => String(step.type || '').toLowerCase() === 'connect');
    if (lastConnect?.id) return String(lastConnect.id);

    const lastNonDisconnect = [...withId].reverse().find((step) => String(step.type || '').toLowerCase() !== 'disconnect');
    if (lastNonDisconnect?.id) return String(lastNonDisconnect.id);

    return withId.length ? String(withId[withId.length - 1].id) : '';
  };

  const targetId = pickTargetId();
  if (!targetId) return false;

  const usedSaveAs = collectExistingSaveAsFromSteps(originalSteps);
  let saveAs = 'opc';
  let idx = 2;
  while (usedSaveAs.has(saveAs.toLowerCase())) {
    saveAs = `opc_${idx}`;
    idx += 1;
  }

  actionsJson.actions = [
    {
      id: mkId('a_opc'),
      type: 'insert_step_after',
      targetStepId: targetId,
      newStep: {
        id: mkId('s_opc'),
        type: 'query',
        label: 'Query OPC',
        params: {
          command: '*OPC?',
          saveAs,
        },
      },
    },
  ];
  upsertFinding(actionsJson, 'Converted suggestion into an applyable action.');
  upsertSuggestedFix(actionsJson, 'Applied suggestion as an insert_step_after action for *OPC? query.');
  return true;
}

/** Normalize assistant-style actions (action_type, target_step_id, payload.new_step) for frontend and validator. */
function normalizeAssistantActions(actionsJson: Record<string, unknown>): void {
  const normalized = normalizeActionsJsonPayload(actionsJson);
  actionsJson.summary = normalized.summary;
  actionsJson.findings = normalized.findings;
  actionsJson.suggestedFixes = normalized.suggestedFixes;
  actionsJson.actions = normalized.actions;
}

async function filterInvalidAssistantActions(
  actionsJson: Record<string, unknown>,
  originalSteps?: Array<Record<string, unknown>>
): Promise<void> {
  const actions = Array.isArray(actionsJson.actions)
    ? (actionsJson.actions as Array<Record<string, unknown>>)
    : [];
  if (!actions.length) return;

  const kept: Array<Record<string, unknown>> = [];
  const droppedDetails: string[] = [];

  for (const action of actions) {
    const candidate = {
      summary: actionsJson.summary,
      findings: actionsJson.findings,
      suggestedFixes: actionsJson.suggestedFixes,
      actions: [action],
    };
    const payloadValidation = await validateActionPayload({
      actionsJson: candidate,
      originalSteps,
    });
    const validData = payloadValidation.data as { valid: boolean; errors: string[] };
    if (validData.valid) {
      kept.push(action);
      continue;
    }
    droppedDetails.push(...validData.errors.slice(0, 3));
  }

  if (kept.length === actions.length) return;

  actionsJson.actions = kept;
  upsertFinding(
    actionsJson,
    'Assistant returned JSON that did not fully map to valid TekAutomate steps, so invalid apply actions were removed.'
  );
  if (droppedDetails.length) {
    upsertSuggestedFix(
      actionsJson,
      `Use only real TekAutomate step types and schema-valid actions. Removed invalid items: ${Array.from(new Set(droppedDetails)).join('; ')}`
    );
  }
}

function mkId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function splitCommandParts(raw: string): string[] {
  return String(raw || '')
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function enforceConcatCapInSteps(
  steps: Array<Record<string, unknown>>,
  cap = 3
): { steps: Array<Record<string, unknown>>; changed: boolean } {
  let changed = false;
  const out = steps.flatMap((step) => {
    const base = { ...step };
    if (Array.isArray(base.children)) {
      const nested = enforceConcatCapInSteps(base.children as Array<Record<string, unknown>>, cap);
      base.children = nested.steps;
      if (nested.changed) changed = true;
    }

    const type = String(base.type || '').toLowerCase();
    if (!['write', 'query', 'set_and_query'].includes(type)) return [base];
    const params = (base.params || {}) as Record<string, unknown>;
    const command = String(params.command || '');
    const parts = splitCommandParts(command);
    if (parts.length <= cap) return [base];

    changed = true;
    const baseLabel = String(base.label || 'Command').replace(/\s+\(\d+\/\d+\)$/i, '');
    const children = parts.map((cmd, idx) => ({
      ...base,
      id: idx === 0 && typeof base.id === 'string' ? base.id : mkId('cmd'),
      label: baseLabel,
      params: { ...params, command: cmd },
      children: undefined,
    }));
    return [{
      id: mkId('g_concat'),
      type: 'group',
      label: baseLabel,
      params: {},
      collapsed: false,
      children,
    }];
  });
  return { steps: out, changed };
}

function isMeasurementAddOrSource(step: Record<string, unknown>): boolean {
  const type = String(step.type || '').toLowerCase();
  if (!['write', 'set_and_query'].includes(type)) return false;
  const cmd = String(((step.params || {}) as Record<string, unknown>).command || '').toLowerCase();
  return /measurement:addmeas\b/.test(cmd) || /measurement:meas\d+:sour(?:ce)?\d*\b/.test(cmd);
}

function isMeasurementResultQuery(step: Record<string, unknown>): boolean {
  const type = String(step.type || '').toLowerCase();
  if (type !== 'query') return false;
  const cmd = String(((step.params || {}) as Record<string, unknown>).command || '').toLowerCase();
  return /measurement:meas\d+:.+\?/.test(cmd) && /(results|curr|mean|value|pk2pk|rms|max|min)/.test(cmd);
}

function enforceMeasurementGroupingInSteps(
  steps: Array<Record<string, unknown>>
): { steps: Array<Record<string, unknown>>; changed: boolean } {
  let changed = false;
  const normalized = steps.map((step) => {
    if (!Array.isArray(step.children)) return step;
    const nested = enforceMeasurementGroupingInSteps(step.children as Array<Record<string, unknown>>);
    if (nested.changed) changed = true;
    return { ...step, children: nested.steps };
  });

  const hasCanonicalGroups = normalized.some((s) => {
    const t = String(s.type || '').toLowerCase();
    const lbl = String(s.label || '').toLowerCase();
    return t === 'group' && (lbl.includes('add measurements') || lbl.includes('read results'));
  });
  if (hasCanonicalGroups) return { steps: normalized, changed };

  const addIdx: number[] = [];
  const readIdx: number[] = [];
  normalized.forEach((s, idx) => {
    if (String(s.type || '').toLowerCase() === 'group') return;
    if (isMeasurementAddOrSource(s)) addIdx.push(idx);
    else if (isMeasurementResultQuery(s)) readIdx.push(idx);
  });
  if (addIdx.length < 2 || readIdx.length < 1) return { steps: normalized, changed };

  const addSet = new Set(addIdx);
  const readSet = new Set(readIdx);
  const firstIdx = Math.min(...addIdx, ...readIdx);
  const out: Array<Record<string, unknown>> = [];
  const addChildren = addIdx.map((i) => normalized[i]);
  const readChildren = readIdx.map((i) => normalized[i]);

  normalized.forEach((s, idx) => {
    if (idx === firstIdx) {
      out.push({
        id: mkId('g_meas_add'),
        type: 'group',
        label: 'Add Measurements',
        params: {},
        collapsed: false,
        children: addChildren,
      });
      out.push({
        id: mkId('g_meas_read'),
        type: 'group',
        label: 'Read Results',
        params: {},
        collapsed: false,
        children: readChildren,
      });
    }
    if (addSet.has(idx) || readSet.has(idx)) return;
    out.push(s);
  });
  return { steps: out, changed: true };
}

function extractActionsJson(text: string): Record<string, unknown> | null {
  const rawTrim = text.trim();
  // Assistant often returns raw JSON only (no ACTIONS_JSON marker).
  if (rawTrim.startsWith('{')) {
    try {
      const parsed = JSON.parse(rawTrim) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.actions)) {
        return parsed;
      }
    } catch {
      // fall through
    }
  }

  // Strip any fences wrapping ACTIONS_JSON
  const cleaned = text
    .replace(/ACTIONS_JSON:\s*```json\s*/gi, 'ACTIONS_JSON: ')
    .replace(/ACTION_JSON:\s*```json\s*/gi, 'ACTIONS_JSON: ')
    .replace(/ACTION_JSON:/gi, 'ACTIONS_JSON:')
    .replace(/```\s*(\n|$)/g, '')
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '');

  // Preferred: object payload; find anywhere
  const objMatch = cleaned.match(/ACTIONS_JSON:\s*(\{[\s\S]*\})/);
  if (objMatch) {
    const sub = objMatch[1];
    let depth = 0;
    let end = 0;
    for (let i = 0; i < sub.length; i++) {
      if (sub[i] === '{') depth += 1;
      else if (sub[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end > 0) {
      try {
        return JSON.parse(sub.slice(0, end)) as Record<string, unknown>;
      } catch {
        // fall through to array handling
      }
    }
  }

  // Try parsing from first brace after marker
  const markerIdx = cleaned.search(/ACTIONS_JSON:/i);
  if (markerIdx !== -1) {
    const afterMarker = cleaned.slice(markerIdx + 12).trim();
    const braceStart = afterMarker.indexOf('{');
    if (braceStart !== -1) {
      const sub = afterMarker.slice(braceStart);
      let depth = 0;
      let end = 0;
      for (let i = 0; i < sub.length; i++) {
        if (sub[i] === '{') depth += 1;
        else if (sub[i] === '}') {
          depth -= 1;
          if (depth === 0) {
            end = i + 1;
            break;
          }
        }
      }
      if (end > 0) {
        try {
          return JSON.parse(sub.slice(0, end)) as Record<string, unknown>;
        } catch {
          // fall through
        }
      }
      try {
        const partial = sub.trimEnd().replace(/,\s*$/, '');
        const openBraces = (partial.match(/\{/g) || []).length;
        const closeBraces = (partial.match(/\}/g) || []).length;
        const openBrackets = (partial.match(/\[/g) || []).length;
        const closeBrackets = (partial.match(/\]/g) || []).length;
        const repaired =
          partial +
          ']'.repeat(Math.max(0, openBrackets - closeBrackets)) +
          '}'.repeat(Math.max(0, openBraces - closeBraces));
        return JSON.parse(repaired) as Record<string, unknown>;
      } catch {
        // fall through
      }
    }
  }

  // Fallback: raw array payload -> wrap into minimal ACTIONS_JSON
  const arrMatch = cleaned.match(/ACTIONS_JSON:\s*(\[[\s\S]*\])\s*$/);
  if (arrMatch) {
    try {
      const arr = JSON.parse(arrMatch[1]);
      return {
        summary: 'Actions',
        findings: [],
        suggestedFixes: [],
        actions: Array.isArray(arr) ? arr : [],
      } as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  // If marker exists but parsing failed, return minimal shell
  if (cleaned.match(/ACTIONS_JSON:/i)) {
    return { summary: '', findings: [], suggestedFixes: [], actions: [] };
  }

  // Assistant-mode fallback: accept raw JSON outputs without ACTIONS_JSON marker.
  const tryParseObject = (raw: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };
  const normalizeFlowObject = (flow: Record<string, unknown>): Record<string, unknown> => {
    let seq = 1;
    const mkId = (prefix = 's') => `${prefix}${seq++}`;
    const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const normalizeStep = (rawStep: Record<string, unknown>): Record<string, unknown> => {
      const stepType = String(rawStep.type || 'comment').toLowerCase();
      const inParams =
        rawStep.params && typeof rawStep.params === 'object' && !Array.isArray(rawStep.params)
          ? ({ ...(rawStep.params as Record<string, unknown>) } as Record<string, unknown>)
          : {};
      const out: Record<string, unknown> = {
        id: typeof rawStep.id === 'string' && rawStep.id ? rawStep.id : mkId(stepType === 'group' ? 'g' : 's'),
        type: stepType,
        label:
          typeof rawStep.label === 'string' && rawStep.label
            ? rawStep.label
            : typeof inParams.name === 'string' && inParams.name
              ? String(inParams.name)
              : titleCase(stepType || 'Step'),
        params: inParams,
      };

      if (stepType === 'group') {
        const nested =
          Array.isArray(rawStep.children)
            ? (rawStep.children as Array<Record<string, unknown>>)
            : Array.isArray(inParams.steps)
              ? (inParams.steps as Array<Record<string, unknown>>)
              : [];
        if (Object.prototype.hasOwnProperty.call(out.params as Record<string, unknown>, 'steps')) {
          delete (out.params as Record<string, unknown>).steps;
        }
        if (Object.prototype.hasOwnProperty.call(out.params as Record<string, unknown>, 'name')) {
          delete (out.params as Record<string, unknown>).name;
        }
        out.params = out.params && typeof out.params === 'object' ? out.params : {};
        out.children = nested.map((s) => normalizeStep(s));
      }

      if (stepType === 'python') {
        const p = out.params as Record<string, unknown>;
        if (typeof p.code !== 'string' && typeof p.source === 'string') {
          p.code = p.source;
          delete p.source;
        }
      }

      if (stepType === 'query') {
        const p = out.params as Record<string, unknown>;
        if (typeof p.saveAs !== 'string' || !String(p.saveAs).trim()) {
          p.saveAs = 'result';
        }
      }

      return out;
    };

    const rawSteps = Array.isArray(flow.steps) ? (flow.steps as Array<Record<string, unknown>>) : [];
    return {
      name: String(flow.name || 'Generated Flow'),
      description: String(flow.description || 'Generated by assistant'),
      backend: String(flow.backend || 'pyvisa'),
      deviceType: String(flow.deviceType || 'SCOPE'),
      steps: rawSteps.map((s) => normalizeStep(s)),
    };
  };

  const wrapFlowAsActions = (flow: Record<string, unknown>): Record<string, unknown> => ({
    summary: 'Parsed full flow JSON from assistant output.',
    findings: [],
    suggestedFixes: [],
    actions: [{ type: 'replace_flow', flow: normalizeFlowObject(flow) }],
  });
  const looksLikeFlow = (obj: Record<string, unknown>): boolean => Array.isArray(obj.steps);

  const fenced = cleaned.match(/```json\s*([\s\S]*?)```/i);
  const fencedObj = fenced?.[1] ? tryParseObject(fenced[1].trim()) : null;
  if (fencedObj) {
    if (Array.isArray(fencedObj.actions)) return fencedObj;
    if (looksLikeFlow(fencedObj)) return wrapFlowAsActions(fencedObj);
  }

  const start = cleaned.indexOf('{');
  if (start !== -1) {
    const sub = cleaned.slice(start);
    let depth = 0;
    let end = 0;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < sub.length; i++) {
      const ch = sub[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end > 0) {
      const obj = tryParseObject(sub.slice(0, end));
      if (obj) {
        if (Array.isArray(obj.actions)) return obj;
        if (looksLikeFlow(obj)) return wrapFlowAsActions(obj);
      }
    }
  }

  return null;
}

function collectCommandsFromActions(actionsJson: Record<string, unknown>): string[] {
  const out: string[] = [];
  const actions = Array.isArray(actionsJson.actions)
    ? (actionsJson.actions as Array<Record<string, unknown>>)
    : [];
  actions.forEach((action) => {
    const payload = (action.payload || {}) as Record<string, unknown>;
    const newStep = parseJsonValueString(action.newStep || payload.new_step || payload.newStep) as
      | Record<string, unknown>
      | undefined;
    const actionType = String(action.action_type || action.type || '');
    const replaceFlowSteps = actionType === 'replace_flow' ? extractReplaceFlowSteps(action) : null;
    if (actionType === 'replace_flow' && Array.isArray(replaceFlowSteps)) {
      const walk = (steps: Array<Record<string, unknown>>) => {
        steps.forEach((step) => {
          if (String(step.type || '') === 'tm_device_command') {
            return;
          }
      const params = (step.params || {}) as Record<string, unknown>;
      if (typeof params.command === 'string' && params.command.trim()) {
        splitCommands(params.command).forEach((cmd) => out.push(cmd));
      }
          if (Array.isArray(step.children)) walk(step.children as Array<Record<string, unknown>>);
        });
      };
      walk(replaceFlowSteps);
    }
    if (newStep) {
      if (String(newStep.type || '') === 'tm_device_command') {
        return;
      }
      const params = (newStep.params || {}) as Record<string, unknown>;
      if (typeof params.command === 'string' && params.command.trim()) {
        splitCommands(params.command).forEach((cmd) => out.push(cmd));
      }
    }
  });
  return out;
}

export async function postCheckResponse(
  text: string,
  flowContext?: {
    backend?: string;
    modelFamily?: string;
    originalSteps?: Array<Record<string, unknown>>;
    scpiContext?: Array<Record<string, unknown>>;
    alias?: string;
    instrumentMap?: Array<Record<string, unknown>>;
  },
  options?: PostCheckOptions
): Promise<PostCheckResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let finalText = text;
  let verificationRows: Array<Record<string, unknown>> = [];
  const actionsJson = extractActionsJson(finalText);
  if (!actionsJson) {
    if (options?.allowMissingActionsJson || options?.assistantMode) {
      return { ok: true, text: finalText, errors: [], warnings: [] };
    }
    errors.push('ACTIONS_JSON parse failed');
    return { ok: false, text: finalText, errors };
  }

  // Lenient path: explicit flag or response that looks like assistant output (raw JSON with action_type).
  const rawLooksLikeAssistant =
    finalText.trim().startsWith('{') &&
    Array.isArray(actionsJson.actions) &&
    (actionsJson.actions as Array<Record<string, unknown>>).some(
      (a) => {
        if (!a || typeof a !== 'object') return false;
        const payload = a.payload && typeof a.payload === 'object'
          ? (a.payload as Record<string, unknown>)
          : undefined;
        return a.action_type !== undefined || payload?.new_step !== undefined;
      }
    );
  const assistantMode =
    options?.assistantMode === true || (options?.assistantMode !== false && rawLooksLikeAssistant);

  // Always heal structural replace_flow issues before any validator pass.
  const idsHealedGlobal = ensureReplaceFlowStepIds(actionsJson);
  const incrementalIdsHealedGlobal = ensureIncrementalActionStepIds(actionsJson);
  const saveAsHealedGlobal = ensureReplaceFlowUniqueSaveAs(actionsJson);
  const suggestionsSanitizedGlobal = sanitizeSuggestedFixes(actionsJson);
  if (idsHealedGlobal) {
    upsertSuggestedFix(
      actionsJson,
      'Auto-repaired missing/duplicate step ids in replace_flow actions for apply compatibility.'
    );
  }
  if (saveAsHealedGlobal) {
    upsertSuggestedFix(
      actionsJson,
      'Auto-repaired duplicate or missing saveAs variables in replace_flow query steps.'
    );
  }
  if (incrementalIdsHealedGlobal) {
    upsertSuggestedFix(
      actionsJson,
      'Auto-repaired missing/duplicate step ids in insert_step_after/replace_step actions for apply compatibility.'
    );
  }
  if (idsHealedGlobal || incrementalIdsHealedGlobal || saveAsHealedGlobal || suggestionsSanitizedGlobal) {
    finalText = rebuildTextWithActionsJson(finalText, actionsJson);
  }

  if (assistantMode) {
    if (rawLooksLikeAssistant && options?.assistantMode !== true) {
      console.log('[MCP] postCheck: using lenient path (detected assistant-style JSON)');
    }
    normalizeAssistantActions(actionsJson);
    await filterInvalidAssistantActions(actionsJson, flowContext?.originalSteps);
    const trimmed = finalText.trim();
    const jsonOnlyInput = trimmed.startsWith('{') || trimmed.startsWith('```');
    finalText = jsonOnlyInput
      ? `ACTIONS_JSON: ${JSON.stringify(actionsJson)}`
      : rebuildTextWithActionsJson(finalText, actionsJson);
  } else {
    const payloadValidation = await validateActionPayload({
      actionsJson,
      originalSteps: flowContext?.originalSteps,
    });
    const validData = payloadValidation.data as { valid: boolean; errors: string[] };
    if (!validData.valid) errors.push(...validData.errors);
  }

  const synthesizedFromSuggestions = synthesizeApplyActionsFromSuggestions(
    actionsJson,
    flowContext?.originalSteps
  );
  if (synthesizedFromSuggestions) {
    finalText = rebuildTextWithActionsJson(finalText, actionsJson);
  }

  const actionRows = Array.isArray(actionsJson.actions)
    ? (actionsJson.actions as Array<Record<string, unknown>>)
    : [];
  if (!assistantMode) {
    actionRows.forEach((action) => {
      const actionType = String(action.action_type || action.type || '');
      const targetStepId =
        String(action.targetStepId || action.target_step_id || action.stepId || '');
      const payload = (action.payload && typeof action.payload === 'object')
        ? (action.payload as Record<string, unknown>)
        : {};
      const param = String(action.param || payload.param || '');
      if (actionType === 'set_step_param' && param === 'params') {
        errors.push(
          `Invalid set_step_param for ${targetStepId || '(unknown step)'}: param must be a single field, not "params"`
        );
      }
    });
  }

  // Group-aware post-check: for long flat replace_flow payloads, auto-suggest a grouped rewrite.
  let regroupedAny = false;
  let concatSplitAny = false;
  let actionStepConcatSplitAny = false;
  let measurementGroupedAny = false;
  actionRows.forEach((action) => {
    const actionType = String(action.action_type || action.type || '');
    if (actionType !== 'replace_flow') return;
    const replaceFlowSteps = extractReplaceFlowSteps(action);
    if (!Array.isArray(replaceFlowSteps)) return;
    let nextSteps = replaceFlowSteps;

    if (isLongFlatFlow(nextSteps)) {
      const grouped = groupFlatFlowSteps(nextSteps);
      if (JSON.stringify(grouped) !== JSON.stringify(nextSteps)) {
        nextSteps = grouped;
        regroupedAny = true;
      }
    }

    const concatFixed = enforceConcatCapInSteps(nextSteps, 3);
    if (concatFixed.changed) {
      nextSteps = concatFixed.steps;
      concatSplitAny = true;
    }

    const measFixed = enforceMeasurementGroupingInSteps(nextSteps);
    if (measFixed.changed) {
      nextSteps = measFixed.steps;
      measurementGroupedAny = true;
    }

    if (action.flow && typeof action.flow === 'object') {
      const flow = action.flow as Record<string, unknown>;
      flow.steps = nextSteps;
      action.flow = flow;
    } else if (Array.isArray(action.steps)) {
      action.steps = nextSteps as unknown as Record<string, unknown>;
    } else {
      const payload = (action.payload && typeof action.payload === 'object')
        ? (action.payload as Record<string, unknown>)
        : {};
      payload.steps = nextSteps;
      action.payload = payload;
    }
  });
  actionRows.forEach((action) => {
    const payload = (action.payload && typeof action.payload === 'object')
      ? (action.payload as Record<string, unknown>)
      : {};
    const newStep = parseJsonValueString(action.newStep || payload.new_step || payload.newStep) as
      | Record<string, unknown>
      | undefined;
    if (!newStep) return;

    const fixed = enforceConcatCapInSteps([newStep], 3);
    if (!fixed.changed || !fixed.steps.length) return;

    const repairedStep = fixed.steps[0];
    if (typeof action.newStep === 'string' || Object.prototype.hasOwnProperty.call(action, 'newStep')) {
      action.newStep = repairedStep;
    } else if (Object.prototype.hasOwnProperty.call(payload, 'new_step')) {
      payload.new_step = repairedStep;
      action.payload = payload;
    } else if (Object.prototype.hasOwnProperty.call(payload, 'newStep')) {
      payload.newStep = repairedStep;
      action.payload = payload;
    }
    actionStepConcatSplitAny = true;
  });
  if (regroupedAny) {
    // Auto-grouping applied; no warning so logs stay clean (behavior is silent improvement).
    finalText = rebuildTextWithActionsJson(finalText, actionsJson);
  }
  if (concatSplitAny || actionStepConcatSplitAny) {
    warnings.push('Detected over-concatenated SCPI command strings; split into grouped steps (max 3 per step).');
    upsertSuggestedFix(
      actionsJson,
      'Long semicolon command chains were split and grouped for readability (max 3 commands per step).'
    );
    finalText = rebuildTextWithActionsJson(finalText, actionsJson);
  }
  if (measurementGroupedAny) {
    warnings.push('Detected measurement setup/result scatter; grouped into Add Measurements and Read Results.');
    upsertSuggestedFix(
      actionsJson,
      'Measurement steps were regrouped into Add Measurements and Read Results.'
    );
    finalText = rebuildTextWithActionsJson(finalText, actionsJson);
  }

  const preferredInstrumentId = (() => {
    const directAlias = String(flowContext?.alias || '').trim();
    if (directAlias) return directAlias;
    const instrumentMap = Array.isArray(flowContext?.instrumentMap)
      ? (flowContext?.instrumentMap as Array<Record<string, unknown>>)
      : [];
    if (instrumentMap.length === 1) {
      const alias = String(instrumentMap[0]?.alias || '').trim();
      if (alias) return alias;
    }
    return '';
  })();
  if (preferredInstrumentId) {
    const fillInstrumentIds = (steps: Array<Record<string, unknown>>): boolean => {
      let changed = false;
      steps.forEach((step) => {
        const type = String(step.type || '').toLowerCase();
        if (type === 'connect' || type === 'disconnect') {
          const params =
            step.params && typeof step.params === 'object'
              ? ({ ...(step.params as Record<string, unknown>) } as Record<string, unknown>)
              : {};
          const ids = Array.isArray(params.instrumentIds)
            ? (params.instrumentIds as unknown[]).map((value) => String(value || '').trim()).filter(Boolean)
            : [];
          if (!ids.length) {
            params.instrumentIds = [preferredInstrumentId];
            step.params = params;
            changed = true;
          }
        }
        if (Array.isArray(step.children) && step.children.length) {
          if (fillInstrumentIds(step.children as Array<Record<string, unknown>>)) changed = true;
        }
      });
      return changed;
    };

    let instrumentIdsFilled = false;
    actionRows.forEach((action) => {
      const actionType = String(action.action_type || action.type || '');
      if (actionType === 'replace_flow') {
        const replaceFlowSteps = extractReplaceFlowSteps(action);
        if (Array.isArray(replaceFlowSteps) && fillInstrumentIds(replaceFlowSteps)) {
          instrumentIdsFilled = true;
        }
      }
      const payload = (action.payload && typeof action.payload === 'object')
        ? (action.payload as Record<string, unknown>)
        : {};
      const newStep = parseJsonValueString(action.newStep || payload.new_step || payload.newStep) as
        | Record<string, unknown>
        | undefined;
      if (newStep && fillInstrumentIds([newStep])) {
        if (typeof action.newStep === 'string') {
          action.newStep = newStep;
        } else if (payload.new_step || payload.newStep) {
          payload.new_step = newStep;
          action.payload = payload;
        }
        instrumentIdsFilled = true;
      }
    });
    if (instrumentIdsFilled) {
      upsertSuggestedFix(
        actionsJson,
        `Filled connect/disconnect instrumentIds with workspace alias "${preferredInstrumentId}" for direct chat apply compatibility.`
      );
      finalText = rebuildTextWithActionsJson(finalText, actionsJson);
    }
  }

  let commands = collectCommandsFromActions(actionsJson);
  const requiresHostedScpiGate = shouldHardGateHostedScpiApply(
    assistantMode,
    flowContext?.backend,
    commands,
    options?.toolTrace
  );
  if (requiresHostedScpiGate) {
    const materialized = hasHostedToolCall(options?.toolTrace, [
      'materialize_scpi_command',
      'materialize_scpi_commands',
      'finalize_scpi_commands',
    ]);
    const verified = hasHostedToolCall(options?.toolTrace, ['verify_scpi_commands', 'finalize_scpi_commands']);
    const verifyRequired = commands.some((command) => !isHostedPreverifiedScpiCommand(command));
    if (!materialized || (verifyRequired && !verified)) {
      const missing: string[] = [];
      if (!materialized) missing.push('MCP exact materialization');
      if (verifyRequired && !verified) missing.push('MCP exact verification');
      if (Array.isArray(actionsJson.actions) && actionsJson.actions.length > 0) {
        actionsJson.actions = [];
        upsertFinding(
          actionsJson,
          verifyRequired
            ? 'Apply was disabled because SCPI-bearing output did not use MCP exact materialization and verification before returning JSON.'
            : 'Apply was disabled because SCPI-bearing output did not use MCP exact materialization before returning JSON.'
        );
        upsertSuggestedFix(
          actionsJson,
          verifyRequired
            ? `Before returning applyable SCPI steps, call finalize_scpi_commands or materialize_scpi_command/materialize_scpi_commands, then verify_scpi_commands for uncertain commands. Missing for this turn: ${missing.join(' and ')}.`
            : `Before returning applyable SCPI steps, call finalize_scpi_commands or materialize_scpi_command/materialize_scpi_commands. Missing for this turn: ${missing.join(' and ')}.`
        );
        warnings.push(
          `Hosted SCPI apply disabled because the response skipped ${missing.join(' and ')}.`
        );
        finalText = rebuildTextWithActionsJson(finalText, actionsJson);
      }
      commands = [];
    }
  }
  if (commands.length) {
    const isAlwaysValid = (cmd: string) => {
      const lower = cmd.toLowerCase();
      return ALWAYS_VALID_PREFIXES.some((p) => lower.startsWith(p)) || lower.startsWith('*');
    };
    const toVerify = Array.from(new Set(commands.filter((cmd) => !isAlwaysValid(cmd))));

    const verification = await verifyScpiCommands({
      commands: toVerify,
      modelFamily: flowContext?.modelFamily,
      requireExactSyntax: true,
    });
    verificationRows = verification.data as Array<Record<string, unknown>>;
    const failures = verificationRows.filter((item) => item.verified !== true);

    if (failures.length) {
      const commandIndex = await getCommandIndex();
      const lenientVerification = await verifyScpiCommands({
        commands: failures.map((item) => String(item.command || '')).filter(Boolean),
        modelFamily: flowContext?.modelFamily,
        requireExactSyntax: false,
      });
      const lenientMap = new Map(
        ((lenientVerification.data as Array<Record<string, unknown>>) || []).map((item) => [
          String(item.command || ''),
          item.verified === true,
        ])
      );
      const stillFailing: Array<Record<string, unknown>> = [];
      const tolerated: string[] = [];

      failures.forEach((f) => {
        const command = String(f.command || '').trim();
        const header = splitCommands(command)[0] || command;
        const lenientlyVerified = lenientMap.get(command) === true;
        const indexed =
          commandIndex.getByHeader(header, flowContext?.modelFamily) ||
          commandIndex.getByHeader(header.toUpperCase(), flowContext?.modelFamily) ||
          commandIndex.getByHeader(header.toLowerCase(), flowContext?.modelFamily) ||
          commandIndex.getByHeaderPrefix(header, flowContext?.modelFamily) ||
          commandIndex.getByHeader(header) ||
          commandIndex.getByHeader(header.toUpperCase()) ||
          commandIndex.getByHeader(header.toLowerCase()) ||
          commandIndex.getByHeaderPrefix(header);
        if (lenientlyVerified || indexed) {
          tolerated.push(command);
          return;
        }
        stillFailing.push(f);
      });

      tolerated.forEach((command) => {
        warnings.push(`Command kept with lenient post-check validation: ${command}`);
      });

      stillFailing.forEach((f) => {
        errors.push(`Unverified command: ${String(f.command || '')}`);
      });
      if (stillFailing.length && Array.isArray(actionsJson.actions) && actionsJson.actions.length > 0) {
        actionsJson.actions = [];
        upsertFinding(
          actionsJson,
          'Apply was disabled because one or more SCPI commands did not exactly match the uploaded source-of-truth command library.'
        );
        upsertSuggestedFix(
          actionsJson,
          'Use source-backed SCPI syntax from the command library. If a command remains uncertain, avoid applying that command until clarified.'
        );
        finalText = rebuildTextWithActionsJson(finalText, actionsJson);
      }
    }
  }

  const prose = finalText.replace(/ACTIONS_JSON:[\s\S]*$/i, '').trim();
  // Keep narrative clipping conservative but not overly aggressive for hosted answers.
  const maxProseCharsRaw = Number(process.env.MCP_POSTCHECK_MAX_PROSE_CHARS || 1200);
  const maxProseChars = Number.isFinite(maxProseCharsRaw) ? Math.max(600, Math.floor(maxProseCharsRaw)) : 1200;
  if (prose.length > maxProseChars) {
    warnings.push(`Prose exceeded ${maxProseChars} characters and was truncated.`);
    const actionsBlockMatch = finalText.match(/ACTIONS_JSON:[\s\S]*$/i);
    const actionsBlock = actionsBlockMatch?.[0] || '';
    const truncated = prose.slice(0, maxProseChars);
    const lastBoundary = Math.max(
      truncated.lastIndexOf('. '),
      truncated.lastIndexOf('.\n')
    );
    const proseFixed =
      lastBoundary > Math.floor(maxProseChars / 2)
        ? truncated.slice(0, lastBoundary + 1).trim()
        : `${truncated.trim()}...`;
    finalText = actionsBlock ? `${proseFixed}\n\n${actionsBlock.trim()}` : proseFixed;
  }
  if (
    (flowContext?.backend || '').toLowerCase() !== 'tekhsi' &&
    /tekhsi/i.test(finalText)
  ) {
    errors.push('Unexpected TekHSI reference for non-TekHSI backend');
  }
  const verifiedCount = verificationRows.filter((r) => r.verified === true).length;
  const totalCount = verificationRows.length;
  // eslint-disable-next-line no-console
  console.log(
    `[MCP] postCheck verification: ${verifiedCount}/${totalCount} commands verified` +
      (errors.length ? ` | errors: ${errors.join(', ')}` : '') +
      (warnings.length ? ` | warnings: ${warnings.join(', ')}` : ' | clean')
  );
  return { ok: errors.length === 0, text: finalText, errors, warnings };
}
