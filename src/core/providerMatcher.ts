import type { ProviderSupplementEntry, ProviderSupplementKind } from './providerCatalog';

const MIN_HINT_SCORE = 0.2;    // Low to catch more variations for hints
const MIN_OVERRIDE_SCORE = 0.7; // Must be high confidence to override the planner — 0.4 was too low, single-keyword matches at 0.49 were hijacking multi-intent queries
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'before',
  'by',
  'for',
  'from',
  'how',
  'i',
  'in',
  'into',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'please',
  'show',
  'that',
  'the',
  'then',
  'this',
  'to',
  'what',
  'with',
]);

export interface ProviderMatchContext {
  backend?: string;
  deviceType?: string;
  modelFamily?: string;
  buildNew?: boolean;
}

export interface ProviderMatchResult {
  entry: ProviderSupplementEntry;
  score: number;
  decision: 'override' | 'hint' | 'context';
  overrideThreshold: number;
  matchedKeywords: string[];
  matchedOperations: string[];
}

export interface ProviderMatchOptions {
  kinds?: ProviderSupplementKind[];
  limit?: number;
  minScore?: number;
}

function normalizeText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function normalizeKey(value: string): string {
  return normalizeText(value).replace(/\s+/g, '');
}

function matchesAny(value: string | undefined, candidates: string[]): boolean {
  const normalizedValue = normalizeKey(value || '');
  if (!normalizedValue || !candidates.length) return false;
  return candidates.some((candidate) => {
    const normalizedCandidate = normalizeKey(candidate);
    return Boolean(normalizedCandidate) &&
      (normalizedValue.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedValue));
  });
}

function phraseRatio(
  queryTokens: Set<string>,
  normalizedQuery: string,
  phrase: string
): number {
  const normalizedPhrase = normalizeText(phrase);
  const phraseTokens = Array.from(new Set(tokenize(phrase)));
  if (!phraseTokens.length) return 0;
  if (normalizedPhrase && normalizedQuery.includes(normalizedPhrase)) return 1;

  const matches = phraseTokens.filter((token) => queryTokens.has(token)).length;
  return matches / phraseTokens.length;
}

function scorePhraseSet(
  phrases: string[],
  queryTokens: Set<string>,
  normalizedQuery: string
): {
  score: number;
  matchedPhrases: string[];
} {
  const filtered = Array.from(new Set(phrases.map((phrase) => String(phrase || '').trim()).filter(Boolean)));
  if (!filtered.length) {
    return { score: 0, matchedPhrases: [] };
  }

  const providerTokens = new Set(
    filtered.flatMap((phrase) => tokenize(phrase))
  );
  const matchedTokens = Array.from(providerTokens).filter((token) => queryTokens.has(token)).length;
  const tokenCoverage = providerTokens.size ? matchedTokens / providerTokens.size : 0;

  const ratios = filtered.map((phrase) => ({
    phrase,
    ratio: phraseRatio(queryTokens, normalizedQuery, phrase),
  }));
  const maxPhrase = ratios.reduce((best, current) => Math.max(best, current.ratio), 0);
  const matchedPhrases = ratios
    .filter((item) => item.ratio >= 0.999)
    .map((item) => item.phrase);

  return {
    score: Math.min(1, tokenCoverage * 0.6 + maxPhrase * 0.4),
    matchedPhrases,
  };
}

