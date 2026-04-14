import { getRuntimeContextState } from './runtimeContextStore';

export type LiveActionToolName =
  | 'send_scpi'
  | 'capture_screenshot'
  | 'get_instrument_state'
  | 'get_visa_resources'
  | 'probe_command'
  | 'run_python'
  | 'workflow_proposal'; // fire-and-forget — no browser result required

export interface LiveActionRequest {
  id: string;
  sessionKey: string;
  toolName: LiveActionToolName;
  args: Record<string, unknown>;
  createdAt: string;
  claimedAt?: string;
  status: 'queued' | 'claimed' | 'completed' | 'failed';
}

interface PendingActionRecord extends LiveActionRequest {
  resolveHandlers: Array<(value: LiveActionResultEnvelope) => void>;
  rejectHandlers: Array<(reason?: unknown) => void>;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

export interface LiveActionResultEnvelope {
  ok: boolean;
  result?: unknown;
  error?: string;
  completedAt: string;
}

const LIVE_ACTION_TIMEOUT_MS = 45_000;
// Debounce deduplicates rapid screenshot bursts (e.g. double-clicks).
// 150ms is enough to collapse duplicates without adding visible latency.
// Previously 1500ms — that added a guaranteed 1.5s floor AND caused the
// long-poll waiter to miss the wake-up, adding up to 25s more.
const SCREENSHOT_DEBOUNCE_MS = 150;
const liveActionQueue: PendingActionRecord[] = [];
const liveActionWaiters = new Map<string, Array<(action: LiveActionRequest | null) => void>>();

function createActionId(): string {
  return `live_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function isScreenshotAction(record: LiveActionRequest | PendingActionRecord): boolean {
  return record.toolName === 'capture_screenshot';
}

function getNextQueuedRecord(sessionKey: string): PendingActionRecord | null {
  const queued = liveActionQueue.filter((item) => item.sessionKey === sessionKey && item.status === 'queued');
  if (!queued.length) return null;

  const commandLike = queued.find((item) => !isScreenshotAction(item));
  if (commandLike) return commandLike;

  const screenshots = queued
    .filter((item) => isScreenshotAction(item))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const latestScreenshot = screenshots[0];
  if (!latestScreenshot) return null;

  const ageMs = Date.now() - Date.parse(latestScreenshot.createdAt);
  if (ageMs < SCREENSHOT_DEBOUNCE_MS) {
    return null;
  }
  return latestScreenshot;
}

function notifySession(sessionKey: string) {
  const waiters = liveActionWaiters.get(sessionKey);
  if (!waiters?.length) return;
  const action = getNextQueuedRecord(sessionKey);
  if (!action) return;
  liveActionWaiters.delete(sessionKey);
  waiters.forEach((resolve) => resolve(stripRecord(action)));
}

function stripRecord(record: PendingActionRecord): LiveActionRequest {
  const {
    resolveHandlers: _resolveHandlers,
    rejectHandlers: _rejectHandlers,
    timeoutHandle: _timeoutHandle,
    ...action
  } = record;
  return action;
}

function cleanupRecord(id: string) {
  const index = liveActionQueue.findIndex((item) => item.id === id);
  if (index >= 0) {
    liveActionQueue.splice(index, 1);
  }
}

function getDefaultLiveSessionKey(): string | null {
  const runtime = getRuntimeContextState();
  if (!runtime.instrument.connected || !runtime.instrument.liveMode) return null;
  const key = String(runtime.liveSession?.sessionKey || '').trim();
  return key || null;
}

export function getPendingLiveActionCount(sessionKey?: string | null): number {
  return liveActionQueue.filter((item) => {
    if (item.status !== 'queued' && item.status !== 'claimed') return false;
    if (!sessionKey) return true;
    return item.sessionKey === sessionKey;
  }).length;
}

export async function enqueueLiveAction(params: {
  toolName: LiveActionToolName;
  args: Record<string, unknown>;
  sessionKey?: string | null;
  timeoutMs?: number;
}): Promise<LiveActionResultEnvelope> {
  const sessionKey = String(params.sessionKey || getDefaultLiveSessionKey() || '').trim();
  if (!sessionKey) {
    throw new Error('No active live TekAutomate session is registered with MCP.');
  }

  const timeoutMs = Math.max(5_000, Math.min(params.timeoutMs ?? LIVE_ACTION_TIMEOUT_MS, 120_000));
  return new Promise<LiveActionResultEnvelope>((resolve, reject) => {
    if (params.toolName === 'capture_screenshot') {
      const existingQueuedScreenshot = liveActionQueue.find(
        (item) =>
          item.sessionKey === sessionKey
          && item.status === 'queued'
          && item.toolName === 'capture_screenshot',
      );
      if (existingQueuedScreenshot) {
        existingQueuedScreenshot.args = params.args;
        existingQueuedScreenshot.createdAt = new Date().toISOString();
        existingQueuedScreenshot.resolveHandlers.push(resolve);
        existingQueuedScreenshot.rejectHandlers.push(reject);
        notifySession(sessionKey);
        return;
      }
    }

    const id = createActionId();
    const timeoutHandle = setTimeout(() => {
      const record = liveActionQueue.find((item) => item.id === id);
      cleanupRecord(id);
      const error = new Error(`Timed out waiting for TekAutomate live action result for ${params.toolName}.`);
      if (record) {
        record.rejectHandlers.forEach((handler) => handler(error));
        return;
      }
      reject(error);
    }, timeoutMs);

    const record: PendingActionRecord = {
      id,
      sessionKey,
      toolName: params.toolName,
      args: params.args,
      createdAt: new Date().toISOString(),
      status: 'queued',
      resolveHandlers: [resolve],
      rejectHandlers: [reject],
      timeoutHandle,
    };

    liveActionQueue.push(record);
    notifySession(sessionKey);

    // For screenshot actions: notifySession above returns immediately because the
    // debounce hasn't elapsed yet, so any open long-poll waiter is NOT notified.
    // Schedule a second notifySession after the debounce so the waiter wakes up
    // as soon as the action is eligible — instead of waiting up to 25s for the
    // app's next poll cycle.
    if (params.toolName === 'capture_screenshot') {
      setTimeout(() => notifySession(sessionKey), SCREENSHOT_DEBOUNCE_MS + 10);
    }
  });
}

export async function waitForNextLiveAction(sessionKey: string, timeoutMs = 25_000): Promise<LiveActionRequest | null> {
  const normalized = String(sessionKey || '').trim();
  if (!normalized) return null;

  const queued = getNextQueuedRecord(normalized);
  if (queued) {
    queued.status = 'claimed';
    queued.claimedAt = new Date().toISOString();
    return stripRecord(queued);
  }

  return new Promise<LiveActionRequest | null>((resolve) => {
    const timeoutHandle = setTimeout(() => {
      const waiters = liveActionWaiters.get(normalized) || [];
      liveActionWaiters.set(
        normalized,
        waiters.filter((waiter) => waiter !== wrappedResolve),
      );
      resolve(null);
    }, Math.max(1_000, Math.min(timeoutMs, 30_000)));

    const wrappedResolve = (action: LiveActionRequest | null) => {
      clearTimeout(timeoutHandle);
      if (!action) {
        resolve(null);
        return;
      }
      const queuedRecord = liveActionQueue.find((item) => item.id === action.id);
      if (queuedRecord && queuedRecord.status === 'queued') {
        queuedRecord.status = 'claimed';
        queuedRecord.claimedAt = new Date().toISOString();
        resolve(stripRecord(queuedRecord));
        return;
      }
      resolve(action);
    };

    const waiters = liveActionWaiters.get(normalized) || [];
    waiters.push(wrappedResolve);
    liveActionWaiters.set(normalized, waiters);
  });
}

export function pushLiveProposal(proposal: unknown, sessionKey: string): void {
  const proposalKey = `${sessionKey}:proposal`;
  const id = createActionId();
  const record: PendingActionRecord = {
    id,
    sessionKey: proposalKey,
    toolName: 'workflow_proposal',
    args: { proposal },
    createdAt: new Date().toISOString(),
    status: 'queued',
    resolveHandlers: [],
    rejectHandlers: [],
    timeoutHandle: setTimeout(() => cleanupRecord(id), 120_000),
  };
  liveActionQueue.push(record);
  notifySession(proposalKey);
}

export function completeLiveAction(input: {
  id: string;
  sessionKey?: string | null;
  ok: boolean;
  result?: unknown;
  error?: string;
}): boolean {
  const record = liveActionQueue.find((item) => item.id === input.id);
  if (!record) return false;
  if (input.sessionKey && record.sessionKey !== input.sessionKey) return false;

  clearTimeout(record.timeoutHandle);
  record.status = input.ok ? 'completed' : 'failed';
  const payload: LiveActionResultEnvelope = {
    ok: input.ok,
    result: input.result,
    error: input.error,
    completedAt: new Date().toISOString(),
  };
  record.resolveHandlers.forEach((handler) => handler(payload));
  cleanupRecord(record.id);
  notifySession(record.sessionKey);
  return true;
}
