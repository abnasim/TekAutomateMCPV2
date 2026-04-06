import rawGroups from './commandGroups.json';

export interface CommandGroupInfo {
  description: string;
  commands: string[];
}

export const COMMAND_GROUPS = rawGroups as Record<string, CommandGroupInfo>;

export const GROUP_NAMES = Object.keys(COMMAND_GROUPS).sort();

export const GROUP_DESCRIPTIONS: Record<string, string> = Object.fromEntries(
  Object.entries(COMMAND_GROUPS).map(([name, info]) => [name, info.description || ''])
);

export const GROUP_COMMANDS: Record<string, string[]> = Object.fromEntries(
  Object.entries(COMMAND_GROUPS).map(([name, info]) => [name, Array.isArray(info.commands) ? info.commands : []])
);

const GROUP_HINTS: Record<string, string[]> = {
  Acquisition: ['acquisition', 'average', 'sample', 'single', 'sequence', 'run', 'stop'],
  'Act On Event': ['act on event', 'save on event', 'stop acquisition', 'srq', 'mask fail', 'measurement event'],
  AFG: ['arbitrary function generator', 'afg', 'burst', 'pulse', 'square', 'ramp'],
  Alias: ['alias', 'define alias', 'macro command'],
  Bus: ['bus', 'decode', 'can', 'can fd', 'i2c', 'uart', 'spi', 'lin', 'flexray', 'arinc', 'mil-std-1553'],
  Calibration: ['calibration', 'spc', 'signal path calibration', 'touchscreen calibrate'],
  Callout: ['callout', 'annotate', 'bookmark', 'label'],
  Cursor: ['cursor', 'bars', 'delta', 'readout'],
  Digital: ['digital', 'logic', 'dall', 'digital probe'],
  'Digital Power Management': ['dpm', 'power management', 'power rail', 'switching loss', 'efficiency'],
  Display: ['display', 'graticule', 'overlay', 'stacked', 'intensity', 'waveview'],
  DVM: ['dvm', 'digital voltmeter', 'voltmeter'],
  Ethernet: ['ethernet', 'lxi', 'dhcp', 'dns', 'gateway', 'remote interface'],
  'File System': ['filesystem', 'file system', 'directory', 'readfile', 'delete file', 'copy file'],
  Histogram: ['histogram', 'hits', 'distribution'],
  History: ['history', 'timestamp table'],
  Horizontal: ['horizontal', 'record length', 'time per div', 'timebase', 'fastframe'],
  'Inverter Motors and Drive Analysis': ['imda', 'motor drive', 'torque', 'speed', 'ripple'],
  Mask: ['mask', 'eye mask', 'mask test', 'mask hit', 'mask fail'],
  Math: ['math', 'fft', 'expression', 'filter', 'waveform math'],
  Measurement: ['measurement', 'measure', 'pk2pk', 'rms', 'mean', 'overshoot', 'rise time', 'fall time'],
  Miscellaneous: ['autoset', 'preset', 'factory', 'common command', 'idn', 'opc'],
  Plot: ['plot', 'trend plot', 'histogram plot', 'acq trend'],
  Power: ['power', 'harmonics', 'control loop', 'switching loss', 'efficiency'],
  'Save and Recall': ['save', 'recall', 'screenshot', 'image', 'waveform', 'setup', 'session'],
  'Save on': ['save on', 'save event', 'save waveform on trigger'],
  'Search and Mark': ['search', 'mark', 'error frame', 'find packet', 'errtype'],
  'Self Test': ['self test', 'diagnostic', 'test result'],
  'Spectrum view': ['spectrum', 'spectral', 'rf', 'spectrum view'],
  'Status and Error': ['status', 'error queue', 'allev', 'esr', 'stb'],
  Trigger: ['trigger', 'edge', 'pulse', 'holdoff', 'runt', 'timeout', 'logic', 'level'],
  'Waveform Transfer': ['waveform transfer', 'curve', 'waveform data', 'wfmoutpre', 'data source'],
  'Wide Band Gap Analysis': ['wbg', 'wide band gap', 'double pulse test', 'dpt'],
  Zoom: ['zoom', 'magnify', 'expand waveform'],
};

const GENERIC_GROUP_STOP_WORDS = new Set([
  'command',
  'commands',
  'group',
  'groups',
  'use',
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'into',
  'from',
  'mode',
  'mso',
  'series',
]);

function normalizeGroupText(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeGroupText(text: string): string[] {
  return normalizeGroupText(text)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !GENERIC_GROUP_STOP_WORDS.has(token));
}

function buildCommandKeywordBag(commands: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const command of commands.slice(0, 16)) {
    const parts = String(command || '')
      .replace(/[{}<>?|]/g, ' ')
      .split(/[:\s]+/)
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);
    for (const part of parts) {
      const normalized = part
        .replace(/b<x>|ch<x>|ref<x>|math<x>|meas<x>|plot<x>|search<x>|x/g, '')
        .replace(/[^a-z0-9]+/g, '');
      if (normalized.length < 3 || GENERIC_GROUP_STOP_WORDS.has(normalized) || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
      if (out.length >= 12) return out;
    }
  }
  return out;
}

export function buildCommandGroupSeedQuery(name: string): string {
  const info = COMMAND_GROUPS[name];
  if (!info) return String(name || '').trim();
  const tokens = Array.from(
    new Set([
      ...tokenizeGroupText(name),
      ...(GROUP_HINTS[name] || []).flatMap((value) => tokenizeGroupText(value)),
      ...buildCommandKeywordBag(Array.isArray(info.commands) ? info.commands : []),
    ])
  );
  return tokens.slice(0, 18).join(' ');
}

export function suggestCommandGroups(input: string, limit = 8): string[] {
  const query = normalizeGroupText(input);
  if (!query) return [];
  const queryTokens = new Set(tokenizeGroupText(query));
  const ranked = GROUP_NAMES.map((name) => {
    const groupTokens = tokenizeGroupText(name);
    const hintPhrases = GROUP_HINTS[name] || [];
    const hintTokens = hintPhrases.flatMap((value) => tokenizeGroupText(value));
    const commandTokens = buildCommandKeywordBag(GROUP_COMMANDS[name] || []);
    let score = 0;

    if (query.includes(normalizeGroupText(name))) score += 12;
    score += groupTokens.filter((token) => queryTokens.has(token)).length * 4;
    score += hintPhrases.filter((phrase) => query.includes(normalizeGroupText(phrase))).length * 5;
    score += hintTokens.filter((token) => queryTokens.has(token)).length;
    score += commandTokens.filter((token) => queryTokens.has(token)).length;

    return { name, score };
  })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => (b.score - a.score) || a.name.localeCompare(b.name));

  return ranked.slice(0, Math.max(1, limit)).map((entry) => entry.name);
}

export function resolveCommandGroupName(input: string): string | null {
  const query = input.trim();
  if (!query) return null;
  const direct = GROUP_NAMES.find((name) => name === query);
  if (direct) return direct;
  const lower = query.toLowerCase();
  return GROUP_NAMES.find((name) => name.toLowerCase() === lower) || null;
}

