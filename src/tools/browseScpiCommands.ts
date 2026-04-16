import { getCommandIndex, type CommandRecord } from '../core/commandIndex';
import { GROUP_NAMES, GROUP_COMMANDS, GROUP_DESCRIPTIONS, resolveCommandGroupName } from '../core/commandGroups';
import { serializeCommandCompactText } from './commandResultShape';
import type { ToolResult } from '../core/schemas';

interface BrowseScpiInput {
  /** Level 1: omit to list all groups. Level 2: provide to list commands in group. */
  group?: string;
  /** Level 3: provide to get full details for a specific command header. */
  header?: string;
  /** Optional model family filter */
  modelFamily?: string;
  /** Optional keyword filter within a group (e.g. "edge" within Trigger) */
  filter?: string;
  /** Max commands to return in level 2 (default 30) */
  limit?: number;
}

/**
 * browse_scpi_commands — 3-level interactive drill-down for SCPI commands.
 *
 * Level 1 (no args):        List all command groups with descriptions & counts
 * Level 2 (group):          List commands in a group, optionally filtered by keyword
 * Level 3 (group + header): Full command details: syntax, arguments, valid values, examples
 *
 * The AI can call this iteratively to explore the command tree when smart_scpi_lookup
 * doesn't find what it needs.
 */
export async function browseScpiCommands(input: BrowseScpiInput): Promise<ToolResult<unknown>> {
  const group = (input.group || '').trim();
  const header = (input.header || '').trim();
  const filter = (input.filter || '').trim().toLowerCase();
  const limit = Math.min(input.limit || 30, 100);

  // ── Level 3: Full command detail ──
  if (header) {
    const index = await getCommandIndex();
    const entry = index.getByHeader(header, input.modelFamily)
      || index.getByHeaderPrefix(header, input.modelFamily);
    if (!entry) {
      return {
        ok: false,
        data: null,
        sourceMeta: [],
        warnings: [`No command found for header "${header}". Try browsing the group first.`],
      };
    }
    return {
      ok: true,
      data: {
        level: 'command_detail',
        command: serializeCommandCompactText(entry),
      },
      sourceMeta: [{ file: entry.sourceFile, commandId: entry.commandId, section: entry.group }],
      warnings: [],
    };
  }

  // ── Level 2: List commands in a group ──
  if (group) {
    let resolved = resolveCommandGroupName(group);
    if (!resolved) {
      // Try fuzzy match on full phrase (handles "Spectrum view", "Save and Recall", etc.)
      const lower = group.toLowerCase();
      const fuzzy = GROUP_NAMES.find(g => g.toLowerCase() === lower)
        || GROUP_NAMES.find(g => g.toLowerCase().includes(lower))
        || GROUP_NAMES.find(g => lower.includes(g.toLowerCase()));
      if (fuzzy) {
        resolved = fuzzy;
        // If the input is longer than the matched group, extract a filter
        // e.g. "Trigger edge" → group=Trigger, filter=edge
        const fuzzyLower = fuzzy.toLowerCase();
        if (lower !== fuzzyLower && lower.startsWith(fuzzyLower)) {
          const extractedFilter = lower.slice(fuzzyLower.length).trim();
          if (extractedFilter && !filter) {
            return browseScpiCommands({ ...input, group: fuzzy, filter: extractedFilter });
          }
        } else if (lower !== fuzzyLower && lower.includes(' ')) {
          // Try splitting: first word as group, rest as filter
          const words = group.split(/\s+/);
          const firstWord = words[0];
          const firstMatch = GROUP_NAMES.find(g => g.toLowerCase() === firstWord.toLowerCase())
            || GROUP_NAMES.find(g => g.toLowerCase().includes(firstWord.toLowerCase()));
          if (firstMatch && !filter) {
            return browseScpiCommands({ ...input, group: firstMatch, filter: words.slice(1).join(' ').toLowerCase() });
          }
        }
      }
      if (!resolved) {
        return {
          ok: false,
          data: null,
          sourceMeta: [],
          warnings: [`Unknown group "${group}". Type "browse commands" to see available groups.`],
        };
      }
    }

    const headers = GROUP_COMMANDS[resolved] || [];
    const description = GROUP_DESCRIPTIONS[resolved] || '';

    // Get brief info for each command (header + short description + command type)
    const index = await getCommandIndex();

    // If filter is provided, search against header AND shortDescription
    // "FFT" doesn't appear in Math headers (they use SPECTral), but it's in descriptions
    let filteredHeaders = headers;
    if (filter) {
      filteredHeaders = headers.filter(h => {
        if (h.toLowerCase().includes(filter)) return true;
        // Also check description
        const entry = index.getByHeader(h, input.modelFamily);
        if (entry) {
          const desc = `${entry.shortDescription} ${entry.description}`.toLowerCase();
          return desc.includes(filter);
        }
        return false;
      });
    }

    const commands = filteredHeaders.slice(0, limit).map(h => {
      const entry = index.getByHeader(h, input.modelFamily);
      return {
        header: h,
        commandId: entry?.commandId || h,
        commandType: entry?.commandType || 'unknown',
        shortDescription: entry?.shortDescription || '',
      };
    });

    return {
      ok: true,
      data: {
        level: 'group_commands',
        groupName: resolved,
        description,
        totalCommands: headers.length,
        showing: commands.length,
        filter: filter || undefined,
        commands,
        hint: 'Pass header="<header>" to see full details for a specific command (e.g. tek_router with action:"browse" and header:"TRIGger:A:EDGE:SOUrce").',
      },
      sourceMeta: [{ file: 'commandGroups.json', section: resolved }],
      warnings: [],
    };
  }

  // ── Level 1: List all groups ──
  const groups = GROUP_NAMES.map(name => ({
    name,
    description: (GROUP_DESCRIPTIONS[name] || '').slice(0, 120),
    commandCount: (GROUP_COMMANDS[name] || []).length,
  }));

  return {
    ok: true,
    data: {
      level: 'group_list',
      totalGroups: groups.length,
      groups,
      hint: 'Pass group="<name>" to see commands in a group (e.g. tek_router with action:"browse" and group:"Trigger"). Add filter:"keyword" to narrow results.',
    },
    sourceMeta: [],
    warnings: [],
  };
}
