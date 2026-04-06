import { getCommandIndex, type CommandIndex, type CommandRecord } from './commandIndex';
import { GROUP_DESCRIPTIONS } from './commandGroups';
import { planIntent, type PlannerOutput, type ResolvedCommand } from './intentPlanner';
import { postCheckResponse } from './postCheck';
import { getProviderCatalog, providerSupplementsEnabled, providerSupplementsEnabledForMode, type ProviderSupplementEntry } from './providerCatalog';
import { findProviderSupplementMatches, matchProviderSupplement, type ProviderMatchResult } from './providerMatcher';
import type { MicroToolResult } from './toolRegistry';
import { materializeTmDevicesCall } from '../tools/materializeTmDevicesCall';
import { searchTmDevices } from '../tools/searchTmDevices';
import { verifyScpiCommands } from '../tools/verifyScpiCommands';
import { getRagIndexes } from './ragIndex';

export interface BuildRequest {
  query: string;
  context?: {
    backend?: string;
    deviceType?: string;
    modelFamily?: string;
    steps?: Array<Record<string, unknown>>;
    selectedStepId?: string;
    alias?: string;
    instrumentMap?: Array<Record<string, unknown>>;
  };
  buildNew?: boolean;
  instrumentId?: string;
}

type QueryMode = 'action' | 'info';

interface FlowEditInstruction {
  fromChannel?: string;
  toChannel: string;
}

interface CommentInsertInstruction {
  text: string;
  beforeDisconnect?: boolean;
}

interface CommandCard {
  header: string;
  commandId: string;
  commandType: string;
  group: string;
  groupDescription: string;
  category: string;
  shortDescription: string;
  description: string;
  families: string[];
  models: string[];
  syntax: { set?: string; query?: string };
  arguments: Array<{
    name: string;
    type: string;
    required: boolean;
    description: string;
    validValues: Record<string, unknown>;
    defaultValue?: unknown;
  }>;
  queryResponse?: string;
  examples: Array<{ description: string; scpi?: string; python?: string; tm_devices?: string }>;
  relatedCommands: string[];
  notes: string[];
  manualReference?: { section?: string; page?: number };
}

interface MaterializedCommand {
  record: CommandRecord;
  concreteCommand: string;
  isQuery: boolean;
  saveAs?: string;
  verified: boolean;
}

interface SuggestedCommand {
  header: string;
  commandType: 'set' | 'query';
  command: string;
  description: string;
  reason: string;
  step: Record<string, unknown>;
}

interface ProviderMatchDebug {
  source: 'provider_catalog';
  providerId: string;
  entryId: string;
  templateId: string;
  name: string;
  kind: 'template' | 'overlay';
  handlerRef: string;
  score: number;
  overrideThreshold: number;
  applied: boolean;
  decision: 'override' | 'hint' | 'context';
  author?: string;
  version?: string;
  tested?: boolean;
  sourceFile: string;
}

const INFO_PATTERNS = [
  /\bwhat\s+(params?|parameters?|arguments?|values?|options?|types?)\b/i,
  /\bwhat\s+can\s+i\s+(use|pass|set|send)\b/i,
  /\btell\s+me\s+(about|more)\b/i,
  /\bshow\s+me\b.*\b(syntax|params?|args?|values?|options?)\b/i,
  /\bexplain\b.*\b(command|header|syntax)\b/i,
  /\binfo\s+(on|about|for)\b/i,
  /\bdetails?\s+(on|about|for)\b/i,
  /\bhow\s+(do|does|to)\s+(i\s+)?(use|configure|set)\b/i,
  /\blist\s+(all|the|valid|available)\b.*\b(params?|values?|options?|types?|measurements?)\b/i,
  /\bvalid\s+(values?|options?|params?|arguments?)\b/i,
  /\blookup\b/i,
  /\bdescribe\b/i,
  /\bsyntax\s+(for|of)\b/i,
];

function detectQueryMode(query: string): QueryMode {
  const trimmed = String(query || '').trim();
  for (const pattern of INFO_PATTERNS) {
    if (pattern.test(trimmed)) return 'info';
  }

  const firstToken = trimmed.split(/\s+/)[0] || '';
  if (/^[A-Z*][A-Za-z0-9]*(?::[A-Za-z0-9<>{}|_]+)+\??$/i.test(firstToken) && trimmed.split(/\s+/).length <= 3) {
    if (!/\b(set|write|send|configure|enable|disable|add|change|turn|build)\b/i.test(trimmed)) {
      return 'info';
    }
  }

  return 'action';
}

/** Compact text card for build results — ~150 tokens vs ~3K for full JSON */
function buildCommandCard(record: CommandRecord): string {
  const lines: string[] = [];
  lines.push(`Command: ${record.header}`);
  if (record.shortDescription) lines.push(`Description: ${record.shortDescription}`);
  if (record.syntax?.set) lines.push(`Set: ${record.syntax.set}`);
  if (record.syntax?.query) lines.push(`Query: ${record.syntax.query}`);
  if (record.arguments?.length) {
    for (const arg of record.arguments.slice(0, 4)) {
      const desc = (arg.description || '').slice(0, 60);
      lines.push(`  ${arg.name} (${arg.type}${arg.required ? ', required' : ''}): ${desc}`);
    }
  }
  const examples = record.codeExamples?.slice(0, 3).filter(e => e?.scpi?.code);
  if (examples?.length) {
    for (const ex of examples) {
      lines.push(`Example: ${ex.scpi!.code}${ex.description ? ' — ' + ex.description : ''}`);
    }
  }
  return lines.join('\n');
}

function normalizeChannelToken(value: string): string | undefined {
  const match = String(value || '').match(/\b(?:CH|channel)\s*([1-8])\b/i);
  return match ? `CH${match[1]}` : undefined;
}

function detectFlowEditInstruction(query: string): FlowEditInstruction | null {
  const replaceMatch = query.match(/\bactually\s+make\s+that\s+(CH[1-8]|channel\s*[1-8])\s+not\s+(CH[1-8]|channel\s*[1-8])\b/i);
  if (replaceMatch) {
    return {
      toChannel: normalizeChannelToken(replaceMatch[1]) || 'CH1',
      fromChannel: normalizeChannelToken(replaceMatch[2]),
    };
  }
  const retargetMatch = query.match(/\bsame\s+thing\s+but\s+on\s+(CH[1-8]|channel\s*[1-8])\b/i);
  if (retargetMatch) {
    return {
      toChannel: normalizeChannelToken(retargetMatch[1]) || 'CH1',
    };
  }
  const contextualRetargetMatch = query.match(/\b(?:same\s+thing(?:\s+as\s+before)?|do\s+all\s+of\s+that|actually\s+do\s+all\s+of\s+that)\b[\s\S]*?\b(?:on|to)\s+(CH[1-8]|channel\s*[1-8])\b/i);
  if (contextualRetargetMatch) {
    return {
      toChannel: normalizeChannelToken(contextualRetargetMatch[1]) || 'CH1',
    };
  }
  if (/\b(?:same\s+thing(?:\s+as\s+before)?|do\s+all\s+of\s+that|actually\s+do\s+all\s+of\s+that)\b/i.test(query)) {
    return {
      toChannel: 'CH1',
    };
  }
  return null;
}

