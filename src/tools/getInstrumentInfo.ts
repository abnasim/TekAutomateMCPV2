import type { ToolResult } from '../core/schemas';
import { getInstrumentInfoState } from './runtimeContextStore';

export async function getInstrumentInfo(): Promise<ToolResult<Record<string, unknown>>> {
  return {
    ok: true,
    data: getInstrumentInfoState() as unknown as Record<string, unknown>,
    sourceMeta: [],
    warnings: [],
  };
}
