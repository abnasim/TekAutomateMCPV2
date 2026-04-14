// commandIndex.ts - SCPI command search and ranking (build: 2026-04-14)
import { promises as fs } from 'fs';
import * as path from 'path';
import { resolveCommandsDir } from './paths';
import { GROUP_DESCRIPTIONS } from './commandGroups';

export type CommandType = 'set' | 'query' | 'both';

export interface CommandSyntax {
  set?: string;
  query?: string;
}

export interface CommandArgument {
  name: string;
  type: string;
  required: boolean;
  description: string;
  validValues: Record<string, unknown>;
  defaultValue?: unknown;
}

export interface CommandCodeExample {
  description: string;
  scpi?: { code: string };
  python?: { code: string };
  tm_devices?: { code: string };
}

export interface ManualReference {
  section?: string;
  page?: number;
}

export interface CommandRecord {
  commandId: string;
  command?: string;
  sourceFile: string;
  group: string;
  header: string;
  shortDescription: string;
  description: string;
  category: string;
  tags: string[];
  commandType: CommandType;
  families: string[];
  models: string[];
  syntax: CommandSyntax;
  arguments: CommandArgument[];
  queryResponse?: string;
  codeExamples: CommandCodeExample[];
  examples?: Array<{ description?: string; scpi?: string; tm_devices?: string }>;
  relatedCommands: string[];
  notes: string[];
  manualReference?: ManualReference;
  raw: Record<string, unknown>;
}

export interface SearchFilters {
  family?: string;
  commandType?: CommandType;
  limit?: number;
}

const DEFAULT_COMMAND_FILES = [
  'mso_2_4_5_6_7.json',
  'mso_manual_overrides.json',
  'MSO_DPO_5k_7k_70K.json',
  'legacy_scope_manual_overrides.json',
  'afg.json',
  'awg.json',
  'smu.json',
  'dpojet.json',
  'tekexpress.json',
  'rsa.json',
  'pi_only.json',
];

const SOURCE_FILE_FAMILY_HINTS: Record<string, string[]> = {
  'mso_2_4_5_6_7.json': ['MSO2', 'MSO4', 'MSO5', 'MSO6', 'MSO7'],
  'mso_manual_overrides.json': ['MSO4', 'MSO5', 'MSO6', 'MSO7'],
  'MSO_DPO_5k_7k_70K.json': ['MSO5000', 'DPO5000', 'DPO7000', 'DPO70000'],
  'legacy_scope_manual_overrides.json': ['MSO5000', 'DPO5000', 'DPO7000', 'DPO70000'],
  'pi_only.json': ['MSO4', 'MSO5', 'MSO6', 'MSO44', 'MSO46', 'MSO54', 'MSO56', 'MSO58', 'MSO64', 'MSO66', 'MSO68', 'DPO7000', 'DPO70000'],
  'afg.json': ['AFG'],
  'awg.json': ['AWG'],
  'smu.json': ['SMU'],
  'rsa.json': ['RSA'],
  'dpojet.json': ['DPOJET'],
  'tekexpress.json': ['TEKEXPRESS'],
};

function stripPlaceholders(token: string): string {
  // Remove {ch}, {n}, <x>, <y> etc from tokens
  return token.replace(/\{[^}]*\}/g, '').replace(/<[^>]*>/g, '');
}

function normalizeToken(raw: string): string {
  const stripped = stripPlaceholders(raw);
  return stripped.replace(/[^A-Za-z0-9_*]/g, '').toUpperCase().trim();
}

function shortToken(raw: string): string {
  const cleaned = stripPlaceholders(raw).replace(/[^A-Za-z0-9_*]/g, '');
  if (!cleaned) return '';
  const star = cleaned.startsWith('*') ? '*' : '';
  const body = star ? cleaned.slice(1) : cleaned;
  const upperChars = body.split('').filter((ch) => ch >= 'A' && ch <= 'Z').join('');
  const short = upperChars || body.toUpperCase();
  return `${star}${short}`;
}

function tokenizeHeader(header: string): string[] {
  return header
    .replace(/\?/g, '')
    .replace(/,/g, ' ')
    .split(/[:\s]+/g)
    .map((t) => t.trim())
    .filter(Boolean);
}

function stripPlaceholdersFromKey(key: string): string {
  return key
    .split(':')
    .map((t) => stripPlaceholders(t))
    .filter(Boolean)
    .join(':');
}

function stripTrailingDigitsFromKey(key: string): string {
  return key
    .split(':')
    .map((t) => t.replace(/\d+$/g, ''))
    .filter(Boolean)
    .join(':');
}

function buildIndexedHeaderLookupVariants(header: string): string[] {
  const source = String(header || '').trim();
  if (!source) return [];

  const variants = new Set<string>([source]);
  const add = (value: string) => {
    const trimmed = String(value || '').trim();
    if (trimmed) variants.add(trimmed);
  };

  const placeholderized = source
    .replace(/\bCH\d+_D\d+\b/gi, 'CH<x>_D<x>')
    .replace(/\bCH\d+\b/gi, 'CH<x>')
    .replace(/\bB\d+\b/gi, 'B<x>')
    .replace(/\bREF\d+\b/gi, 'REF<x>')
    .replace(/\bMATH\d+\b/gi, 'MATH<x>')
    .replace(/\bBUS\d+\b/gi, 'BUS<x>')
    .replace(/\bMEAS\d+\b/gi, 'MEAS<x>')
    .replace(/\bSEARCH\d+\b/gi, 'SEARCH<x>')
    .replace(/\bZOOM\d+\b/gi, 'ZOOM<x>')
    .replace(/\bPLOT\d+\b/gi, 'PLOT<x>')
    .replace(/\bVIEW\d+\b/gi, 'VIEW<x>')
    .replace(/\bSOURCE\d+\b/gi, 'SOURCE<x>')
    .replace(/\bEDGE\d+\b/gi, 'EDGE<x>')
    .replace(/\bREFLEVELS\d+\b/gi, 'REFLevels<x>')
    .replace(/(^|:)(A|B)(?=:|$)/gi, '$1{A|B}');
  add(placeholderized);

  add(
    source
      .replace(/\bSOURCE\d+\b/gi, 'SOURCE')
      .replace(/\bEDGE\d+\b/gi, 'EDGE')
      .replace(/\bREFLEVELS\d+\b/gi, 'REFLevels')
  );

  add(
    placeholderized
      .replace(/\bSOURCE<x>\b/gi, 'SOURCE')
      .replace(/\bEDGE<x>\b/gi, 'EDGE')
      .replace(/\bREFLEVELS<x>\b/gi, 'REFLevels')
  );

  return Array.from(variants);
}