function detectCommentInsertInstruction(query: string): CommentInsertInstruction | null {
  const raw = String(query || '').trim();
  if (!/\b(add|insert|also add|append)\b/i.test(raw) || !/\bcomment\b/i.test(raw)) return null;

  const extracted =
    raw.match(/\b(?:that says|saying|with text)\b\s*["']([^"']+)["']/i)?.[1] ||
    raw.match(/\b(?:that says|saying|with text)\b\s+(.+)$/i)?.[1] ||
    raw.match(/\bcomment(?:\s+step)?\b[\s\S]*?:\s*(.+)$/i)?.[1] ||
    raw.match(/\bcomment(?:\s+step)?\b[\s\S]*?\b(.+)$/i)?.[1];
  const text = String(extracted || '')
    .trim()
    .replace(/^(before\s+disconnect\s+)?(that\s+says|saying|with\s+text)\s+/i, '')
    .replace(/[.]+$/, '');
  if (!text) return null;
  return {
    text,
    beforeDisconnect: /\bbefore\s+disconnect\b/i.test(raw),
  };
}

function rewriteChannelsDeep<T>(value: T, instruction: FlowEditInstruction): T {
  if (typeof value === 'string') {
    if (instruction.fromChannel) {
      return value.replace(new RegExp(`\\b${instruction.fromChannel}\\b`, 'gi'), instruction.toChannel) as T;
    }
    return value.replace(/\bCH[1-8]\b/gi, instruction.toChannel) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteChannelsDeep(item, instruction)) as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = rewriteChannelsDeep(item, instruction);
    }
    return out as T;
  }
  return value;
}

function buildEditedFlowResult(
  request: BuildRequest,
  existingSteps: Array<Record<string, unknown>>,
  instruction: FlowEditInstruction,
  instrumentId: string
): MicroToolResult {
  const backend = request.context?.backend || 'pyvisa';
  const deviceType = request.context?.deviceType || 'SCOPE';
  const rewrittenSteps = rewriteChannelsDeep(existingSteps, instruction);
  const payload = {
    summary: instruction.fromChannel
      ? `Updated the existing flow to use ${instruction.toChannel} instead of ${instruction.fromChannel}.`
      : `Updated the existing flow to target ${instruction.toChannel}.`,
    findings: [],
    suggestedFixes: [],
    actions: [
      {
        type: 'replace_flow',
        flow: {
          name: `Edited from: ${request.query.slice(0, 60)}`,
          description: 'Auto-edited flow from router build action',
          backend,
          deviceType,
          steps: rewrittenSteps.length > 0 ? rewrittenSteps : [connectStep(instrumentId), disconnectStep(instrumentId)],
        },
      },
    ],
  };
  return {
    ok: true,
    data: {
      mode: 'action',
      edited: true,
      totalSteps: rewrittenSteps.length,
    },
    text: `ACTIONS_JSON: ${JSON.stringify(payload)}`,
  };
}

function buildCommentInsertResult(
  request: BuildRequest,
  existingSteps: Array<Record<string, unknown>>,
  instruction: CommentInsertInstruction,
  instrumentId: string
): MicroToolResult {
  const backend = request.context?.backend || 'pyvisa';
  const deviceType = request.context?.deviceType || 'SCOPE';
  const trailingDisconnect = [...existingSteps].reverse().find((step) => String(step.type || '').toLowerCase() === 'disconnect');
  const targetId =
    instruction.beforeDisconnect && trailingDisconnect?.id
      ? String(trailingDisconnect.id)
      : inferInsertTargetStepId(existingSteps, [commentStep('comment_new', instruction.text)], request.query, request.context?.selectedStepId || null);
  const rewritten = insertTopLevelStepsAfterTarget(
    existingSteps,
    [commentStep(`comment_${Date.now()}`, instruction.text)],
    targetId && instruction.beforeDisconnect && trailingDisconnect?.id ? undefined : targetId
  );
  const finalSteps =
    instruction.beforeDisconnect && trailingDisconnect?.id
      ? (() => {
          const cloned = cloneSteps(existingSteps);
          const disconnectIdx = cloned.findIndex((step) => String(step.id || '') === String(trailingDisconnect.id));
          const newComment = commentStep(`comment_${Date.now()}`, instruction.text);
          if (disconnectIdx >= 0) cloned.splice(disconnectIdx, 0, newComment);
          else cloned.push(newComment);
          return cloned;
        })()
      : rewritten;

  const payload = {
    summary: 'Inserted a comment step into the current flow.',
    findings: [],
    suggestedFixes: [],
    actions: [
      {
        type: 'replace_flow',
        flow: {
          name: `Edited from: ${request.query.slice(0, 60)}`,
          description: 'Auto-edited flow from router build action',
          backend,
          deviceType,
          steps: finalSteps.length > 0 ? finalSteps : [connectStep(instrumentId), disconnectStep(instrumentId)],
        },
      },
    ],
  };
  return {
    ok: true,
    data: {
      mode: 'action',
      edited: true,
      insertedComment: true,
      totalSteps: finalSteps.length,
    },
    text: `ACTIONS_JSON: ${JSON.stringify(payload)}`,
  };
}

function inferInsertTargetStepId(
  existingSteps: Array<Record<string, unknown>>,
  groupedSteps: Array<Record<string, unknown>>,
  query: string,
  selectedStepId?: string | null
): string | undefined {
  const explicit = String(selectedStepId || '').trim();
  if (explicit) return explicit;

  const topLevelSteps = Array.isArray(existingSteps) ? existingSteps : [];
  const queryLower = String(query || '').toLowerCase();
  const screenshotOnly =
    groupedSteps.length === 1 &&
    String(groupedSteps[0]?.type || '').toLowerCase() === 'save_screenshot';

  if (screenshotOnly || /\bscreenshot\b|\bcapture screen\b/.test(queryLower)) {
    const readResultsGroup = topLevelSteps.find(
      (step) =>
        String(step.type || '').toLowerCase() === 'group' &&
        /read results/i.test(String(step.label || ''))
    );
    if (readResultsGroup?.id) return String(readResultsGroup.id);

    const reverseTopLevel = [...topLevelSteps].reverse();
    const queryBearingGroup = reverseTopLevel.find((step) => {
      if (String(step.type || '').toLowerCase() !== 'group' || !Array.isArray(step.children)) return false;
      return (step.children as Array<Record<string, unknown>>).some(
        (child) => String(child.type || '').toLowerCase() === 'query'
      );
    });
    if (queryBearingGroup?.id) return String(queryBearingGroup.id);
  }

  const lastNonDisconnect = [...topLevelSteps]
    .reverse()
    .find((step) => String(step.type || '').toLowerCase() !== 'disconnect');
  if (lastNonDisconnect?.id) return String(lastNonDisconnect.id);

  const connect = topLevelSteps.find((step) => String(step.type || '').toLowerCase() === 'connect');
  return connect?.id ? String(connect.id) : undefined;
}

function cloneSteps(steps: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return JSON.parse(JSON.stringify(steps)) as Array<Record<string, unknown>>;
}

function insertTopLevelStepsAfterTarget(
  existingSteps: Array<Record<string, unknown>>,
  stepsToInsert: Array<Record<string, unknown>>,
  targetStepId?: string
): Array<Record<string, unknown>> {
  const cloned = cloneSteps(existingSteps);
  const inserts = cloneSteps(stepsToInsert);
  if (!inserts.length) return cloned;

  const target = String(targetStepId || '').trim();
  if (!target) {
    const disconnectIdx = cloned.findIndex((step) => String(step.type || '').toLowerCase() === 'disconnect');
    if (disconnectIdx >= 0) {
      cloned.splice(disconnectIdx, 0, ...inserts);
      return cloned;
    }
    cloned.push(...inserts);
    return cloned;
  }

  const topLevelIndex = cloned.findIndex((step) => String(step.id || '') === target);
  if (topLevelIndex >= 0) {
    cloned.splice(topLevelIndex + 1, 0, ...inserts);
    return cloned;
  }

  const disconnectIdx = cloned.findIndex((step) => String(step.type || '').toLowerCase() === 'disconnect');
  if (disconnectIdx >= 0) {
    cloned.splice(disconnectIdx, 0, ...inserts);
    return cloned;
  }
  cloned.push(...inserts);
  return cloned;
}

