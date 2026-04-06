import { getTemplateIndex } from '../core/templateIndex';
import type { ToolResult } from '../core/schemas';

interface GetTemplateExamplesInput {
  query: string;
  limit?: number;
}

export async function getTemplateExamples(
  input: GetTemplateExamplesInput
): Promise<ToolResult<unknown[]>> {
  const q = (input.query || '').trim();
  if (!q) return { ok: true, data: [], sourceMeta: [], warnings: ['Empty query'] };
  const index = await getTemplateIndex();
  const results = index.search(q, input.limit || 5);
  return {
    ok: true,
    data: results.map((r) => ({
      name: r.name,
      description: r.description,
      sourceFile: r.sourceFile,
      steps: r.steps,
    })),
    sourceMeta: results.map((r) => ({ file: `templates/${r.sourceFile}`, section: r.name })),
    warnings: results.length ? [] : ['No templates matched query'],
  };
}
