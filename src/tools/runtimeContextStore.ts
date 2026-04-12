export interface RuntimeWorkflowStep {
  id?: string;
  index?: number;
  type?: string;
  label?: string;
  command?: string;
}

export interface RuntimeWorkflowContext {
  stepCount: number;
  steps: RuntimeWorkflowStep[];
  selectedStep: string | null;
  validationErrors: string[];
  backend: string;
  modelFamily: string;
  deviceDriver: string | null;
  isEmpty: boolean;
}

export interface RuntimeInstrumentInfo {
  connected: boolean;
  executorUrl: string | null;
  visaResource: string | null;
  backend: string;
  modelFamily: string;
  deviceDriver: string | null;
  liveMode: boolean;
  devices?: Array<Record<string, unknown>>;
}

export interface RuntimeRunLogInfo {
  hasLogs: boolean;
  lineCount: number;
  tailLineCount: number;
  logTail: string;
  lastLine: string;
}

export interface RuntimeLiveSessionInfo {
  sessionKey: string | null;
  threadId: string | null;
  workflowId: string | null;
  userId: string | null;
}

interface RuntimeContextState {
  updatedAt: string;
  workflow: RuntimeWorkflowContext;
  instrument: RuntimeInstrumentInfo;
  runLog: RuntimeRunLogInfo;
  liveSession: RuntimeLiveSessionInfo;
}

const DEFAULT_WORKFLOW: RuntimeWorkflowContext = {
  stepCount: 0,
  steps: [],
  selectedStep: null,
  validationErrors: [],
  backend: 'pyvisa',
  modelFamily: 'unknown',
  deviceDriver: null,
  isEmpty: true,
};

const DEFAULT_INSTRUMENT: RuntimeInstrumentInfo = {
  connected: false,
  executorUrl: null,
  visaResource: null,
  backend: 'pyvisa',
  modelFamily: 'unknown',
  deviceDriver: null,
  liveMode: false,
  devices: [],
};

const DEFAULT_RUN_LOG: RuntimeRunLogInfo = {
  hasLogs: false,
  lineCount: 0,
  tailLineCount: 0,
  logTail: '',
  lastLine: '',
};

const DEFAULT_LIVE_SESSION: RuntimeLiveSessionInfo = {
  sessionKey: null,
  threadId: null,
  workflowId: null,
  userId: null,
};

let runtimeContextState: RuntimeContextState = {
  updatedAt: new Date(0).toISOString(),
  workflow: DEFAULT_WORKFLOW,
  instrument: DEFAULT_INSTRUMENT,
  runLog: DEFAULT_RUN_LOG,
  liveSession: DEFAULT_LIVE_SESSION,
};

// ── Active session registry ──────────────────────────────────────────────────
// Tracks every sessionKey that has pushed to /runtime-context recently.
// Keyed by sessionKey → last push timestamp (ms).
// Used by auto-staging to push proposals to ALL active browsers, not just the
// last one to push (which would cause cross-browser session collision).
const ACTIVE_SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ACTIVE_SESSIONS = 50;
const activeSessionRegistry = new Map<string, number>();

function registerActiveSession(sessionKey: string) {
  activeSessionRegistry.set(sessionKey, Date.now());
  // Evict expired entries if we hit the cap
  if (activeSessionRegistry.size > MAX_ACTIVE_SESSIONS) {
    const cutoff = Date.now() - ACTIVE_SESSION_TTL_MS;
    for (const [key, ts] of activeSessionRegistry) {
      if (ts < cutoff) activeSessionRegistry.delete(key);
      if (activeSessionRegistry.size <= MAX_ACTIVE_SESSIONS) break;
    }
  }
}

export function getActiveSessionKeys(): string[] {
  const cutoff = Date.now() - ACTIVE_SESSION_TTL_MS;
  const keys: string[] = [];
  for (const [key, ts] of activeSessionRegistry) {
    if (ts >= cutoff) keys.push(key);
  }
  return keys;
}

// ── Pending MCP session key queue ────────────────────────────────────────────
// When /chatkit/session is called with a sessionKey, it's enqueued here.
// When a new /mcp connection is established, it dequeues the oldest entry.
// FIFO order ensures ChatKit sessions and MCP connections are matched correctly
// without relying on shared liveSession state that can be overwritten by other browsers.
const pendingMcpSessionKeys: Array<{ key: string; enqueuedAt: number }> = [];
const PENDING_KEY_TTL_MS = 30_000; // 30 seconds — discard stale entries

export function enqueueMcpSessionKey(sessionKey: string): void {
  if (!sessionKey) return;
  const now = Date.now();
  // Evict stale entries first
  while (pendingMcpSessionKeys.length > 0 && now - pendingMcpSessionKeys[0].enqueuedAt > PENDING_KEY_TTL_MS) {
    pendingMcpSessionKeys.shift();
  }
  pendingMcpSessionKeys.push({ key: sessionKey, enqueuedAt: now });
  console.log(`[runtimeContextStore] Enqueued MCP sessionKey=${sessionKey} (queue size=${pendingMcpSessionKeys.length})`);
}