function formatProviderTemplateLabel(entry: ProviderSupplementEntry): string {
  return entry.version ? `${entry.id} v${entry.version}` : entry.id;
}

function serializeProviderMatch(
  match: ProviderMatchResult,
  applied: boolean,
  decision: 'override' | 'hint' | 'context' = match.decision
): ProviderMatchDebug {
  return {
    source: 'provider_catalog',
    providerId: match.entry.providerId,
    entryId: match.entry.id,
    templateId: match.entry.id,
    name: match.entry.name,
    kind: match.entry.kind,
    handlerRef: match.entry.handlerRef,
    score: Number(match.score.toFixed(3)),
    overrideThreshold: Number(match.overrideThreshold.toFixed(3)),
    applied,
    decision,
    ...(match.entry.author ? { author: match.entry.author } : {}),
    ...(match.entry.version ? { version: match.entry.version } : {}),
    ...(typeof match.entry.tested === 'boolean' ? { tested: match.entry.tested } : {}),
    sourceFile: match.entry.sourceFile,
  };
}

function buildProviderOverrideFindings(match: ProviderMatchResult): string[] {
  const findings = [`Using golden template: ${formatProviderTemplateLabel(match.entry)}`];
  if (match.entry.author) findings.push(`Template author: ${match.entry.author}`);
  if (typeof match.entry.tested === 'boolean') findings.push(`Template tested: ${String(match.entry.tested)}`);
  return findings;
}

function summarizeProviderContextData(raw: unknown): string | null {
  if (Array.isArray(raw)) {
    const preview = raw.slice(0, 5).map((value) => String(value)).filter(Boolean);
    return preview.length ? preview.join(', ') : null;
  }
  if (!raw || typeof raw !== 'object') {
    const text = String(raw || '').trim();
    return text || null;
  }
  const record = raw as Record<string, unknown>;
  if (Array.isArray(record.checks)) {
    const preview = record.checks.slice(0, 6).map((value) => String(value)).filter(Boolean);
    if (preview.length) return preview.join(', ');
  }
  const preview = Object.entries(record)
    .slice(0, 3)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        const values = value.slice(0, 4).map((item) => String(item)).filter(Boolean);
        return values.length ? `${key}: ${values.join(', ')}` : '';
      }
      if (value && typeof value === 'object') return `${key}: [object]`;
      return `${key}: ${String(value)}`;
    })
    .filter(Boolean);
  return preview.length ? preview.join(' | ') : null;
}

function buildProviderContextFindings(match: ProviderMatchResult): string[] {
  const label = formatProviderTemplateLabel(match.entry);
  const findings = [
    `Matched provider supplement: ${label} (score ${match.score.toFixed(2)}). Using it as supplemental context only.`,
  ];
  if (match.entry.description) findings.push(`Provider note: ${match.entry.description}`);
  if (match.entry.contextText && match.entry.contextText !== match.entry.description) {
    findings.push(`Provider text: ${match.entry.contextText}`);
  }
  const contextPreview = summarizeProviderContextData(match.entry.contextData);
  if (contextPreview) findings.push(`Provider data: ${contextPreview}`);
  if (match.entry.author) findings.push(`Provider author: ${match.entry.author}`);
  if (typeof match.entry.tested === 'boolean') findings.push(`Provider tested: ${String(match.entry.tested)}`);
  return findings;
}

function buildProviderHintFindings(
  match: ProviderMatchResult,
  buildNew: boolean,
  reason?: string
): string[] {
  const label = formatProviderTemplateLabel(match.entry);
  const roundedScore = match.score.toFixed(2);
  const threshold = match.overrideThreshold.toFixed(2);
  if (reason) {
    return [
      `Matched golden template candidate: ${label} (score ${roundedScore}). ${reason}`,
    ];
  }
  if (!buildNew && match.score >= match.overrideThreshold) {
    return [
      `Matched golden template candidate: ${label} (score ${roundedScore}). Planner output kept because phase 1 does not auto-replace existing flows with provider templates.`,
    ];
  }
  return [
    `Matched golden template candidate: ${label} (score ${roundedScore}). Planner output kept because confidence was below the override threshold of ${threshold}.`,
  ];
}

function withProviderMatchData(
  data: Record<string, unknown>,
  providerMatch?: ProviderMatchDebug
): Record<string, unknown> {
  return providerMatch ? { ...data, providerMatch } : data;
}

async function buildProviderOverrideResult(
  request: BuildRequest,
  match: ProviderMatchResult,
  existingSteps: Array<Record<string, unknown>>,
  startedAt: number
): Promise<MicroToolResult | null> {
  const context = request.context || {};
  const payload = {
    summary: match.entry.summary || `Applied golden template ${formatProviderTemplateLabel(match.entry)}.`,
    findings: buildProviderOverrideFindings(match),
    suggestedFixes: [],
    actions: [
      {
        type: 'replace_flow',
        flow: {
          name: match.entry.name,
          description: match.entry.description || 'Curated provider supplement template',
          backend: match.entry.backend || context.backend || 'pyvisa',
          deviceType: match.entry.deviceType || context.deviceType || 'SCOPE',
          steps: cloneSteps(match.entry.steps),
        },
      },
    ],
  };

  const checked = await postCheckResponse(
    `ACTIONS_JSON: ${JSON.stringify(payload)}`,
    {
      backend: match.entry.backend || context.backend || 'pyvisa',
      modelFamily: context.modelFamily,
      originalSteps: existingSteps,
      alias: context.alias,
      instrumentMap: context.instrumentMap,
    },
    { allowMissingActionsJson: false }
  );

  if (checked.errors.length) return null;

  return {
    ok: true,
    warnings: checked.warnings.length ? checked.warnings : undefined,
    data: withProviderMatchData({
      mode: 'action',
      resolvedCount: match.entry.steps.length,
      unresolvedCount: 0,
      excludedCount: 0,
      totalSteps: match.entry.steps.length,
      phases: [],
      durationMs: Date.now() - startedAt,
    }, serializeProviderMatch(match, true)),
    text: checked.text,
  };
}

function extractInfoTargets(query: string): string[] {
  const targets: string[] = [];
  const headers = query.match(/\b[A-Z*][A-Za-z0-9]*(?::[A-Za-z0-9<>{}|_]+)+\b/gi);
  if (headers) targets.push(...headers);
  const keywords = query.match(/\b(?:ADDMEAS|DELETEALL|MEAS\d*|TYPE|SOURCE|RESULTS|FASTFRAME|COUNT|STATE|BANDWIDTH|SCALE|OFFSET|POSITION|LABEL|TRIGGER|EDGE|LEVEL|SLOPE|HORIZONTAL|RECORDLENGTH|ACQUIRE|MODE|BUS|I2C|SPI|CAN|CURSOR|PLOT|SEARCH|ZOOM|SAVE|RECALL)\b/gi);
  if (keywords) targets.push(...keywords);
  return Array.from(new Set(targets.map((item) => item.trim()).filter(Boolean)));
}

