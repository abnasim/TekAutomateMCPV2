import { sendScpiProxy } from '../core/instrumentProxy';
import type { ToolResult } from '../core/schemas';

interface Input {
  action: 'snapshot' | 'diff' | 'inspect';
  executorUrl?: string;
  visaResource?: string;
  backend?: string;
  liveMode?: boolean;
  timeoutMs?: number;
  modelFamily?: string;
  /** Optional filter — only return commands/changes under this SCPI root (e.g. "TRIGGER", "BUS", "MEASUREMENT") */
  filter?: string;
  /** For inspect: max commands to return (default 50) */
  limit?: number;
  /** Pre-fetched *LRN? response from browser executor (bypasses sendScpiProxy) */
  _lrnResponse?: string;
}

// ── In-memory snapshot store (per instrument) ───────────────────────
interface Snapshot {
  instrument: string;
  timestamp: string;
  commands: Map<string, string>; // header → value
  raw: string;
}

const snapshots = new Map<string, Snapshot>(); // keyed by visaResource

// ── Parse *LRN? response into command → value map ───────────────────
function parseLrnResponse(raw: string): Map<string, string> {
  const commands = new Map<string, string>();
  // Split on semicolons, handle leading colons
  const parts = raw.split(';').map(s => s.trim()).filter(Boolean);

  for (const part of parts) {
    // Remove leading colon
    const clean = part.startsWith(':') ? part.slice(1) : part;
    if (!clean) continue;

    // Split into header and value at the first space
    const spaceIdx = clean.indexOf(' ');
    if (spaceIdx === -1) {
      // Command with no value (like *RST)
      commands.set(clean.toUpperCase(), '');
    } else {
      const header = clean.slice(0, spaceIdx).toUpperCase();
      const value = clean.slice(spaceIdx + 1).trim();
      commands.set(header, value);
    }
  }

  return commands;
}

// ── Diff two snapshots ──────────────────────────────────────────────
interface DiffEntry {
  command: string;
  type: 'changed' | 'added' | 'removed';
  before?: string;
  after?: string;
  /** Full set command to reproduce the change */
  scpi: string;
}

function diffSnapshots(
  before: Map<string, string>,
  after: Map<string, string>,
  filter?: string,
): DiffEntry[] {
  const changes: DiffEntry[] = [];
  const filterUpper = filter?.toUpperCase();

  // Find changed and added
  for (const [header, afterValue] of after) {
    if (filterUpper && !header.startsWith(filterUpper)) continue;

    const beforeValue = before.get(header);
    if (beforeValue === undefined) {
      changes.push({
        command: header,
        type: 'added',
        after: afterValue,
        scpi: afterValue ? `${header} ${afterValue}` : header,
      });
    } else if (beforeValue !== afterValue) {
      changes.push({
        command: header,
        type: 'changed',
        before: beforeValue,
        after: afterValue,
        scpi: afterValue ? `${header} ${afterValue}` : header,
      });
    }
  }

  // Find removed
  for (const [header, beforeValue] of before) {
    if (filterUpper && !header.startsWith(filterUpper)) continue;
    if (!after.has(header)) {
      changes.push({
        command: header,
        type: 'removed',
        before: beforeValue,
        scpi: '',
      });
    }
  }

  return changes;
}

// ── Format diff as compact text ─────────────────────────────────────
function formatDiffText(changes: DiffEntry[]): string {
  if (changes.length === 0) return 'No changes detected.';

  const lines: string[] = [];
  const changed = changes.filter(c => c.type === 'changed');
  const added = changes.filter(c => c.type === 'added');
  const removed = changes.filter(c => c.type === 'removed');

  if (changed.length) {
    lines.push(`Changed (${changed.length}):`);
    for (const c of changed) {
      lines.push(`  ${c.command}: ${c.before} → ${c.after}`);
    }
  }
  if (added.length) {
    lines.push(`Added (${added.length}):`);
    for (const c of added) {
      lines.push(`  ${c.scpi}`);
    }
  }
  if (removed.length) {
    lines.push(`Removed (${removed.length}):`);
    for (const c of removed) {
      lines.push(`  ${c.command} (was: ${c.before})`);
    }
  }

  return lines.join('\n');
}