function rootTokenForSafety(header: string): string {
  const root = tokenizeHeader(header)[0] || '';
  return normalizeToken(root.replace(/\d+$/g, ''));
}

function headerSpecificityScore(candidateHeader: string, requestedHeader: string): number {
  const candidateTokens = tokenizeHeader(candidateHeader);
  const requestedTokens = tokenizeHeader(requestedHeader);
  let score = candidateTokens.length === requestedTokens.length ? 4 : 0;
  const pairs = Math.min(candidateTokens.length, requestedTokens.length);

  for (let i = 0; i < pairs; i += 1) {
    const candidate = candidateTokens[i] || '';
    const requested = requestedTokens[i] || '';
    if (!candidate || !requested) continue;

    const candidateUpper = candidate.toUpperCase();
    const requestedUpper = requested.toUpperCase();
    const candidateNorm = normalizeToken(candidate);
    const requestedNorm = normalizeToken(requested);

    if (candidateNorm === requestedNorm) score += 2;
    if (candidateUpper === requestedUpper) score += 10;

    if (/<[^>]+>/.test(requested) && /<[^>]+>/.test(candidate)) score += 8;
    if (/\{[^}]+\}/.test(requested) && /\{[^}]+\}/.test(candidate)) score += 8;
    if (/SOURCE<[^>]+>/i.test(requested) && /SOURCE<[^>]+>/i.test(candidate)) score += 10;
    if (/EDGE<[^>]+>/i.test(requested) && /EDGE<[^>]+>/i.test(candidate)) score += 10;
    if (/REFLEVELS<[^>]+>/i.test(requested) && /REFLEVELS<[^>]+>/i.test(candidate)) score += 10;
  }

  return score;
}

function normalizeHeaderKey(header: string): string {
  const tokens = tokenizeHeader(header).map(normalizeToken).filter(Boolean);
  return tokens.join(':');
}

function normalizeSearchDedupKey(header: string): string {
  const canonical = String(header || '')
    .trim()
    .replace(/\?$/g, '')
    .replace(/\bCH\d+_D\d+\b/gi, 'CH<x>_D<x>')
    .replace(/\bCH\d+\b/gi, 'CH<x>')
    .replace(/\bB\d+\b/gi, 'B<x>')
    .replace(/\bREF\d+\b/gi, 'REF<x>')
    .replace(/\bMATH\d+\b/gi, 'MATH<x>')
    .replace(/\bBUS\d+\b/gi, 'BUS<x>')
    .replace(/\bMEAS\d+\b/gi, 'MEAS<x>')
    .replace(/\bSEARCH\d+\b/gi, 'SEARCH<x>')
    .replace(/\bZOOM\d+\b/gi, 'ZOOM<x>')
    .replace(/\bPLOT\d+\b/gi, 'PLOT<x>')
    .replace(/\bVIEW\d+\b/gi, 'VIEW<x>')
    .replace(/\bSOURCE\d+\b/gi, 'SOURCE<x>')
    .replace(/\bEDGE\d+\b/gi, 'EDGE<x>')
    .replace(/\bREFLEVELS\d+\b/gi, 'REFLevels<x>')
    .replace(/(^|:)(A|B)(?=:|$)/gi, '$1{A|B}');
  return normalizeHeaderKey(canonical);
}

function expandHeaderKeys(header: string): string[] {
  const tokens = tokenizeHeader(header);
  if (!tokens.length) return [];
  const variants = tokens.map((t) => {
    const full = normalizeToken(t);
    const short = shortToken(t);
    return full && short && full !== short ? [full, short] : [full || short];
  });

  const keys: string[] = [];
  const walk = (idx: number, acc: string[]) => {
    if (idx >= variants.length) {
      const key = acc.filter(Boolean).join(':');
      if (key) keys.push(key);
      return;
    }
    variants[idx].forEach((v) => walk(idx + 1, [...acc, v]));
  };
  walk(0, []);
  return Array.from(new Set(keys));
}

function normalizeText(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9_:.?]+/g)
    .map((v) => v.trim())
    .filter((v) => v.length > 1);
}

function sourceFilePriority(sourceFile: string): number {
  return /manual_overrides\.json$/i.test(String(sourceFile || '')) ? 0 : 1;
}

function searchSourceFilePriority(sourceFile: string): number {
  const name = String(sourceFile || '');
  // manual_overrides get -5 so they receive a +10 bonus in search scoring
  if (/manual_overrides\.json$/i.test(name)) return -5;
  if (/mso_2_4_5_6_7\.json$/i.test(name)) return 0;
  if (/MSO_DPO_5k_7k_70K\.json$/i.test(name)) return 0;
  return 2;
}

function extractHeader(raw: Record<string, unknown>): string {
  const manual = raw._manualEntry as Record<string, unknown> | undefined;
  if (typeof manual?.header === 'string' && manual.header.trim()) {
    return manual.header.trim();
  }
  const header =
    (typeof raw.header === 'string' && raw.header) ||
    '';
  if (header) return header.trim();

  const src = (typeof raw.command === 'string' && raw.command) || (typeof raw.scpi === 'string' && raw.scpi) || '';
  if (!src) return '';
  const base = src.split(/\s+/).slice(0, 2).join(' ').trim();
  return base.replace(/\?$/, '');
}

function extractShortDescription(raw: Record<string, unknown>): string {
  const manual = raw._manualEntry as Record<string, unknown> | undefined;
  return (
    (typeof raw.shortDescription === 'string' && raw.shortDescription.trim()) ||
    (typeof manual?.shortDescription === 'string' && manual.shortDescription.trim()) ||
    (typeof raw.summary === 'string' && raw.summary.trim()) ||
    ''
  );
}

