import { getCommandIndex } from '../core/commandIndex';
import type { ToolResult } from '../core/schemas';

interface GetCommandsByHeaderBatchInput {
  headers: string[];
  family?: string;
}

function thinResult(entry: {
  commandId: string;
  sourceFile: string;
  header: string;
  commandType: 'set' | 'query' | 'both';
  shortDescription: string;
  syntax: { set?: string; query?: string };
  codeExamples: Array<{
    scpi?: { code: string };
    python?: { code: string };
    tm_devices?: { code: string };
  }>;
  arguments: Array<{
    name: string;
    type: string;
    required: boolean;
    description: string;
    validValues: Record<string, unknown>;
    defaultValue?: unknown;
  }>;
  notes: string[];
}) {
  const ex = entry.codeExamples?.[0];
  const argumentsPreview = Array.isArray(entry.arguments)
    ? entry.arguments.slice(0, 8).map((arg) => ({
        name: arg.name,
        type: arg.type,
        required: arg.required,
        description: arg.description,
        defaultValue: arg.defaultValue,
        validValues: arg.validValues,
      }))
    : [];
  return {
    commandId: entry.commandId,
    sourceFile: entry.sourceFile,
    header: entry.header,
    commandType: entry.commandType,
    shortDescription: entry.shortDescription,
    syntax: entry.syntax,
    example: ex
      ? {
          scpi: ex.scpi?.code,
          python: ex.python?.code,
          tm_devices: ex.tm_devices?.code,
        }
      : undefined,
    validValues: entry.arguments?.[0]?.validValues || undefined,
    arguments: argumentsPreview.length ? argumentsPreview : undefined,
    notes: entry.notes?.length ? entry.notes : undefined,
  };
}

export async function getCommandsByHeaderBatch(
  input: GetCommandsByHeaderBatchInput
): Promise<ToolResult<Record<string, unknown>>> {
  const headers = Array.isArray(input.headers)
    ? input.headers.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  if (!headers.length) {
    return {
      ok: false,
      data: { results: [], missingHeaders: [] },
      sourceMeta: [],
      warnings: ['headers is required'],
    };
  }

  const index = await getCommandIndex();
  const results: Array<Record<string, unknown>> = [];
  const sourceMeta: Array<{ file: string; commandId?: string; section?: string }> = [];
  const missingHeaders: string[] = [];
  const seen = new Set<string>();

  headers.forEach((requestedHeader) => {
    const entry = index.getByHeader(requestedHeader, input.family);
    if (!entry) {
      missingHeaders.push(requestedHeader);
      return;
    }
    const key = `${entry.sourceFile}:${entry.commandId}`;
    if (seen.has(key)) {
      results.push({
        requestedHeader,
        matchedHeader: entry.header,
        deduped: true,
      });
      return;
    }
    seen.add(key);
    results.push({
      requestedHeader,
      matchedHeader: entry.header,
      ...thinResult(entry),
    });
    sourceMeta.push({
      file: entry.sourceFile,
      commandId: entry.commandId,
      section: entry.group,
    });
  });

  const warnings = missingHeaders.length
    ? [`Missing headers: ${missingHeaders.join(', ')}`]
    : [];

  return {
    ok: results.length > 0,
    data: {
      results,
      missingHeaders,
    },
    sourceMeta,
    warnings,
  };
}
