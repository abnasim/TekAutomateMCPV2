const ESR_BIT_MEANINGS: Record<number, string> = {
  0: 'OPC: Operation complete',
  2: 'QYE: Query error',
  3: 'DDE: Device-dependent error',
  4: 'EXE: Execution error/warning',
  5: 'CME: Command error',
  6: 'URQ: User request',
  7: 'PON: Power on',
};

const EVENT_CODE_MEANINGS: Record<number, string> = {
  0: 'No events to report; queue empty',
  1: 'No events to report; new events pending *ESR?',
  100: 'Command error',
  101: 'Invalid character',
  102: 'Syntax error',
  103: 'Invalid separator',
  104: 'Data type error',
  108: 'Parameter not allowed',
  109: 'Missing parameter',
  110: 'Command header error',
  112: 'Program mnemonic too long',
  113: 'Undefined header',
  120: 'Numeric data error',
  121: 'Invalid character in numeric',
  123: 'Exponent too large',
  124: 'Too many digits',
  130: 'Suffix error',
  131: 'Invalid suffix',
  134: 'Suffix too long',
  140: 'Character data error',
  141: 'Invalid character data',
  144: 'Character data too long',
  150: 'String data error',
  151: 'Invalid string data',
  152: 'String data too long',
  160: 'Block data error',
  161: 'Invalid block data',
  170: 'Command expression error',
  171: 'Invalid expression',
  200: 'Execution error',
  221: 'Settings conflict',
  222: 'Data out of range',
  224: 'Illegal parameter value',
  241: 'Hardware missing',
  250: 'Mass storage error',
  251: 'Missing mass storage',
  252: 'Missing media',
  253: 'Corrupt media',
  254: 'Media full',
  255: 'Directory full',
  256: 'File name not found',
  257: 'File name error',
  258: 'Media protected',
  259: 'File name too long',
  280: 'Program error',
  286: 'Program runtime error',
  310: 'System error',
  311: 'Memory error',
  312: 'PUD memory lost',
  314: 'Save/recall memory lost',
  400: 'Query event',
  401: 'Power on (PON bit set)',
  402: 'Operation complete (OPC bit set)',
  403: 'User request (URQ bit set)',
  404: 'Power fail (DDE bit set)',
  410: 'Query INTERRUPTED (QYE bit set)',
  420: 'Query UNTERMINATED (QYE bit set)',
  430: 'Query DEADLOCKED (QYE bit set)',
  440: 'Query UNTERMINATED after indefinite response',
  468: 'Knob/Keypad value changed',
  472: 'Application variable changed',
  528: 'Parameter out of range',
  532: 'Curve data too long, truncated',
  533: 'Curve error, preamble values inconsistent',
  540: 'Measurement warning',
  541: 'Measurement warning, low signal amplitude',
  542: 'Measurement warning, unstable histogram',
  543: 'Measurement warning, low resolution',
  544: 'Measurement warning, uncertain edge',
  545: 'Measurement warning, invalid min/max',
  546: 'Measurement warning, need 3 edges',
  547: 'Measurement warning, clipping positive/negative',
  548: 'Measurement warning, clipping positive',
  549: 'Measurement warning, clipping negative',
  630: 'Internal warning',
  2200: 'Measurement error (generic)',
  2231: 'Measurement error, no statistics available',
  2233: 'Requested waveform temporarily unavailable',
  2244: 'Source waveform is not active',
  2245: 'SaveRef error, selected channel is turned off',
  2250: 'Reference waveform file is invalid',
  2253: 'Reference error, too many points received',
  2254: 'Reference error, too few points received',
  2259: 'File too big',
  2270: 'Alias error',
  2271: 'Alias syntax error',
  2273: 'Illegal alias label',
  2276: 'Alias expansion error',
  2277: 'Alias redefinition not allowed',
  2278: 'Alias header not found',
  2285: 'TekSecure Pass',
  2286: 'TekSecure Fail',
  2500: 'Setup error, file does not look like a setup file',
  2501: 'Setup warning, could not recall all values from external setup',
  2620: 'Mask error, too few points received',
  2760: 'Mark limit reached',
  2761: 'No mark present',
  2762: 'Search copy failed',
};

