import { getCommandIndex } from '../core/commandIndex';
import type { ToolResult } from '../core/schemas';
import { verifyScpiCommands } from './verifyScpiCommands';

interface MaterializeScpiCommandInput {
  header: string;
  concreteHeader?: string;
  family?: string;
  commandType?: 'set' | 'query';
  placeholderBindings?: Record<string, string | number | boolean>;
  argumentBindings?: Record<string, string | number | boolean>;
  arguments?: Array<string | number | boolean>;
  value?: string | number | boolean;
}

type BindingMap = Record<string, string | number | boolean>;

function ensurePrefixedValue(prefix: string, value: string | number | boolean): string {
  const raw = String(value).trim();
  if (!raw) return raw;
  if (raw.toUpperCase().startsWith(prefix.toUpperCase())) return raw;
  return `${prefix}${raw}`;
}

function formatArgumentValue(value: string | number | boolean): string {
  return String(value);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceAllLiteral(source: string, pattern: string, replacement: string): string {
  if (!pattern) return source;
  return source.replace(new RegExp(escapeRegex(pattern), 'g'), replacement);
}

function chooseScpiSyntax(
  entry: {
    header: string;
    commandType: 'set' | 'query' | 'both';
    syntax: { set?: string; query?: string };
  },
  input: MaterializeScpiCommandInput
): { kind: 'set' | 'query'; syntax: string } | null {
  const requested = String(input.commandType || '').toLowerCase();
  if (requested === 'query') {
    return entry.syntax.query ? { kind: 'query', syntax: entry.syntax.query } : null;
  }
  if (requested === 'set') {
    return entry.syntax.set ? { kind: 'set', syntax: entry.syntax.set } : null;
  }
  if (/\?\s*$/.test(String(input.header || '').trim())) {
    if (entry.syntax.query) return { kind: 'query', syntax: entry.syntax.query };
    return { kind: 'query', syntax: `${entry.header}?` };
  }
  if (typeof input.value !== 'undefined' || (Array.isArray(input.arguments) && input.arguments.length > 0)) {
    if (entry.syntax.set) return { kind: 'set', syntax: entry.syntax.set };
  }
  if (entry.commandType === 'query' && entry.syntax.query) {
    return { kind: 'query', syntax: entry.syntax.query };
  }
  if (entry.syntax.set) return { kind: 'set', syntax: entry.syntax.set };
  if (entry.syntax.query) return { kind: 'query', syntax: entry.syntax.query };
  return null;
}

function expandBindingAliases(bindings: BindingMap): BindingMap {
  const out: BindingMap = { ...bindings };
  const entries = Object.entries(bindings);
  entries.forEach(([key, value]) => {
    const normalized = key.trim().toLowerCase();
    if (normalized === 'channel') out['CH<x>'] = ensurePrefixedValue('CH', value);
    if (normalized === 'reference' || normalized === 'ref') out['REF<x>'] = ensurePrefixedValue('REF', value);
    if (normalized === 'math') out['MATH<x>'] = ensurePrefixedValue('MATH', value);
    if (normalized === 'bus' || normalized === 'busnumber' || normalized === 'b') {
      out['BUS<x>'] = ensurePrefixedValue('BUS', value);
      out['B<x>'] = ensurePrefixedValue('B', value);
    }
    if (normalized === 'measurement' || normalized === 'meas') {
      out['MEAS<x>'] = ensurePrefixedValue('MEAS', value);
    }
    if (normalized === 'search') out['SEARCH<x>'] = ensurePrefixedValue('SEARCH', value);
    if (normalized === 'plot') out['PLOT<x>'] = ensurePrefixedValue('PLOT', value);
    if (normalized === 'zoom') out['ZOOM<x>'] = ensurePrefixedValue('ZOOM', value);
    if (normalized === 'view') out['VIEW<x>'] = ensurePrefixedValue('VIEW', value);
    if (normalized === 'trigger' || normalized === 'triggergroup') out['{A|B}'] = String(value).trim().toUpperCase();
    if (normalized === 'x') out['<x>'] = String(value).trim();
    if (normalized === 'y') out['<y>'] = String(value).trim();
    if (normalized === 'z') out['<z>'] = String(value).trim();
  });
  Object.entries(out).forEach(([key, value]) => {
    const raw = String(value).trim();
    const indexed = raw.match(/^(?:CH|REF|MATH|BUS|MEAS|SEARCH|PLOT|ZOOM|VIEW|B)(\d+)$/i);
    if (indexed && !Object.prototype.hasOwnProperty.call(out, '<x>')) {
      out['<x>'] = indexed[1];
    }
  });
  return out;
}

function inferPlaceholderBindingsFromConcreteHeader(
  concreteHeader: string,
  canonicalHeader: string
): BindingMap {
  const out: BindingMap = {};
  const rawParts = String(concreteHeader || '')
    .replace(/\?$/, '')
    .split(':')
    .map((part) => part.trim())
    .filter(Boolean);
  const canonicalParts = String(canonicalHeader || '')
    .replace(/\?$/, '')
    .split(':')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!rawParts.length || rawParts.length !== canonicalParts.length) {
    return out;
  }

  canonicalParts.forEach((canonicalPart, index) => {
    const rawPart = rawParts[index] || '';
    if (!rawPart) return;

    if (canonicalPart.includes('{A|B}')) {
      if (/^(A|B)$/i.test(rawPart)) {
        out['{A|B}'] = rawPart.toUpperCase();
      }
      return;
    }

    const indexedMatch = canonicalPart.match(/^([A-Za-z*]+)<([xyz])>$/);
    if (indexedMatch) {
      const prefix = indexedMatch[1];
      const axis = indexedMatch[2];
      const rawMatch = rawPart.match(new RegExp(`^${escapeRegex(prefix)}(\\d+)$`, 'i'));
      if (rawMatch) {
        out[canonicalPart] = `${prefix}${rawMatch[1]}`;
        const placeholderKey = `<${axis}>`;
        if (!Object.prototype.hasOwnProperty.call(out, placeholderKey)) {
          out[placeholderKey] = rawMatch[1];
        }
        return;
      }
    }

    const barePlaceholderMatch = canonicalPart.match(/^<([xyz])>$/);
    if (barePlaceholderMatch) {
      const rawMatch = rawPart.match(/^(\d+)$/);
      if (rawMatch) {
        out[`<${barePlaceholderMatch[1]}>`] = rawMatch[1];
      }
    }
  });

  return out;
}

