import type { ToolResult } from '../core/schemas';
import { materializeScpiCommands } from './materializeScpiCommands';

interface FinalizeScpiCommandBatchItem {
  header: string;
  concreteHeader?: string;
  family?: string;
  commandType?: 'set' | 'query';
  placeholderBindings?: Record<string, string | number | boolean>;
  argumentBindings?: Record<string, string | number | boolean>;
  arguments?: Array<string | number | boolean>;
  value?: string | number | boolean;
}

interface FinalizeScpiCommandsInput {
  items: FinalizeScpiCommandBatchItem[];
}

export async function finalizeScpiCommands(
  input: FinalizeScpiCommandsInput
): Promise<ToolResult<Record<string, unknown>>> {
  const materialized = await materializeScpiCommands({ items: Array.isArray(input.items) ? input.items : [] });
  const rows = materialized.data && typeof materialized.data === 'object' && Array.isArray((materialized.data as Record<string, unknown>).results)
    ? ((materialized.data as Record<string, unknown>).results as Array<Record<string, unknown>>)
    : [];

  const results = rows.map((row) => {
    const data = row.data && typeof row.data === 'object' ? (row.data as Record<string, unknown>) : {};
    return {
      header: String(row.header || ''),
      ok: row.ok === true,
      verified: row.ok === true,
      command: typeof data.command === 'string' ? data.command : undefined,
      canonicalHeader: typeof data.canonicalHeader === 'string' ? data.canonicalHeader : undefined,
      commandType: typeof data.commandType === 'string' ? data.commandType : undefined,
      sourceFile: typeof data.sourceFile === 'string' ? data.sourceFile : undefined,
      warnings: Array.isArray(row.warnings) ? row.warnings : [],
    };
  });

  return {
    ok: materialized.ok,
    data: {
      results,
      commands: results
        .map((row) => (typeof row.command === 'string' ? row.command : ''))
        .filter(Boolean),
    },
    sourceMeta: materialized.sourceMeta,
    warnings: materialized.warnings,
  };
}
