export interface ToolSourceMeta {
  file?: string;
  commandId?: string;
  section?: string;
  score?: number;
  type?: string;
  [key: string]: unknown;
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  data: T;
  sourceMeta: ToolSourceMeta[];
  warnings: string[];
  paging?: {
    offset: number;
    limit: number;
    returned: number;
    nextOffset?: number;
    hasMore: boolean;
  };
}

export type InstrumentOutputMode = 'clean' | 'verbose';

export interface McpChatRequest {
  userMessage: string;
  attachments?: McpChatAttachment[];
  outputMode: 'steps_json' | 'blockly_xml' | 'chat';
  interactionMode?: 'build' | 'chat' | 'live';
  buildNew?: boolean;
  buildBrief?: {
    intent: string;
    diagnosticDomain: string[];
    channels: string[];
    protocols: string[];
    signalType?: string;
    dataRate?: string;
    closureType?: string;
    probing?: string;
    measurementGoals: string[];
    artifactGoals: string[];
    operatingModeHints: string[];
    unresolvedQuestions: string[];
    suggestedChecks: string[];
    secondaryEvidence?: string[];
  };
  intent?: 'default' | 'command_explain';
  mode?: 'mcp_only' | 'mcp_ai';
  routerEnabled?: boolean;
  routerPreferred?: boolean;
  routerOnly?: boolean;
  provider: 'openai' | 'anthropic';
  apiKey: string;
  model: string;
  toolCallMode?: boolean;
  openaiAssistantId?: string;
  openaiThreadId?: string;
  scpiContext?: unknown[];
  tmContext?: unknown[];
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  flowContext: {
    backend: string;
    host: string;
    port?: number;
    connectionType: string;
    modelFamily: string;
    firmware?: string;
    steps: Array<Record<string, unknown>>;
    selectedStepId: string | null;
    executionSource: 'steps' | 'blockly' | 'live';
    deviceType?: string;
    deviceDriver?: string;
    visaBackend?: string;
    alias?: string;
    instrumentMap?: Array<{
      alias: string;
      backend: string;
      host?: string;
      connectionType?: string;
      deviceType?: string;
      deviceDriver?: string;
      visaBackend?: string;
      visaResource?: string;
    }>;
    selectedStep?: Record<string, unknown> | null;
    validationErrors?: string[];
  };
  runContext: {
    runStatus: 'idle' | 'running' | 'done' | 'error' | 'connecting';
    logTail: string;
    auditOutput: string;
    exitCode: number | null;
    duration?: string;
  };
  instrumentEndpoint?: {
    executorUrl: string;
    visaResource: string;
    backend: string;
    liveMode?: boolean;
    outputMode?: InstrumentOutputMode;
  };
  routerBaselineText?: string;
}

export interface McpChatAttachment {
  name: string;
  mimeType: string;
  size: number;
  dataUrl?: string;
  textExcerpt?: string;
}

export interface McpChatError {
  type: 'validation_error' | 'tool_error' | 'provider_error';
  message: string;
  details?: string[];
}

export function extractReplaceFlowSteps(
  action: Record<string, unknown>
): Array<Record<string, unknown>> | null {
  if (Array.isArray(action.steps)) {
    return action.steps as Array<Record<string, unknown>>;
  }
  const flow = action.flow as Record<string, unknown> | undefined;
  if (flow && Array.isArray(flow.steps)) {
    return flow.steps as Array<Record<string, unknown>>;
  }
  const payload = action.payload as Record<string, unknown> | undefined;
  if (payload && Array.isArray(payload.steps)) {
    return payload.steps as Array<Record<string, unknown>>;
  }
  const payloadFlow = payload?.flow as Record<string, unknown> | undefined;
  if (payloadFlow && Array.isArray(payloadFlow.steps)) {
    return payloadFlow.steps as Array<Record<string, unknown>>;
  }
  return null;
}