function extractSyntax(raw: Record<string, unknown>): CommandSyntax {
  const manual = raw._manualEntry as Record<string, unknown> | undefined;
  const manualSyntax = manual?.syntax;
  if (manualSyntax && typeof manualSyntax === 'object' && !Array.isArray(manualSyntax)) {
    const syn = manualSyntax as Record<string, unknown>;
    const setValue = typeof syn.set === 'string' ? syn.set.trim() : '';
    const queryValue = typeof syn.query === 'string' ? syn.query.trim() : '';
    if (setValue || queryValue) {
      return { set: setValue || undefined, query: queryValue || undefined };
    }
  }

  const syntax = raw.syntax;
  if (!syntax) return {};

  if (typeof syntax === 'object' && !Array.isArray(syntax)) {
    const syn = syntax as Record<string, unknown>;
    const setValue = typeof syn.set === 'string' ? syn.set.trim() : '';
    const queryValue = typeof syn.query === 'string' ? syn.query.trim() : '';
    return {
      set: setValue || undefined,
      query: queryValue || undefined,
    };
  }

  const candidates: string[] = [];
  if (typeof syntax === 'string') {
    candidates.push(syntax.trim());
  } else if (Array.isArray(syntax)) {
    syntax.forEach((item) => {
      if (typeof item === 'string' && item.trim()) candidates.push(item.trim());
    });
  }

  let setValue = '';
  let queryValue = '';
  const classify = (chunk: string) => {
    if (!chunk) return;
    if (chunk.includes('?')) {
      if (!queryValue) queryValue = chunk;
    } else if (!setValue) {
      setValue = chunk;
    }
  };

  candidates.forEach((candidate) => {
    const parts = candidate
      .split(/\s+(?=[A-Za-z*][A-Za-z0-9]*(?::[A-Za-z0-9]+)+)/g)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length <= 1) {
      classify(candidate);
      return;
    }
    parts.forEach(classify);
  });

  return {
    set: setValue || undefined,
    query: queryValue || undefined,
  };
}

function collectSyntaxChunks(syntax: unknown): string[] {
  const candidates: string[] = [];
  if (typeof syntax === 'string') {
    candidates.push(syntax.trim());
  } else if (Array.isArray(syntax)) {
    syntax.forEach((item) => {
      if (typeof item === 'string' && item.trim()) candidates.push(item.trim());
    });
  }

  const chunks: string[] = [];
  candidates.forEach((candidate) => {
    const parts = candidate
      .split(/\s+(?=[*A-Za-z][A-Za-z0-9_<>{}\[\]\-|]*(?::[A-Za-z0-9_<>{}\[\]\-|]+)+)/g)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length <= 1) {
      chunks.push(candidate);
      return;
    }
    chunks.push(...parts);
  });
  return chunks;
}

function extractHeaderFromSyntaxChunk(chunk: string): string {
  const match = chunk.trim().match(/^[*A-Za-z][A-Za-z0-9_<>{}\[\]\-|]*(?::[A-Za-z0-9_<>{}\[\]\-|]+)+\??/);
  return match ? match[0].replace(/\?$/, '') : '';
}

function buildSyntaxVariantSpecs(raw: Record<string, unknown>): Array<{ header: string; syntax: CommandSyntax }> {
  const chunks = collectSyntaxChunks(raw.syntax);
  if (!chunks.length) return [];

  const grouped = new Map<string, CommandSyntax>();
  chunks.forEach((chunk) => {
    const header = extractHeaderFromSyntaxChunk(chunk);
    if (!header || !header.includes(':')) return;
    const current = grouped.get(header) || {};
    if (chunk.includes('?')) {
      if (!current.query) current.query = chunk;
    } else if (!current.set) {
      current.set = chunk;
    }
    grouped.set(header, current);
  });

  return Array.from(grouped.entries()).map(([header, syntax]) => ({ header, syntax }));
}

function toValidValues(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

function extractArguments(raw: Record<string, unknown>): CommandArgument[] {
  const manual = raw._manualEntry as Record<string, unknown> | undefined;
  const params = Array.isArray(raw.params) ? raw.params : [];
  const argsRaw = params.length
    ? params
    : Array.isArray(raw.arguments)
      ? raw.arguments
      : Array.isArray(manual?.arguments)
        ? (manual?.arguments as unknown[])
        : [];
  if (!Array.isArray(argsRaw)) return [];
  return argsRaw
    .filter((arg): arg is Record<string, unknown> => !!arg && typeof arg === 'object')
    .map((arg) => ({
      name: typeof arg.name === 'string' ? arg.name : '',
      type: typeof arg.type === 'string' ? arg.type : '',
      required: Boolean(arg.required),
      description: typeof arg.description === 'string' ? arg.description : '',
      validValues: toValidValues(
        arg.validValues ||
          (Array.isArray(arg.options) ? { values: arg.options } : undefined) ||
          (typeof arg.min !== 'undefined' || typeof arg.max !== 'undefined' || typeof arg.default !== 'undefined'
            ? { min: arg.min, max: arg.max, default: arg.default }
            : undefined)
      ),
      defaultValue: arg.defaultValue,
    }))
    .filter((arg) => arg.name || arg.type || Object.keys(arg.validValues).length > 0);
}

function argumentHint(arg?: CommandArgument): string {
  if (!arg) return '<value>';
  const values = Array.isArray(arg.validValues?.values) ? (arg.validValues.values as unknown[]) : [];
  if (values.length) {
    const enums = values
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter(Boolean);
    if (enums.length) return `{${enums.join('|')}}`;
  }
  const t = (arg.type || '').toLowerCase();
  if (t.includes('int') || t.includes('nr1') || t.includes('integer')) return '<NR1>';
  if (t.includes('float') || t.includes('nrf') || t.includes('number')) return '<NRf>';
  return '<value>';
}

function extractCodeExamples(raw: Record<string, unknown>): CommandCodeExample[] {
  const manual = raw._manualEntry as Record<string, unknown> | undefined;
  const examplesRaw = Array.isArray(manual?.examples)
    ? (manual.examples as unknown[])
    : Array.isArray(raw.codeExamples)
      ? raw.codeExamples
      : [];
  if (!Array.isArray(examplesRaw)) return [];
  const result = examplesRaw
    .filter((ex): ex is Record<string, unknown> => !!ex && typeof ex === 'object')
    .map((ex) => {
      const nested =
        ex.codeExamples && typeof ex.codeExamples === 'object' && !Array.isArray(ex.codeExamples)
          ? (ex.codeExamples as Record<string, unknown>)
          : ex;
      const scpi = nested.scpi as Record<string, unknown> | undefined;
      const python = nested.python as Record<string, unknown> | undefined;
      const tmDevices = nested.tm_devices as Record<string, unknown> | undefined;
      const out: CommandCodeExample = {
        description: typeof ex.description === 'string' ? ex.description : '',
      };
      if (typeof scpi?.code === 'string' && scpi.code.trim()) {
        out.scpi = { code: scpi.code.trim() };
      }
      if (typeof python?.code === 'string' && python.code.trim()) {
        out.python = { code: python.code.trim() };
      }
      if (typeof tmDevices?.code === 'string' && tmDevices.code.trim()) {
        out.tm_devices = { code: tmDevices.code.trim() };
      }
      return out;
    })
    .filter((ex) => Boolean(ex.scpi?.code || ex.python?.code || ex.tm_devices?.code));

  // If no code examples extracted, try top-level example/examples
  if (result.length === 0) {
    // Try raw.examples array (MSO format: [{scpi: "CMD", description: "..."}])
    if (Array.isArray(raw.examples)) {
      raw.examples.forEach((ex: unknown) => {
        if (ex && typeof ex === 'object') {
          const exObj = ex as Record<string, unknown>;
          const scpiCode = typeof exObj.scpi === 'string' ? exObj.scpi.trim() : '';
          if (scpiCode) {
            result.push({
              description: typeof exObj.description === 'string' ? exObj.description : '',
              scpi: { code: scpiCode },
            });
          }
        }
      });
    }
    // Try raw.example string
    if (result.length === 0 && typeof raw.example === 'string' && raw.example.trim()) {
      result.push({
        description: '',
        scpi: { code: raw.example.trim() },
      });
    }
  }

  return result;
}

function extractStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean);
}

