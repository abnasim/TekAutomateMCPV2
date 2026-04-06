import type { ToolResult } from '../core/schemas';
import { materializeScpiCommand } from './materializeScpiCommand';

interface MaterializeScpiCommandBatchItem {
  header: string;
  concreteHeader?: string;
  family?: string;
  commandType?: 'set' | 'query';
  placeholderBindings?: Record<string, string | number | boolean>;
  argumentBindings?: Record<string, string | number | boolean>;
  arguments?: Array<string | number | boolean>;
  value?: string | number | boolean;
}

interface MaterializeScpiCommandsInput {
  items: MaterializeScpiCommandBatchItem[];
}

export async function materializeScpiCommands(
  input: MaterializeScpiCommandsInput
): Promise<ToolResult<Record<string, unknown>>> {
  const items = Array.isArray(input.items) ? input.items : [];
  if (!items.length) {
    return {
      ok: false,
      data: { results: [] },
      sourceMeta: [],
      warnings: ['items is required'],
    };
  }

  const results: Array<Record<string, unknown>> = [];
  const warnings: string[] = [];
  const sourceMeta: NonNullable<ToolResult['sourceMeta']> = [];
  let allOk = true;

  for (const item of items) {
    const result = await materializeScpiCommand(item);
    const itemWarnings = Array.isArray(result.warnings) ? result.warnings : [];
    if (!result.ok) allOk = false;
    if (itemWarnings.length) {
      warnings.push(`${String(item.header || '').trim()}: ${itemWarnings.join(' | ')}`);
    }
    if (Array.isArray(result.sourceMeta)) {
      result.sourceMeta.forEach((meta) => sourceMeta.push(meta));
    }
    results.push({
      header: String(item.header || '').trim(),
      ok: result.ok,
      data: result.data,
      warnings: itemWarnings,
    });
  }

  return {
    ok: allOk,
    data: {
      results,
    },
    sourceMeta,
    warnings,
  };
}