export function dequeueMcpSessionKey(): string | null {
  const now = Date.now();
  // Evict stale entries
  while (pendingMcpSessionKeys.length > 0 && now - pendingMcpSessionKeys[0].enqueuedAt > PENDING_KEY_TTL_MS) {
    pendingMcpSessionKeys.shift();
  }
  const entry = pendingMcpSessionKeys.shift();
  if (entry) {
    console.log(`[runtimeContextStore] Dequeued MCP sessionKey=${entry.key} (queue size=${pendingMcpSessionKeys.length})`);
    return entry.key;
  }
  return null;
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function normalizeSteps(value: unknown): RuntimeWorkflowStep[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const step = item as Record<string, unknown>;
      return {
        id: typeof step.id === 'string' ? step.id : undefined,
        index: typeof step.index === 'number' ? step.index : index + 1,
        type: typeof step.type === 'string' ? step.type : undefined,
        label: typeof step.label === 'string' ? step.label : undefined,
        command: typeof step.command === 'string' ? step.command : undefined,
      } satisfies RuntimeWorkflowStep;
    })
    .filter((item) => item !== null) as RuntimeWorkflowStep[];
}

function normalizeRunLog(value: unknown): RuntimeRunLogInfo {
  const raw = String(value || '');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const tailLines = lines.slice(-60);
  return {
    hasLogs: tailLines.length > 0,
    lineCount: lines.length,
    tailLineCount: tailLines.length,
    logTail: tailLines.join('\n'),
    lastLine: tailLines.length ? tailLines[tailLines.length - 1] : '',
  };
}

export function updateRuntimeContext(input: {
  workflow?: unknown;
  instrument?: unknown;
  runLog?: unknown;
  liveSession?: unknown;
}) {
  if (input.workflow && typeof input.workflow === 'object') {
    const workflow = input.workflow as Record<string, unknown>;
    const steps = normalizeSteps(workflow.steps);
    runtimeContextState.workflow = {
      stepCount: typeof workflow.stepCount === 'number' ? workflow.stepCount : steps.length,
      steps,
      selectedStep: typeof workflow.selectedStep === 'string' ? workflow.selectedStep : null,
      validationErrors: toStringList(workflow.validationErrors),
      backend: typeof workflow.backend === 'string' && workflow.backend ? workflow.backend : 'pyvisa',
      modelFamily: typeof workflow.modelFamily === 'string' && workflow.modelFamily ? workflow.modelFamily : 'unknown',
      deviceDriver: typeof workflow.deviceDriver === 'string' && workflow.deviceDriver ? workflow.deviceDriver : null,
      isEmpty: typeof workflow.isEmpty === 'boolean' ? workflow.isEmpty : steps.length === 0,
    };
  }

  if (input.instrument && typeof input.instrument === 'object') {
    const instrument = input.instrument as Record<string, unknown>;
    const previous = runtimeContextState.instrument;
    const nextExecutorUrl =
      typeof instrument.executorUrl === 'string' && instrument.executorUrl
        ? instrument.executorUrl
        : previous.executorUrl;
    const nextVisaResource =
      typeof instrument.visaResource === 'string' && instrument.visaResource
        ? instrument.visaResource
        : previous.visaResource;
    const nextBackend =
      typeof instrument.backend === 'string' && instrument.backend
        ? instrument.backend
        : previous.backend || 'pyvisa';
    const nextModelFamily =
      typeof instrument.modelFamily === 'string' && instrument.modelFamily
        ? instrument.modelFamily
        : previous.modelFamily || 'unknown';
    const nextDeviceDriver =
      typeof instrument.deviceDriver === 'string' && instrument.deviceDriver
        ? instrument.deviceDriver
        : previous.deviceDriver;
    const explicitConnected = typeof instrument.connected === 'boolean' ? instrument.connected : null;
    const nextLiveMode =
      typeof instrument.liveMode === 'boolean'
        ? instrument.liveMode
        : previous.liveMode;

    const rawInstrumentMap = Array.isArray((instrument as any).instrumentMap) ? (instrument as any).instrumentMap : [];
    const normalizedDevices = rawInstrumentMap
      .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>) : null))
      .filter((item): item is Record<string, unknown> => item !== null)
      .map((item, idx) => ({
        deviceId:
          typeof item.alias === 'string' && item.alias
            ? item.alias
            : typeof item.deviceId === 'string' && item.deviceId
              ? item.deviceId
              : `device-${idx}`,
        visaResource: typeof item.visaResource === 'string' ? item.visaResource : null,
        backend: typeof item.backend === 'string' ? item.backend : undefined,
        modelFamily: typeof item.modelFamily === 'string' ? item.modelFamily : undefined,
        deviceDriver: typeof item.deviceDriver === 'string' ? item.deviceDriver : undefined,
        alias: typeof item.alias === 'string' ? item.alias : undefined,
        host: typeof item.host === 'string' ? item.host : undefined,
        connectionType: typeof item.connectionType === 'string' ? item.connectionType : undefined,
        visaBackend: typeof item.visaBackend === 'string' ? item.visaBackend : undefined,
      }));

    runtimeContextState.instrument = {
      connected:
        explicitConnected === true
          ? true
          : explicitConnected === false
            ? false
            : Boolean(nextExecutorUrl && nextLiveMode),
      executorUrl: nextExecutorUrl,
      visaResource: nextVisaResource,
      backend: nextBackend,
      modelFamily: nextModelFamily,
      deviceDriver: nextDeviceDriver,
      liveMode: nextLiveMode,
      devices: normalizedDevices.length > 0 ? normalizedDevices : previous.devices || [],
    };
  }

  if (Object.prototype.hasOwnProperty.call(input, 'runLog')) {
    runtimeContextState.runLog = normalizeRunLog(input.runLog);
  }

  if (input.liveSession && typeof input.liveSession === 'object') {
    const liveSession = input.liveSession as Record<string, unknown>;
    const newKey = typeof liveSession.sessionKey === 'string' && liveSession.sessionKey ? liveSession.sessionKey : null;
    if (newKey) registerActiveSession(newKey);
    runtimeContextState.liveSession = {
      sessionKey: newKey,
      threadId: typeof liveSession.threadId === 'string' && liveSession.threadId ? liveSession.threadId : null,
      workflowId: typeof liveSession.workflowId === 'string' && liveSession.workflowId ? liveSession.workflowId : null,
      userId: typeof liveSession.userId === 'string' && liveSession.userId ? liveSession.userId : null,
    };
  }

  runtimeContextState.updatedAt = new Date().toISOString();

  // Also store workflow per-session so each browser's workflow is isolated.
  const pushedSessionKey = runtimeContextState.liveSession.sessionKey;
  if (pushedSessionKey && input.workflow) {
    setWorkflowForSession(pushedSessionKey, runtimeContextState.workflow);
  }

  return getRuntimeContextState();
}

