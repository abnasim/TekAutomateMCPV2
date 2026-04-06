/**
 * LiveSessionState — server-side session management for Live copilot mode.
 *
 * TekAutomate owns the canonical session context, then projects it into
 * either provider (OpenAI / Anthropic) request format. Provider thread IDs
 * are optional accelerators, not the source of truth.
 */

export interface LiveSessionState {
  /** Unique session id */
  sessionId: string;
  /** Provider in use */
  provider: 'openai' | 'anthropic';
  /** Model in use */
  model: string;
  /** Provider-specific thread/conversation id (optional accelerator) */
  providerThreadId?: string;
  /** Active instrument endpoint */
  instrumentEndpoint?: {
    executorUrl: string;
    visaResource: string;
    backend: string;
  };
  /** Rolling summary of the session so far (compact text) */
  rollingSummary: string;
  /** Recent observations from screenshots/instrument state */
  recentObservations: string[];
  /** Recent tool calls and their results (last N) */
  recentToolResults: Array<{
    tool: string;
    args: Record<string, unknown>;
    resultSummary: string;
    timestamp: number;
  }>;
  /** Last screenshot metadata (not the image data itself) */
  lastScreenshot?: {
    timestamp: number;
    sizeBytes: number;
    hash?: string;
  };
  /** Context diagnostics per turn */
  contextDiagnostics: {
    systemPromptChars: number;
    historyChars: number;
    imagePayloadBytes: number;
    toolResultChars: number;
    totalEstimatedTokens: number;
  };
  /** Number of turns in this session */
  turnCount: number;
  /** Session start time */
  startedAt: number;
  /** Last activity time */
  lastActivityAt: number;
}

/** In-memory session store keyed by sessionId */
const sessions = new Map<string, LiveSessionState>();

/** Max recent tool results to keep */
const MAX_TOOL_RESULTS = 8;
/** Max recent observations */
const MAX_OBSERVATIONS = 5;
/** Chars threshold to trigger summary compression */
const SUMMARY_COMPRESS_THRESHOLD = 3000;

export function createSession(
  sessionId: string,
  provider: 'openai' | 'anthropic',
  model: string,
  instrumentEndpoint?: LiveSessionState['instrumentEndpoint']
): LiveSessionState {
  const session: LiveSessionState = {
    sessionId,
    provider,
    model,
    instrumentEndpoint,
    rollingSummary: '',
    recentObservations: [],
    recentToolResults: [],
    contextDiagnostics: {
      systemPromptChars: 0,
      historyChars: 0,
      imagePayloadBytes: 0,
      toolResultChars: 0,
      totalEstimatedTokens: 0,
    },
    turnCount: 0,
    lastActivityAt: Date.now(),
    startedAt: Date.now(),
  };
  sessions.set(sessionId, session);
  return session;
}

export function getSession(sessionId: string): LiveSessionState | undefined {
  return sessions.get(sessionId);
}

export function getOrCreateSession(
  sessionId: string,
  provider: 'openai' | 'anthropic',
  model: string,
  instrumentEndpoint?: LiveSessionState['instrumentEndpoint']
): LiveSessionState {
  const existing = sessions.get(sessionId);
  if (existing) {
    existing.lastActivityAt = Date.now();
    // Update endpoint if changed
    if (instrumentEndpoint) {
      existing.instrumentEndpoint = instrumentEndpoint;
    }
    return existing;
  }
  return createSession(sessionId, provider, model, instrumentEndpoint);
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId);
}

/**
 * Record a tool call result in the session.
 */
export function recordToolResult(
  session: LiveSessionState,
  tool: string,
  args: Record<string, unknown>,
  resultSummary: string
): void {
  session.recentToolResults.push({
    tool,
    args,
    resultSummary: resultSummary.slice(0, 500),
    timestamp: Date.now(),
  });
  if (session.recentToolResults.length > MAX_TOOL_RESULTS) {
    session.recentToolResults = session.recentToolResults.slice(-MAX_TOOL_RESULTS);
  }
  session.lastActivityAt = Date.now();
}