function parseInteger(value: string): number | null {
  const match = String(value || '').trim().match(/^[-+]?\d+/);
  if (!match) return null;
  const num = Number.parseInt(match[0], 10);
  return Number.isFinite(num) ? num : null;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value.trim());
  }
  return out;
}

function decodeEsrValue(value: number): string {
  if (!Number.isFinite(value) || value < 0) return `ESR ${value}: invalid value`;
  if (value === 0) return 'ESR 0: no standard event bits set';
  const bits: string[] = [];
  for (let bit = 0; bit <= 7; bit += 1) {
    if (((value >> bit) & 1) === 1) {
      bits.push(ESR_BIT_MEANINGS[bit] || `bit ${bit}`);
    }
  }
  return `ESR ${value}: ${bits.join('; ')}`;
}

function classifyEventCode(code: number): string {
  if (EVENT_CODE_MEANINGS[code]) return EVENT_CODE_MEANINGS[code];
  if (code >= 100 && code < 200) return 'Command error';
  if (code >= 200 && code < 300) return 'Execution error';
  if (code >= 300 && code < 400) return 'Device error';
  if (code >= 400 && code < 500) return 'System event';
  if (code >= 500 && code < 600) return 'Execution warning';
  if (code >= 2200 && code < 2300) return 'Measurement/reference/alias execution error';
  if (code >= 2500 && code < 2600) return 'Setup/recall event';
  if (code >= 2600 && code < 2700) return 'Mask-related event';
  if (code >= 2760 && code < 2770) return 'Search/mark event';
  return 'Unknown event code';
}

function extractEventCodes(text: string): number[] {
  const out: number[] = [];
  const segments = String(text || '')
    .split(/[;\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const seg of segments) {
    const codeMatch = seg.match(/^([-+]?\d+)\b/);
    if (!codeMatch) continue;
    const code = Number.parseInt(codeMatch[1], 10);
    if (Number.isFinite(code)) out.push(code);
  }
  return out;
}

export function decodeCommandStatus(command: string, response: string): string[] {
  const cmd = String(command || '').toUpperCase();
  const raw = String(response || '').trim();
  if (!raw) return [];

  if (cmd.includes('*ESR?')) {
    const value = parseInteger(raw);
    return value === null ? [] : [decodeEsrValue(value)];
  }

  if (cmd.includes('EVENT?') || cmd.includes('EVMSG?') || cmd.includes('ALLEV?')) {
    const codes = extractEventCodes(raw);
    if (!codes.length) return [];
    return uniqueStrings(codes.map((code) => `Event ${code}: ${classifyEventCode(code)}`));
  }

  if (cmd.includes('BUSY?')) {
    const value = parseInteger(raw);
    if (value === 1) return ['BUSY? = 1: pending operations still in progress'];
    if (value === 0) return ['BUSY? = 0: no pending operations'];
    return [];
  }

  if (cmd.includes('*OPC?')) {
    const value = parseInteger(raw);
    if (value === 1) return ['*OPC? = 1: all eligible pending operations completed'];
    if (value === 0) return ['*OPC? = 0: completion not yet signaled'];
  }

  return [];
}

export function decodeStatusFromText(text: string): string[] {
  const raw = String(text || '');
  if (!raw.trim()) return [];

  const out: string[] = [];
  const esrRegex = /(?:\*ESR\?|ESR)\s*[:=]?\s*([-+]?\d+)/gi;
  for (const match of raw.matchAll(esrRegex)) {
    const value = Number.parseInt(match[1], 10);
    if (Number.isFinite(value)) out.push(decodeEsrValue(value));
  }

  const eventRegex = /(?:EVENT\?|EVMSG\?|ALLEV\?)\s*[:=]?\s*([-+]?\d+)/gi;
  for (const match of raw.matchAll(eventRegex)) {
    const code = Number.parseInt(match[1], 10);
    if (Number.isFinite(code)) out.push(`Event ${code}: ${classifyEventCode(code)}`);
  }

  const genericEventLineRegex = /(?:^|[;\r\n])\s*([-+]?\d{1,4})\s*,/g;
  for (const match of raw.matchAll(genericEventLineRegex)) {
    const code = Number.parseInt(match[1], 10);
    if (Number.isFinite(code)) out.push(`Event ${code}: ${classifyEventCode(code)}`);
  }

  return uniqueStrings(out).slice(0, 12);
}
