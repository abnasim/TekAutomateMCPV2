import { getCommandIndex, type CommandRecord } from '../core/commandIndex';
import type { ToolResult } from '../core/schemas';

interface VerifyScpiInput {
  commands: string[];
  modelFamily?: string;
  requireExactSyntax?: boolean;
}

function parseSegments(command: string): string[] {
  return command
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

function headerFromSegment(segment: string): string {
  return segment.split(/\s+/).slice(0, 1).join(' ').trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expandOptionalHeaderVariants(value: string): string[] {
  const source = String(value || '').trim();
  const match = source.match(/\[[^\]]+\]/);
  if (!match) return [source];
  const optional = match[0];
  const before = source.slice(0, match.index);
  const after = source.slice((match.index || 0) + optional.length);
  const inner = optional.slice(1, -1);
  const withInner = `${before}${inner}${after}`;
  const withoutInner = `${before}${after}`;
  return Array.from(
    new Set([
      ...expandOptionalHeaderVariants(withInner),
      ...expandOptionalHeaderVariants(withoutInner),
    ])
  );
}

function tokenizeHeader(value: string): string[] {
  return String(value || '')
    .replace(/\?/g, '')
    .replace(/,/g, ' ')
    .split(/[:\s]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

function buildTokenRegex(token: string): RegExp {
  const src = String(token || '');
  let pattern = '^';
  let index = 0;
  const matcher = /(\{[^{}]+\}|<[^>]+>)/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(src)) !== null) {
    pattern += escapeRegex(src.slice(index, match.index).toUpperCase());
    const marker = match[0];
    if (marker.startsWith('{') && marker.includes('|')) {
      const choices = marker
        .slice(1, -1)
        .split('|')
        .map((choice) => escapeRegex(choice.toUpperCase()))
        .join('|');
      pattern += `(?:${choices})`;
    } else {
      pattern += '[A-Z0-9_]+';
    }
    index = match.index + marker.length;
  }
  pattern += escapeRegex(src.slice(index).toUpperCase());
  pattern += '$';
  return new RegExp(pattern, 'i');
}

function exactHeaderPatterns(entry: CommandRecord): string[] {
  const candidates = new Set<string>();
  if (entry.header) candidates.add(entry.header);
  if (entry.syntax?.set) candidates.add(headerFromSegment(entry.syntax.set));
  if (entry.syntax?.query) candidates.add(headerFromSegment(entry.syntax.query));
  entry.codeExamples?.forEach((example) => {
    const code = example.scpi?.code;
    if (typeof code === 'string' && code.trim()) {
      candidates.add(headerFromSegment(code));
    }
  });
  return Array.from(candidates).filter(Boolean);
}

function segmentMatchesExactSyntax(segment: string, entry: CommandRecord): boolean {
  const inputTokens = tokenizeHeader(headerFromSegment(segment).toUpperCase());
  if (!inputTokens.length) return false;

  return exactHeaderPatterns(entry).some((patternHeader) => {
    return expandOptionalHeaderVariants(patternHeader).some((variant) => {
      const patternTokens = tokenizeHeader(variant.toUpperCase());
      if (patternTokens.length !== inputTokens.length) return false;
      return patternTokens.every((patternToken, index) =>
        buildTokenRegex(patternToken).test(inputTokens[index])
      );
    });
  });
}

function findExactSyntaxEntry(
  segment: string,
  candidates: CommandRecord[]
): CommandRecord | null {
  const matches = candidates
    .filter((entry) => segmentMatchesExactSyntax(segment, entry))
    .sort((a, b) => `${a.sourceFile}:${a.commandId}`.localeCompare(`${b.sourceFile}:${b.commandId}`));
  return matches[0] || null;
}

export async function verifyScpiCommands(
  input: VerifyScpiInput
): Promise<ToolResult<unknown[]>> {
  const index = await getCommandIndex();
  const commands = Array.isArray(input.commands) ? input.commands : [];
  const results: Array<{
    command: string;
    verified: boolean;
    commandId?: string;
    sourceFile?: string;
    reason?: string;
  }> = [];
  const sourceMeta: ToolResult['sourceMeta'] = [];
  const warnings: string[] = [];
  const exactCandidates = input.requireExactSyntax === true
    ? index.getEntries(input.modelFamily)
    : [];
  let unverifiedCount = 0;
  for (const command of commands) {
    const segments = parseSegments(command);
    if (!segments.length) {
      results.push({ command, verified: false, reason: 'Empty command' });
      warnings.push(`Invalid command: ${command}`);
      continue;
    }
    let failed = false;
    let firstMatch: { commandId: string; sourceFile: string } | null = null;
    for (const segment of segments) {
      const candidate = headerFromSegment(segment);
      const entry =
        index.getByHeader(candidate, input.modelFamily) ||
        index.getByHeader(candidate.toUpperCase(), input.modelFamily) ||
        index.getByHeader(candidate.toLowerCase(), input.modelFamily) ||
        index.getByHeaderPrefix(candidate, input.modelFamily);
      const exactEntry =
        input.requireExactSyntax === true
          ? (entry && segmentMatchesExactSyntax(segment, entry)
              ? entry
              : findExactSyntaxEntry(segment, exactCandidates))
          : entry;
      if (!exactEntry) {
        failed = true;
        break;
      }
      if (!firstMatch) {
        firstMatch = { commandId: exactEntry.commandId, sourceFile: exactEntry.sourceFile };
      }
      sourceMeta.push({
        file: exactEntry.sourceFile,
        commandId: exactEntry.commandId,
        section: exactEntry.group,
      });
    }
    if (failed || !firstMatch) {
      results.push({
        command,
        verified: false,
        commandId: undefined,
        sourceFile: undefined,
        reason: 'I could not verify this command in the uploaded sources.',
      });
      unverifiedCount += 1;
      continue;
    }
    results.push({
      command,
      verified: true,
      commandId: firstMatch.commandId,
      sourceFile: firstMatch.sourceFile,
    });
  }
  if (unverifiedCount > 0) {
    warnings.push(`${unverifiedCount} of ${commands.length} commands could not be verified`);
  }
  return {
    ok: true,
    data: results,
    sourceMeta,
    warnings,
  };
}
