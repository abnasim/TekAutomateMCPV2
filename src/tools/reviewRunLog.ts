import type { ToolResult } from '../core/schemas';

interface ReviewRunLogInput {
  runLog?: string;
  auditOutput?: string;
  currentWorkflow?: Array<Record<string, unknown>>;
  selectedStepId?: string | null;
  backend?: string;
  modelFamily?: string;
  request?: string;
}

function cleanLine(line: string): string {
  return String(line || '').replace(/\s+/g, ' ').trim();
}

function uniqueLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const key = cleanLine(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function detectErrorType(text: string): string | null {
  if (/VI_ERROR_TMO|timeout expired|timed out/i.test(text)) return 'timeout';
  if (/VI_ERROR_RSRC_NFOUND|resource not found|not present in the system/i.test(text)) return 'resource_not_found';
  if (/read_raw|FILESYSTEM:READFILE|SAVE:IMAGE|capture_screenshot/i.test(text)) return 'screenshot_transfer';
  if (/Traceback|Exception|Unhandled|stack trace/i.test(text)) return 'exception';
  if (/invalid|unknown command|header error|syntax error/i.test(text)) return 'invalid_command';
  if (/refused|unreachable|ECONN|network|socket/i.test(text)) return 'connection';
  if (/tm_devices|pyvisa|vxi11/i.test(text)) return 'backend_runtime';
  return null;
}

function suggestionsForType(type: string | null): string[] {
  switch (type) {
    case 'timeout':
      return [
        'Increase or separate the timeout for the slow step instead of using one short timeout for the full sequence.',
        'Prefer *OPC? or an explicit completion query over fixed sleep when waiting for acquisition or save operations.',
        'If the timeout happened during screenshot transfer, keep screenshot capture isolated from normal SCPI command timing.',
      ];
    case 'resource_not_found':
      return [
        'Re-check the active VISA resource and reconnect before re-running the workflow.',
        'Avoid hardcoding stale resource strings; use the connected instrument context when building the flow.',
      ];
    case 'screenshot_transfer':
      return [
        'Use the built-in screenshot flow and wait for completion before reading the file back.',
        'Keep screenshot capture at the end of the flow and isolate it from ordinary setup/write steps.',
      ];
    case 'invalid_command':
      return [
        'Rebuild the affected step from verified command-library data instead of guessing syntax.',
        'Use build_or_edit_workflow to replace only the failing step or group when possible.',
      ];
    case 'connection':
      return [
        'Check executor reachability and instrument connection first before changing the workflow itself.',
        'If the workflow is correct but transport failed, fix connection state rather than rewriting the whole flow.',
      ];
    case 'backend_runtime':
      return [
        'Keep backend-specific steps consistent with the active backend and avoid mixing representations.',
        'If the backend is tm_devices, prefer tm_device_command steps instead of raw SCPI write/query steps.',
      ];
    case 'exception':
      return [
        'Use the traceback evidence to target the smallest failing step or phase instead of rebuilding the whole flow.',
      ];
    default:
      return [
        'Use the most relevant error lines to target the smallest safe workflow change.',
        'If execution mostly succeeded, prefer incremental edits over replacing the full workflow.',
      ];
  }
}

export async function reviewRunLog(
  input: ReviewRunLogInput
): Promise<ToolResult<Record<string, unknown>>> {
  const runLog = String(input.runLog || '');
  const auditOutput = String(input.auditOutput || '');
  const combined = `${runLog}\n${auditOutput}`.trim();
  if (!combined) {
    return {
      ok: true,
      data: {
        status: 'empty',
        summary: 'No run log is available yet.',
        findings: ['Run the workflow first or open the latest execution logs before asking for runtime diagnosis.'],
        suggestedFixes: [],
        evidence: [],
        suggestedRequest: '',
        selectedStepId: input.selectedStepId || null,
        backend: input.backend || null,
        modelFamily: input.modelFamily || null,
      },
      sourceMeta: [],
      warnings: [],
    };
  }

  const lines = combined.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const recentLines = lines.slice(-80);
  const evidence = uniqueLines(
    recentLines.filter((line) =>
      /\b(ERROR|Traceback|Exception|FAILED|FAIL|VI_ERROR|timeout|timed out|not found|invalid|refused|unreachable|capture_screenshot|read_raw|FILESYSTEM:READFILE|SAVE:IMAGE|exit code)\b/i.test(line)
    )
  ).slice(-8);

  const status =
    evidence.length > 0
      ? 'failed'
      : /\b(succeeded|completed|200 OK|connected:|done)\b/i.test(combined)
        ? 'succeeded'
        : 'unknown';

  const errorType = detectErrorType(evidence.join('\n') || combined);
  const findings: string[] = [];
  const workflowSize = Array.isArray(input.currentWorkflow) ? input.currentWorkflow.length : 0;

  if (status === 'failed') {
    findings.push(`Execution failed with ${errorType || 'a runtime error'} evidence in the latest log.`);
  } else if (status === 'succeeded') {
    findings.push('The latest run log looks successful overall.');
  } else {
    findings.push('The latest run log is inconclusive; there is not enough explicit success or failure evidence.');
  }
  if (workflowSize > 0) {
    findings.push(`Current workflow context includes ${workflowSize} step(s).`);
  }
  if (input.selectedStepId) {
    findings.push(`Selected step hint is ${input.selectedStepId}.`);
  }

  const summary =
    status === 'failed'
      ? `Latest run failed${errorType ? ` due to ${errorType.replace(/_/g, ' ')}` : ''}.`
      : status === 'succeeded'
        ? 'Latest run looks successful.'
        : 'Latest run log needs manual review.';

  const suggestedRequest =
    status === 'failed'
      ? `Fix the workflow based on this runtime failure${errorType ? ` (${errorType.replace(/_/g, ' ')})` : ''} while preserving working steps.`
      : status === 'succeeded'
        ? 'Review the workflow for cleanup or resilience improvements only if needed.'
        : 'Review the latest run log and suggest the smallest safe workflow change if a real blocker exists.';

  return {
    ok: true,
    data: {
      status,
      errorType,
      summary,
      findings,
      suggestedFixes: suggestionsForType(errorType),
      evidence,
      logTail: recentLines.slice(-30),
      suggestedRequest,
      selectedStepId: input.selectedStepId || null,
      backend: input.backend || null,
      modelFamily: input.modelFamily || null,
      request: input.request || '',
    },
    sourceMeta: [],
    warnings: [],
  };
}
