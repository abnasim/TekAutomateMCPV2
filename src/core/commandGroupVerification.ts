import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import rawGroups from './commandGroups.json';
import { type CommandIndex, getCommandIndex } from './commandIndex';
import { resolveRagDir } from './paths';

export type CommandVerificationStatus =
  | 'verified_same_group'
  | 'verified_shared'
  | 'verified_curated_override'
  | 'missing';

export interface CommandVerificationItem {
  header: string;
  status: CommandVerificationStatus;
  curatedGroups: string[];
  rawGroup?: string;
  sourceFile?: string;
}

export interface CommandGroupVerificationEntry {
  name: string;
  description: string;
  ragPresent: boolean;
  listedCommandCount: number;
  uniqueCommandCount: number;
  duplicateCommandCount: number;
  duplicateCommands: string[];
  statusCounts: Record<CommandVerificationStatus, number>;
  missingHeaders: string[];
  commands: CommandVerificationItem[];
}

export interface CommandGroupVerificationTotals {
  groupCount: number;
  ragGroupCount: number;
  listedCommandCount: number;
  uniqueListedCommandCount: number;
  duplicateHeaderCountAcrossGroups: number;
  duplicateHeaderCountWithinGroups: number;
  verifiedSameGroupCount: number;
  verifiedSharedCount: number;
  verifiedCuratedOverrideCount: number;
  missingCount: number;
}

export interface CommandGroupVerificationReport {
  generatedAt: string;
  totals: CommandGroupVerificationTotals;
  ragMissingGroups: string[];
  missingHeaders: Array<{ groupName: string; header: string }>;
  sharedHeaders: Array<{ header: string; groups: string[] }>;
  groups: CommandGroupVerificationEntry[];
}

interface RagGroupIndexItem {
  id?: string;
  title?: string;
  body?: string;
  tags?: string[];
  source?: string;
}

const COMMAND_GROUPS = rawGroups as Record<string, { description: string; commands: string[] }>;

function normalizeGroupName(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+command group$/i, '')
    .replace(/\s+/g, ' ');
}

function buildCuratedHeaderOwners(): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const [groupName, info] of Object.entries(COMMAND_GROUPS)) {
    for (const header of Array.isArray(info.commands) ? info.commands : []) {
      const list = owners.get(header) || [];
      list.push(groupName);
      owners.set(header, list);
    }
  }
  return owners;
}

function buildWithinGroupDuplicates(headers: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const header of headers) {
    if (seen.has(header)) duplicates.add(header);
    seen.add(header);
  }
  return Array.from(duplicates).sort((a, b) => a.localeCompare(b));
}

async function loadRagGroupIndex(): Promise<RagGroupIndexItem[]> {
  const fullPath = path.join(resolveRagDir(), 'corpus', 'app_logic', 'groups_index.json');
  const raw = await readFile(fullPath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? (parsed as RagGroupIndexItem[]) : [];
}

export async function buildCommandGroupVerificationReport(
  index: CommandIndex | null = null
): Promise<CommandGroupVerificationReport> {
  const commandIndex = index || (await getCommandIndex());
  const ragGroups = await loadRagGroupIndex();
  const ragTitles = new Set(ragGroups.map((entry) => normalizeGroupName(String(entry.title || ''))));
  const curatedOwners = buildCuratedHeaderOwners();
  const sharedHeaders = Array.from(curatedOwners.entries())
    .filter(([, groups]) => new Set(groups).size > 1)
    .map(([header, groups]) => ({
      header,
      groups: Array.from(new Set(groups)).sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.header.localeCompare(b.header));

  const reportGroups: CommandGroupVerificationEntry[] = [];
  const ragMissingGroups: string[] = [];
  const missingHeaders: Array<{ groupName: string; header: string }> = [];

  let listedCommandCount = 0;
  let uniqueListedCommandCount = 0;
  let duplicateHeaderCountWithinGroups = 0;
  let verifiedSameGroupCount = 0;
  let verifiedSharedCount = 0;
  let verifiedCuratedOverrideCount = 0;
  let missingCount = 0;

  for (const [groupName, info] of Object.entries(COMMAND_GROUPS)) {
    const headers = Array.isArray(info.commands) ? info.commands : [];
    listedCommandCount += headers.length;
    uniqueListedCommandCount += new Set(headers).size;

    const duplicateCommands = buildWithinGroupDuplicates(headers);
    duplicateHeaderCountWithinGroups += duplicateCommands.length;

    const statusCounts: Record<CommandVerificationStatus, number> = {
      verified_same_group: 0,
      verified_shared: 0,
      verified_curated_override: 0,
      missing: 0,
    };

    const commands: CommandVerificationItem[] = headers.map((header) => {
      const curatedGroups = Array.from(new Set(curatedOwners.get(header) || [groupName]));
      const record = commandIndex.getByHeader(header);

      if (!record) {
        statusCounts.missing += 1;
        missingCount += 1;
        missingHeaders.push({ groupName, header });
        return {
          header,
          status: 'missing',
          curatedGroups,
        };
      }

      const normalizedRawGroup = normalizeGroupName(record.group);
      const normalizedCuratedGroups = curatedGroups.map(normalizeGroupName);
      let status: CommandVerificationStatus = 'verified_curated_override';

      if (curatedGroups.length > 1) {
        status = 'verified_shared';
      } else if (normalizedCuratedGroups.includes(normalizedRawGroup)) {
        status = 'verified_same_group';
      }

      statusCounts[status] += 1;
      if (status === 'verified_same_group') verifiedSameGroupCount += 1;
      if (status === 'verified_shared') verifiedSharedCount += 1;
      if (status === 'verified_curated_override') verifiedCuratedOverrideCount += 1;

      return {
        header,
        status,
        curatedGroups,
        rawGroup: record.group,
        sourceFile: record.sourceFile,
      };
    });

    const ragPresent = ragTitles.has(normalizeGroupName(groupName));
    if (!ragPresent) ragMissingGroups.push(groupName);

    reportGroups.push({
      name: groupName,
      description: info.description || '',
      ragPresent,
      listedCommandCount: headers.length,
      uniqueCommandCount: new Set(headers).size,
      duplicateCommandCount: duplicateCommands.length,
      duplicateCommands,
      statusCounts,
      missingHeaders: commands.filter((item) => item.status === 'missing').map((item) => item.header),
      commands,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      groupCount: Object.keys(COMMAND_GROUPS).length,
      ragGroupCount: ragGroups.length,
      listedCommandCount,
      uniqueListedCommandCount,
      duplicateHeaderCountAcrossGroups: sharedHeaders.length,
      duplicateHeaderCountWithinGroups,
      verifiedSameGroupCount,
      verifiedSharedCount,
      verifiedCuratedOverrideCount,
      missingCount,
    },
    ragMissingGroups: ragMissingGroups.sort((a, b) => a.localeCompare(b)),
    missingHeaders: missingHeaders.sort((a, b) =>
      a.groupName.localeCompare(b.groupName) || a.header.localeCompare(b.header)
    ),
    sharedHeaders,
    groups: reportGroups.sort((a, b) => a.name.localeCompare(b.name)),
  };
}