function applyBindings(source: string, bindings?: BindingMap): string {
  if (!bindings || !Object.keys(bindings).length) return source;
  let out = source;
  const expanded = expandBindingAliases(bindings);
  Object.entries(expanded)
    .sort((a, b) => b[0].length - a[0].length)
    .forEach(([key, value]) => {
      out = replaceAllLiteral(out, key, String(value));
    });
  return out;
}

function applyPositionalArguments(
  source: string,
  values: Array<string | number | boolean>
): { command: string; remainingValues: Array<string | number | boolean> } {
  if (!values.length) return { command: source, remainingValues: [] };
  const firstSpace = source.indexOf(' ');
  if (firstSpace < 0) {
    return { command: source, remainingValues: values };
  }
  const head = source.slice(0, firstSpace);
  let tail = source.slice(firstSpace + 1);
  const placeholders = tail.match(/(\{[^{}]+\}|<[^>]+>)/g) || [];
  let index = 0;
  placeholders.forEach((placeholder) => {
    if (index >= values.length) return;
    tail = tail.replace(placeholder, formatArgumentValue(values[index]));
    index += 1;
  });
  return {
    command: `${head} ${tail}`.trim(),
    remainingValues: values.slice(index),
  };
}

function collectUnresolvedPlaceholders(command: string): string[] {
  const matches = command.match(/(\{[^{}]+\}|<[^>]+>|\b(?:CH|REF|MATH|BUS|MEAS|SEARCH|PLOT|ZOOM|VIEW)<x>\b)/g) || [];
  return Array.from(new Set(matches.map((item) => item.trim()).filter(Boolean)));
}

function extractCommandStem(command: string): string {
  return String(command || '').trim().split(/\s+/)[0]?.replace(/\?$/, '') || '';
}

function normalizeStemForCompare(command: string): string {
  return extractCommandStem(command).replace(/[^A-Za-z0-9:*]/g, '').toUpperCase();
}