// ── Get *LRN? response — either pre-fetched from browser or via proxy ──
async function queryLrn(input: Input): Promise<{ ok: boolean; response: string; instrument: string; error?: string }> {
  // If browser already fetched *LRN? and passed it, use that directly
  if (input._lrnResponse) {
    try {
      const parsed = JSON.parse(input._lrnResponse);
      const data = parsed?.data ?? parsed;
      const responses = (data?.responses ?? data?.results ?? []) as Array<{ command?: string; response?: string }>;
      const lrnEntry = responses.find(r => r.command?.includes('LRN') || r.response?.includes('RST'));
      const lrnText = lrnEntry?.response || String(data?.stdout || '');
      if (lrnText) {
        return { ok: true, response: lrnText.trim(), instrument: input.visaResource || 'browser-executor' };
      }
    } catch { /* fall through to proxy path */ }
  }

  if (!input.executorUrl) {
    return { ok: false, response: '', instrument: '', error: 'No executorUrl — instrument not connected.' };
  }

  const timeoutMs = Math.max(3000, Math.min(input.timeoutMs ?? 10000, 30000));

  // Pre-flight check
  const idnResult = await sendScpiProxy(
    {
      executorUrl: input.executorUrl,
      visaResource: input.visaResource,
      backend: input.backend,
      liveMode: true,
      outputMode: 'clean',
    },
    ['*IDN?'],
    3000,
  );

  const idnData = idnResult.data as Record<string, unknown>;
  const idnResponses = (idnData?.responses ?? idnData?.results ?? []) as Array<{ response?: string; error?: string }>;
  const instrument = idnResponses[0]?.response?.trim() || '';

  if (!instrument) {
    return { ok: false, response: '', instrument: '', error: 'Instrument not reachable. *IDN? did not respond.' };
  }

  // Send *LRN?
  const lrnResult = await sendScpiProxy(
    {
      executorUrl: input.executorUrl,
      visaResource: input.visaResource,
      backend: input.backend,
      liveMode: true,
      outputMode: 'clean',
    },
    ['*LRN?'],
    timeoutMs,
  );

  const lrnData = lrnResult.data as Record<string, unknown>;
  const lrnResponses = (lrnData?.responses ?? lrnData?.results ?? []) as Array<{ response?: string; error?: string }>;
  const lrnResponse = lrnResponses[0]?.response?.trim()
    || String(lrnData?.stdout || '').trim();

  if (!lrnResponse) {
    return { ok: false, response: '', instrument, error: '*LRN? returned empty response.' };
  }

  return { ok: true, response: lrnResponse, instrument };
}

