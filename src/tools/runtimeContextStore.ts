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
    runtimeContextState.instrument = {
      connected: Boolean(instrument.connected),
      executorUrl: typeof instrument.executorUrl === 'string' && instrument.executorUrl ? instrument.executorUrl : null,
      visaResource: typeof instrument.visaResource === 'string' && instrument.visaResource ? instrument.visaResource : null,
      backend: typeof instrument.backend === 'string' && instrument.backend ? instrument.backend : 'pyvisa',
      modelFamily: typeof instrument.modelFamily === 'string' && instrument.modelFamily ? instrument.modelFamily : 'unknown',
      deviceDriver: typeof instrument.deviceDriver === 'string' && instrument.deviceDriver ? instrument.deviceDriver : null,
      liveMode: Boolean(instrument.liveMode),
    };
  }

  if (Object.prototype.hasOwnProperty.call(input, 'runLog')) {
    runtimeContextState.runLog = normalizeRunLog(input.runLog);
  }

  if (input.liveSession && typeof input.liveSession === 'object') {
    const liveSession = input.liveSession as Record<string, unknown>;
    runtimeContextState.liveSession = {
      sessionKey: typeof liveSession.sessionKey === 'string' && liveSession.sessionKey ? liveSession.sessionKey : null,
      threadId: typeof liveSession.threadId === 'string' && liveSession.threadId ? liveSession.threadId : null,
      workflowId: typeof liveSession.workflowId === 'string' && liveSession.workflowId ? liveSession.workflowId : null,
      userId: typeof liveSession.userId === 'string' && liveSession.userId ? liveSession.userId : null,
    };
  }

  runtimeContextState.updatedAt = new Date().toISOString();
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

export function getCurrentWorkflowState(): RuntimeWorkflowContext {
  return getRuntimeContextState().workflow;
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
