import { GROUP_COMMANDS, GROUP_DESCRIPTIONS, resolveCommandGroupName } from '../core/commandGroups';
import type { ToolResult } from '../core/schemas';

interface GetCommandGroupInput {
  groupName: string;
}

export async function getCommandGroup(input: GetCommandGroupInput): Promise<ToolResult<Record<string, unknown>>> {
  const requested = String(input.groupName || '').trim();
  if (!requested) {
    return {
      ok: false,
      data: {} as Record<string, unknown>,
      sourceMeta: [],
      warnings: ['groupName is required'],
    };
  }

  const resolved = resolveCommandGroupName(requested);
  if (!resolved) {
    return {
      ok: false,
      data: {} as Record<string, unknown>,
      sourceMeta: [],
      warnings: [`Unknown command group: ${requested}`],
    };
  }

  const headers = GROUP_COMMANDS[resolved] || [];
  const description = GROUP_DESCRIPTIONS[resolved] || '';

  return {
    ok: true,
    data: {
      groupName: resolved,
      description,
      commandHeaders: headers,
      commandCount: headers.length,
    },
    sourceMeta: [
      {
        file: 'scripts/command_groups_mapping.py',
        section: resolved,
      },
    ],
    warnings: [],
  };
}