export function getRuntimeContextState(): RuntimeContextState {
  return {
    updatedAt: runtimeContextState.updatedAt,
    workflow: {
      ...runtimeContextState.workflow,
      steps: runtimeContextState.workflow.steps.map((step) => ({ ...step })),
      validationErrors: [...runtimeContextState.workflow.validationErrors],
    },
    instrument: { ...runtimeContextState.instrument },
    runLog: { ...runtimeContextState.runLog },
    liveSession: { ...runtimeContextState.liveSession },
  };
}

// ── Per-session workflow store ───────────────────────────────────────────────
// Each browser has a unique sessionKey (from sessionStorage). When it pushes
// /runtime-context, the workflow is stored under that key. getCurrentWorkflow
// uses __connectionSessionKey to look up the right browser's workflow — no
// cross-session contamination even when multiple browsers are open.
const WORKFLOW_TTL_MS = 90_000;
const workflowBySession = new Map<string, { workflow: RuntimeWorkflowContext; updatedAt: number }>();

export function setWorkflowForSession(sessionKey: string, workflow: RuntimeWorkflowContext): void {
  workflowBySession.set(sessionKey, { workflow, updatedAt: Date.now() });
  // Evict expired entries
  const cutoff = Date.now() - WORKFLOW_TTL_MS;
  for (const [key, entry] of workflowBySession) {
    if (entry.updatedAt < cutoff) workflowBySession.delete(key);
  }
}

export function getWorkflowForSession(sessionKey: string): RuntimeWorkflowContext | null {
  const entry = workflowBySession.get(sessionKey);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > WORKFLOW_TTL_MS) {
    workflowBySession.delete(sessionKey);
    return null;
  }
  return { ...entry.workflow, steps: entry.workflow.steps.map((s) => ({ ...s })) };
}

export function getCurrentWorkflowState(): RuntimeWorkflowContext {
  const state = getRuntimeContextState();
  const age = Date.now() - new Date(state.updatedAt).getTime();
  if (age > WORKFLOW_TTL_MS) return { ...DEFAULT_WORKFLOW };
  return state.workflow;
}

export function getInstrumentInfoState(): RuntimeInstrumentInfo {
  return getRuntimeContextState().instrument;
}

export function getRunLogState(): RuntimeRunLogInfo {
  return getRuntimeContextState().runLog;
}

export function getLiveSessionState(): RuntimeLiveSessionInfo {
  return getRuntimeContextState().liveSession;
}