async function handleInfoMode(query: string, family?: string): Promise<MicroToolResult> {
  const commandIndex = await getCommandIndex();
  const targets = extractInfoTargets(query);
  const cards: string[] = [];
  const seen = new Set<string>();

  for (const target of targets) {
    if (!target.includes(':')) continue;
    const record =
      commandIndex.getByHeader(target, family) ||
      commandIndex.getByHeader(target.toUpperCase(), family);
    if (!record || seen.has(record.header)) continue;
    seen.add(record.header);
    cards.push(buildCommandCard(record));
  }

  if (!cards.length) {
    const searchQuery = query
      .replace(/\b(what|params?|parameters?|arguments?|values?|options?|can|use|tell|me|about|show|explain|info|details?|how|do|does|list|all|the|valid|available|are|there|is|for|of|on|with|i|a|an|to)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (searchQuery) {
      const results = commandIndex.searchByQuery(searchQuery, family, 5);
      for (const record of results) {
        if (seen.has(record.header)) continue;
        seen.add(record.header);
        cards.push(buildCommandCard(record));
      }
    }
  }

  if (!cards.length) {
    return {
      ok: true,
      data: { mode: 'info', commands: [], query },
      text: `No commands found matching "${query}".`,
    };
  }

  const primary = cards[0];
  const primaryHeader = (primary.match(/^Command:\s*(.+)$/m)?.[1] || '').trim();

  return {
    ok: true,
    data: {
      mode: 'info',
      commands: cards,
      primaryHeader,
      totalCards: cards.length,
    },
    text: primary,
  };
}

function connectStep(instrumentId: string): Record<string, unknown> {
  return {
    id: '1',
    type: 'connect',
    label: 'Connect',
    params: {
      instrumentIds: [instrumentId],
      printIdn: true,
    },
  };
}

function disconnectStep(instrumentId: string): Record<string, unknown> {
  return {
    id: '99',
    type: 'disconnect',
    label: 'Disconnect',
    params: {
      instrumentIds: [instrumentId],
    },
  };
}

function writeStep(id: string, command: string, header: string): Record<string, unknown> {
  return {
    id,
    type: 'write',
    label: `Set ${header}`,
    params: { command },
  };
}

function queryStep(id: string, command: string, header: string, saveAs: string): Record<string, unknown> {
  return {
    id,
    type: 'query',
    label: `Read ${header}`,
    params: { command, saveAs },
  };
}

function groupStep(id: string, label: string, children: Record<string, unknown>[]): Record<string, unknown> {
  return {
    id,
    type: 'group',
    label,
    params: {},
    collapsed: false,
    children,
  };
}

function commentStep(id: string, text: string): Record<string, unknown> {
  return {
    id,
    type: 'comment',
    label: 'Comment',
    params: { text },
  };
}

function inferSaveAs(command: string, index: number): string {
  const header = String(command || '').split('?')[0].trim().split(/\s+/)[0];
  if (/\*IDN/i.test(header)) return 'idn';
  if (/\*ESR/i.test(header)) return 'esr';
  if (/\*OPC/i.test(header)) return 'opc';
  const measurementMatch = header.match(/MEAS(?:UREMENT)?:MEAS(\d+)/i);
  if (measurementMatch) return `meas${measurementMatch[1]}_result`;
  const normalized = header
    .replace(/[<>{}|]/g, '')
    .replace(/:/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .toLowerCase();
  return normalized || `result_${index + 1}`;
}

function pickSuggestedScpi(record: CommandRecord, index: number): SuggestedCommand[] {
  const suggestions: SuggestedCommand[] = [];
  const setCommand = String(record.syntax?.set || '').trim();
  const queryCommand = String(record.syntax?.query || '').trim();

  if (setCommand && record.commandType !== 'query') {
    suggestions.push({
      header: record.header,
      commandType: 'set',
      command: setCommand,
      description: record.shortDescription || record.description,
      reason: `Matched ${record.group} command from the SCPI index.`,
      step: writeStep(`suggested_set_${index + 1}`, setCommand, record.header),
    });
  }

  if (queryCommand) {
    const normalized = queryCommand.endsWith('?') ? queryCommand : `${queryCommand}?`;
    suggestions.push({
      header: record.header,
      commandType: 'query',
      command: normalized,
      description: record.shortDescription || record.description,
      reason: `Matched ${record.group} query from the SCPI index.`,
      step: queryStep(`suggested_query_${index + 1}`, normalized, record.header, inferSaveAs(normalized, index)),
    });
  }

  if (!suggestions.length && record.examples.length) {
    const example = record.examples.find((item) => item.scpi) || record.examples[0];
    const exampleScpi = String(example?.scpi || '').trim();
    if (exampleScpi) {
      const isQuery = /\?$/.test(exampleScpi);
      suggestions.push({
        header: record.header,
        commandType: isQuery ? 'query' : 'set',
        command: exampleScpi,
        description: record.shortDescription || record.description,
        reason: `Matched ${record.group} example command from the SCPI index.`,
        step: isQuery
          ? queryStep(`suggested_example_${index + 1}`, exampleScpi, record.header, inferSaveAs(exampleScpi, index))
          : writeStep(`suggested_example_${index + 1}`, exampleScpi, record.header),
      });
    }
  }

  return suggestions;
}

function buildSuggestionFallback(
  unresolved: string[],
  records: CommandRecord[],
  supplementalFindings: string[] = []
): { payload: Record<string, unknown>; text: string; suggestions: SuggestedCommand[] } {
  const suggestions = records
    .flatMap((record, index) => pickSuggestedScpi(record, index))
    .slice(0, 12);

  const payload = {
    summary: suggestions.length
      ? `Could not build a full action flow, but found ${suggestions.length} SCPI suggestion(s) you can apply individually.`
      : unresolved.length
      ? `Could not resolve: ${unresolved.slice(0, 3).join(', ')}`
        : 'No actionable commands found.',
    findings: [...supplementalFindings, ...unresolved],
    suggestedFixes: [
      'Use the suggested SCPI commands below as individual steps, or make the request more specific for full flow generation.',
    ],
    actions: [],
    suggestedCommands: suggestions.map((suggestion) => ({
      header: suggestion.header,
      commandType: suggestion.commandType,
      command: suggestion.command,
      description: suggestion.description,
      reason: suggestion.reason,
      step: suggestion.step,
    })),
  };

  const textLines = [payload.summary];
  if (suggestions.length) {
    textLines.push('', 'Suggested SCPI commands:');
    for (const suggestion of suggestions) {
      textLines.push(`- ${suggestion.header}: ${suggestion.command}`);
    }
  }

  return {
    payload,
    text: `ACTIONS_JSON: ${JSON.stringify(payload)}\n\n${textLines.join('\n')}`,
    suggestions,
  };
}

function buildSuggestionQueries(query: string): string[] {
  const raw = String(query || '').trim();
  const normalized = raw.toLowerCase();
  const queries = new Set<string>();
  if (raw) queries.add(raw);

  const stripped = normalized
    .replace(/\b(tell me|show me|what is|what's|what scope|am i|connected to|using|for this one|please|just|the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped) queries.add(stripped);

  if (/\b(hide|turn off|disable)\b/.test(normalized) && /\b(ch|channel)\s*[1-4]\b/.test(normalized)) {
    queries.add('display channel state off');
    queries.add('waveview channel state off');
  }
  if (/\b(show|turn on|enable)\b/.test(normalized) && /\b(ch|channel)\s*[1-4]\b/.test(normalized)) {
    queries.add('display channel state on');
    queries.add('waveview channel state on');
  }
  if (/\b(what scope|connected|identify|idn|instrument am i)\b/.test(normalized)) {
    queries.add('*IDN? connected status');
    queries.add('connected status');
  }
  if (/\b(trigger level)\b/.test(normalized)) {
    queries.add('trigger level source slope');
  }
  if (/\b(save|export)\b/.test(normalized)) {
    queries.add('save export file hardcopy waveform');
  }

  return Array.from(queries).filter(Boolean);
}

function gatherSuggestionRecords(
  commandIndex: CommandIndex,
  query: string,
  family?: string,
  seedRecords: CommandRecord[] = []
): CommandRecord[] {
  const merged = new Map<string, CommandRecord>();
  for (const record of seedRecords) {
    merged.set(record.header, record);
  }
  for (const searchQuery of buildSuggestionQueries(query)) {
    for (const record of commandIndex.searchByQuery(searchQuery, family, 6)) {
      if (!merged.has(record.header)) merged.set(record.header, record);
    }
  }
  return Array.from(merged.values());
}

function classifyCommandPhase(command: string): string {
  const normalized = String(command || '').toLowerCase();
  if (/\*rst|\*cls|\*opc\?|recall|preset|factory/.test(normalized)) return 'Setup';
  if (/save|hardcopy|filesystem|export/.test(normalized)) return 'Save / Export';
  if (/meas|measurement/.test(normalized)) {
    if (/measurement:immed:/.test(normalized)) return 'Measurements';
    if (/\?|results:currentacq|results:allacq|query\(/.test(normalized)) return 'Read Results';
    return 'Measurements';
  }
  if (/bus\d|bus:/.test(normalized)) return 'Bus Decode';
  if (/search\d/.test(normalized)) return 'Search';
  if (/trig|trigger/.test(normalized)) return 'Trigger Configuration';
  if (/hor|horizontal|acq|acquire/.test(normalized)) return 'Acquisition';
  if (/ch\d|display:waveview|math\d|ref\d/.test(normalized)) return 'Channel Configuration';
  return 'Configuration';
}

const PHASE_PRIORITY = [
  'Setup',
  'Channel Configuration',
  'Bus Decode',
  'Trigger Configuration',
  'Measurements',
  'Acquisition',
  'Read Results',
  'Save / Export',
  'Search',
  'Configuration',
] as const;

type TmDevicesMaterialized = {
  step: Record<string, unknown>;
  phase: string;
};

interface TmDevicesMapping {
  methodPath: string;
  bindings?: Record<string, string | number | boolean>;
  args?: unknown[];
  saveAs?: string;
}

function normalizeTmString(value: string): string {
  return value.replace(/^"|"$/g, '');
}

function mapResolvedCommandToTmDevices(command: ResolvedCommand): TmDevicesMapping | null {
  const concrete = String(command.concreteCommand || '').trim();
  const header = command.header;

  let match = concrete.match(/^CH(\d+):SCAle\s+(.+)$/i);
  if (match) {
    return {
      methodPath: 'ch[x].scale.write',
      bindings: { channel: match[1] },
      args: [Number(match[2])],
    };
  }

  match = concrete.match(/^CH(\d+):OFFSet\s+(.+)$/i);
  if (match) {
    return {
      methodPath: 'ch[x].offset.write',
      bindings: { channel: match[1] },
      args: [Number(match[2])],
    };
  }

  match = concrete.match(/^TRIGger:A:TYPe\s+(.+)$/i);
  if (match) {
    return { methodPath: 'trigger.a.type.write', args: [normalizeTmString(match[1])] };
  }

  match = concrete.match(/^TRIGger:A:MODe\s+(.+)$/i);
  if (match) {
    return { methodPath: 'trigger.a.mode.write', args: [normalizeTmString(match[1])] };
  }

  match = concrete.match(/^TRIGger:A:EDGE:SOUrce\s+(.+)$/i);
  if (match) {
    return { methodPath: 'trigger.a.edge.source.write', args: [normalizeTmString(match[1])] };
  }

  match = concrete.match(/^TRIGger:A:EDGE:SLOpe\s+(.+)$/i);
  if (match) {
    return { methodPath: 'trigger.a.edge.slope.write', args: [normalizeTmString(match[1])] };
  }

  match = concrete.match(/^TRIGger:A:LEVel:CH(\d+)\s+(.+)$/i);
  if (match) {
    return {
      methodPath: 'trigger.a.level.ch[x].write',
      bindings: { channel: match[1] },
      args: [Number(match[2])],
    };
  }

  match = concrete.match(/^MEASUrement:ADDMEAS\s+(.+)$/i);
  if (match) {
    return { methodPath: 'measurement.addmeas.write', args: [normalizeTmString(match[1])] };
  }

  match = concrete.match(/^MEASUrement:MEAS(\d+):SOUrce1\s+(.+)$/i);
  if (match) {
    return {
      methodPath: 'measurement.meas[x].source1.write',
      bindings: { x: match[1] },
      args: [normalizeTmString(match[2])],
    };
  }

  match = concrete.match(/^MEASUrement:MEAS(\d+):SOUrce2\s+(.+)$/i);
  if (match) {
    return {
      methodPath: 'measurement.meas[x].source2.write',
      bindings: { x: match[1] },
      args: [normalizeTmString(match[2])],
    };
  }

  match = concrete.match(/^MEASUrement:MEAS(\d+):RESUlts:CURRentacq:MEAN\?$/i);
  if (match) {
    return {
      methodPath: 'measurement.meas[x].results.currentacq.mean.query',
      bindings: { x: match[1] },
      saveAs: command.saveAs || inferSaveAs(concrete, Number(match[1]) - 1),
    };
  }

  match = concrete.match(/^ACQuire:STOPAfter\s+(.+)$/i);
  if (match) {
    return { methodPath: 'acquire.stopafter.write', args: [normalizeTmString(match[1])] };
  }

  match = concrete.match(/^ACQuire:STATE\s+(.+)$/i);
  if (match) {
    return { methodPath: 'acquire.state.write', args: [normalizeTmString(match[1])] };
  }

  match = concrete.match(/^HORizontal:MODe\s+(.+)$/i);
  if (match) {
    return { methodPath: 'horizontal.mode.write', args: [normalizeTmString(match[1])] };
  }

  match = concrete.match(/^HORizontal:MODE:RECOrdlength\s+(.+)$/i);
  if (match) {
    return { methodPath: 'horizontal.mode.recordlength.write', args: [Number(match[1])] };
  }

  match = concrete.match(/^HORizontal:MODE:SCAle\s+(.+)$/i);
  if (match) {
    return { methodPath: 'horizontal.mode.scale.write', args: [Number(match[1])] };
  }

  match = concrete.match(/^HORizontal:FASTframe:STATE\s+(.+)$/i);
  if (match) {
    return { methodPath: 'horizontal.fastframe.state.write', args: [normalizeTmString(match[1])] };
  }

  match = concrete.match(/^HORizontal:FASTframe:COUNt\s+(.+)$/i);
  if (match) {
    return { methodPath: 'horizontal.fastframe.count.write', args: [Number(match[1])] };
  }

  match = concrete.match(/^BUS:B(\d+):TYPe\s+(.+)$/i);
  if (match) {
    return {
      methodPath: 'bus.b[x].type.write',
      bindings: { x: match[1] },
      args: [normalizeTmString(match[2])],
    };
  }

  match = concrete.match(/^BUS:B(\d+):I2C:CLOCk:SOUrce\s+(.+)$/i);
  if (match) {
    return {
      methodPath: 'bus.b[x].i2c.clock.source.write',
      bindings: { x: match[1] },
      args: [normalizeTmString(match[2])],
    };
  }

  match = concrete.match(/^BUS:B(\d+):I2C:DATa:SOUrce\s+(.+)$/i);
  if (match) {
    return {
      methodPath: 'bus.b[x].i2c.data.source.write',
      bindings: { x: match[1] },
      args: [normalizeTmString(match[2])],
    };
  }

  match = concrete.match(/^RECAll:SESsion\s+\"(.+)\"$/i);
  if (match) {
    return { methodPath: 'recall.session.write', args: [match[1]] };
  }

  match = concrete.match(/^RECAll:SETUp\s+\"(.+)\"$/i);
  if (match) {
    return { methodPath: 'recall.setup.write', args: [match[1]] };
  }

  if (/^\*RST$/i.test(concrete)) {
    return { methodPath: 'factory.write', args: [] };
  }

  if (/^\*OPC\?$/i.test(concrete)) {
    return { methodPath: 'opc.query', args: [], saveAs: command.saveAs || 'opc_status' };
  }

  if (/^\*CLS$/i.test(concrete)) {
    return { methodPath: 'cls.write', args: [] };
  }

  return null;
}

async function materializeTmDevicesStep(
  command: ResolvedCommand,
  modelFamily: string,
  index: number
): Promise<TmDevicesMaterialized | null> {
  const mapping = mapResolvedCommandToTmDevices(command);
  if (!mapping) return null;

  const search = await searchTmDevices({
    query: mapping.methodPath,
    model: modelFamily,
    limit: 5,
  });
  const exact = Array.isArray(search.data)
    ? search.data.find((doc) => String((doc as Record<string, unknown>).methodPath || '') === mapping.methodPath)
    : null;
  const methodPath = String((exact as Record<string, unknown> | null)?.methodPath || mapping.methodPath);

  const materialized = await materializeTmDevicesCall({
    methodPath,
    model: modelFamily,
    objectName: 'scope',
    placeholderBindings: mapping.bindings,
    arguments: mapping.args,
  });
  if (!materialized.ok || !materialized.data || typeof materialized.data !== 'object') return null;

  const code = String((materialized.data as Record<string, unknown>).code || '').trim();
  if (!code) return null;

  return {
    phase: classifyCommandPhase(command.concreteCommand),
    step: {
      id: `tm_step_${index + 1}`,
      type: 'tm_device_command',
      label: command.commandType === 'query' ? `Read ${command.header}` : `Call ${command.header}`,
      params: {
        code: command.commandType === 'query' && mapping.saveAs ? `${mapping.saveAs} = ${code}` : code,
        model: modelFamily,
        description: command.concreteCommand,
      },
    },
  };
}

async function materializeAndVerify(
  command: ResolvedCommand,
  commandIndex: CommandIndex,
  family?: string
): Promise<MaterializedCommand | null> {
  const record =
    commandIndex.getByHeader(command.header, family) ||
    commandIndex.getByHeader(command.header.toUpperCase(), family) ||
    commandIndex.getByHeaderPrefix(command.header, family) ||
    commandIndex.getByHeader(command.header) ||
    commandIndex.getByHeader(command.header.toUpperCase()) ||
    commandIndex.getByHeaderPrefix(command.header);

  let verified = true;
  const headerToVerify = String(command.concreteCommand || '')
    .split('?')[0]
    .trim()
    .split(/\s+/)[0];

  if (headerToVerify && !headerToVerify.startsWith('*') && !/[<>]/.test(command.header)) {
    try {
      const verification = await verifyScpiCommands({
        commands: [headerToVerify],
        modelFamily: family,
        requireExactSyntax: false,
      });
      const rows = Array.isArray(verification.data) ? (verification.data as Array<Record<string, unknown>>) : [];
      if (rows.length > 0 && rows[0].verified === false) {
        verified = false;
      }
    } catch {
      verified = true;
    }
  }

  const fallbackRecord =
    record ||
    ({
      header: command.header,
      commandId: command.header,
      commandType: command.commandType === 'query' ? 'query' : 'set',
      group: command.group,
      category: command.group,
      shortDescription: command.header,
      description: command.concreteCommand,
      families: family ? [family] : [],
      models: [],
      syntax: command.syntax,
      arguments: command.arguments.map((argument) => ({
        name: argument.name,
        type: argument.type,
        required: argument.required,
        description: argument.description || '',
        validValues: argument.validValues ? { values: argument.validValues } : {},
        defaultValue: undefined,
      })),
      queryResponse: undefined,
      codeExamples: command.examples.map((example) => ({
        description: '',
        scpi: example.scpi ? { code: example.scpi } : undefined,
        python: undefined,
        tm_devices: example.tm_devices ? { code: example.tm_devices } : undefined,
      })),
      relatedCommands: command.relatedCommands || [],
      notes: command.notes || [],
      manualReference: undefined,
    } as unknown as CommandRecord);

  return {
    record: fallbackRecord,
    concreteCommand: command.concreteCommand,
    isQuery: command.commandType === 'query' || command.concreteCommand.includes('?'),
    saveAs: command.saveAs,
    verified,
  };
}

function buildPlannerRequest(request: BuildRequest): Record<string, unknown> {
  const context = request.context || {};
  return {
    userMessage: request.query,
    outputMode: 'steps_json',
    provider: 'openai',
    apiKey: '',
    model: 'router-build',
    flowContext: {
      backend: context.backend || 'pyvisa',
      host: '127.0.0.1',
      connectionType: 'tcpip',
      modelFamily: context.modelFamily || '',
      steps: context.steps || [],
      selectedStepId: context.selectedStepId || null,
      executionSource: 'steps',
      deviceType: context.deviceType || 'SCOPE',
      alias: context.alias || request.instrumentId || 'scope1',
      instrumentMap: context.instrumentMap || [],
      validationErrors: [],
    },
    runContext: {
      runStatus: 'idle',
      logTail: '',
      auditOutput: '',
      exitCode: null,
    },
  };
}

export async function executeBuild(request: BuildRequest): Promise<MicroToolResult> {
  const startedAt = Date.now();
  const mode = detectQueryMode(request.query);
  const family = request.context?.modelFamily;
  const context = request.context || {};
  const existingSteps = context.steps || [];
  const instrumentId = request.instrumentId || context.alias || 'scope1';

  const editInstruction = detectFlowEditInstruction(request.query);
  if (editInstruction && existingSteps.length > 0) {
    return buildEditedFlowResult(request, existingSteps, editInstruction, instrumentId);
  }
  if (editInstruction && existingSteps.length === 0) {
    const payload = {
      summary: 'I need the previous flow before I can retarget or convert it.',
      findings: [
        'This request refers to a prior flow ("same thing" / "actually make that"), but no current steps were provided in context.',
      ],
      suggestedFixes: [
        'Send the previous flow steps in context, or restate the full task you want on the new channel/backend.',
      ],
      actions: [],
    };
    return {
      ok: true,
      data: {
        mode: 'info',
        clarificationNeeded: true,
        durationMs: Date.now() - startedAt,
      },
      text: `ACTIONS_JSON: ${JSON.stringify(payload)}`,
    };
  }
  const commentInstruction = detectCommentInsertInstruction(request.query);
  if (commentInstruction && existingSteps.length > 0) {
    return buildCommentInsertResult(request, existingSteps, commentInstruction, instrumentId);
  }

  if (mode === 'info') {
    const result = await handleInfoMode(request.query, family);
    return {
      ...result,
      data: {
        ...(result.data as Record<string, unknown>),
        durationMs: Date.now() - startedAt,
      },
    };
  }

  const backend = context.backend || 'pyvisa';
  const deviceType = context.deviceType || 'SCOPE';
  const buildNew = request.buildNew ?? existingSteps.length === 0;
  const providerSupplementFindings: string[] = [];
  let providerMatchDebug: ProviderMatchDebug | undefined;

  if (providerSupplementsEnabled()) {
    const providerCatalog = await getProviderCatalog();
    const providerContextMatches = findProviderSupplementMatches(providerCatalog.all(), request.query, {
      backend,
      deviceType,
      modelFamily: family,
      buildNew,
    }, {
      kinds: ['overlay'],
      limit: 2,
    });
    providerContextMatches.forEach((match) => {
      providerSupplementFindings.push(...buildProviderContextFindings(match));
    });
    const providerMatch = matchProviderSupplement(providerCatalog.all(), request.query, {
      backend,
      deviceType,
      modelFamily: family,
      buildNew,
    });

    if (providerMatch) {
      if (providerMatch.decision === 'override') {
        const providerResult = await buildProviderOverrideResult(
          request,
          providerMatch,
          existingSteps,
          startedAt
        );
        if (providerResult) return providerResult;
        providerMatchDebug = serializeProviderMatch(providerMatch, false, 'hint');
        providerSupplementFindings.push(
          ...buildProviderHintFindings(
            providerMatch,
            buildNew,
            'Planner output kept because the template did not pass post-check validation.'
          )
        );
      } else {
        providerMatchDebug = serializeProviderMatch(providerMatch, false);
        providerSupplementFindings.push(...buildProviderHintFindings(providerMatch, buildNew));
      }
    }
  }

  let plannerOutput: PlannerOutput;
  try {
    plannerOutput = await planIntent(buildPlannerRequest(request) as never);
  } catch (error) {
    return {
      ok: false,
      error: `Planner failed: ${error instanceof Error ? error.message : String(error)}`,
      text: `Could not parse intent from "${request.query}".`,
    };
  }

  const commandIndex = await getCommandIndex();
  const resolvedCommands: MaterializedCommand[] = [];
  const unresolved: string[] = [...plannerOutput.unresolved];
  const tmResolvedSteps: TmDevicesMaterialized[] = [];

  if (plannerOutput.rejection === 'out_of_scope') {
    const payload = {
      summary: 'Request is outside TekAutomate scope.',
      findings: [plannerOutput.rejectionReason || 'This request is outside TekAutomate scope.'],
      suggestedFixes: [],
      actions: [],
    };
    return {
      ok: true,
      data: {
        mode: 'rejected',
        rejection: plannerOutput.rejection,
        rejectionReason: plannerOutput.rejectionReason,
        durationMs: Date.now() - startedAt,
      ...(providerMatchDebug ? { providerMatch: providerMatchDebug } : {}),
      },
      text: `ACTIONS_JSON: ${JSON.stringify(payload)}`,
    };
  }

  if (backend === 'tm_devices') {
    const tmModel = family || 'MSO6B';
    for (const [index, resolved] of plannerOutput.resolvedCommands.entries()) {
      if (resolved.header.startsWith('STEP:')) continue;
      const materialized = await materializeTmDevicesStep(resolved, tmModel, index);
      if (!materialized) {
        unresolved.push(`Could not materialize tm_devices call for ${resolved.header}`);
        continue;
      }
      tmResolvedSteps.push(materialized);
    }
  } else {
    for (const resolved of plannerOutput.resolvedCommands) {
      if (resolved.header.startsWith('STEP:')) continue;
      const materialized = await materializeAndVerify(resolved, commandIndex, family);
      if (!materialized) {
        unresolved.push(`Could not resolve ${resolved.header}`);
        continue;
      }
      resolvedCommands.push(materialized);
    }
  }

  const specialSteps = plannerOutput.resolvedCommands
    .filter((item) => item.header.startsWith('STEP:') && item.stepType)
    .map((item, index) => ({
      id: `special_${index + 1}`,
      type: item.stepType,
      label: String(item.stepType || 'action')
        .split('_')
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
        .join(' '),
      params: item.stepParams || {},
    }));

  const conflictErrors = plannerOutput.conflicts
    .filter((conflict) => conflict.severity === 'ERROR')
    .map((conflict) => conflict.message);
  const conflictWarnings = plannerOutput.conflicts
    .filter((conflict) => conflict.severity === 'WARNING')
    .map((conflict) => conflict.message);

  if (conflictErrors.length) {
    const payload = {
      summary: 'Build blocked by resource conflicts.',
      findings: [...providerSupplementFindings, ...conflictErrors],
      suggestedFixes: plannerOutput.conflicts.map((conflict) => conflict.suggestion).filter(Boolean),
      actions: [],
    };
    return {
      ok: false,
      error: conflictErrors.join('; '),
      warnings: conflictWarnings,
      data: {
        conflicts: plannerOutput.conflicts,
        resolvedCount: backend === 'tm_devices' ? tmResolvedSteps.length : resolvedCommands.length,
        ...(providerMatchDebug ? { providerMatch: providerMatchDebug } : {}),
      },
      text: `ACTIONS_JSON: ${JSON.stringify(payload)}`,
    };
  }

  if (!resolvedCommands.length && !tmResolvedSteps.length && !specialSteps.length) {
    if (plannerOutput.rejection === 'low_confidence') {
      const payload = {
        summary: plannerOutput.rejectionReason || 'Could not build a confident action flow.',
        findings: [
          ...providerSupplementFindings,
          plannerOutput.rejectionReason || 'Could not build a confident action flow.',
          ...(plannerOutput.unsupportedSubrequests || []),
        ],
        suggestedFixes: [
          'Make the request more specific with channel, source, value, or protocol details.',
        ],
        actions: [],
      };
      return {
        ok: true,
        data: {
          mode: 'clarification_fallback',
          rejection: plannerOutput.rejection,
          rejectionReason: plannerOutput.rejectionReason,
          durationMs: Date.now() - startedAt,
          ...(providerMatchDebug ? { providerMatch: providerMatchDebug } : {}),
        },
        text: `ACTIONS_JSON: ${JSON.stringify(payload)}`,
      };
    }

    const infoFallback = await handleInfoMode(request.query, family);
    const infoData = (infoFallback.data as Record<string, unknown>) || {};
    if (Array.isArray(infoData.commands) && infoData.commands.length) {
      const infoRecords = (infoData.commands as CommandCard[])
        .map((card) => commandIndex.getByHeader(card.header, family) || commandIndex.getByHeader(card.header))
        .filter((record): record is CommandRecord => Boolean(record));
      const suggestionRecords = gatherSuggestionRecords(commandIndex, request.query, family, infoRecords);
      const suggestionFallback = buildSuggestionFallback(
        unresolved,
        suggestionRecords,
        providerSupplementFindings
      );
      return {
        ok: true,
        data: {
          mode: 'suggestion_fallback',
          reason: 'Could not resolve a full action flow. Returning SCPI suggestions and command info for manual selection.',
          unresolved,
          suggestedCommands: suggestionFallback.suggestions,
          ...infoData,
          durationMs: Date.now() - startedAt,
          ...(providerMatchDebug ? { providerMatch: providerMatchDebug } : {}),
        },
        text: `${suggestionFallback.text}\n\nRelevant command info:\n\n${infoFallback.text || ''}`,
      };
    }

    const searchFallback = buildSuggestionFallback(
      unresolved,
      gatherSuggestionRecords(commandIndex, request.query, family),
      providerSupplementFindings
    );

    return {
      ok: true,
      data: {
        mode: 'suggestion_fallback',
        resolvedCount: 0,
        unresolvedCount: unresolved.length,
        suggestedCommands: searchFallback.suggestions,
        durationMs: Date.now() - startedAt,
        ...(providerMatchDebug ? { providerMatch: providerMatchDebug } : {}),
      },
      text: searchFallback.text,
    };
  }

  const verifiedCommands = resolvedCommands.filter((command) => command.verified);
  const unverifiedCommands = resolvedCommands.filter((command) => !command.verified);

  const bodySteps: Record<string, unknown>[] = [];
  if (backend === 'tm_devices') {
    tmResolvedSteps.forEach(({ step }) => bodySteps.push(step));
  } else {
    verifiedCommands.forEach((command, index) => {
      const id = `step_${index + 1}`;
      const saveAs = command.saveAs || inferSaveAs(command.concreteCommand, index);
      bodySteps.push(
        command.isQuery
          ? queryStep(id, command.concreteCommand.endsWith('?') ? command.concreteCommand : `${command.concreteCommand}?`, command.record.header, saveAs)
          : writeStep(id, command.concreteCommand, command.record.header)
      );
    });
  }

  const byPhase = new Map<string, Record<string, unknown>[]>();
  const phaseOrder: string[] = [];
  for (const step of bodySteps) {
    const params = (step.params as Record<string, unknown>) || {};
    const phase = classifyCommandPhase(String(params.command || params.code || ''));
    if (!byPhase.has(phase)) {
      byPhase.set(phase, []);
      phaseOrder.push(phase);
    }
    byPhase.get(phase)?.push(step);
  }

  phaseOrder.sort((left, right) => {
    const leftIndex = PHASE_PRIORITY.indexOf(left as (typeof PHASE_PRIORITY)[number]);
    const rightIndex = PHASE_PRIORITY.indexOf(right as (typeof PHASE_PRIORITY)[number]);
    const normalizedLeft = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const normalizedRight = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
    if (normalizedLeft !== normalizedRight) return normalizedLeft - normalizedRight;
    return left.localeCompare(right);
  });

  const groupedSteps =
    phaseOrder.length > 1 && bodySteps.length >= 4
      ? phaseOrder.map((phase, index) => groupStep(`group_${index + 1}`, phase, byPhase.get(phase) || []))
      : bodySteps;

  groupedSteps.push(...specialSteps);

  const findings: string[] = [...providerSupplementFindings];
  if (unverifiedCommands.length) {
    findings.push(`${unverifiedCommands.length} command(s) were excluded because they could not be verified.`);
  }
  if (unresolved.length) {
    findings.push(...unresolved.slice(0, 5));
  }
  if (
    /\bfastframe\b/i.test(request.query) &&
    /\btimestamps?\b/i.test(request.query) &&
    !plannerOutput.resolvedCommands.some((command) => /FASTframe/i.test(command.concreteCommand))
  ) {
    findings.push(
      'FastFrame timestamp query is not yet resolved to a verified command path; verified setup steps were returned without guessing timestamp commands.'
    );
  }
  if (conflictWarnings.length) {
    findings.push(...conflictWarnings);
  }
  if (plannerOutput.unsupportedSubrequests?.length) {
    findings.push(...plannerOutput.unsupportedSubrequests.map((reason) => `Unsupported sub-request ignored: ${reason}`));
  }

  const payload = buildNew
    ? {
        summary: `Built ${backend === 'tm_devices' ? tmResolvedSteps.length : verifiedCommands.length} command(s) into a new flow.${unresolved.length ? ` ${unresolved.length} unresolved.` : ''}`,
        findings,
        suggestedFixes: unverifiedCommands.length ? ['Unverified commands were excluded. Use exact SCPI headers where possible.'] : [],
        actions: [
          {
            type: 'replace_flow',
            flow: {
              name: `Built from: ${request.query.slice(0, 60)}`,
              description: 'Auto-built flow from router build action',
              backend,
              deviceType,
              steps: [connectStep(instrumentId), ...groupedSteps, disconnectStep(instrumentId)],
            },
          },
        ],
      }
    : {
        summary:
          groupedSteps.length === 1 && String(groupedSteps[0]?.type || '').toLowerCase() === 'save_screenshot'
            ? 'Inserted a screenshot step into the current flow.'
            : `Built ${backend === 'tm_devices' ? tmResolvedSteps.length : verifiedCommands.length} command(s) for insertion.${unresolved.length ? ` ${unresolved.length} unresolved.` : ''}`,
        findings,
        suggestedFixes: unverifiedCommands.length ? ['Unverified commands were excluded.'] : [],
        actions: (() => {
          const screenshotOnlyIncremental =
            groupedSteps.length === 1 &&
            String(groupedSteps[0]?.type || '').toLowerCase() === 'save_screenshot';
          const inferredTarget = inferInsertTargetStepId(existingSteps, groupedSteps, request.query, context.selectedStepId);
          if (screenshotOnlyIncremental) {
            const replacedSteps = insertTopLevelStepsAfterTarget(existingSteps, groupedSteps, inferredTarget);
            return [
              {
                type: 'replace_flow',
                flow: {
                  name: `Edited from: ${request.query.slice(0, 60)}`,
                  description: 'Inserted screenshot step into the current flow',
                  backend,
                  deviceType,
                  steps: replacedSteps,
                },
              },
            ];
          }
          let currentTarget = inferredTarget;
          return groupedSteps.map((step) => {
            const action = {
              type: 'insert_step_after',
              targetStepId: currentTarget || undefined,
              newStep: step,
            };
            currentTarget = String(step.id || currentTarget || '');
            return action;
          });
        })(),
      };

  let text = `ACTIONS_JSON: ${JSON.stringify(payload)}`;
  const warnings = [...conflictWarnings];

  try {
    const checked = await postCheckResponse(
      text,
      {
        backend,
        modelFamily: family,
        originalSteps: existingSteps,
        alias: context.alias,
        instrumentMap: context.instrumentMap,
      },
      { allowMissingActionsJson: false }
    );
    text = checked.text;
    warnings.push(...checked.warnings);
    findings.push(...checked.errors);
  } catch {
    // Keep raw ACTIONS_JSON if post-check fails.
  }

  // ── RAG enrichment — attach relevant knowledge chunks ──
  // Gives the AI additional context (app notes, best practices, error guides)
  // alongside the verified command cards.
  let ragChunks: Array<{ title: string; body: string; source?: string; corpus?: string }> = [];
  try {
    const rag = await getRagIndexes();
    if (rag) {
      const queryWords = new Set(request.query.toLowerCase().split(/\s+/).filter(w => w.length > 2));
      // Search SCPI + procedural corpora for relevant context
      const scpiChunks = rag.search('scpi', request.query, 5) as Array<{ title: string; body: string; source?: string }>;
      const scopeChunks = rag.search('scope_logic', request.query, 3) as Array<{ title: string; body: string; source?: string }>;
      const appChunks = rag.search('app_logic', request.query, 2) as Array<{ title: string; body: string; source?: string }>;
      const allChunks = [...scpiChunks, ...scopeChunks, ...appChunks];

      // Filter: keep chunks whose title overlaps with query words
      ragChunks = allChunks
        .filter(c => {
          const titleWords = (c.title || '').toLowerCase().split(/\s+/);
          return titleWords.some(w => queryWords.has(w));
        })
        .slice(0, 3)
        .map(c => ({
          title: c.title,
          body: String(c.body || '').slice(0, 300),
          source: c.source,
        }));
    }
  } catch { /* RAG is non-fatal */ }

  return {
    ok: true,
    warnings: warnings.length ? Array.from(new Set(warnings)) : undefined,
    data: withProviderMatchData({
      mode: 'action',
      resolvedCount: backend === 'tm_devices' ? tmResolvedSteps.length : verifiedCommands.length,
      unresolvedCount: unresolved.length,
      excludedCount: unverifiedCommands.length,
      totalSteps: groupedSteps.length,
      phases: phaseOrder,
      commandCards: verifiedCommands.map((command) => buildCommandCard(command.record)),
      ...(ragChunks.length ? { knowledgeContext: ragChunks } : {}),
      durationMs: Date.now() - startedAt,
    }, providerMatchDebug),
    text,
  };
}