// ── Main discover function ──────────────────────────────────────────
export async function discoverScpi(input: Input): Promise<ToolResult<Record<string, unknown>>> {
  if (!input.action || !['snapshot', 'diff', 'inspect'].includes(input.action)) {
    return { ok: false, data: { error: 'INVALID_ACTION', message: 'action must be "snapshot", "diff", or "inspect".' }, sourceMeta: [], warnings: ['Valid actions: snapshot, diff, inspect'] };
  }

  const hasForwardedLrn = Boolean(String(input._lrnResponse || '').trim());
  const requiresLiveQuery = input.action !== 'inspect' && !hasForwardedLrn;

  if (requiresLiveQuery && !input.executorUrl) {
    return { ok: false, data: { error: 'NO_INSTRUMENT', message: 'No instrument connected.' }, sourceMeta: [], warnings: ['No executorUrl.'] };
  }
  if (requiresLiveQuery && !input.liveMode) {
    return { ok: false, data: { error: 'NOT_LIVE', message: 'liveMode must be true.' }, sourceMeta: [], warnings: ['liveMode is not enabled.'] };
  }

  const key = input.visaResource || 'default';

  // ── SNAPSHOT ──────────────────────────────────────────────────────
  if (input.action === 'snapshot') {
    const lrn = await queryLrn(input);
    if (!lrn.ok) {
      return { ok: false, data: { error: lrn.error }, sourceMeta: [], warnings: [lrn.error || 'Failed to capture snapshot.'] };
    }

    const commands = parseLrnResponse(lrn.response);
    const snapshot: Snapshot = {
      instrument: lrn.instrument,
      timestamp: new Date().toISOString(),
      commands,
      raw: lrn.response,
    };
    snapshots.set(key, snapshot);

    // Group commands by root mnemonic for summary
    const groups = new Map<string, number>();
    for (const header of commands.keys()) {
      const root = header.split(':')[0] || header;
      groups.set(root, (groups.get(root) || 0) + 1);
    }
    const groupSummary = Array.from(groups.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([root, count]) => `${root}: ${count}`)
      .join(', ');

    return {
      ok: true,
      data: {
        action: 'snapshot',
        instrument: lrn.instrument,
        timestamp: snapshot.timestamp,
        commandCount: commands.size,
        groupSummary,
        message: `Captured ${commands.size} instrument settings. Use action:"diff" after making changes to see what changed.`,
      },
      sourceMeta: [{ type: 'lrn_snapshot', instrument: lrn.instrument }],
      warnings: [],
    };
  }

  // ── INSPECT — return stored commands from last snapshot ────────────
  if (input.action === 'inspect') {
    const stored = snapshots.get(key);
    if (!stored) {
      return {
        ok: false,
        data: { error: 'NO_SNAPSHOT', message: 'No snapshot found. Run action:"snapshot" first.' },
        sourceMeta: [],
        warnings: ['Take a snapshot first with action:"snapshot".'],
      };
    }

    const filterUpper = input.filter?.toUpperCase();
    const limit = Math.min(input.limit ?? 50, 200);
    const entries: Array<{ command: string; value: string }> = [];

    for (const [header, value] of stored.commands) {
      if (filterUpper && !header.startsWith(filterUpper)) continue;
      entries.push({ command: header, value });
      if (entries.length >= limit) break;
    }

    // Format as compact text — one line per command
    const text = entries.map(e => e.value ? `${e.command} ${e.value}` : e.command).join('\n');

    return {
      ok: true,
      data: {
        action: 'inspect',
        instrument: stored.instrument,
        snapshotTimestamp: stored.timestamp,
        filter: input.filter || null,
        returned: entries.length,
        totalInSnapshot: stored.commands.size,
        commands: text,
        message: `Returned ${entries.length} commands${filterUpper ? ` under ${filterUpper}` : ''} from stored snapshot.`,
      },
      sourceMeta: [{ type: 'lrn_inspect', instrument: stored.instrument }],
      warnings: [],
    };
  }

  // ── DIFF ──────────────────────────────────────────────────────────
  const baseline = snapshots.get(key);
  if (!baseline) {
    return {
      ok: false,
      data: { error: 'NO_BASELINE', message: 'No baseline snapshot found. Run action:"snapshot" first.' },
      sourceMeta: [],
      warnings: ['Take a snapshot first with action:"snapshot".'],
    };
  }

  const lrn = await queryLrn(input);
  if (!lrn.ok) {
    return { ok: false, data: { error: lrn.error }, sourceMeta: [], warnings: [lrn.error || 'Failed to capture current state.'] };
  }

  const currentCommands = parseLrnResponse(lrn.response);
  const changes = diffSnapshots(baseline.commands, currentCommands, input.filter);

  // Update stored snapshot to current state
  snapshots.set(key, {
    instrument: lrn.instrument,
    timestamp: new Date().toISOString(),
    commands: currentCommands,
    raw: lrn.response,
  });

  const diffText = formatDiffText(changes);
  const scpiCommands = changes
    .filter(c => c.type !== 'removed' && c.scpi)
    .map(c => c.scpi);

  return {
    ok: true,
    data: {
      action: 'diff',
      instrument: lrn.instrument,
      baselineTimestamp: baseline.timestamp,
      currentTimestamp: new Date().toISOString(),
      totalChanges: changes.length,
      changed: changes.filter(c => c.type === 'changed').length,
      added: changes.filter(c => c.type === 'added').length,
      removed: changes.filter(c => c.type === 'removed').length,
      diffText,
      scpiCommands,
      filter: input.filter || null,
      message: changes.length > 0
        ? `Detected ${changes.length} changes since baseline. scpiCommands contains the exact SCPI to reproduce them.`
        : 'No changes detected since baseline.',
    },
    sourceMeta: [{ type: 'lrn_diff', instrument: lrn.instrument }],
    warnings: [],
  };
}
