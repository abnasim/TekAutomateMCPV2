import { executeBuild, type BuildRequest } from '../core/buildAction';
import type { ToolResult } from '../core/schemas';
import { normalizeActionsJsonPayload } from '../core/actionNormalizer';

interface BuildOrEditWorkflowInput {
  request: string;
  currentWorkflow?: Array<Record<string, unknown>>;
  selectedStepId?: string | null;
  instrumentInfo?: {
    backend?: string;
    modelFamily?: string;
    deviceType?: string;
    deviceDriver?: string;
    alias?: string;
    instrumentMap?: Array<Record<string, unknown>>;
  };
  buildNew?: boolean;
}

function extractFirstJsonObjectAfterMarker(text: string, marker = 'ACTIONS_JSON:'): Record<string, unknown> | null {
  const source = String(text || '');
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;
  const jsonStart = source.indexOf('{', markerIndex + marker.length);
  if (jsonStart < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = jsonStart; i < source.length; i += 1) {
    const ch = source[i];
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
        try {
          const parsed = JSON.parse(source.slice(jsonStart, i + 1));
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

export async function buildOrEditWorkflow(
  input: BuildOrEditWorkflowInput
): Promise<ToolResult<Record<string, unknown>>> {
  const request = String(input.request || '').trim();
  if (!request) {
    return {
      ok: false,
      data: {
        error: 'Missing required field: request',
      },
      sourceMeta: [],
      warnings: [],
    };
  }

  const instrumentInfo = input.instrumentInfo || {};
  const buildRequest: BuildRequest = {
    query: request,
    buildNew: input.buildNew,
    instrumentId: instrumentInfo.alias,
    context: {
      backend: instrumentInfo.backend,
      modelFamily: instrumentInfo.modelFamily,
      deviceType: instrumentInfo.deviceType,
      alias: instrumentInfo.alias,
      instrumentMap: instrumentInfo.instrumentMap,
      steps: Array.isArray(input.currentWorkflow) ? input.currentWorkflow : [],
      selectedStepId: typeof input.selectedStepId === 'string' ? input.selectedStepId : undefined,
    },
  };

  const result = await executeBuild(buildRequest);
  const rawActionsJson = extractFirstJsonObjectAfterMarker(result.text || '');
  const normalized = rawActionsJson ? normalizeActionsJsonPayload(rawActionsJson) : null;

  return {
    ok: result.ok,
    data: {
      request,
      summary:
        typeof normalized?.summary === 'string'
          ? normalized.summary
          : typeof rawActionsJson?.summary === 'string'
            ? rawActionsJson.summary
            : '',
      findings:
        Array.isArray(normalized?.findings)
          ? normalized.findings
          : Array.isArray(rawActionsJson?.findings)
            ? rawActionsJson.findings
            : [],
      suggestedFixes:
        Array.isArray(normalized?.suggestedFixes)
          ? normalized.suggestedFixes
          : Array.isArray(rawActionsJson?.suggestedFixes)
            ? rawActionsJson.suggestedFixes
            : [],
      actions: Array.isArray(normalized?.actions) ? normalized.actions : [],
      rawActionsJson,
      text: result.text,
      mode: (result.data as Record<string, unknown> | undefined)?.mode || null,
      warnings: result.warnings || [],
    },
    sourceMeta: [],
    warnings: result.warnings || [],
  };
}