/**
 * Record an observation (from screenshot analysis, instrument state, etc.)
 */
export function recordObservation(session: LiveSessionState, observation: string): void {
  session.recentObservations.push(observation.slice(0, 500));
  if (session.recentObservations.length > MAX_OBSERVATIONS) {
    session.recentObservations = session.recentObservations.slice(-MAX_OBSERVATIONS);
  }
  session.lastActivityAt = Date.now();
}

/**
 * Update screenshot metadata.
 */
export function recordScreenshot(session: LiveSessionState, sizeBytes: number, hash?: string): void {
  session.lastScreenshot = {
    timestamp: Date.now(),
    sizeBytes,
    hash,
  };
  session.lastActivityAt = Date.now();
}

/**
 * Update the rolling summary. If the summary is getting long, compress it.
 */
export function updateSummary(session: LiveSessionState, newSummaryFragment: string): void {
  session.rollingSummary = session.rollingSummary
    ? `${session.rollingSummary}\n${newSummaryFragment}`
    : newSummaryFragment;

  // If summary is getting too long, keep only the most recent portion
  if (session.rollingSummary.length > SUMMARY_COMPRESS_THRESHOLD) {
    const lines = session.rollingSummary.split('\n');
    // Keep the last ~60% of lines
    const keepFrom = Math.floor(lines.length * 0.4);
    session.rollingSummary = lines.slice(keepFrom).join('\n');
  }
  session.lastActivityAt = Date.now();
}

/**
 * Update context diagnostics after a turn.
 */
export function updateContextDiagnostics(
  session: LiveSessionState,
  diagnostics: Partial<LiveSessionState['contextDiagnostics']>
): void {
  Object.assign(session.contextDiagnostics, diagnostics);
  // Rough token estimate: ~4 chars per token
  const totalChars =
    (session.contextDiagnostics.systemPromptChars || 0) +
    (session.contextDiagnostics.historyChars || 0) +
    (session.contextDiagnostics.toolResultChars || 0);
  session.contextDiagnostics.totalEstimatedTokens = Math.ceil(totalChars / 4);
  session.lastActivityAt = Date.now();
}

/**
 * Increment turn count.
 */
export function incrementTurn(session: LiveSessionState): void {
  session.turnCount += 1;
  session.lastActivityAt = Date.now();
}

/**
 * Build a compact context string from the session state.
 * This gets injected into the system prompt for live mode turns.
 * Designed to be small (~500-1500 chars) to keep token usage low.
 */
export function buildSessionContext(session: LiveSessionState): string {
  const parts: string[] = [];

  if (session.rollingSummary) {
    parts.push(`## Session Summary (turn ${session.turnCount})`);
    parts.push(session.rollingSummary);
  }

  if (session.recentObservations.length > 0) {
    parts.push('## Recent Observations');
    session.recentObservations.forEach((obs) => parts.push(`- ${obs}`));
  }

  if (session.recentToolResults.length > 0) {
    parts.push('## Recent Tool Results');
    session.recentToolResults.slice(-3).forEach((tr) => {
      parts.push(`- ${tr.tool}: ${tr.resultSummary}`);
    });
  }

  if (session.lastScreenshot) {
    const ago = Math.round((Date.now() - session.lastScreenshot.timestamp) / 1000);
    parts.push(`## Last Screenshot: ${ago}s ago (${Math.round(session.lastScreenshot.sizeBytes / 1024)}KB)`);
  }

  return parts.join('\n');
}

/**
 * Clean up stale sessions (older than 2 hours).
 */
export function cleanupStaleSessions(): number {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  let cleaned = 0;
  for (const [id, session] of sessions) {
    if (session.lastActivityAt < cutoff) {
      sessions.delete(id);
      cleaned += 1;
    }
  }
  return cleaned;
}