function compatibilityScore(
  entry: ProviderSupplementEntry,
  context: ProviderMatchContext
): number | null {
  const backends = (entry.match.backends?.length ? entry.match.backends : [entry.backend])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const deviceTypes = (entry.match.deviceTypes?.length ? entry.match.deviceTypes : [entry.deviceType])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const modelFamilies = (entry.match.modelFamilies?.length ? entry.match.modelFamilies : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  let score = 0;

  if (context.backend && backends.length) {
    if (!matchesAny(context.backend, backends)) return null;
    score += 0.06;
  }

  if (context.deviceType && deviceTypes.length) {
    if (!matchesAny(context.deviceType, deviceTypes)) return null;
    score += 0.06;
  }

  if (context.modelFamily && modelFamilies.length) {
    if (!matchesAny(context.modelFamily, modelFamilies)) return null;
    score += 0.04;
  }

  return score;
}

function fallbackKeywords(entry: ProviderSupplementEntry): string[] {
  const fromMatch = entry.match.keywords?.length ? entry.match.keywords : [];
  if (fromMatch.length) return fromMatch;
  return Array.from(
    new Set([
      entry.name,
      entry.id,
      entry.description,
      entry.summary || '',
      entry.contextText || '',
      ...entry.triggers,
      ...entry.tags,
    ].map((value) => String(value || '').trim()).filter(Boolean))
  );
}

function operationPhrases(entry: ProviderSupplementEntry): string[] {
  return entry.match.operations?.length ? entry.match.operations : [];
}

function priorityBoost(entry: ProviderSupplementEntry): number {
  const priority = Number(entry.match.priority);
  if (!Number.isFinite(priority)) return 0;
  return Math.max(0, Math.min(priority, 10)) * 0.005;
}

function scoreEntry(
  entry: ProviderSupplementEntry,
  query: string,
  context: ProviderMatchContext
): Omit<ProviderMatchResult, 'decision' | 'overrideThreshold'> | null {
  const normalizedQuery = normalizeText(query);
  const queryTokens = new Set(tokenize(query));
  if (!queryTokens.size) return null;

  const compatible = compatibilityScore(entry, context);
  if (compatible === null) return null;

  const keywordStats = scorePhraseSet(fallbackKeywords(entry), queryTokens, normalizedQuery);
  const operationStats = scorePhraseSet(operationPhrases(entry), queryTokens, normalizedQuery);
  const nameScore = phraseRatio(queryTokens, normalizedQuery, entry.name) * 0.08;
  const score = Math.min(
    1,
    keywordStats.score * 0.55 +
      operationStats.score * 0.25 +
      compatible +
      nameScore +
      priorityBoost(entry)
  );

  return {
    entry,
    score: Number(score.toFixed(3)),
    matchedKeywords: keywordStats.matchedPhrases,
    matchedOperations: operationStats.matchedPhrases,
  };
}

export function matchProviderSupplement(
  entries: ProviderSupplementEntry[],
  query: string,
  context: ProviderMatchContext = {}
): ProviderMatchResult | null {
  return findProviderSupplementMatches(entries, query, context, {
    kinds: ['template'],
    limit: 1,
  })[0] || null;
}

export function findProviderSupplementMatches(
  entries: ProviderSupplementEntry[],
  query: string,
  context: ProviderMatchContext = {},
  options: ProviderMatchOptions = {}
): ProviderMatchResult[] {
  const allowedKinds = Array.isArray(options.kinds) && options.kinds.length
    ? new Set(options.kinds)
    : null;
  const limit = Math.max(1, Math.floor(options.limit || 3));
  const minScore = Number.isFinite(Number(options.minScore))
    ? Number(options.minScore)
    : MIN_HINT_SCORE;
  const matches: ProviderMatchResult[] = [];

  for (const entry of entries) {
    if (allowedKinds && !allowedKinds.has(entry.kind)) continue;
    const scored = scoreEntry(entry, query, context);
    if (!scored || scored.score < minScore) continue;

    const overrideThreshold = Math.max(
      MIN_OVERRIDE_SCORE,
      Number.isFinite(Number(entry.match.minScore))
        ? Number(entry.match.minScore)
        : MIN_OVERRIDE_SCORE
    );
    const decision =
      entry.kind === 'template'
        ? (scored.score >= overrideThreshold && context.buildNew !== false
            ? 'override'
            : 'hint')
        : 'context';

    matches.push({
      ...scored,
      overrideThreshold: Number(overrideThreshold.toFixed(3)),
      decision,
    });
  }

  matches.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (left.entry.kind !== right.entry.kind) {
      return left.entry.kind === 'template' ? -1 : 1;
    }
    return left.entry.id.localeCompare(right.entry.id);
  });

  return matches.slice(0, limit);
}
