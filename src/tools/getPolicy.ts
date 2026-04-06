import { loadPolicy } from '../core/policyLoader';
import type { ToolResult } from '../core/schemas';

interface GetPolicyInput {
  mode:
    | 'steps_json'
    | 'blockly_xml'
    | 'scpi_verification'
    | 'response_format'
    | 'backend_taxonomy';
}

export async function getPolicy(input: GetPolicyInput): Promise<ToolResult<string | null>> {
  const content = await loadPolicy(input.mode);
  if (!content) {
    return {
      ok: false,
      data: null,
      sourceMeta: [],
      warnings: [`Policy not found for mode: ${input.mode}`],
    };
  }
  return {
    ok: true,
    data: content,
    sourceMeta: [{ file: `policies/${input.mode}.v1.md` }],
    warnings: [],
  };
}