function extractManualReference(raw: Record<string, unknown>): ManualReference | undefined {
  const manual = raw._manualEntry as Record<string, unknown> | undefined;
  const mrSource = manual?.manualReference || raw.manualReference;
  if (!mrSource || typeof mrSource !== 'object' || Array.isArray(mrSource)) {
    return undefined;
  }
  const mr = mrSource as Record<string, unknown>;
  const section = typeof mr.section === 'string' ? mr.section.trim() : '';
  const page = typeof mr.page === 'number' && Number.isFinite(mr.page) ? mr.page : undefined;
  if (!section && typeof page === 'undefined') return undefined;
  return {
    section: section || undefined,
    page,
  };
}

function extractCommandType(raw: Record<string, unknown>, header: string): CommandType {
  // Check syntax FIRST — it's the most reliable source of truth.
  // _manualEntry.commandType is often wrong (e.g. "query" when command has both set and query forms).
  const syntax = raw.syntax
    || (raw._manualEntry as Record<string, unknown> | undefined)?.syntax;
  if (syntax && typeof syntax === 'object' && !Array.isArray(syntax)) {
    const syn = syntax as Record<string, unknown>;
    const hasSet = typeof syn.set === 'string' && syn.set.trim().length > 0;
    const hasQuery = typeof syn.query === 'string' && syn.query.trim().length > 0;
    if (hasSet && hasQuery) return 'both';
    if (hasQuery) return 'query';
    if (hasSet) return 'set';
  }

  // Fall back to explicit commandType if syntax didn't resolve
  const explicit =
    (typeof raw.commandType === 'string' && raw.commandType) ||
    (typeof (raw._manualEntry as Record<string, unknown> | undefined)?.commandType === 'string'
      ? String((raw._manualEntry as Record<string, unknown>).commandType)
      : '');
  const normalized = explicit.toLowerCase();
  if (normalized === 'set' || normalized === 'query' || normalized === 'both') return normalized;

  if (header.endsWith('?')) return 'query';
  return 'both';
}