export async function materializeScpiCommand(
  input: MaterializeScpiCommandInput
): Promise<ToolResult<Record<string, unknown> | null>> {
  const header = String(input.header || '').trim();
  const concreteHeader = String(input.concreteHeader || '').trim();
  if (!header) {
    return { ok: false, data: null, sourceMeta: [], warnings: ['Missing header'] };
  }

  const index = await getCommandIndex();
  const entry = index.getByHeader(header, input.family);
  if (!entry) {
    return { ok: false, data: null, sourceMeta: [], warnings: ['No command matched header'] };
  }

  const chosen = chooseScpiSyntax(entry, input);
  if (!chosen) {
    return {
      ok: false,
      data: null,
      sourceMeta: [{ file: entry.sourceFile, commandId: entry.commandId, section: entry.group }],
      warnings: ['No matching syntax variant was available for this command'],
    };
  }

  const inferredBindings = concreteHeader
    ? inferPlaceholderBindingsFromConcreteHeader(concreteHeader, entry.header)
    : inferPlaceholderBindingsFromConcreteHeader(header, entry.header);
  const placeholderBindings = {
    ...inferredBindings,
    ...(input.placeholderBindings || {}),
  };

  let command = applyBindings(chosen.syntax, placeholderBindings);
  command = applyBindings(command, input.argumentBindings);

  const argumentValues = Array.isArray(input.arguments)
    ? [...input.arguments]
    : typeof input.value !== 'undefined'
      ? [input.value]
      : [];

  let positional = chosen.kind === 'set' ? applyPositionalArguments(command, argumentValues) : { command, remainingValues: argumentValues };
  command = positional.command.replace(/\s{2,}/g, ' ').trim();
  const warnings: string[] = [];
  if (chosen.kind === 'query' && argumentValues.length) {
    warnings.push('Query syntax ignores supplied argument values.');
  }

  const fallbackStem = applyBindings(concreteHeader || entry.header, placeholderBindings)
    .replace(/\?$/, '')
    .trim();
  const needsConcreteStemFallback =
    chosen.kind === 'set' &&
    typeof input.value !== 'undefined' &&
    Boolean(concreteHeader) &&
    Boolean(fallbackStem) &&
    normalizeStemForCompare(command) !== normalizeStemForCompare(fallbackStem);

  if (
    chosen.kind === 'set' &&
    typeof input.value !== 'undefined' &&
    (positional.remainingValues.length || needsConcreteStemFallback)
  ) {
    if (fallbackStem) {
      command = `${applyBindings(fallbackStem, input.argumentBindings)} ${formatArgumentValue(input.value)}`
        .replace(/\s{2,}/g, ' ')
        .trim();
      positional = { command, remainingValues: [] };
      warnings.push('Used concrete header/value fallback because the source syntax template was incomplete.');
    }
  }

  if (positional.remainingValues.length) {
    warnings.push(`Unused argument values: ${positional.remainingValues.map((value) => String(value)).join(', ')}`);
  }

  const unresolved = collectUnresolvedPlaceholders(command);
  if (unresolved.length) {
    return {
      ok: false,
      data: {
        canonicalHeader: entry.header,
        commandType: chosen.kind,
        syntaxUsed: chosen.syntax,
        partialCommand: command,
        inferredPlaceholderBindings: inferredBindings,
      },
      sourceMeta: [{ file: entry.sourceFile, commandId: entry.commandId, section: entry.group }],
      warnings: [`Command still contains unresolved placeholders: ${unresolved.join(', ')}`],
    };
  }

  const verification = await verifyScpiCommands({
    commands: [command],
    modelFamily: input.family,
    requireExactSyntax: true,
  });
  const verified = Array.isArray(verification.data)
    ? Boolean((verification.data as Array<Record<string, unknown>>)[0]?.verified)
    : false;
  if (!verified) {
    return {
      ok: false,
      data: {
        canonicalHeader: entry.header,
        commandType: chosen.kind,
        syntaxUsed: chosen.syntax,
        partialCommand: command,
        inferredPlaceholderBindings: inferredBindings,
      },
      sourceMeta: [{ file: entry.sourceFile, commandId: entry.commandId, section: entry.group }],
      warnings: ['Materialized command did not pass exact source-of-truth SCPI verification.'],
    };
  }

  return {
    ok: true,
    data: {
      canonicalHeader: entry.header,
      sourceFile: entry.sourceFile,
      commandType: chosen.kind,
      syntaxUsed: chosen.syntax,
      command,
      inferredPlaceholderBindings: inferredBindings,
    },
    sourceMeta: [{ file: entry.sourceFile, commandId: entry.commandId, section: entry.group }],
    warnings,
  };
}