function extractFamilyModel(raw: Record<string, unknown>, sourceFile: string): { families: string[]; models: string[] } {
  const instruments = raw.instruments as Record<string, unknown> | undefined;
  const families = Array.isArray(instruments?.families)
    ? (instruments?.families as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  const models = Array.isArray(instruments?.models)
    ? (instruments?.models as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  const hinted = SOURCE_FILE_FAMILY_HINTS[sourceFile] || [];
  return {
    families: Array.from(new Set([...families, ...hinted])),
    models: Array.from(new Set(models)),
  };
}

function extractTags(raw: Record<string, unknown>, group: string, sourceFile: string): string[] {
  const tags: string[] = [];
  if (Array.isArray(raw.mnemonics)) {
    raw.mnemonics.forEach((t) => {
      if (typeof t === 'string' && t.trim()) tags.push(t.trim());
    });
  }
  if (typeof raw.commandGroup === 'string' && raw.commandGroup.trim()) tags.push(raw.commandGroup.trim());
  if (group.trim()) tags.push(group.trim());
  tags.push(sourceFile.replace('.json', ''));
  return Array.from(new Set(tags));
}

class Bm25 {
  private readonly docs: string[];
  private readonly docLengths: number[];
  private readonly postings = new Map<string, Array<{ docIdx: number; tf: number }>>();
  private readonly avgDocLength: number;

  constructor(docs: string[]) {
    this.docs = docs;
    this.docLengths = new Array(docs.length).fill(0);
    let total = 0;
    docs.forEach((doc, docIdx) => {
      const tokens = normalizeText(doc);
      this.docLengths[docIdx] = tokens.length;
      total += tokens.length;
      const tf = new Map<string, number>();
      tokens.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
      tf.forEach((count, token) => {
        const arr = this.postings.get(token) || [];
        arr.push({ docIdx, tf: count });
        this.postings.set(token, arr);
      });
    });
    this.avgDocLength = docs.length ? total / docs.length : 1;
  }

  search(query: string, limit: number): Array<{ index: number; score: number }> {
    const tokens = normalizeText(query);
    if (!tokens.length) return [];
    const N = this.docs.length || 1;
    const scores = new Map<number, number>();
    const k1 = 1.2;
    const b = 0.75;

    tokens.forEach((token) => {
      const posting = this.postings.get(token);
      if (!posting?.length) return;
      const df = posting.length;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      posting.forEach(({ docIdx, tf }) => {
        const dl = this.docLengths[docIdx] || 1;
        const numer = tf * (k1 + 1);
        const denom = tf + k1 * (1 - b + (b * dl) / this.avgDocLength);
        const score = idf * (numer / denom);
        scores.set(docIdx, (scores.get(docIdx) || 0) + score);
      });
    });

    return Array.from(scores.entries())
      .map(([index, score]) => ({ index, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, limit));
  }
}

function normalizeFamilyKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function requestedFamilyBuckets(family?: string): Set<string> {
  const out = new Set<string>();
  const raw = String(family || '').trim();
  if (!raw) return out;
  const normalized = normalizeFamilyKey(raw);
  const add = (value: string) => out.add(value);

  if (/MSO24567|MSO456|MSO45|MSO56|MSO7|MSO6|MSO5|MSO4|MSO2/.test(normalized)) add('MODERN_MSO');
  if (/DPO|5K|7K|70K|MSO5000/.test(normalized)) add('LEGACY_SCOPE');
  if (/TEKSCOPEPC|TEKSCOPE/.test(normalized)) {
    add('MODERN_MSO');
    add('LEGACY_SCOPE');
  }
  if (/AFG/.test(normalized)) add('AFG');
  if (/AWG/.test(normalized)) add('AWG');
  if (/SMU|KEITHLEY/.test(normalized)) add('SMU');
  if (/RSA/.test(normalized)) add('RSA');
  if (/DPOJET/.test(normalized)) add('DPOJET');
  if (/TEKEXPRESS/.test(normalized)) add('TEKEXPRESS');

  out.add(normalized);
  return out;
}

function entryFamilyKeys(entry: CommandRecord): Set<string> {
  const out = new Set<string>();
  [...entry.families, ...entry.models, ...(SOURCE_FILE_FAMILY_HINTS[entry.sourceFile] || [])]
    .map((value) => normalizeFamilyKey(value))
    .filter(Boolean)
    .forEach((value) => out.add(value));

  if (
    entry.sourceFile === 'mso_2_4_5_6_7.json' ||
    ['MSO2', 'MSO4', 'MSO5', 'MSO6', 'MSO7'].some((family) => out.has(family))
  ) {
    out.add('MODERN_MSO');
  }
  if (
    entry.sourceFile === 'MSO_DPO_5k_7k_70K.json' ||
    ['MSO5000', 'DPO5000', 'DPO7000', 'DPO70000'].some((family) => out.has(family))
  ) {
    out.add('LEGACY_SCOPE');
  }
  if (entry.sourceFile === 'afg.json') out.add('AFG');
  if (entry.sourceFile === 'awg.json') out.add('AWG');
  if (entry.sourceFile === 'smu.json') out.add('SMU');
  if (entry.sourceFile === 'rsa.json') out.add('RSA');
  if (entry.sourceFile === 'dpojet.json') out.add('DPOJET');
  if (entry.sourceFile === 'tekexpress.json') out.add('TEKEXPRESS');

  return out;
}

// Application-specific command sets that should ONLY appear when explicitly targeted.
// They are not general scope commands and must not pollute unfiltered searches.
const APPLICATION_ONLY_FAMILIES = new Set(['DPOJET', 'TEKEXPRESS', 'AFG', 'AWG', 'SMU', 'RSA']);

function familyMatches(entry: CommandRecord, family?: string): boolean {
  const requested = requestedFamilyBuckets(family);
  const entryKeys = entryFamilyKeys(entry);

  // Application-specific sources must be explicitly requested — never appear in unfiltered searches
  if (!requested.size) {
    for (const key of APPLICATION_ONLY_FAMILIES) {
      if (entryKeys.has(key)) return false;
    }
    return true;
  }

  for (const key of requested) {
    if (entryKeys.has(key)) return true;
  }
  return false;
}

function commandTypeMatches(entryType: CommandType, requested?: CommandType): boolean {
  if (!requested) return true;
  if (requested === 'both') return entryType === 'both';
  if (requested === 'set') return entryType === 'set' || entryType === 'both';
  if (requested === 'query') return entryType === 'query' || entryType === 'both';
  return true;
}

export class CommandIndex {
  private readonly entries: CommandRecord[];
  private readonly bm25: Bm25;
  private readonly byHeaderKey = new Map<string, number[]>();

  constructor(entries: CommandRecord[]) {
    this.entries = entries;
    const docs = entries.map((entry) => {
      // Extract distinctive words from the full description that don't appear in
      // the header or short description. These help find commands by UI terminology
      // (e.g. "badge" in DISPlaystat:ENABle description, "crosshair" in GRAticule).
      const headerAndShort = `${entry.header} ${entry.shortDescription}`.toLowerCase().replace(/[^a-z]/g, ' ');
      const commonWords = new Set(headerAndShort.split(/\s+/).filter(w => w.length > 2));
      const descWords = (entry.description || '').toLowerCase().replace(/[^a-z]/g, ' ').split(/\s+/).filter(w => w.length > 3);
      const uniqueDescWords = descWords.filter(w => !commonWords.has(w)).slice(0, 12).join(' ');

      // Extract SCPI abbreviations from mixed-case mnemonics (e.g. MEASUrement → measu, TRIGger → trig).
      // This allows BM25 to match abbreviated queries like "meas", "trig", "acq", "freq".
      // The SCPI convention: capital letters = minimum abbreviation, lowercase = optional extension.
      const scpiAbbrevTokens = entry.header
        .split(/[:\s<>{}()\[\]|,?]+/)
        .flatMap(tok => {
          const m = tok.match(/^([A-Z]{2,})[a-z]/);  // e.g. MEASUrement, TRIGger, FREQuency
          return m ? [m[1].toLowerCase()] : [];         // → measu, trig, freq
        })
        .join(' ');

      // Extract enum option values from arguments (e.g. SINusoid, SQUare, SEQuence, RUNSTop).
      // TekControl scores +200 for exact enum match — indexing these lets BM25 find the right
      // command when the user says "sinusoid" or "sequence" (which are SCPI enum tokens).
      const enumTokens = (entry.arguments || [])
        .flatMap(arg => {
          const vals = Array.isArray((arg.validValues as Record<string, unknown>)?.values)
            ? ((arg.validValues as Record<string, unknown>).values as unknown[])
            : [];
          return vals.filter((v): v is string => typeof v === 'string' && v.length > 1);
        })
        .join(' ');

      return [
        entry.header,
        scpiAbbrevTokens,       // SCPI abbreviations for mnemonic queries (meas, trig, freq, etc.)
        enumTokens,             // Enum option values (SINusoid, SEQuence, RUNSTop, EYEDiagram, etc.)
        entry.shortDescription,
        entry.shortDescription, // weight semantic intent heavier in BM25 ranking
        GROUP_DESCRIPTIONS[entry.group] || '',
        entry.description,
        uniqueDescWords,        // extra weight for distinctive description terms
        entry.category,
        entry.tags.join(' '),
      ]
        .filter(Boolean)
        .join(' ');
    });
    this.bm25 = new Bm25(docs);
    entries.forEach((entry, idx) => {
      const keys = expandHeaderKeys(entry.header);
      keys.forEach((key) => {
        const list = this.byHeaderKey.get(key) || [];
        list.push(idx);
        this.byHeaderKey.set(key, list);
      });
      const normalized = normalizeHeaderKey(entry.header);
      if (normalized) {
        const list = this.byHeaderKey.get(normalized) || [];
        if (!list.includes(idx)) list.push(idx);
        this.byHeaderKey.set(normalized, list);
      }
    });
  }

  getByHeader(header: string, family?: string): CommandRecord | null {
    const selectCandidate = (indexes: number[]): CommandRecord | null => {
      const candidates = indexes
        .map((idx) => this.entries[idx])
        .filter((entry) => familyMatches(entry, family))
        .sort((a, b) => {
          const score = headerSpecificityScore(b.header, header) - headerSpecificityScore(a.header, header);
          if (score !== 0) return score;
          const priority = sourceFilePriority(a.sourceFile) - sourceFilePriority(b.sourceFile);
          if (priority !== 0) return priority;
          return `${a.sourceFile}:${a.commandId}`.localeCompare(`${b.sourceFile}:${b.commandId}`);
        });
      return candidates[0] || null;
    };

    const exactKey = normalizeHeaderKey(header);
    const exact = selectCandidate(this.byHeaderKey.get(exactKey) || []);
    if (exact) return exact;

    const placeholderKey = stripPlaceholdersFromKey(exactKey);
    if (placeholderKey && placeholderKey !== exactKey) {
      const placeholder = selectCandidate(this.byHeaderKey.get(placeholderKey) || []);
      if (placeholder) return placeholder;
    }

    const digitKey = stripTrailingDigitsFromKey(placeholderKey || exactKey);
    if (digitKey && digitKey !== exactKey && digitKey !== placeholderKey) {
      const digitCandidates = (this.byHeaderKey.get(digitKey) || [])
        .map((idx) => this.entries[idx])
        .filter((entry) => familyMatches(entry, family))
        .sort((a, b) => `${a.sourceFile}:${a.commandId}`.localeCompare(`${b.sourceFile}:${b.commandId}`));
      const inputRoot = rootTokenForSafety(header);
      const safe = digitCandidates.find((candidate) => rootTokenForSafety(candidate.header) === inputRoot);
      if (safe) return safe;
    }

    for (const variant of buildIndexedHeaderLookupVariants(header)) {
      const variantKey = normalizeHeaderKey(variant);
      if (variantKey && variantKey !== exactKey) {
        const matched = selectCandidate(this.byHeaderKey.get(variantKey) || []);
        if (matched) return matched;
      }
    }

    return null;
  }
  searchByQuery(query: string, family?: string, limit = 10, commandType?: CommandType, offset = 0): CommandRecord[] {
    const normalizedOffset = Math.max(0, offset || 0);
    const q = query.toLowerCase();
    // For queries that need special reranking, use a larger candidate pool
    // to ensure the target commands are included even if BM25 doesn't rank them high
    const needsLargerPool = /(\bbus\b.*\btype\b|\btype\b.*\bbus\b)|(\badd\b.*\b(bus|measure)|\b(bus|measure).*\badd\b)/.test(q);
    const candidateCount = needsLargerPool
      ? Math.max((normalizedOffset + limit) * 10, 200)
      : Math.max((normalizedOffset + limit) * 4, 25);
    const scored = this.bm25.search(query, candidateCount);
    const wantsFastframeCount =
      q.includes('fastframe') && /(count|frames|frame|number)/.test(q);
    // Detect queries that want bus protocol type (not trigger/search bus sub-commands)
    const wantsBusType = /\bbus\b/.test(q) && /\btype\b/.test(q) && !/trigger|search|edge|pulse/.test(q);
    // Detect queries wanting measurement add/create (not jitter models or summary sub-items)
    const wantsAddMeas = /\badd\b/.test(q) && /\bmeasure(ment)?s?\b/.test(q);
    // Detect queries wanting to add a bus search (not add a bus)
    const wantsBusSearch = /\bbus\b/.test(q) && /\bsearch\b/.test(q) && /\badd\b/.test(q);
    // Detect queries wanting jitter measurement add specifically
    const wantsJitterMeas = /\bjitter\b/.test(q) && /\bmeasure(ment)?s?\b/.test(q) && /\badd\b/.test(q);
    const reranked = scored
      .map((item) => {
        const entry = this.entries[item.index];
        if (!entry) return item;
        let bonus = 0;
        bonus -= searchSourceFilePriority(entry.sourceFile) * 2;
        if (wantsFastframeCount) {
          const h = entry.header.toLowerCase();
          if (h.includes('fastframe:count')) bonus += 50;
          if (h.includes('sixteenbit')) bonus -= 8;
        }
        if (wantsBusType) {
          const h = entry.header.toLowerCase();
          // Boost the bus type command strongly
          if (/^bus:b[^:]*:type$/.test(h)) bonus += 80;
          // Penalize trigger/search bus commands
          if (/^trigger/.test(h) || /^search/.test(h)) bonus -= 25;
          // Penalize I2C/SPI/CAN/UART specific bus sub-commands (they're config, not type-setting)
          if (/^bus:b[^:]*:(i2c|spi|can|rs232|usb|lin|arinc|flex)/.test(h)) bonus -= 25;
        }
        if (wantsAddMeas || wantsJitterMeas) {
          const h = entry.header.toLowerCase();
          // Boost the add measurement command
          if (h.includes('measurement:addmeas') || h.includes('measur.*:addmeas')) bonus += 30;
          // Penalize jitter model/summary sub-commands
          if (/jitter(model|mode|summary)/.test(h) || /jittersummary/.test(h)) bonus -= 15;
        }
        if (wantsBusSearch) {
          const h = entry.header.toLowerCase();
          // Boost search:addnew strongly for bus search queries
          if (h === 'search:addnew') bonus += 80;
          // Penalize bus:addnew since that adds a bus, not a search
          if (h === 'bus:addnew') bonus -= 30;
        }
        return { ...item, score: item.score + bonus };
      })
      .sort((a, b) => b.score - a.score);
    const results: CommandRecord[] = [];
    const seen = new Set<string>();
    let skipped = 0;

    // For certain patterns, directly inject the known-correct result at the top
    // when it might not appear in BM25 candidates due to keyword pollution
    if (wantsBusSearch && normalizedOffset === 0) {
      const searchAddNewKey = normalizeHeaderKey('SEARch:ADDNew');
      const candidates = (this.byHeaderKey.get(searchAddNewKey) || [])
        .map((idx) => this.entries[idx])
        .filter((e) => familyMatches(e, family) && commandTypeMatches(e.commandType, commandType));
      if (candidates.length > 0) {
        const key = normalizeSearchDedupKey(candidates[0].header) || normalizeHeaderKey(candidates[0].header) || '';
        seen.add(key);
        results.push(candidates[0]);
      }
    }

    for (const item of reranked) {
      const entry = this.entries[item.index];
      if (!entry) continue;
      if (!familyMatches(entry, family)) continue;
      if (!commandTypeMatches(entry.commandType, commandType)) continue;
      const key = normalizeSearchDedupKey(entry.header) || normalizeHeaderKey(entry.header) || `${entry.sourceFile}:${entry.commandId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (skipped < normalizedOffset) {
        skipped++;
        continue;
      }
      results.push(entry);
      if (results.length >= limit) break;
    }
    return results;
  }

  size(): number {
    return this.entries.length;
  }

  getAllHeaders(): string[] {
    return this.entries.map((e) => e.header);
  }

  getEntries(family?: string): CommandRecord[] {
    return this.entries.filter((entry) => familyMatches(entry, family));
  }

  getByHeaderPrefix(header: string, family?: string): CommandRecord | null {
    const h = header.toLowerCase();
    const candidate = this.entries.find((e) => e.header.toLowerCase().startsWith(h) && familyMatches(e, family));
    return candidate || null;
  }
}

function toCommandRecord(
  raw: Record<string, unknown>,
  sourceFile: string,
  group: string
): CommandRecord | null {
  const manual = raw._manualEntry as Record<string, unknown> | undefined;
  let header = extractHeader(raw);
  if (!header) return null;
  header = header.replace(/\?$/, '');
  // Prefer explicit group from the command data over the file-level default
  // Check both 'group' and 'commandGroup' fields (legacy overrides use 'commandGroup')
  const effectiveGroup =
    (typeof raw.group === 'string' && raw.group) ||
    (typeof raw.commandGroup === 'string' && (raw.commandGroup as string)) ||
    group;
  const description =
    (typeof raw.description === 'string' && raw.description) ||
    (typeof manual?.description === 'string' && manual.description) ||
    (typeof raw.shortDescription === 'string' && raw.shortDescription) ||
    '';
  const shortDescription = extractShortDescription(raw);
  const category = (typeof raw.category === 'string' && raw.category) || effectiveGroup || 'general';
  const commandId =
    (typeof manual?.command === 'string' && manual.command) ||
    (typeof raw.id === 'string' && raw.id) ||
    (typeof manual?.header === 'string' && manual.header) ||
    (typeof raw.header === 'string' && raw.header) ||
    header;
  const { families, models } = extractFamilyModel(raw, sourceFile);
  const syntax = extractSyntax(raw);
  const args = extractArguments(raw);
  if (!syntax.set && !syntax.query) {
    const scpi = (typeof raw.scpi === 'string' && raw.scpi.trim()) || header;
    const hint = argumentHint(args[0]);
    if (scpi.endsWith('?')) {
      syntax.query = scpi;
    } else {
      syntax.set = args.length ? `${scpi} ${hint}` : scpi;
      syntax.query = `${scpi}?`;
    }
  }
  if (syntax.set && !/\s/.test(syntax.set) && args.length) {
    syntax.set = `${syntax.set} ${argumentHint(args[0])}`;
  }
  if (!header.includes(':')) {
    const candidate = (syntax.set || syntax.query || '')
      .match(/^[*A-Za-z][A-Za-z0-9:*]*\??/)?.[0]
      ?.trim();
    if (candidate && candidate.includes(':')) {
      header = candidate;
    }
  }
  const mnemonics = extractStringArray(manual?.mnemonics);
  return {
    commandId,
    sourceFile,
    group: effectiveGroup,
    header,
    shortDescription,
    description,
    category,
    tags: Array.from(new Set([...extractTags(raw, group, sourceFile), ...mnemonics])),
    commandType: extractCommandType((manual || raw) as Record<string, unknown>, header),
    families,
    models,
    syntax,
    arguments: args,
    queryResponse: typeof raw.queryResponse === 'string' ? raw.queryResponse : undefined,
    codeExamples: extractCodeExamples(raw),
    relatedCommands: extractStringArray(manual?.relatedCommands || raw.relatedCommands),
    notes: extractStringArray(manual?.notes || raw.notes),
    manualReference: extractManualReference(raw),
    raw,
  };
}

function parseGroupedCommands(sourceFile: string, root: Record<string, unknown>): CommandRecord[] {
  const out: CommandRecord[] = [];
  
  // Handle commandGroups.json structure (groups at root level with string arrays)
  if (sourceFile === 'commandGroups.json') {
    Object.entries(root).forEach(([groupName, groupRaw]) => {
      if (typeof groupRaw !== 'object' || !groupRaw) return;
      const groupObj = groupRaw as Record<string, unknown>;
      const commands = Array.isArray(groupObj?.commands) ? (groupObj.commands as unknown[]) : [];
      
      commands.forEach((cmd) => {
        if (typeof cmd !== 'string') return;
        
        // Create a minimal command record from string
        const rec: CommandRecord = {
          commandId: cmd,
          sourceFile,
          group: groupName,
          header: cmd,
          shortDescription: `Command from ${groupName} group`,
          description: `Command from ${groupName} group: ${cmd}`,
          category: groupName,
          tags: [groupName.toLowerCase()],
          commandType: 'both',
          families: ['MSO2', 'MSO4', 'MSO5', 'MSO6', 'MSO7'], // Default to MSO families
          models: [],
          syntax: { set: cmd, query: cmd + '?' },
          arguments: [],
          codeExamples: [],
          relatedCommands: [],
          notes: [],
          raw: { header: cmd, command: cmd }
        };
        
        if (rec) out.push(rec);
      });
    });
    return out;
  }
  
  // Handle original structure (root.groups with full command objects)
  const groups = root.groups as Record<string, unknown> | undefined;
  if (!groups || typeof groups !== 'object') return out;
  Object.entries(groups).forEach(([groupName, groupRaw]) => {
    const groupObj = groupRaw as Record<string, unknown>;
    const commands = Array.isArray(groupObj?.commands) ? (groupObj.commands as unknown[]) : [];
    commands.forEach((cmd) => {
      if (!cmd || typeof cmd !== 'object') return;
      const raw = cmd as Record<string, unknown>;
      const rec = toCommandRecord(raw, sourceFile, groupName);
      if (rec) out.push(rec);
      const parentHeader = rec?.header || extractHeader(raw);
      buildSyntaxVariantSpecs(raw).forEach((variant) => {
        if (normalizeHeaderKey(variant.header) === normalizeHeaderKey(parentHeader)) return;
        const variantRec = toCommandRecord(
          {
            ...raw,
            _manualEntry: {
              header: variant.header,
              syntax: variant.syntax,
              shortDescription: extractShortDescription(raw),
              commandType:
                variant.syntax.set && variant.syntax.query ? 'both' : variant.syntax.query ? 'query' : 'set',
            },
          },
          sourceFile,
          groupName
        );
        if (variantRec) out.push(variantRec);
      });
    });
  });
  return out;
}

function parseSectionedCommands(sourceFile: string, root: Record<string, unknown>): CommandRecord[] {
  const out: CommandRecord[] = [];
  const sections = root.commands_by_section as Record<string, unknown> | undefined;
  if (!sections || typeof sections !== 'object') return out;
  Object.entries(sections).forEach(([sectionName, sectionRaw]) => {
    if (!Array.isArray(sectionRaw)) return;
    sectionRaw.forEach((cmd) => {
      if (!cmd || typeof cmd !== 'object') return;
      const raw = cmd as Record<string, unknown>;
      const rec = toCommandRecord(raw, sourceFile, sectionName);
      if (rec) out.push(rec);
      const parentHeader = rec?.header || extractHeader(raw);
      buildSyntaxVariantSpecs(raw).forEach((variant) => {
        if (normalizeHeaderKey(variant.header) === normalizeHeaderKey(parentHeader)) return;
        const variantRec = toCommandRecord(
          {
            ...raw,
            _manualEntry: {
              header: variant.header,
              syntax: variant.syntax,
              shortDescription: extractShortDescription(raw),
              commandType:
                variant.syntax.set && variant.syntax.query ? 'both' : variant.syntax.query ? 'query' : 'set',
            },
          },
          sourceFile,
          sectionName
        );
        if (variantRec) out.push(variantRec);
      });
    });
  });
  return out;
}

function parseFlatCommands(sourceFile: string, root: unknown): CommandRecord[] {
  if (!Array.isArray(root)) return [];
  const out: CommandRecord[] = [];
  root
    .filter((cmd): cmd is Record<string, unknown> => !!cmd && typeof cmd === 'object')
    .forEach((raw) => {
      const rec = toCommandRecord(raw, sourceFile, 'general');
      if (rec) out.push(rec);
      const parentHeader = rec?.header || extractHeader(raw);
      buildSyntaxVariantSpecs(raw).forEach((variant) => {
        if (normalizeHeaderKey(variant.header) === normalizeHeaderKey(parentHeader)) return;
        const variantRec = toCommandRecord(
          {
            ...raw,
            _manualEntry: {
              header: variant.header,
              syntax: variant.syntax,
              shortDescription: extractShortDescription(raw),
              commandType:
                variant.syntax.set && variant.syntax.query ? 'both' : variant.syntax.query ? 'query' : 'set',
            },
          },
          sourceFile,
          'general'
        );
        if (variantRec) out.push(variantRec);
      });
    });
  return out;
}

export async function loadCommandIndex(options?: {
  commandsDir?: string;
  files?: string[];
}): Promise<CommandIndex> {
  const commandsDir = options?.commandsDir || resolveCommandsDir();
  const files = options?.files && options.files.length ? options.files : DEFAULT_COMMAND_FILES;
  const all: CommandRecord[] = [];

  for (const file of files) {
    const fullPath = path.join(commandsDir, file);
    let rawText = '';
    try {
      rawText = await fs.readFile(fullPath, 'utf8');
    } catch {
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(rawText) as unknown;
    } catch {
      continue;
    }
    const grouped = parseGroupedCommands(file, json as Record<string, unknown>);
    if (grouped.length) {
      all.push(...grouped);
      continue;
    }
    const sectioned = parseSectionedCommands(file, json as Record<string, unknown>);
    if (sectioned.length) {
      all.push(...sectioned);
      continue;
    }
    const flat = parseFlatCommands(file, json);
    if (flat.length) {
      all.push(...flat);
    }
  }

  return new CommandIndex(all);
}

let _commandIndexPromise: Promise<CommandIndex> | null = null;

export function initCommandIndex(options?: {
  commandsDir?: string;
  files?: string[];
}): Promise<CommandIndex> {
  if (!_commandIndexPromise) {
    _commandIndexPromise = loadCommandIndex(options);
  }
  return _commandIndexPromise;
}

export async function getCommandIndex(): Promise<CommandIndex> {
  return initCommandIndex();
}

