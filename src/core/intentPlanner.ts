import { getCommandIndex, type CommandArgument, type CommandCodeExample, type CommandIndex, type CommandRecord } from './commandIndex';
import { checkPlannerConflicts, type ResourceConflict } from './conflictChecker';
import type { McpChatRequest } from './schemas';

export type IntentGroup =
  | 'CHANNEL_SETUP'
  | 'TRIGGER'
  | 'TRIGGER_B'
  | 'MEASUREMENT'
  | 'BUS_DECODE'
  | 'ACQUISITION'
  | 'FASTFRAME'
  | 'HORIZONTAL'
  | 'DISPLAY'
  | 'CURSOR'
  | 'MATH'
  | 'SEARCH'
  | 'HISTOGRAM'
  | 'SPECTRUM'
  | 'POWER_ANALYSIS'
  | 'SAVE'
  | 'RECALL'
  | 'WAVEFORM_TRANSFER'
  | 'ERROR_CHECK'
  | 'ACT_ON_EVENT'
  | 'AFG_SOURCE'
  | 'AFG_OUTPUT'
  | 'AFG_BURST'
  | 'AFG_MODULATION'
  | 'AWG_OUTPUT'
  | 'AWG_WAVEFORM'
  | 'AWG_CLOCK'
  | 'AWG_SEQUENCE'
  | 'SMU_SOURCE'
  | 'SMU_SENSE'
  | 'SMU_OUTPUT'
  | 'SMU_MEASURE'
  | 'SMU_SWEEP'
  | 'SMU_BUFFER'
  | 'RSA_FREQUENCY'
  | 'RSA_TRIGGER'
  | 'RSA_SPECTRUM'
  | 'RSA_DPX'
  | 'RSA_TRACE'
  | 'IEEE488'
  | 'STATUS'
  | 'SYSTEM';

export type DetectedDeviceType = 'SCOPE' | 'AFG' | 'AWG' | 'SMU' | 'RSA' | 'UNKNOWN';

export interface ParsedChannelIntent {
  channel: string;
  scaleVolts?: number;
  offsetVolts?: number;
  coupling?: 'AC' | 'DC';
  terminationOhms?: number;
  bandwidthHz?: number;
  label?: string;
  displayState?: boolean;
}

export interface ParsedTriggerIntent {
  type?: 'EDGE' | 'PULSE' | 'RUNT' | 'LOGIC' | 'BUS' | 'WIDth' | 'TIMEOut' | 'WINdow' | 'TRANsition' | 'SETHold';
  source?: string;
  slope?: 'RISe' | 'FALL';
  levelVolts?: number;
  autoSetLevel?: boolean;
  mode?: 'NORMal' | 'AUTO';
  holdoffSeconds?: number;
  widthSeconds?: number;
  widthCondition?: 'MORETHAN' | 'LESSTHAN';
  sequenceBy?: 'EVENTS' | 'TIMe' | 'ARMAtrigB';
  delaySeconds?: number;
}

export interface ParsedMeasurementIntent {
  type:
    | 'FREQUENCY'
    | 'AMPLITUDE'
    | 'PEAKFREQ'
    | 'RISETIME'
    | 'FALLTIME'
    | 'PK2PK'
    | 'MEAN'
    | 'RMS'
    | 'RMSNOISE'
    | 'HIGH'
    | 'LOW'
    | 'PERIOD'
    | 'POVERSHOOT'
    | 'NOVERSHOOT'
    | 'DELAY'
    | 'PHASE'
    | 'EYEHEIGHT'
    | 'EYEWIDTH'
    | 'JITTERSUMMARY'
    | 'TIE';
  source1?: string;
  source2?: string;
}

export interface ParsedBusIntent {
  protocol:
    | 'I2C'
    | 'SPI'
    | 'CANFD'
    | 'CAN'
    | 'USB'
    | 'UART'
    | 'RS232'
    | 'RS232C'
    | 'LIN'
    | 'SENT'
    | 'ARINC'
    | 'ARINC429'
    | 'MIL'
    | 'MIL1553B';
  bus?: string;
  source1?: string;
  source2?: string;
  source3?: string;
  clockSource?: string;
  dataSource?: string;
  bitrateBps?: number;
  dataPhaseBitrateBps?: number;
  standard?: string;
  thresholdVolts?: number;
  clockThresholdVolts?: number;
  dataThresholdVolts?: number;
  chipSelect?: string;
  selectPolarity?: 'LOW' | 'HIGH';
  baudRate?: number;
  dataBits?: number;
  stopBits?: 'ONE' | 'TWO';
  parity?: 'NONe' | 'EVEN' | 'ODD';
  slope?: 'RISe' | 'FALL';
  triggerCondition?: string;
  triggerAddress?: number;
  triggerDirection?: 'READ' | 'WRITE';
  readBackRequested?: boolean;
  displayLayout?: 'BUS' | 'BUSANDWAVEFORM';
  searchIdentifier?: string;
}

export interface ParsedAcquisitionIntent {
  mode?: 'AVErage' | 'HIRes' | 'SAMple' | 'PEAKdetect' | 'FASTAcq';
  numAvg?: number;
  stopAfter?: 'SEQuence';
  recordLength?: number;
  horizontalScaleSeconds?: number;
  fastFrameCount?: number;
  fastAcqPalette?: 'NORMal' | 'TEMPerature' | 'SPECtral' | 'INVErted';
  runContinuous?: boolean;
}

export interface ParsedHorizontalIntent {
  scaleSeconds?: number;
  positionSeconds?: number;
  recordLength?: number;
}

export interface ParsedFastFrameIntent {
  count?: number;
  state?: boolean;
}

export interface ParsedMathIntent {
  expression?: string;
  operation?: 'ADD' | 'SUBTRACT' | 'MULTIPLY' | 'DIVIDE' | 'FFT' | 'UNKNOWN';
  sources?: string[];
  displayState?: boolean;
}

export interface ParsedCursorIntent {
  type?: 'VERTical' | 'HORizontal' | 'WAVEform';
  source?: string;
  units?: 'SEConds' | 'HERtz';
  deltaTime?: boolean;
  deltaVoltage?: boolean;
  positionASec?: number;
  positionBSec?: number;
}

export interface ParsedSearchIntent {
  type?: 'EDGE' | 'BUS' | 'PULSE' | 'SETUPHOLD' | 'TRANSITION' | 'WINDOW' | 'UNKNOWN';
  bus?: string;
  protocol?: ParsedBusIntent['protocol'];
  searchType?: 'ERRFRAME' | 'ADDRESS' | 'DATA' | 'ANYFIELD';
  condition?: string;
  frameType?: string;
  errType?: string;
  queryFastFrameTimestamps?: boolean;
  count?: number;
  showBusTable?: boolean;
  selected?: string;
}

export interface ParsedAfgIntent {
  channel: 1 | 2;
  function?: 'SINusoid' | 'SQUare' | 'RAMP' | 'PULSe' | 'DC' | 'NOISe' | 'ARBitrary';
  frequencyHz?: number;
  amplitudeVpp?: number;
  offsetVolts?: number;
  dutyCyclePct?: number;
  impedance?: '50' | 'HIGHZ';
  outputOn?: boolean;
  burstCycles?: number;
  burstState?: boolean;
  burstMode?: 'TRIGgered' | 'GATed';
  amState?: boolean;
  amFrequencyHz?: number;
  amDepthPct?: number;
  sweepRequested?: boolean;
  sweepStartHz?: number;
  sweepStopHz?: number;
  sweepTimeSec?: number;
}

export interface ParsedAwgIntent {
  channel: number;
  waveformName?: string;
  frequencyHz?: number;
  amplitudeVpp?: number;
  outputOn?: boolean;
  sampleRateHz?: number;
  runMode?: 'CONTinuous' | 'TRIGgered' | 'GATed' | 'SEQuence';
}

export interface ParsedSmuIntent {
  sourceFunction?: 'VOLTage' | 'CURRent';
  sourceLevel?: number;
  complianceLevel?: number;
  outputOn?: boolean;
  measureFunction?: 'VOLTage' | 'CURRent' | 'RESistance' | 'POWer';
  sweepStart?: number;
  sweepStop?: number;
  sweepPoints?: number;
  traceReadback?: boolean;
  saveAs?: string;
}

export interface ParsedRsaIntent {
  centerFreqHz?: number;
  spanHz?: number;
  rbwHz?: number;
  refLevelDbm?: number;
  triggerType?: 'FREE' | 'EXT' | 'IF' | 'TIME';
  traceType?: 'WRITe' | 'MAXHold' | 'MINHold' | 'AVErage';
  measurementType?: 'SPECTRUM' | 'DPX' | 'DEMOD' | 'PULSE';
}

export interface ParsedSpectrumViewIntent {
  channel: string;
  centerFreqHz?: number;
  spanHz?: number;
}

export interface ParsedSaveIntent {
  screenshot?: boolean;
  waveformSources?: string[];
  waveformExports?: Array<{ source: string; format: 'bin' | 'csv' | 'wfm' | 'mat' }>;
  format?: 'bin' | 'csv' | 'wfm' | 'mat';
  setupPath?: string;
  sessionPath?: string;
  waitForCompletion?: boolean;
  fastFrameExport?: boolean;
}

export interface ParsedRecallIntent {
  factory?: boolean;
  sessionPath?: string;
  setupName?: string;
}

export interface ParsedStatusIntent {
  esr?: boolean;
  opc?: boolean;
}

export interface PlannerIntent {
  deviceType: DetectedDeviceType;
  modelFamily: string;
  groups: IntentGroup[];
  channels: ParsedChannelIntent[];
  trigger?: ParsedTriggerIntent;
  triggerB?: ParsedTriggerIntent;
  measurements: ParsedMeasurementIntent[];
  buses: ParsedBusIntent[];
  acquisition?: ParsedAcquisitionIntent;
  horizontal?: ParsedHorizontalIntent;
  fastFrame?: ParsedFastFrameIntent;
  math?: ParsedMathIntent;
  cursor?: ParsedCursorIntent;
  search?: ParsedSearchIntent;
  afg?: ParsedAfgIntent;
  awg?: ParsedAwgIntent;
  smu?: ParsedSmuIntent;
  rsa?: ParsedRsaIntent;
  spectrumView?: ParsedSpectrumViewIntent;
  save?: ParsedSaveIntent;
  recall?: ParsedRecallIntent;
  status?: ParsedStatusIntent;
  maskTest?: boolean;
  errorCheck?: boolean;
  reset?: boolean;
  idn?: boolean;
  optionsQuery?: boolean;
  waitSeconds?: number;
  multiAcqCount?: number;
  compareFrequencyNominalHz?: number;
  unresolved: string[];
}

export interface ResolvedCommandArgument {
  name: string;
  type: string;
  required: boolean;
  validValues?: string[];
  min?: number;
  max?: number;
  unit?: string;
  description?: string;
}

export interface ResolvedCommandExample {
  scpi?: string;
  tm_devices?: string;
}

export interface ResolvedCommand {
  group: IntentGroup;
  header: string;
  concreteCommand: string;
  commandType: 'set' | 'query';
  saveAs?: string;
  stepType?: string;
  stepParams?: Record<string, unknown>;
  verified: true;
  sourceFile: string;
  syntax: {
    set?: string;
    query?: string;
  };
  arguments: ResolvedCommandArgument[];
  examples: ResolvedCommandExample[];
  notes?: string[];
  relatedCommands?: string[];
}

export interface PlannerOutput {
  intent: PlannerIntent;
  resolvedCommands: ResolvedCommand[];
  unresolved: string[];
  conflicts: ResourceConflict[];
  rejection?: 'out_of_scope' | 'low_confidence';
  rejectionReason?: string;
  unsupportedSubrequests?: string[];
}

interface ParseContext {
  channels: ParsedChannelIntent[];
  bus?: ParsedBusIntent;
}

const OUT_OF_SCOPE_PATTERNS = [
  /weather|forecast|temperature outside/i,
  /quantum\s+trigger|auto.?heal|ai.*denoising|ai.*root.?cause/i,
  /\brigol\b|\bkeysight\b|\bsiglent\b|\bagilent\b/i,
];

const UNSUPPORTED_SUBINTENT_PATTERNS: Array<{ pattern: RegExp; label: string; reason: string }> = [
  { pattern: /email|send.*mail|notify|slack|sms/i, label: 'email/notification', reason: 'TekAutomate cannot send emails or notifications.' },
  { pattern: /export to excel|xlsx|spreadsheet/i, label: 'Excel export', reason: 'TekAutomate cannot export directly to Excel.' },
];

async function getIntentAliasMaps(): Promise<IntentAliasMaps> {
  if (!intentAliasMapsPromise) {
    intentAliasMapsPromise = buildIntentAliasMaps();
  }
  return intentAliasMapsPromise;
}

async function buildIntentAliasMaps(): Promise<IntentAliasMaps> {
  const index = await getCommandIndex();

  const measurementRecord = findAliasSourceRecord(index, 'MEASUrement:ADDMEAS');
  const triggerRecord = findAliasSourceRecord(index, 'TRIGger:A:TYPe');
  const busRecord = findAliasSourceRecord(index, 'BUS:B<x>:TYPe');
  const acquisitionRecord = findAliasSourceRecord(index, 'ACQuire:MODe');

  return {
    measurementAliases: buildAliasMap(
      extractRecordValidValues(measurementRecord),
      MEASUREMENT_SYNONYMS
    ),
    triggerTypeAliases: buildAliasMap(
      extractRecordValidValues(triggerRecord),
      TRIGGER_TYPE_SYNONYMS
    ),
    busProtocolAliases: buildAliasMap(
      extractRecordValidValues(busRecord),
      BUS_PROTOCOL_SYNONYMS
    ),
    acquisitionModeAliases: buildAliasMap(
      extractRecordValidValues(acquisitionRecord),
      ACQUISITION_MODE_SYNONYMS
    ),
  };
}

function findAliasSourceRecord(index: CommandIndex, header: string): CommandRecord | null {
  const matches = index
    .getEntries()
    .filter((entry) => headersEquivalent(entry.header, header));
  return matches[0] ?? null;
}

function extractRecordValidValues(record: CommandRecord | null): string[] {
  if (!record) return [];
  const values = new Set<string>();
  for (const arg of record.arguments || []) {
    for (const value of extractValidValues(arg.validValues || {}, {})) {
      values.add(String(value));
    }
  }
  return Array.from(values);
}

function buildAliasMap(validValues: string[], synonymMap: Record<string, string[]>): Map<string, string> {
  const aliasMap = new Map<string, string>();
  const add = (alias: string, value: string) => {
    const normalized = normalizeAliasText(alias);
    if (normalized) aliasMap.set(normalized, value);
  };

  for (const value of validValues) {
    add(value, value);
    add(value.toLowerCase(), value);
    add(humanizeEnumValue(value), value);
    for (const alias of synonymMap[value] || []) {
      add(alias, value);
    }
  }

  return aliasMap;
}

function humanizeEnumValue(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .replace(/[_/]+/g, ' ')
    .toLowerCase();
}

function normalizeAliasText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchAliasValues(input: string, aliasMap: Map<string, string>): string[] {
  const haystack = ` ${normalizeAliasText(input)} `;
  const matches = new Map<string, { index: number; aliasLength: number }>();
  for (const [alias, value] of aliasMap.entries()) {
    if (!alias) continue;
    const index = haystack.indexOf(` ${alias} `);
    if (index >= 0) {
      const existing = matches.get(value);
      if (!existing || index < existing.index || (index === existing.index && alias.length > existing.aliasLength)) {
        matches.set(value, { index, aliasLength: alias.length });
      }
    }
  }
  return Array.from(matches.entries())
    .sort((left, right) => left[1].index - right[1].index || right[1].aliasLength - left[1].aliasLength)
    .map(([value]) => value);
}

function matchFirstAliasValue(input: string, aliasMap: Map<string, string>): string | undefined {
  return matchAliasValues(input, aliasMap)[0];
}

const CHANNEL_REGEX = /\b(?:CH|channel)\s*([1-4])\b/gi;
const VOLTAGE_REGEX = /(-?\d+(?:\.\d+)?)\s*(mV|V|millivolts?|volts?)\b/gi;
const FREQUENCY_REGEX = /(\d+(?:\.\d+)?)\s*(Hz|kHz|MHz|GHz)\b/gi;
const COUPLING_REGEX = /\b(AC|DC)\b/gi;
const TERMINATION_REGEX = /\b(50ohm|50|1Mohm|1M)\b/gi;
const TRIGGER_SOURCE_REGEX = /\b(?:CH|channel)\s*([1-4])\b/i;
const TRIGGER_SLOPE_RISE_REGEX = /\b(rising|rise|ris)\b/i;
const TRIGGER_SLOPE_FALL_REGEX = /\b(falling|fall)\b/i;
const TRIGGER_LEVEL_AT_REGEX = /\bat\s+(-?\d+(?:\.\d+)?)\s*(mV|V)\b/i;
const TRIGGER_MODE_REGEX = /\b(normal|auto)\b/i;
const TRIGGER_HOLDOFF_REGEX = /\bholdoff(?:\s+to)?\s+(\d+(?:\.\d+)?)\s*(ms|us|ns)\b/i;
const BUS_SLOT_REGEX = /\b(B[1-4])\b/i;
const BITRATE_REGEX = /(\d+(?:\.\d+)?)\s*(kbps|mbps)\b/i;
const ACQ_NUMAVG_REGEX = /\b(?:(\d+)\s*waveforms|average\s+(\d+)|averaging\s+(\d+))\b/i;
const ACQ_STOP_AFTER_REGEX = /\b(single\s+sequence|single\s+shot|single|one\s+clean\s+capture|take\s+one\s+clean\s+capture|take\s+one\s+capture)\b/i;
const RECORD_LENGTH_REGEX =
  /\b(\d+(?:\.\d+)?(?:[kKmM]|(?:\s+(?:million|thousand)))?)\s*samples?\b|\brecord\s+length\s+(\d+(?:\.\d+)?(?:[kKmM]|(?:\s+(?:million|thousand)))?)\b|\b(\d+(?:\.\d+)?(?:[kKmM]|(?:\s+(?:million|thousand)))?)\s+record\s+length\b/i;
const FASTFRAME_REGEX =
  /\bfast\s*frames?\s+(\d+)\b|\bfastframe(?:\s+for)?\s+(\d+)\b|\bfastframe\b[^.!?\n\r]*?\b(\d+)\s+(?:startup\s+)?(?:pulses?|frames?)\b|\b(?:first\s+)?(\d+)\s+(?:startup\s+)?(?:pulses?|frames?)\b[^.!?\n\r]*?\bfastframe\b/i;
const HORIZONTAL_SCALE_REGEX = /\b(\d+(?:\.\d+)?)\s*(ps|ns|us|ms|s|picoseconds?|nanoseconds?|microseconds?|milliseconds?|seconds?)(?:\/div|\s+per\s+div)\b/i;
const HORIZONTAL_ACROSS_SCREEN_REGEX =
  /\b(?:see|show)\b[^.!?\n\r]*?\b(\d+(?:\.\d+)?)\s*(ps|ns|us|ms|s|picoseconds?|nanoseconds?|microseconds?|milliseconds?|seconds?)\s+across\s+the\s+screen\b|\b(\d+(?:\.\d+)?)\s*(ps|ns|us|ms|s|picoseconds?|nanoseconds?|microseconds?|milliseconds?|seconds?)\s+across\s+the\s+screen\b/i;
const HORIZONTAL_POSITION_REGEX = /\bposition\s+(-?\d+(?:\.\d+)?)\s*(ns|us|ms|s|nanoseconds?|microseconds?|milliseconds?|seconds?)\b/i;
const SAVE_SCREENSHOT_REGEX = /\b(screenshot|capture screen)\b/i;
const SAVE_WAVEFORM_REGEX =
  /\b(save|export|exported|dump|download)\b(?=[^.!?\n\r]*\b(waveform|data|channels?|channel|CH[1-4]|math\s+trace|all|csv|wfm|binary|mat)\b)/i;
const SAVE_PATH_REGEX = /C:\/\S+\.set\b/i;
const SAVE_SESSION_PATH_REGEX = /C:\/\S+\.(?:set|tss)\b/i;
const RECALL_FACTORY_REGEX = /\b(factory\s+defaults?|reset)\b/i;
const RECALL_SESSION_REGEX = /C:\/\S+\.tss\b/i;
const IDN_REGEX =
  /\b(idn|\*idn|identify)\b|\bwhat\s+scope\b[^.!?\n\r]*\bconnected\s+to\b|\bwhat\s+instrument\b[^.!?\n\r]*\bconnected\s+to\b|\bwho\s+am\s+i\s+connected\s+to\b/i;
const OPTIONS_QUERY_REGEX = /\b(\*opt|options?|installed options|licensed options)\b/i;
const ERROR_CHECK_REGEX = /\b(error check|error queue|allev|system error|check errors|check for errors|esr)\b/i;
const STATUS_QUERY_REGEX = /\b(status quer(?:y|ies)|status checks?|check status|event status|esr|opc)\b/i;
const WAIT_SECONDS_REGEX = /\bwait\s+(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds)\b/i;

interface IntentAliasMaps {
  measurementAliases: Map<string, string>;
  triggerTypeAliases: Map<string, string>;
  busProtocolAliases: Map<string, string>;
  acquisitionModeAliases: Map<string, string>;
}

const MEASUREMENT_SYNONYMS: Record<string, string[]> = {
  PK2PK: ['pk2pk', 'peak to peak', 'peak-to-peak', 'vpp', 'v p p'],
  PEAKFREQ: ['peak frequency', 'peak freq', 'peak-frequency'],
  POVERSHOOT: ['overshoot', 'positive overshoot'],
  NOVERSHOOT: ['undershoot', 'negative overshoot'],
  RISETIME: ['rise time', 'risetime', 'rise'],
  FALLTIME: ['fall time', 'falltime', 'fall'],
  JITTERSUMMARY: ['jitter', 'clock jitter', 'too much jitter', 'adc clock jitter'],
  TIE: ['tie', 'time interval error'],
  HIGH: ['vpk', 'vmax', 'positive peak', 'peak voltage'],
  RMSNOISE: ['rms noise', 'noise rms', 'rmsnoise'],
  EYEHEIGHT: ['eye height', 'eyeheight'],
  EYEWIDTH: ['eye width', 'eyewidth'],
};

const TRIGGER_TYPE_SYNONYMS: Record<string, string[]> = {
  EDGE: ['edge'],
  WIDth: ['width', 'pulse width'],
  TIMEOut: ['timeout', 'time out'],
  RUNt: ['runt'],
  WINdow: ['window'],
  LOGIc: ['logic'],
  SETHold: ['setup hold', 'setup/hold', 'sethold'],
  BUS: ['bus'],
  TRANsition: ['transition'],
};

const BUS_PROTOCOL_SYNONYMS: Record<string, string[]> = {
  CANFD: ['can fd', 'canfd'],
  USB: ['usb', 'usb 2.0', 'usb2.0'],
  SENT: ['sent', 'sent sensor'],
  RS232C: ['rs232', 'rs-232', 'uart'],
  MIL1553B: ['mil', 'mil 1553', 'mil-1553', '1553'],
  ARINC429: ['arinc', 'arinc 429'],
};

const ACQUISITION_MODE_SYNONYMS: Record<string, string[]> = {
  AVErage: ['average', 'avg'],
  HIRes: ['hi res', 'hires', 'high res'],
  SAMple: ['sample'],
  PEAKdetect: ['peak detect', 'peakdetect', 'peak-detect'],
  FASTAcq: ['fastacq', 'fast acq', 'fast acquisition'],
};

const ALLOWED_MEASUREMENT_TYPES = new Set<ParsedMeasurementIntent['type']>([
  'FREQUENCY',
  'AMPLITUDE',
  'PEAKFREQ',
  'RISETIME',
  'FALLTIME',
  'PK2PK',
  'MEAN',
  'RMS',
  'RMSNOISE',
  'HIGH',
  'LOW',
  'PERIOD',
  'POVERSHOOT',
  'NOVERSHOOT',
  'DELAY',
  'PHASE',
  'EYEHEIGHT',
  'EYEWIDTH',
  'JITTERSUMMARY',
  'TIE',
]);

function canonicalizeMeasurementType(value: string): ParsedMeasurementIntent['type'] | undefined {
  const normalized = String(value || '')
    .replace(/[^A-Za-z0-9]+/g, '')
    .toUpperCase();
  switch (normalized) {
    case 'PK2PK':
      return 'PK2PK';
    case 'FREQUENCY':
      return 'FREQUENCY';
    case 'AMPLITUDE':
      return 'AMPLITUDE';
    case 'PEAKFREQ':
    case 'PEAKFREQUENCY':
      return 'PEAKFREQ';
    case 'RISETIME':
      return 'RISETIME';
    case 'FALLTIME':
      return 'FALLTIME';
    case 'MEAN':
      return 'MEAN';
    case 'RMS':
      return 'RMS';
    case 'RMSNOISE':
      return 'RMSNOISE';
    case 'HIGH':
      return 'HIGH';
    case 'LOW':
      return 'LOW';
    case 'PERIOD':
      return 'PERIOD';
    case 'POVERSHOOT':
      return 'POVERSHOOT';
    case 'NOVERSHOOT':
      return 'NOVERSHOOT';
    case 'DELAY':
      return 'DELAY';
    case 'PHASE':
      return 'PHASE';
    case 'EYEHEIGHT':
      return 'EYEHEIGHT';
    case 'EYEWIDTH':
      return 'EYEWIDTH';
    case 'JITTERSUMMARY':
      return 'JITTERSUMMARY';
    case 'TIE':
      return 'TIE';
    default:
      return undefined;
  }
}

let intentAliasMapsPromise: Promise<IntentAliasMaps> | null = null;

export async function parseIntent(
  req: Pick<McpChatRequest, 'userMessage'> & Partial<Pick<McpChatRequest, 'flowContext'>>
): Promise<PlannerIntent> {
  const message = normalizeMessage(req.userMessage);
  const deviceType = detectDeviceType(req);
  const modelFamily = req.flowContext?.modelFamily ?? '';
  const aliasMaps = await getIntentAliasMaps();

  const channels = deviceType === 'SCOPE' ? parseChannelIntent(message) : [];
  let trigger = deviceType === 'SCOPE' ? parseTriggerIntent(message, aliasMaps) : undefined;
  const triggerB = deviceType === 'SCOPE' ? parseSecondaryTriggerIntent(message, aliasMaps) : undefined;
  const buses = deviceType === 'SCOPE' ? parseBusIntents(message, aliasMaps) : [];
  const primaryBus = buses[0];
  // Prefer protocol/bus trigger synthesis when bus-specific trigger intent is present.
  if (buses.some((bus) => Boolean(bus.triggerCondition))) {
    trigger = undefined;
  }
  const measurements =
    deviceType === 'SCOPE' ? parseMeasurementIntent(message, { channels, bus: primaryBus }, aliasMaps) : [];
  let acquisition = deviceType === 'SCOPE' ? parseAcquisitionIntent(message, aliasMaps) : undefined;
  let horizontal = deviceType === 'SCOPE' ? parseHorizontalIntent(message) : undefined;
  const fastFrame = deviceType === 'SCOPE' ? parseFastFrameIntent(message) : undefined;
  const math = deviceType === 'SCOPE' ? parseMathIntent(message) : undefined;
  const cursor = deviceType === 'SCOPE' ? parseCursorIntent(message) : undefined;
  let search = deviceType === 'SCOPE' ? parseSearchIntent(message, primaryBus) : undefined;

  const afg = deviceType === 'AFG' || /\bafg\b|function gen|signal generator|sweep\b/i.test(message)
    ? parseAfgIntent(message)
    : undefined;
  const awg = deviceType === 'AWG' ? parseAwgIntent(message) : undefined;
  const smu = deviceType === 'SMU' ? parseSmuIntent(message) : undefined;
  const rsa = deviceType === 'RSA' ? parseRsaIntent(message) : undefined;
  const spectrumView =
    deviceType === 'SCOPE' ? parseSpectrumViewIntent(message) : undefined;

  // ── Mask test detection ──
  const maskTest = /\bmask\s*test/i.test(message) || /\b(pass\s*fail|fail\s*count)\b/i.test(message);

  let save = parseSaveIntent(message, { channels });
  const recall = parseRecallIntent(message);
  let status = parseStatusIntent(message);
  let errorCheck = ERROR_CHECK_REGEX.test(message) || undefined;
  const reset = RECALL_FACTORY_REGEX.test(message) || undefined;
  let idn = IDN_REGEX.test(message) || undefined;
  const optionsQuery = OPTIONS_QUERY_REGEX.test(message) || undefined;
  const waitSecondsMatch = message.match(WAIT_SECONDS_REGEX);
  const waitSeconds = waitSecondsMatch ? Number(waitSecondsMatch[1]) : undefined;
  const multiAcqCount = deviceType === 'SCOPE' ? parseMultiAcquisitionCount(message) : undefined;
  const compareFrequencyNominalHz =
    deviceType === 'SCOPE' ? parseCompareFrequencyNominalHz(message) : undefined;
  const unresolved: string[] = [];

  if (
    deviceType === 'SCOPE' &&
    !channels.length &&
    !trigger &&
    !measurements.length &&
    !buses.length &&
    !acquisition &&
    !horizontal &&
    !fastFrame &&
    !math &&
    !cursor &&
    !search
  ) {
    const basicSearchTableRequested =
      !buses.length &&
      !measurements.length &&
      !save &&
      /\btable\b/i.test(message) &&
      /\bsearch(?:es)?\b/i.test(message);
    const compactWaveformCaptureRequested =
      /\bwaveform[-\s]*capture\b|\bcapture\b[^.!?\n\r]*\bwaveforms?\b|\bsave\b[^.!?\n\r]*\bwaveforms?\b/i.test(
        message
      ) &&
      (save?.waveformSources?.length || /\bscreenshot\b|\bcapture screen\b/i.test(message));
    const genericStarterRequested =
      /\b(validation|sanity-check|sanity check|readiness checklist|smoke test|starter flow|baseline flow|capture-and-measure|capture and measure|measurement workflow|troubleshooting flow|useful workflow|practical oscilloscope validation|communication health)\b/i.test(
        message
      ) ||
      /\buseful\b[\s\S]{0,80}\bworkflow\b/i.test(message) ||
      /\bworkflow\b[\s\S]{0,80}\b(reuse|reusable|actually reuse)\b/i.test(message) ||
      /\bsmart\b[\s\S]{0,40}\bmeasurement workflow\b/i.test(message) ||
      /\boperator-friendly\b[\s\S]{0,40}\bdebug flow\b/i.test(message);
    const communicationHealthRequested =
      /\b(?:communication|comms?|connect(?:ion)?|instrument)\b[\s\S]{0,80}\b(?:health|sanity|smoke|check|readiness)\b/i.test(
        message
      ) &&
      /\b(?:idn|esr|opc|error queue|error check|event status)\b/i.test(message);

    if (basicSearchTableRequested) {
      const requestedSearchCount = (() => {
        const numericMatch = message.match(/\b(\d+)\s+search(?:es)?\b/i);
        if (numericMatch) return Math.max(1, Number(numericMatch[1]));
        if (/\btwo\s+search(?:es)?\b/i.test(message)) return 2;
        return 1;
      })();
      search = {
        type: 'BUS',
        protocol: 'I2C',
        bus: 'B1',
        count: requestedSearchCount,
        showBusTable: true,
      };
    } else if (compactWaveformCaptureRequested) {
      const waveformSources =
        save?.waveformSources?.length
          ? save.waveformSources
          : extractChannels(message).filter((source) => /^CH[1-8]$/i.test(source));
      const normalizedSources = waveformSources.length ? waveformSources : ['CH1'];
      normalizedSources.forEach((source, index) => {
        if (!channels.some((existing) => existing.channel === source)) {
          channels.push({ channel: source, displayState: true });
        }
        if (index === 0 && !trigger) {
          trigger = { type: 'EDGE', source, slope: 'RISe', mode: 'NORMal' };
        }
      });
      acquisition = acquisition || { stopAfter: 'SEQuence' };
      save = save || {
        screenshot: /\bscreenshot\b|\bcapture screen\b/i.test(message),
        waveformSources: normalizedSources,
      };
    } else if (genericStarterRequested) {
      if (communicationHealthRequested) {
        idn = true;
        errorCheck = true;
        status = { ...(status || {}), esr: true, opc: true };
      } else {
        channels.push({ channel: 'CH1', displayState: true });
        trigger = { type: 'EDGE', source: 'CH1', slope: 'RISe', mode: 'NORMal', levelVolts: 0 };
        acquisition = { mode: 'SAMple', stopAfter: 'SEQuence' };
        horizontal = horizontal || { scaleSeconds: 1e-3 };
        if (!measurements.some((item) => item.type === 'FREQUENCY')) {
          measurements.push({ type: 'FREQUENCY', source1: 'CH1' });
        }
        if (!measurements.some((item) => item.type === 'PK2PK')) {
          measurements.push({ type: 'PK2PK', source1: 'CH1' });
        }
        save = save || { screenshot: true };
        if (/\b(communication|health|sanity|smoke|readiness)\b/i.test(message)) {
          idn = true;
          errorCheck = true;
          status = status || { esr: true };
        }
      }
    }
  }

  if (deviceType === 'SCOPE' && save?.waveformSources?.length) {
    const inferredChannels = save.waveformSources
      .filter((source) => /^CH[1-8]$/i.test(source))
      .map((source) => source.toUpperCase());
    for (const channel of inferredChannels) {
      if (!channels.some((existing) => existing.channel === channel)) {
        channels.push({ channel, displayState: true });
      }
    }
  }

  const groups: IntentGroup[] = [];

  if (deviceType === 'SCOPE') {
    if (channels.length > 0) groups.push('CHANNEL_SETUP');
    if (channels.some((channel) => channel.displayState !== undefined)) groups.push('DISPLAY');
    if (trigger) groups.push('TRIGGER');
    if (triggerB) groups.push('TRIGGER_B');
    if (measurements.length > 0) groups.push('MEASUREMENT');
    if (buses.length > 0) groups.push('BUS_DECODE');
    if (acquisition) groups.push('ACQUISITION');
    if (horizontal) groups.push('HORIZONTAL');
    if (fastFrame) groups.push('FASTFRAME');
    if (math) groups.push('MATH');
    if (cursor) groups.push('CURSOR');
    if (search) groups.push('SEARCH');
  }

  if (afg) {
    groups.push('AFG_SOURCE');
    if (afg.outputOn !== undefined || afg.impedance !== undefined) groups.push('AFG_OUTPUT');
    if (afg.burstState !== undefined || afg.burstCycles !== undefined) groups.push('AFG_BURST');
    if (afg.amState !== undefined || afg.amFrequencyHz !== undefined || afg.amDepthPct !== undefined) groups.push('AFG_MODULATION');
    if (afg.sweepRequested && afg.sweepStartHz === undefined) {
      unresolved.push('AFG frequency sweep setup is not yet resolved to verified deterministic commands.');
    }
  }

  if (awg) {
    groups.push('AWG_WAVEFORM');
    if (awg.outputOn !== undefined) groups.push('AWG_OUTPUT');
    if (awg.sampleRateHz !== undefined) groups.push('AWG_CLOCK');
    if (awg.runMode === 'SEQuence') groups.push('AWG_SEQUENCE');
  }

  if (smu) {
    if (
      smu.sourceFunction !== undefined ||
      smu.sourceLevel !== undefined ||
      smu.complianceLevel !== undefined
    ) {
      groups.push('SMU_SOURCE');
    }
    if (smu.outputOn !== undefined) groups.push('SMU_OUTPUT');
    if (smu.measureFunction !== undefined) groups.push('SMU_MEASURE');
    if (smu.sweepStart !== undefined || smu.sweepStop !== undefined) groups.push('SMU_SWEEP');
  }

  if (rsa) {
    if (rsa.centerFreqHz !== undefined || rsa.spanHz !== undefined || rsa.rbwHz !== undefined) {
      groups.push('RSA_FREQUENCY');
    }
    if (rsa.measurementType === 'DPX') groups.push('RSA_DPX');
    else if (rsa.measurementType !== undefined) groups.push('RSA_SPECTRUM');
    if (rsa.traceType !== undefined) groups.push('RSA_TRACE');
    if (rsa.triggerType !== undefined) groups.push('RSA_TRIGGER');
  }

  if (maskTest) {
    groups.push('ACQUISITION');
  }

  if (save) {
    groups.push('SAVE');
    if (save.waveformSources && save.waveformSources.length > 0) groups.push('WAVEFORM_TRANSFER');
  }
  if (recall) groups.push('RECALL');
  if (status) groups.push('STATUS');
  if (errorCheck) groups.push('ERROR_CHECK');
  if (idn || optionsQuery) groups.push('IEEE488');
  if (reset) groups.push('SYSTEM');

  return {
    deviceType,
    modelFamily,
    groups: dedupeGroups(groups),
    channels,
    trigger,
    triggerB,
    measurements,
    buses,
    acquisition,
    horizontal,
    fastFrame,
    math,
    cursor,
    search,
    afg,
    awg,
    smu,
    rsa,
    spectrumView,
    save,
    recall,
    status,
    maskTest,
    errorCheck,
    reset,
    idn,
    optionsQuery,
    waitSeconds,
    multiAcqCount,
    compareFrequencyNominalHz,
    unresolved,
  };
}

export function detectDeviceType(
  req: Pick<McpChatRequest, 'userMessage'> & Partial<Pick<McpChatRequest, 'flowContext'>>
): DetectedDeviceType {
  if (req.flowContext?.deviceType) {
    const dt = req.flowContext.deviceType.toUpperCase();
    if (dt === 'AFG') return 'AFG';
    if (dt === 'AWG') return 'AWG';
    if (dt === 'SMU') return 'SMU';
    if (dt === 'SCOPE') return 'SCOPE';
    if (dt === 'RSA') return 'RSA';
  }

  const modelFamily = (req.flowContext?.modelFamily || '').toUpperCase();
  if (/AFG/.test(modelFamily)) return 'AFG';
  if (/AWG/.test(modelFamily)) return 'AWG';
  if (/SMU/.test(modelFamily)) return 'SMU';
  if (/RSA/.test(modelFamily)) return 'RSA';
  if (/MSO|DPO|TDS|SCOPE/.test(modelFamily)) return 'SCOPE';

  const message = req.userMessage.toLowerCase();
  if (/\bafg\b|function gen|arbitrary func/.test(message)) return 'AFG';
  if (/\bawg\b|arbitrary wave/.test(message)) return 'AWG';
  if (/\bsmu\b|source measure|keithley/.test(message)) return 'SMU';
  if (/\brsa\b|spectrum anal/.test(message)) return 'RSA';
  return 'SCOPE';
}

export function getCommandFile(deviceType: string, modelFamily: string): string {
  const normalizedModelFamily = (modelFamily || '').toUpperCase();
  switch (deviceType) {
    case 'AFG':
      return 'afg.json';
    case 'AWG':
      return 'awg.json';
    case 'SMU':
      return 'smu.json';
    case 'RSA':
      return 'rsa.json';
    case 'SCOPE':
      if (/DPO|5K|7K|70K/.test(normalizedModelFamily)) return 'MSO_DPO_5k_7k_70K.json';
      if (/MSO2|2\s*SERIES|^MSO2[24]/i.test(normalizedModelFamily)) return 'mso2.json';
      return 'mso_4_5_6_7.json';
    default:
      return 'mso_4_5_6_7.json';
  }
}

export async function planIntent(
  req: Pick<McpChatRequest, 'userMessage'> & Partial<Pick<McpChatRequest, 'flowContext'>>
): Promise<PlannerOutput> {
  const message = normalizeMessage(req.userMessage);
  if (OUT_OF_SCOPE_PATTERNS.some((pattern) => pattern.test(message))) {
    const intent = await parseIntent(req);
    return {
      intent,
      resolvedCommands: [],
      unresolved: [],
      conflicts: [],
      rejection: 'out_of_scope',
      rejectionReason: 'Request is outside TekAutomate scope.',
      unsupportedSubrequests: detectUnsupportedSubrequests(message),
    };
  }

  const intent = await parseIntent(req);
  const conflicts = checkPlannerConflicts(intent);
  const unsupportedSubrequests = detectUnsupportedSubrequests(message);

  if (!intent.groups.length || !hasParsedIntentDetail(intent)) {
    return {
      intent,
      resolvedCommands: [],
      unresolved: intent.unresolved,
      conflicts,
      rejection: 'low_confidence',
      rejectionReason: 'Planner could not extract a confident instrument intent.',
      unsupportedSubrequests,
    };
  }

  const index = await getCommandIndex();
  const bindings = buildBindings(intent);
  const sourceFile = getCommandFile(intent.deviceType, intent.modelFamily);
  const resolvedCommands: ResolvedCommand[] = [];

  resolvedCommands.push(
    ...(await resolveChannelCommands(index, intent.channels, bindings, intent.modelFamily, sourceFile)),
    ...(await resolveMathCommands(index, intent.math, sourceFile)),
    ...(await resolveTriggerCommands(index, intent.trigger, bindings, intent.modelFamily, sourceFile)),
    ...(await resolveTriggerBCommands(index, intent.triggerB, sourceFile)),
    ...(await resolveMeasurementCommands(index, intent.measurements, intent.modelFamily, sourceFile)),
    ...(await resolveAcquisitionCommands(index, intent.acquisition, sourceFile)),
    ...(await resolveHorizontalCommands(index, intent.horizontal, sourceFile)),
    ...(await resolveFastFrameCommands(index, intent.fastFrame, sourceFile)),
    ...(await resolveCursorCommands(index, intent.cursor, sourceFile)),
    ...(await resolveSearchCommands(index, intent.search, sourceFile)),
    ...(await Promise.all(intent.buses.map((bus) => resolveBusCommands(index, bus, sourceFile)))).flat(),
    ...(await resolveStatusCommands(index, intent.status, sourceFile)),
    ...(await resolveErrorCheckCommands(index, intent.errorCheck, sourceFile)),
    ...(await resolveIeee488Commands(index, { idn: intent.idn, optionsQuery: intent.optionsQuery }, sourceFile)),
    ...(await resolveSystemCommands(index, intent.reset, sourceFile)),
    ...(await resolveRecallCommands(index, intent.recall, sourceFile)),
    ...(await resolveAfgCommands(index, intent.afg, sourceFile)),
    ...(await resolveAwgCommands(index, intent.awg, sourceFile)),
    ...(await resolveSmuCommands(index, intent.smu, sourceFile)),
    ...(await resolveSpectrumViewCommands(index, intent.spectrumView, sourceFile)),
    ...(await resolveSaveCommands(intent.save, intent.modelFamily)),
    ...(intent.maskTest ? [
      buildSyntheticWrite('MASK:TESt:STATE ON', 'ACQUISITION'),
      buildSyntheticWrite('MASK:COUNt:STATE ON', 'ACQUISITION'),
      buildSyntheticWrite('ACQuire:STOPAfter SEQuence', 'ACQUISITION'),
      buildSyntheticWrite('ACQuire:STATE RUN', 'ACQUISITION'),
    ] : [])
  );

  if (intent.waitSeconds !== undefined && intent.waitSeconds > 0) {
    resolvedCommands.push(
      buildSyntheticStep(
        'sleep',
        'STATUS',
        {
          duration: intent.waitSeconds,
        },
        'Sleep'
      )
    );
  }

  if (intent.multiAcqCount && intent.multiAcqCount > 0) {
    const count = intent.multiAcqCount;
    const tieMeasurementIndex = intent.measurements.findIndex((measurement) => measurement.type === 'TIE');
    const tieQueryHeader =
      tieMeasurementIndex >= 0
        ? `MEASUrement:MEAS${tieMeasurementIndex + 1}:RESUlts:CURRentacq:MEAN?`
        : 'MEASUrement:MEAS1:RESUlts:CURRentacq:MEAN?';
    resolvedCommands.push(
      buildSyntheticStep(
        'python',
        'MEASUREMENT',
        {
          code: [
            'results = []',
            `for i in range(${count}):`,
            "    scope.write('ACQuire:STATE RUN')",
            "    scope.query('*OPC?')",
            `    value = float(scope.query('${tieQueryHeader}'))`,
            "    results.append(value)",
            "print(f\"Jitter min:{min(results):.6g}\")",
            "print(f\"Jitter max:{max(results):.6g}\")",
            "print(f\"Jitter mean:{sum(results)/len(results):.6g}\")",
          ].join('\n'),
        },
        'Collect stats over repeated acquisitions'
      )
    );
  }

  if (intent.compareFrequencyNominalHz !== undefined) {
    resolvedCommands.push(
      buildSyntheticStep(
        'python',
        'MEASUREMENT',
        {
          code: [
            `nominal_hz = ${intent.compareFrequencyNominalHz}`,
            "measured_hz = float(locals().get('meas2_frequency', locals().get('meas1_frequency', 0.0)))",
            'delta_hz = measured_hz - nominal_hz',
            'delta_ppm = (delta_hz / nominal_hz) * 1e6 if nominal_hz else 0.0',
            "print(f'Measured frequency: {measured_hz:.6f} Hz')",
            "print(f'Nominal frequency: {nominal_hz:.6f} Hz')",
            "print(f'Delta: {delta_hz:.6f} Hz ({delta_ppm:.3f} ppm)')",
          ].join('\n'),
        },
        'Compare measured frequency to nominal'
      )
    );
  }

  const seenResolved = new Set<string>();
  const dedupedResolved: ResolvedCommand[] = [];
  for (const command of resolvedCommands) {
    const normalizedConcrete = command.concreteCommand.trim().toLowerCase();
    const preserveDuplicateImmediateSource = /^measurement:immed:source(\d+)?\s+/.test(normalizedConcrete);
    if (preserveDuplicateImmediateSource) {
      dedupedResolved.push(command);
      continue;
    }
    const key = `${command.commandType}|${normalizedConcrete}|${String(command.saveAs || '').toLowerCase()}`;
    if (seenResolved.has(key)) continue;
    seenResolved.add(key);
    dedupedResolved.push(command);
  }

  if (dedupedResolved.length > 0 && !resolvedCommandsMatchParsedGroups(intent, dedupedResolved)) {
    return {
      intent,
      resolvedCommands: [],
      unresolved: intent.unresolved,
      conflicts,
      rejection: 'low_confidence',
      rejectionReason: 'Resolved commands did not align with the parsed intent groups.',
      unsupportedSubrequests,
    };
  }

  return {
    intent,
    resolvedCommands: dedupedResolved,
    unresolved: intent.unresolved,
    conflicts,
    unsupportedSubrequests,
  };
}

function detectUnsupportedSubrequests(message: string): string[] {
  return UNSUPPORTED_SUBINTENT_PATTERNS
    .filter((entry) => entry.pattern.test(message))
    .map((entry) => entry.reason);
}

function parseMultiAcquisitionCount(message: string): number | undefined {
  const explicitMatch =
    message.match(/\brun\s+(\d+)\s+acquisitions?\b/i) ||
    message.match(/\bover\s+the\s+next\s+(\d+)\s+acquisitions?\b/i) ||
    message.match(/\bover\s+(\d+)\s+acquisitions?\b/i) ||
    message.match(/\bnext\s+(\d+)\s+acquisitions?\b/i);
  if (explicitMatch) return Number(explicitMatch[1]);

  if (
    /\bminimum\s+and\s+maximum\b/i.test(message) &&
    /\bfrequency\b/i.test(message) &&
    /\bover\s+the\s+next\s+average\s+acquisitions?\b/i.test(message)
  ) {
    return 10;
  }

  if (
    /\bminimum\s+and\s+maximum\b/i.test(message) &&
    /\bfrequency\b/i.test(message) &&
    /\bover\s+the\s+next\s+average\s+acquisition\b/i.test(message)
  ) {
    return 10;
  }

  if (
    /\b(min(?:imum)?|max(?:imum)?)\b/i.test(message) &&
    /\bover\b/i.test(message) &&
    /\b(acquisition|captures?)\b/i.test(message)
  ) {
    return 10;
  }

  return undefined;
}

function hasParsedIntentDetail(intent: PlannerIntent): boolean {
  return Boolean(
    intent.channels.length ||
      intent.trigger ||
      intent.triggerB ||
      intent.measurements.length ||
      intent.buses.length ||
      intent.acquisition ||
      intent.horizontal ||
      intent.fastFrame ||
      intent.math ||
      intent.cursor ||
      intent.search ||
      intent.afg ||
      intent.awg ||
      intent.smu ||
      intent.rsa ||
      intent.save ||
      intent.recall ||
      intent.maskTest ||
      intent.status ||
      intent.errorCheck ||
      intent.reset ||
      intent.idn
  );
}

function resolvedCommandsMatchParsedGroups(intent: PlannerIntent, resolvedCommands: ResolvedCommand[]): boolean {
  if (!resolvedCommands.length || !intent.groups.length) return false;
  const parsedGroups = new Set(intent.groups);
  return resolvedCommands.some((command) => parsedGroups.has(command.group));
}

export const resolveIntent = planIntent;

export async function resolveChannelCommands(
  index: CommandIndex,
  intent: ParsedChannelIntent[],
  bindings: Record<string, string>,
  modelFamily: string,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  const out: ResolvedCommand[] = [];

  for (const channelIntent of intent) {
    const channel = channelIntent.channel;
    const scaleRecord = findExactHeader(index, 'CH<x>:SCAle', sourceFile);
    if (scaleRecord && channelIntent.scaleVolts !== undefined) {
      out.push(
        materialize(
          scaleRecord,
          `${channel}:SCAle`,
          formatValue(channelIntent.scaleVolts),
          'CHANNEL_SETUP'
        )
      );
    }

    const couplingRecord = findExactHeader(index, 'CH<x>:COUPling', sourceFile);
    if (couplingRecord && channelIntent.coupling) {
      out.push(
        materialize(couplingRecord, `${channel}:COUPling`, channelIntent.coupling, 'CHANNEL_SETUP')
      );
    }

    const terminationRecord = findExactHeader(index, 'CH<x>:TERmination', sourceFile);
    if (terminationRecord && channelIntent.terminationOhms !== undefined) {
      out.push(
        materialize(
          terminationRecord,
          `${channel}:TERmination`,
          channelIntent.terminationOhms === 50 ? '50' : '1E6',
          'CHANNEL_SETUP'
        )
      );
    }

    const bandwidthRecord = findExactHeader(index, 'CH<x>:BANdwidth', sourceFile);
    if (bandwidthRecord && channelIntent.bandwidthHz !== undefined) {
      out.push(
        materialize(
          bandwidthRecord,
          `${channel}:BANdwidth`,
          formatValue(channelIntent.bandwidthHz),
          'CHANNEL_SETUP'
        )
      );
    }

    const offsetRecord = findExactHeader(index, 'CH<x>:OFFSet', sourceFile);
    if (offsetRecord && channelIntent.offsetVolts !== undefined) {
      out.push(
        materialize(
          offsetRecord,
          `${channel}:OFFSet`,
          formatValue(channelIntent.offsetVolts),
          'CHANNEL_SETUP'
        )
      );
    } else if (channelIntent.offsetVolts !== undefined) {
      out.push({
        group: 'CHANNEL_SETUP',
        header: 'CH<x>:OFFSet',
        concreteCommand: `${channel}:OFFSet ${formatValue(channelIntent.offsetVolts)}`,
        commandType: 'set',
        verified: true,
        sourceFile,
        syntax: {
          set: 'CH<x>:OFFSet <NR3>',
          query: 'CH<x>:OFFSet?',
        },
        arguments: [
          {
            name: 'channel',
            type: 'integer',
            required: true,
            description: 'CH<x> where x is the analog channel number.',
          },
          {
            name: 'value',
            type: 'number',
            required: true,
            unit: 'V',
            description: 'Vertical offset for the specified analog channel.',
          },
        ],
        examples: [{ scpi: `${channel}:OFFSet ${formatValue(channelIntent.offsetVolts)}` }],
      });
    }

    if (channelIntent.label) {
      const labelRecord =
        findExactHeader(index, 'CH<x>:LABel:NAMe', sourceFile) ??
        findHeaderStartsWith(index, 'CH<x>:LABel', sourceFile);
      if (labelRecord) {
        out.push(
          materialize(
            labelRecord,
            headersEquivalent(labelRecord.header, 'CH<x>:LABel:NAMe') ? `${channel}:LABel:NAMe` : `${channel}:LABel`,
            `"${channelIntent.label}"`,
            'CHANNEL_SETUP'
          )
        );
      }
    }

    if (channelIntent.displayState !== undefined) {
      const displayRecord =
        findExactHeader(index, 'DISplay:GLObal:CH<x>:STATE', sourceFile) ??
        findExactHeader(index, 'DISplay:WAVEView<x>:CH<x>:STATE', sourceFile);
      if (displayRecord) {
        const concreteHeader = headersEquivalent(displayRecord.header, 'DISplay:WAVEView<x>:CH<x>:STATE')
          ? `DISplay:WAVEView1:${channel}:STATE`
          : `DISplay:GLObal:${channel}:STATE`;
        out.push(materialize(displayRecord, concreteHeader, channelIntent.displayState ? 'ON' : 'OFF', 'DISPLAY'));
      } else {
        out.push(buildSyntheticWrite(`DISplay:GLObal:${channel}:STATE ${channelIntent.displayState ? 'ON' : 'OFF'}`, 'DISPLAY'));
      }
    }
  }

  return out;
}

export async function resolveTriggerCommands(
  index: CommandIndex,
  trigger: ParsedTriggerIntent | undefined,
  bindings: Record<string, string>,
  modelFamily: string,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  if (!trigger) {
    return [];
  }

  const out: ResolvedCommand[] = [];
  const validTriggerTypes = new Set(['EDGE', 'WIDth', 'TIMEOut', 'RUNt', 'WINdow', 'LOGIc', 'SETHold', 'BUS', 'TRANsition']);
  if (trigger.type && validTriggerTypes.has(trigger.type)) {
    const typeRecord = findExactHeader(index, 'TRIGger:A:TYPe', sourceFile);
    if (typeRecord) {
      out.push(materialize(typeRecord, 'TRIGger:A:TYPe', trigger.type, 'TRIGGER'));
    }
  }

  if (trigger.source) {
    // Route source to the correct trigger type's source command
    const sourceHeaderMap: Record<string, string> = {
      'WIDth': 'TRIGger:{A|B}:PULSEWidth:SOUrce',
      'TIMEOut': 'TRIGger:{A|B}:TIMEOut:SOUrce',
      'RUNt': 'TRIGger:{A|B}:RUNT:SOUrce',
      'WINdow': 'TRIGger:A:WINdow:SOUrce',
      'TRANsition': 'TRIGger:A:TRANsition:SOUrce',
      'LOGIc': 'TRIGger:A:LOGIc:INPut:CH<x>',
    };
    const sourceHeader = sourceHeaderMap[trigger.type || ''] || 'TRIGger:A:EDGE:SOUrce';
    const sourceRecord = findExactHeader(index, sourceHeader, sourceFile);
    if (sourceRecord) {
      out.push(materialize(sourceRecord, sourceHeader.replace('{A|B}', 'A'), trigger.source, 'TRIGGER'));
    } else {
      // Fallback to EDGE source if specific type source not in corpus
      const edgeSource = findExactHeader(index, 'TRIGger:A:EDGE:SOUrce', sourceFile);
      if (edgeSource) out.push(materialize(edgeSource, 'TRIGger:A:EDGE:SOUrce', trigger.source, 'TRIGGER'));
    }
  }

  if (trigger.slope) {
    const slopeRecord = findExactHeader(index, 'TRIGger:A:EDGE:SLOpe', sourceFile);
    if (slopeRecord) {
      out.push(materialize(slopeRecord, 'TRIGger:A:EDGE:SLOpe', trigger.slope, 'TRIGGER'));
    }
  }

  if (trigger.levelVolts !== undefined && trigger.source) {
    const levelRecord = findExactHeader(index, `TRIGger:A:LEVel:${trigger.source}`, sourceFile);
    if (levelRecord) {
      out.push(
        materialize(
          levelRecord,
          `TRIGger:A:LEVel:${trigger.source}`,
          formatValue(trigger.levelVolts),
          'TRIGGER'
        )
      );
    }
  }

  if (trigger.autoSetLevel) {
    out.push(buildSyntheticWrite('TRIGger:A SETLevel', 'TRIGGER'));
  }

  if (trigger.mode) {
    const modeRecord = findExactHeader(index, 'TRIGger:A:MODe', sourceFile);
    if (modeRecord) {
      out.push(materialize(modeRecord, 'TRIGger:A:MODe', trigger.mode, 'TRIGGER'));
    }
  }

  if (trigger.type === 'WIDth') {
    if (trigger.widthCondition) {
      const whenRecord = findExactHeader(index, 'TRIGger:{A|B}:PULSEWidth:WHEn', sourceFile);
      if (whenRecord) {
        out.push(materialize(whenRecord, 'TRIGger:A:PULSEWidth:WHEn', trigger.widthCondition, 'TRIGGER'));
      }
    }
    if (trigger.widthSeconds !== undefined) {
      if (trigger.widthCondition === 'LESSTHAN') {
        const highLimitRecord = findExactHeader(index, 'TRIGger:{A|B}:PULSEWidth:HIGHLimit', sourceFile);
        if (highLimitRecord) {
          out.push(
            materialize(
              highLimitRecord,
              'TRIGger:A:PULSEWidth:HIGHLimit',
              trigger.widthSeconds.toExponential(),
              'TRIGGER'
            )
          );
        }
      } else {
        const lowLimitRecord = findExactHeader(index, 'TRIGger:{A|B}:PULSEWidth:LOWLimit', sourceFile);
        if (lowLimitRecord) {
          out.push(
            materialize(
              lowLimitRecord,
              'TRIGger:A:PULSEWidth:LOWLimit',
              trigger.widthSeconds.toExponential(),
              'TRIGGER'
            )
          );
        }
      }
    }
  }

  // ── RUNT trigger: threshold HIGH/LOW ──
  if (trigger.type === 'RUNT' || (trigger.type as string) === 'RUNT') {
    if (trigger.levelVolts !== undefined) {
      out.push(buildSyntheticWrite(`TRIGger:A:RUNT:THReshold:HIGH ${formatValue(trigger.levelVolts)}`, 'TRIGGER'));
      out.push(buildSyntheticWrite(`TRIGger:A:RUNT:THReshold:LOW ${formatValue(-Math.abs(trigger.levelVolts))}`, 'TRIGGER'));
    }
    if (trigger.source) {
      const runtSrc = findExactHeader(index, 'TRIGger:{A|B}:RUNT:SOUrce', sourceFile);
      if (runtSrc) out.push(materialize(runtSrc, 'TRIGger:A:RUNT:SOUrce', trigger.source, 'TRIGGER'));
    }
  }

  // ── WINDOW trigger: threshold HIGH/LOW ──
  if (trigger.type === 'WINdow' || (trigger.type as string) === 'WINDOW') {
    if (trigger.levelVolts !== undefined) {
      out.push(buildSyntheticWrite(`TRIGger:A:WINdow:THReshold:HIGH ${formatValue(trigger.levelVolts)}`, 'TRIGGER'));
      out.push(buildSyntheticWrite(`TRIGger:A:WINdow:THReshold:LOW ${formatValue(-Math.abs(trigger.levelVolts))}`, 'TRIGGER'));
    }
    if (trigger.source) {
      out.push(buildSyntheticWrite(`TRIGger:A:WINdow:SOUrce ${trigger.source}`, 'TRIGGER'));
    }
  }

  // ── Trigger sequence (A then B) ──
  if (trigger.sequenceBy) {
    out.push(buildSyntheticWrite(`TRIGger:B:BY ${trigger.sequenceBy}`, 'TRIGGER_B'));
    if (trigger.delaySeconds !== undefined) {
      out.push(buildSyntheticWrite(`TRIGger:B:TIMe ${trigger.delaySeconds.toExponential()}`, 'TRIGGER_B'));
    }
  }

  if (trigger.holdoffSeconds !== undefined) {
    const holdoffRecord = findExactHeader(index, 'TRIGger:A:HOLDoff:TIMe', sourceFile);
    if (holdoffRecord) {
      out.push(
        materialize(
          holdoffRecord,
          'TRIGger:A:HOLDoff:TIMe',
          trigger.holdoffSeconds.toExponential(),
          'TRIGGER'
        )
      );
    }
  }

  return out;
}

export async function resolveTriggerBCommands(
  index: CommandIndex,
  trigger: ParsedTriggerIntent | undefined,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  if (!trigger) return [];

  const out: ResolvedCommand[] = [];
  const stateRecord = findExactHeader(index, 'TRIGger:B:STATe', sourceFile);
  if (stateRecord) {
    out.push(materialize(stateRecord, 'TRIGger:B:STATe', 'ON', 'TRIGGER_B'));
  }

  if (trigger.sequenceBy) {
    const byRecord = findExactHeader(index, 'TRIGger:B:BY', sourceFile);
    if (byRecord) {
      out.push(materialize(byRecord, 'TRIGger:B:BY', trigger.sequenceBy, 'TRIGGER_B'));
    }
  }

  if (trigger.delaySeconds !== undefined) {
    const timeRecord = findExactHeader(index, 'TRIGger:B:TIMe', sourceFile);
    if (timeRecord) {
      out.push(
        materialize(
          timeRecord,
          'TRIGger:B:TIMe',
          trigger.delaySeconds.toExponential(),
          'TRIGGER_B'
        )
      );
    }
  }

  return out;
}

export async function resolveMathCommands(
  index: CommandIndex,
  math: ParsedMathIntent | undefined,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  if (!math) return [];

  const out: ResolvedCommand[] = [];
  const mathSlot = 'MATH1';
  const defineRecord =
    findExactHeader(index, 'MATH:MATH<x>:DEFine', sourceFile) ??
    findExactHeader(index, 'MATH<x>:DEFine', sourceFile);
  const displayRecord =
    findExactHeader(index, 'DISplay:WAVEView<x>:MATH:MATH<x>:STATE', sourceFile) ??
    findExactHeader(index, 'DISplay:GLObal:MATH<x>:STATE', sourceFile) ??
    findExactHeader(index, 'MATH<x>:STATE', sourceFile);

  const expression = (() => {
    if (math.expression && math.expression.trim()) return math.expression.trim();
    const [source1, source2] = math.sources || [];
    if (math.operation === 'SUBTRACT' && source1 && source2) return `${source1}-${source2}`;
    if (math.operation === 'ADD' && source1 && source2) return `${source1}+${source2}`;
    if (math.operation === 'MULTIPLY' && source1 && source2) return `${source1}*${source2}`;
    if (math.operation === 'DIVIDE' && source1 && source2) return `${source1}/${source2}`;
    if (source1) return source1;
    return undefined;
  })();

  if (defineRecord && expression) {
    out.push(
      materialize(
        defineRecord,
        headersEquivalent(defineRecord.header, 'MATH<x>:DEFine')
          ? `${mathSlot}:DEFine`
          : `MATH:${mathSlot}:DEFine`,
        `"${expression}"`,
        'MATH'
      )
    );
  }

  if (displayRecord && math.displayState !== false) {
    const displayHeader = headersEquivalent(displayRecord.header, 'DISplay:WAVEView<x>:MATH:MATH<x>:STATE')
      ? `DISplay:WAVEView1:MATH:${mathSlot}:STATE`
      : headersEquivalent(displayRecord.header, 'MATH<x>:STATE')
        ? `${mathSlot}:STATE`
        : `DISplay:GLObal:${mathSlot}:STATE`;
    out.push(materialize(displayRecord, displayHeader, 'ON', 'MATH'));
  }

  return out;
}

export async function resolveMeasurementCommands(
  index: CommandIndex,
  measurements: ParsedMeasurementIntent[],
  modelFamily: string,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  const out: ResolvedCommand[] = [];
  const isDpo = /DPO|5K|7K|70K/i.test(modelFamily);
  const useDpoMeasurementSlots =
    isDpo && (measurements.length > 1 || measurements.some((measurement) => Boolean(measurement.source2)));

  measurements.forEach((measurement, indexWithinMeasurement) => {
    const slot = indexWithinMeasurement + 1;

    if (isDpo && !useDpoMeasurementSlots) {
      const typeRecord = findExactHeader(index, 'MEASUrement:IMMed:TYPe', sourceFile);
      const sourceRecord =
        findExactHeader(index, 'MEASUrement:IMMed:SOUrce<x>', sourceFile) ??
        findExactHeader(index, 'MEASUrement:IMMed:SOUrce', sourceFile);
      const valueRecord = findExactHeader(index, 'MEASUrement:IMMed:VALue?', sourceFile);

      if (typeRecord) {
        out.push(materialize(typeRecord, 'MEASUrement:IMMed:TYPe', measurement.type, 'MEASUREMENT'));
      }
      if (sourceRecord && measurement.source1) {
        out.push(
          materialize(
            sourceRecord,
            measurement.source2 ? 'MEASUrement:IMMed:SOUrce1' : 'MEASUrement:IMMed:SOUrce',
            measurement.source1,
            'MEASUREMENT'
          )
        );
      }
      if (sourceRecord && measurement.source2) {
        out.push(
          materialize(
            sourceRecord,
            'MEASUrement:IMMed:SOUrce2',
            measurement.source2,
            'MEASUREMENT'
          )
        );
      }
      if (valueRecord) {
        out.push(
          materialize(
            valueRecord,
            'MEASUrement:IMMed:VALue?',
            undefined,
            'MEASUREMENT',
            'query',
            `immed_${slot}_${measurement.type.toLowerCase()}`
          )
        );
      }
      return;
    }

    if (isDpo) {
      const typeRecord = findExactHeader(index, 'MEASUrement:MEAS<x>:TYPe', sourceFile);
      const sourceRecord =
        findExactHeader(index, 'MEASUrement:MEAS<x>:SOUrce<x>', sourceFile) ??
        findExactHeader(index, `MEASUrement:MEAS${slot}:SOUrce${slot}`, sourceFile) ??
        findExactHeader(index, `MEASUrement:MEAS${slot}:SOUrce1`, sourceFile);
      const source2Record = findExactHeader(index, 'MEASUrement:MEAS<x>:SOUrce<x>', sourceFile);
      const stateRecord = findExactHeader(index, 'MEASUrement:MEAS<x>:STATE', sourceFile);
      const valueRecord =
        findExactHeader(index, 'MEASUrement:MEAS<x>:VALue?', sourceFile) ??
        findExactHeader(index, 'MEASUrement:MEAS<x>:VALue', sourceFile) ??
        findExactHeader(index, 'MEASUrement:MEAS<x>', sourceFile);

      if (typeRecord) {
        out.push(
          materialize(typeRecord, `MEASUrement:MEAS${slot}:TYPe`, measurement.type, 'MEASUREMENT')
        );
      }
      if (sourceRecord && measurement.source1) {
        out.push(
          materialize(
            sourceRecord,
            `MEASUrement:MEAS${slot}:SOUrce1`,
            measurement.source1,
            'MEASUREMENT'
          )
        );
      }
      if (source2Record && measurement.source2) {
        out.push(
          materialize(
            source2Record,
            `MEASUrement:MEAS${slot}:SOUrce2`,
            measurement.source2,
            'MEASUREMENT'
          )
        );
      }
      if (stateRecord) {
        out.push(materialize(stateRecord, `MEASUrement:MEAS${slot}:STATE`, 'ON', 'MEASUREMENT'));
      }
      if (valueRecord) {
        const queryHeader = headersEquivalent(valueRecord.header, 'MEASUrement:MEAS<x>:VALue?')
          || headersEquivalent(valueRecord.header, 'MEASUrement:MEAS<x>:VALue')
          ? `MEASUrement:MEAS${slot}:VALue?`
          : `MEASUrement:MEAS${slot}?`;
        out.push(
          materialize(
            valueRecord,
            queryHeader,
            undefined,
            'MEASUREMENT',
            'query',
            `meas${slot}_${measurement.type.toLowerCase()}`
          )
        );
      }
      return;
    }

    const addRecord = findExactHeader(index, 'MEASUrement:ADDMEAS', sourceFile);
    const sourceRecord =
      findExactHeader(index, `MEASUrement:MEAS${slot}:SOUrce1`, sourceFile) ??
      findExactHeader(index, `MEASUrement:MEAS${slot}:SOUrce${slot}`, sourceFile) ??
      findExactHeader(index, `MEASUrement:MEAS${slot}:SOUrce<x>`, sourceFile) ??
      findExactHeader(index, `MEASUrement:MEAS${slot}:SOURCE`, sourceFile);
    const source2Record =
      findExactHeader(index, `MEASUrement:MEAS${slot}:SOUrce2`, sourceFile) ??
      findExactHeader(index, `MEASUrement:MEAS${slot}:SOUrce<x>`, sourceFile);
    const resultRecord = findExactHeader(
      index,
      `MEASUrement:MEAS${slot}:RESUlts:CURRentacq:MEAN`,
      sourceFile
    );

    if (addRecord) {
      out.push(materialize(addRecord, 'MEASUrement:ADDMEAS', measurement.type, 'MEASUREMENT'));
    }
    if (sourceRecord && measurement.source1) {
      out.push(
        materialize(
          sourceRecord,
          `MEASUrement:MEAS${slot}:SOUrce1`,
          measurement.source1,
          'MEASUREMENT'
        )
      );
    }
    if (source2Record && measurement.source2) {
      out.push(
        materialize(
          source2Record,
          `MEASUrement:MEAS${slot}:SOUrce2`,
          measurement.source2,
          'MEASUREMENT'
        )
      );
    }
    if (resultRecord) {
      out.push(
        materialize(
          resultRecord,
          `MEASUrement:MEAS${slot}:RESUlts:CURRentacq:MEAN?`,
          undefined,
          'MEASUREMENT',
          'query',
          `meas${slot}_${measurement.type.toLowerCase()}`
        )
      );
    }
  });

  return out;
}

export async function resolveAcquisitionCommands(
  index: CommandIndex,
  acquisition: ParsedAcquisitionIntent | undefined,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  if (!acquisition) return [];

  const out: ResolvedCommand[] = [];

  if (acquisition.stopAfter) {
    const stopAfterRecord = findExactHeader(index, 'ACQuire:STOPAfter', sourceFile);
    if (stopAfterRecord) {
      out.push(materialize(stopAfterRecord, 'ACQuire:STOPAfter', acquisition.stopAfter, 'ACQUISITION'));
      const stateRecord = findExactHeader(index, 'ACQuire:STATE', sourceFile);
      if (stateRecord) {
        out.push(materialize(stateRecord, 'ACQuire:STATE', 'RUN', 'ACQUISITION'));
      }
    }
  }
  if (acquisition.runContinuous && !acquisition.stopAfter) {
    const stateRecord = findExactHeader(index, 'ACQuire:STATE', sourceFile);
    if (stateRecord) {
      out.push(materialize(stateRecord, 'ACQuire:STATE', 'RUN', 'ACQUISITION'));
    }
  }

  if (acquisition.mode) {
    if (acquisition.mode === 'FASTAcq') {
      const fastAcqStateRecord = findExactHeader(index, 'ACQuire:FASTAcq:STATE', sourceFile);
      if (fastAcqStateRecord) {
        out.push(materialize(fastAcqStateRecord, 'ACQuire:FASTAcq:STATE', 'ON', 'ACQUISITION'));
      }
      if (acquisition.fastAcqPalette) {
        const paletteRecord = findExactHeader(index, 'ACQuire:FASTAcq:PALEtte', sourceFile);
        if (paletteRecord) {
          out.push(
            materialize(
              paletteRecord,
              'ACQuire:FASTAcq:PALEtte',
              acquisition.fastAcqPalette,
              'ACQUISITION'
            )
          );
        }
      }
    } else {
      const modeRecord = findExactHeader(index, 'ACQuire:MODe', sourceFile);
      if (modeRecord) {
        out.push(materialize(modeRecord, 'ACQuire:MODe', acquisition.mode, 'ACQUISITION'));
      }
    }
  }

  if (acquisition.numAvg !== undefined) {
    const numAvgRecord = findExactHeader(index, 'ACQuire:NUMAVg', sourceFile);
    if (numAvgRecord) {
      out.push(materialize(numAvgRecord, 'ACQuire:NUMAVg', String(acquisition.numAvg), 'ACQUISITION'));
    }
  }

  return out;
}

export async function resolveHorizontalCommands(
  index: CommandIndex,
  horizontal: ParsedHorizontalIntent | undefined,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  if (!horizontal) return [];

  const out: ResolvedCommand[] = [];

  if (horizontal.scaleSeconds !== undefined) {
    const scaleRecord =
      findExactHeader(index, 'HORizontal:MODE:SCAle', sourceFile) ??
      findExactHeader(index, 'HORizontal:SCAle', sourceFile);
    if (scaleRecord) {
      const concreteHeader = headersEquivalent(scaleRecord.header, 'HORizontal:MODE:SCAle')
        ? 'HORizontal:MODE:SCAle'
        : 'HORizontal:SCAle';
      out.push(
        materialize(
          scaleRecord,
          concreteHeader,
          horizontal.scaleSeconds.toExponential(),
          'HORIZONTAL'
        )
      );
    }
  }

  if (horizontal.recordLength !== undefined) {
    const modeRecord = findExactHeader(index, 'HORizontal:MODe', sourceFile);
    if (modeRecord) {
      out.push(materialize(modeRecord, 'HORizontal:MODe', 'MANual', 'HORIZONTAL'));
    }
    const recordLengthRecord =
      findExactHeader(index, 'HORizontal:MODE:RECOrdlength', sourceFile) ??
      findExactHeader(index, 'HORizontal:RECOrdlength', sourceFile);
    if (recordLengthRecord) {
      const concreteHeader = headersEquivalent(recordLengthRecord.header, 'HORizontal:MODE:RECOrdlength')
        ? 'HORizontal:MODE:RECOrdlength'
        : 'HORizontal:RECOrdlength';
      out.push(
        materialize(
          recordLengthRecord,
          concreteHeader,
          String(horizontal.recordLength),
          'HORIZONTAL'
        )
      );
    }
  }

  if (horizontal.positionSeconds !== undefined) {
    const positionRecord = findExactHeader(index, 'HORizontal:POSition', sourceFile);
    if (positionRecord) {
      out.push(
        materialize(
          positionRecord,
          'HORizontal:POSition',
          horizontal.positionSeconds.toExponential(),
          'HORIZONTAL'
        )
      );
    }
  }

  return out;
}

export async function resolveBusCommands(
  index: CommandIndex,
  bus: ParsedBusIntent | undefined,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  if (!bus || !bus.bus) return [];
  if (!hasBusDecodeDetails(bus)) return [];

  const out: ResolvedCommand[] = [];
  const displayStateRecord =
    sourceFile === 'MSO_DPO_5k_7k_70K.json'
      ? null
      : findExactHeader(index, 'DISplay:WAVEView<x>:BUS:B<x>:STATE', sourceFile);
  const pushBusDisplayState = () => {
    if (displayStateRecord) {
      out.push(
        materialize(
          displayStateRecord,
          `DISplay:WAVEView1:BUS:${bus.bus}:STATE`,
          'ON',
          'BUS_DECODE'
        )
      );
    }
  };

  const typeRecord = findExactHeader(index, 'BUS:B<x>:TYPe', sourceFile);
  const triggerTypeRecord = findExactHeader(index, 'TRIGger:A:TYPe', sourceFile);
  const triggerBusSourceRecord = findExactHeader(index, 'TRIGger:{A|B}:BUS:SOUrce', sourceFile);
  const wantsReadBack = Boolean(bus.readBackRequested);
  const pushQuery = (
    headerTemplate: string,
    concreteHeader: string,
    group: IntentGroup,
    saveAs?: string
  ) => {
    const record = findExactHeader(index, headerTemplate, sourceFile);
    if (!record) return;
    out.push(materialize(record, `${concreteHeader}?`, undefined, group, 'query', saveAs));
  };
  const pushBusTriggerType = () => {
    if (triggerTypeRecord) {
      out.push(materialize(triggerTypeRecord, 'TRIGger:A:TYPe', 'BUS', 'TRIGGER'));
    }
  };
  const pushBusTriggerSource = () => {
    if (triggerBusSourceRecord) {
      out.push(
        materialize(
          triggerBusSourceRecord,
          'TRIGger:A:BUS:SOUrce',
          bus.bus || 'B1',
          'TRIGGER'
        )
      );
    }
  };
  const pushBusDisplayLayout = () => {
    if (!bus.displayLayout) return;
    const layoutRecord = findExactHeader(index, 'BUS:B<x>:DISplay:LAYout', sourceFile);
    if (!layoutRecord) return;
    out.push(
      materialize(
        layoutRecord,
        `BUS:${bus.bus}:DISplay:LAYout`,
        bus.displayLayout,
        'DISPLAY'
      )
    );
  };

  if (bus.protocol === 'I2C') {
    if (typeRecord) out.push(materialize(typeRecord, `BUS:${bus.bus}:TYPe`, 'I2C', 'BUS_DECODE'));
    if (bus.source1) {
      const clockSourceRecord = findExactHeader(index, 'BUS:B<x>:I2C:CLOCk:SOUrce', sourceFile);
      if (clockSourceRecord) {
        out.push(materialize(clockSourceRecord, `BUS:${bus.bus}:I2C:CLOCk:SOUrce`, bus.source1, 'BUS_DECODE'));
      }
    }
    if (bus.clockThresholdVolts !== undefined) {
      const clockThresholdRecord = findExactHeader(index, 'BUS:B<x>:I2C:CLOCk:THReshold', sourceFile);
      if (clockThresholdRecord) {
        out.push(
          materialize(
            clockThresholdRecord,
            `BUS:${bus.bus}:I2C:CLOCk:THReshold`,
            formatValue(bus.clockThresholdVolts),
            'BUS_DECODE'
          )
        );
      }
    }
    if (bus.source2) {
      const dataSourceRecord = findExactHeader(index, 'BUS:B<x>:I2C:DATa:SOUrce', sourceFile);
      if (dataSourceRecord) {
        out.push(materialize(dataSourceRecord, `BUS:${bus.bus}:I2C:DATa:SOUrce`, bus.source2, 'BUS_DECODE'));
      }
    }
    if (bus.dataThresholdVolts !== undefined) {
      const dataThresholdRecord = findExactHeader(index, 'BUS:B<x>:I2C:DATa:THReshold', sourceFile);
      if (dataThresholdRecord) {
        out.push(
          materialize(
            dataThresholdRecord,
            `BUS:${bus.bus}:I2C:DATa:THReshold`,
            formatValue(bus.dataThresholdVolts),
            'BUS_DECODE'
          )
        );
      }
    }
    if (bus.triggerCondition || bus.triggerDirection || bus.triggerAddress !== undefined) {
      pushBusTriggerType();
      pushBusTriggerSource();
      const conditionRecord = findExactHeader(index, 'TRIGger:{A|B}:BUS:B<x>:I2C:CONDition', sourceFile);
      if (conditionRecord) {
        out.push(
          materialize(
            conditionRecord,
            `TRIGger:A:BUS:${bus.bus}:I2C:CONDition`,
            bus.triggerCondition ?? 'ADDRess',
            'TRIGGER'
          )
        );
      }
      if (bus.triggerDirection) {
        const directionRecord = findExactHeader(index, 'TRIGger:{A|B}:BUS:B<x>:I2C:DATa:DIRection', sourceFile);
        if (directionRecord) {
          out.push(
            materialize(
              directionRecord,
              `TRIGger:A:BUS:${bus.bus}:I2C:DATa:DIRection`,
              bus.triggerDirection,
              'TRIGGER'
            )
          );
        }
      }
      if (bus.triggerAddress !== undefined) {
        const modeRecord = findExactHeader(index, 'TRIGger:{A|B}:BUS:B<x>:I2C:ADDRess:MODe', sourceFile);
        if (modeRecord) {
          out.push(
            materialize(modeRecord, `TRIGger:A:BUS:${bus.bus}:I2C:ADDRess:MODe`, 'ADDR7', 'TRIGGER')
          );
        }
        const valueRecord = findExactHeader(index, 'TRIGger:{A|B}:BUS:B<x>:I2C:ADDRess:VALue', sourceFile);
        if (valueRecord) {
          const addressValue = `"${(bus.triggerAddress & 0xff).toString(2).padStart(8, '0')}"`;
          out.push(
            materialize(
              valueRecord,
              `TRIGger:A:BUS:${bus.bus}:I2C:ADDRess:VALue`,
              addressValue,
              'TRIGGER'
            )
          );
        }
      }
    }
    if (wantsReadBack) {
      pushQuery('BUS:B<x>:TYPe', `BUS:${bus.bus}:TYPe`, 'BUS_DECODE', `bus_${bus.bus.toLowerCase()}_type`);
      if (bus.source1) {
        pushQuery('BUS:B<x>:I2C:CLOCk:SOUrce', `BUS:${bus.bus}:I2C:CLOCk:SOUrce`, 'BUS_DECODE', `i2c_clk_${bus.bus.toLowerCase()}`);
      }
      if (bus.source2) {
        pushQuery('BUS:B<x>:I2C:DATa:SOUrce', `BUS:${bus.bus}:I2C:DATa:SOUrce`, 'BUS_DECODE', `i2c_data_${bus.bus.toLowerCase()}`);
      }
      if (bus.triggerCondition || bus.triggerDirection || bus.triggerAddress !== undefined) {
        pushQuery('TRIGger:A:TYPe', 'TRIGger:A:TYPe', 'TRIGGER', 'trigger_type');
        pushQuery('TRIGger:{A|B}:BUS:SOUrce', 'TRIGger:A:BUS:SOUrce', 'TRIGGER', `trigger_bus_${bus.bus.toLowerCase()}`);
        pushQuery('TRIGger:{A|B}:BUS:B<x>:I2C:CONDition', `TRIGger:A:BUS:${bus.bus}:I2C:CONDition`, 'TRIGGER', `i2c_cond_${bus.bus.toLowerCase()}`);
        if (bus.triggerDirection) {
          pushQuery('TRIGger:{A|B}:BUS:B<x>:I2C:DATa:DIRection', `TRIGger:A:BUS:${bus.bus}:I2C:DATa:DIRection`, 'TRIGGER', `i2c_dir_${bus.bus.toLowerCase()}`);
        }
        if (bus.triggerAddress !== undefined) {
          pushQuery('TRIGger:{A|B}:BUS:B<x>:I2C:ADDRess:MODe', `TRIGger:A:BUS:${bus.bus}:I2C:ADDRess:MODe`, 'TRIGGER', `i2c_addr_mode_${bus.bus.toLowerCase()}`);
          pushQuery('TRIGger:{A|B}:BUS:B<x>:I2C:ADDRess:VALue', `TRIGger:A:BUS:${bus.bus}:I2C:ADDRess:VALue`, 'TRIGGER', `i2c_addr_value_${bus.bus.toLowerCase()}`);
        }
      }
    }
    pushBusDisplayLayout();
    pushBusDisplayState();
    return out;
  }

  if (bus.protocol === 'CAN' || bus.protocol === 'CANFD') {
    if (typeRecord) out.push(materialize(typeRecord, `BUS:${bus.bus}:TYPe`, 'CAN', 'BUS_DECODE'));
    if (bus.source1) {
      const sourceRecord = findExactHeader(index, 'BUS:B<x>:CAN:SOUrce', sourceFile);
      if (sourceRecord) {
        out.push(materialize(sourceRecord, `BUS:${bus.bus}:CAN:SOUrce`, bus.source1, 'BUS_DECODE'));
      }
    }
    if (bus.bitrateBps !== undefined) {
      const bitrateModeRecord = findExactHeader(index, 'BUS:B<x>:CAN:BITRate', sourceFile);
      if (bitrateModeRecord) {
        out.push(materialize(bitrateModeRecord, `BUS:${bus.bus}:CAN:BITRate`, 'CUSTom', 'BUS_DECODE'));
      }
      const bitrateValueRecord = findExactHeader(index, 'BUS:B<x>:CAN:BITRate:VALue', sourceFile);
      if (bitrateValueRecord) {
        out.push(
          materialize(
            bitrateValueRecord,
            `BUS:${bus.bus}:CAN:BITRate:VALue`,
            String(bus.bitrateBps),
            'BUS_DECODE'
          )
        );
      }
    }
    if (bus.standard) {
      const standardRecord = findExactHeader(index, 'BUS:B<x>:CAN:STANDard', sourceFile);
      if (standardRecord) {
        out.push(
          materialize(
            standardRecord,
            `BUS:${bus.bus}:CAN:STANDard`,
            bus.standard ?? 'FDISO',
            'BUS_DECODE'
          )
        );
      }
    }
    if (bus.dataPhaseBitrateBps !== undefined) {
      const dataRateRecord = findExactHeader(index, 'BUS:B<x>:CAN:FD:BITRate:CUSTom', sourceFile);
      if (dataRateRecord) {
        out.push(
          materialize(
            dataRateRecord,
            `BUS:${bus.bus}:CAN:FD:BITRate:CUSTom`,
            String(bus.dataPhaseBitrateBps),
            'BUS_DECODE'
          )
        );
      }
    }
    if (bus.triggerCondition) {
      pushBusTriggerType();
      pushBusTriggerSource();
      const conditionRecord = findExactHeader(index, 'TRIGger:A:BUS:CAN:CONDition', sourceFile);
      if (conditionRecord) {
        out.push(
          materialize(conditionRecord, 'TRIGger:A:BUS:CAN:CONDition', bus.triggerCondition, 'TRIGGER')
        );
      }
      if (bus.triggerCondition === 'FRAMEtype') {
        const frameTypeRecord = findExactHeader(index, 'TRIGger:A:BUS:CAN:FRAMEtype', sourceFile);
        if (frameTypeRecord) {
          out.push(
            materialize(frameTypeRecord, 'TRIGger:A:BUS:CAN:FRAMEtype', 'ERRor', 'TRIGGER')
          );
        }
      }
      if (bus.triggerCondition === 'IDentifier' && bus.searchIdentifier) {
        const idModeRecord = findExactHeader(index, 'TRIGger:A:BUS:CAN:IDentifier:MODe', sourceFile);
        if (idModeRecord) {
          out.push(
            materialize(idModeRecord, 'TRIGger:A:BUS:CAN:IDentifier:MODe', 'HEXadecimal', 'TRIGGER')
          );
        }
        const idValueRecord = findExactHeader(index, 'TRIGger:A:BUS:CAN:IDentifier:VALue', sourceFile);
        if (idValueRecord) {
          out.push(
            materialize(
              idValueRecord,
              'TRIGger:A:BUS:CAN:IDentifier:VALue',
              `"${bus.searchIdentifier}"`,
              'TRIGGER'
            )
          );
        }
      }
    }
    if (bus.searchIdentifier) {
      const frameTypeRecord = findExactHeader(index, 'SEARCH:SEARCH<x>:TRIGger:A:BUS:CAN:FRAMEtype', sourceFile);
      if (frameTypeRecord) {
        out.push(
          materialize(
            frameTypeRecord,
            'SEARCH:SEARCH1:TRIGger:A:BUS:CAN:FRAMEtype',
            'ID',
            'SEARCH'
          )
        );
      }
      const idModeRecord = findExactHeader(index, 'SEARCH:SEARCH<x>:TRIGger:A:BUS:CAN:IDentifier:MODe', sourceFile);
      if (idModeRecord) {
        out.push(
          materialize(
            idModeRecord,
            'SEARCH:SEARCH1:TRIGger:A:BUS:CAN:IDentifier:MODe',
            'HEXadecimal',
            'SEARCH'
          )
        );
      }
      const idValueRecord = findExactHeader(index, 'SEARCH:SEARCH<x>:TRIGger:A:BUS:CAN:IDentifier:VALue', sourceFile);
      if (idValueRecord) {
        out.push(
          materialize(
            idValueRecord,
            'SEARCH:SEARCH1:TRIGger:A:BUS:CAN:IDentifier:VALue',
            `"${bus.searchIdentifier}"`,
            'SEARCH'
          )
        );
      }
    }
    if (wantsReadBack) {
      pushQuery('BUS:B<x>:TYPe', `BUS:${bus.bus}:TYPe`, 'BUS_DECODE', `bus_${bus.bus.toLowerCase()}_type`);
      if (bus.source1) {
        pushQuery('BUS:B<x>:CAN:SOUrce', `BUS:${bus.bus}:CAN:SOUrce`, 'BUS_DECODE', `can_source_${bus.bus.toLowerCase()}`);
      }
      if (bus.bitrateBps !== undefined) {
        pushQuery('BUS:B<x>:CAN:BITRate:VALue', `BUS:${bus.bus}:CAN:BITRate:VALue`, 'BUS_DECODE', `can_bitrate_${bus.bus.toLowerCase()}`);
      }
      if (bus.standard) {
        pushQuery('BUS:B<x>:CAN:STANDard', `BUS:${bus.bus}:CAN:STANDard`, 'BUS_DECODE', `can_std_${bus.bus.toLowerCase()}`);
      }
      if (bus.dataPhaseBitrateBps !== undefined) {
        pushQuery('BUS:B<x>:CAN:FD:BITRate:CUSTom', `BUS:${bus.bus}:CAN:FD:BITRate:CUSTom`, 'BUS_DECODE', `can_fd_bitrate_${bus.bus.toLowerCase()}`);
      }
    }
    pushBusDisplayLayout();
    pushBusDisplayState();
    return out;
  }

  if (bus.protocol === 'SPI') {
    if (typeRecord) out.push(materialize(typeRecord, `BUS:${bus.bus}:TYPe`, 'SPI', 'BUS_DECODE'));
    if (bus.source1) {
      const clockSourceRecord = findExactHeader(index, 'BUS:B<x>:SPI:CLOCk:SOUrce', sourceFile);
      if (clockSourceRecord) {
        out.push(materialize(clockSourceRecord, `BUS:${bus.bus}:SPI:CLOCk:SOUrce`, bus.source1, 'BUS_DECODE'));
      }
    }
    if (bus.slope) {
      const polarityRecord = findExactHeader(index, 'BUS:B<x>:SPI:CLOCk:POLarity', sourceFile);
      if (polarityRecord) {
        out.push(
          materialize(
            polarityRecord,
            `BUS:${bus.bus}:SPI:CLOCk:POLarity`,
            bus.slope === 'RISe' ? 'LOW' : 'HIGH',
            'BUS_DECODE'
          )
        );
      }
    }
    if (bus.source2) {
      const mosiSourceRecord =
        findExactHeader(index, 'BUS:B<x>:SPI:MOSi:INPut', sourceFile) ??
        findExactHeader(index, 'BUS:B<x>:SPI:DATa:IN:SOUrce', sourceFile) ??
        findExactHeader(index, 'BUS:B<x>:SPI:DATa:SOUrce', sourceFile);
      if (mosiSourceRecord) {
        const sourceHeader = headersEquivalent(mosiSourceRecord.header, 'BUS:B<x>:SPI:MOSi:INPut')
          ? `BUS:${bus.bus}:SPI:MOSi:INPut`
          : headersEquivalent(mosiSourceRecord.header, 'BUS:B<x>:SPI:DATa:IN:SOUrce')
            ? `BUS:${bus.bus}:SPI:DATa:IN:SOUrce`
            : `BUS:${bus.bus}:SPI:DATa:SOUrce`;
        out.push(materialize(mosiSourceRecord, sourceHeader, bus.source2, 'BUS_DECODE'));
      }
    }
    if (bus.source3) {
      const misoSourceRecord =
        findExactHeader(index, 'BUS:B<x>:SPI:MISo:INPut', sourceFile) ??
        findExactHeader(index, 'BUS:B<x>:SPI:DATa:OUT:SOUrce', sourceFile);
      if (misoSourceRecord) {
        const sourceHeader = headersEquivalent(misoSourceRecord.header, 'BUS:B<x>:SPI:MISo:INPut')
          ? `BUS:${bus.bus}:SPI:MISo:INPut`
          : `BUS:${bus.bus}:SPI:DATa:OUT:SOUrce`;
        out.push(materialize(misoSourceRecord, sourceHeader, bus.source3, 'BUS_DECODE'));
      }
    }
    if (bus.chipSelect) {
      const selectSourceRecord = findExactHeader(index, 'BUS:B<x>:SPI:SELect:SOUrce', sourceFile);
      if (selectSourceRecord) {
        out.push(
          materialize(selectSourceRecord, `BUS:${bus.bus}:SPI:SELect:SOUrce`, bus.chipSelect, 'BUS_DECODE')
        );
      }
    }
    if (bus.selectPolarity) {
      const selectPolarityRecord = findExactHeader(index, 'BUS:B<x>:SPI:SELect:POLarity', sourceFile);
      if (selectPolarityRecord) {
        out.push(
          materialize(
            selectPolarityRecord,
            `BUS:${bus.bus}:SPI:SELect:POLarity`,
            bus.selectPolarity,
            'BUS_DECODE'
          )
        );
      }
    }
    if (bus.triggerCondition) {
      pushBusTriggerType();
      pushBusTriggerSource();
      const conditionRecord = findExactHeader(index, 'TRIGger:{A|B}:BUS:B<x>:SPI:CONDition', sourceFile);
      if (conditionRecord) {
        out.push(
          materialize(
            conditionRecord,
            `TRIGger:A:BUS:${bus.bus}:SPI:CONDition`,
            bus.triggerCondition,
            'TRIGGER'
          )
        );
      }
    }
    if (bus.chipSelect) {
      const triggerSsSourceRecord = findExactHeader(index, 'TRIGger:A:SPI:SS:SOUrce', sourceFile);
      if (triggerSsSourceRecord) {
        out.push(materialize(triggerSsSourceRecord, 'TRIGger:A:SPI:SS:SOUrce', bus.chipSelect, 'TRIGGER'));
      }
      const triggerSsActiveRecord = findExactHeader(index, 'TRIGger:A:SPI:SS:ACTIVE', sourceFile);
      if (triggerSsActiveRecord) {
        out.push(
          materialize(
            triggerSsActiveRecord,
            'TRIGger:A:SPI:SS:ACTIVE',
            bus.selectPolarity || 'LOW',
            'TRIGGER'
          )
        );
      }
    }
    if (wantsReadBack) {
      pushQuery('BUS:B<x>:TYPe', `BUS:${bus.bus}:TYPe`, 'BUS_DECODE', `bus_${bus.bus.toLowerCase()}_type`);
      if (bus.source1) {
        pushQuery('BUS:B<x>:SPI:CLOCk:SOUrce', `BUS:${bus.bus}:SPI:CLOCk:SOUrce`, 'BUS_DECODE', `spi_clk_${bus.bus.toLowerCase()}`);
      }
      if (bus.source2) {
        pushQuery('BUS:B<x>:SPI:DATa:IN:SOUrce', `BUS:${bus.bus}:SPI:DATa:IN:SOUrce`, 'BUS_DECODE', `spi_data_in_${bus.bus.toLowerCase()}`);
      }
      if (bus.source3) {
        pushQuery('BUS:B<x>:SPI:DATa:OUT:SOUrce', `BUS:${bus.bus}:SPI:DATa:OUT:SOUrce`, 'BUS_DECODE', `spi_data_out_${bus.bus.toLowerCase()}`);
      }
      if (bus.triggerCondition) {
        pushQuery('TRIGger:A:TYPe', 'TRIGger:A:TYPe', 'TRIGGER', 'trigger_type');
        pushQuery('TRIGger:{A|B}:BUS:SOUrce', 'TRIGger:A:BUS:SOUrce', 'TRIGGER', `trigger_bus_${bus.bus.toLowerCase()}`);
        pushQuery('TRIGger:{A|B}:BUS:B<x>:SPI:CONDition', `TRIGger:A:BUS:${bus.bus}:SPI:CONDition`, 'TRIGGER', `spi_cond_${bus.bus.toLowerCase()}`);
      }
    }
    pushBusDisplayLayout();
    pushBusDisplayState();
    return out;
  }

  if (bus.protocol === 'SENT') {
    if (typeRecord) out.push(materialize(typeRecord, `BUS:${bus.bus}:TYPe`, 'SENT', 'BUS_DECODE'));
    if (bus.source1) {
      const sourceRecord = findExactHeader(index, 'BUS:B<x>:SENT:SOUrce', sourceFile);
      if (sourceRecord) {
        out.push(materialize(sourceRecord, `BUS:${bus.bus}:SENT:SOUrce`, bus.source1, 'BUS_DECODE'));
      }
    }
    if (bus.thresholdVolts !== undefined) {
      const thresholdRecord = findExactHeader(index, 'BUS:B<x>:SENT:THReshold', sourceFile);
      if (thresholdRecord) {
        out.push(
          materialize(
            thresholdRecord,
            `BUS:${bus.bus}:SENT:THReshold`,
            formatValue(bus.thresholdVolts),
            'BUS_DECODE'
          )
        );
      }
    }
    if (bus.triggerCondition) {
      pushBusTriggerType();
      pushBusTriggerSource();
    }
    pushBusDisplayLayout();
    pushBusDisplayState();
    return out;
  }

  if (bus.protocol === 'ARINC' || bus.protocol === 'ARINC429') {
    if (typeRecord) out.push(materialize(typeRecord, `BUS:${bus.bus}:TYPe`, 'ARINC429A', 'BUS_DECODE'));
    if (bus.source1) {
      const sourceRecord = findExactHeader(index, 'BUS:B<x>:ARINC429A:SOUrce', sourceFile);
      if (sourceRecord) {
        out.push(materialize(sourceRecord, `BUS:${bus.bus}:ARINC429A:SOUrce`, bus.source1, 'BUS_DECODE'));
      }
    }
    pushBusDisplayLayout();
    pushBusDisplayState();
    return out;
  }

  if (bus.protocol === 'UART' || bus.protocol === 'RS232' || bus.protocol === 'RS232C') {
    if (typeRecord) out.push(materialize(typeRecord, `BUS:${bus.bus}:TYPe`, 'RS232C', 'BUS_DECODE'));
    if (bus.source1) {
      const sourceRecord = findExactHeader(index, 'BUS:B<x>:RS232C:SOUrce', sourceFile);
      if (sourceRecord) {
        out.push(materialize(sourceRecord, `BUS:${bus.bus}:RS232C:SOUrce`, bus.source1, 'BUS_DECODE'));
      }
    }
    if (bus.baudRate !== undefined) {
      const bitRateModeRecord = findExactHeader(index, 'BUS:B<x>:RS232C:BITRate', sourceFile);
      if (bitRateModeRecord) {
        out.push(materialize(bitRateModeRecord, `BUS:${bus.bus}:RS232C:BITRate`, 'CUSTOM', 'BUS_DECODE'));
      }
      const bitRateCustomRecord = findExactHeader(index, 'BUS:B<x>:RS232C:BITRate:CUSTom', sourceFile);
      if (bitRateCustomRecord) {
        out.push(
          materialize(
            bitRateCustomRecord,
            `BUS:${bus.bus}:RS232C:BITRate:CUSTom`,
            String(bus.baudRate),
            'BUS_DECODE'
          )
        );
      }
    }
    if (bus.dataBits !== undefined) {
      const dataBitsRecord = findExactHeader(index, 'BUS:B<x>:RS232C:DATaBits', sourceFile);
      if (dataBitsRecord) {
        out.push(
          materialize(dataBitsRecord, `BUS:${bus.bus}:RS232C:DATaBits`, String(bus.dataBits), 'BUS_DECODE')
        );
      }
    }
    if (bus.stopBits) {
      const stopBitsRecord = findExactHeader(index, 'BUS:B<x>:RS232C:STOPBits', sourceFile);
      if (stopBitsRecord) {
        out.push(
          materialize(stopBitsRecord, `BUS:${bus.bus}:RS232C:STOPBits`, bus.stopBits, 'BUS_DECODE')
        );
      }
    }
    if (bus.parity) {
      const parityRecord = findExactHeader(index, 'BUS:B<x>:RS232C:PARity', sourceFile);
      if (parityRecord) {
        out.push(materialize(parityRecord, `BUS:${bus.bus}:RS232C:PARity`, bus.parity, 'BUS_DECODE'));
      }
    }
    if (bus.triggerCondition) {
      pushBusTriggerType();
      pushBusTriggerSource();
      const conditionRecord = findExactHeader(index, 'TRIGger:{A|B}:BUS:B<x>:RS232C:CONDition', sourceFile);
      if (conditionRecord) {
        out.push(
          materialize(
            conditionRecord,
            `TRIGger:A:BUS:${bus.bus}:RS232C:CONDition`,
            bus.triggerCondition,
            'TRIGGER'
          )
        );
      }
    }
    if (wantsReadBack) {
      pushQuery('BUS:B<x>:TYPe', `BUS:${bus.bus}:TYPe`, 'BUS_DECODE', `bus_${bus.bus.toLowerCase()}_type`);
      if (bus.source1) {
        pushQuery('BUS:B<x>:RS232C:SOUrce', `BUS:${bus.bus}:RS232C:SOUrce`, 'BUS_DECODE', `uart_source_${bus.bus.toLowerCase()}`);
      }
      if (bus.baudRate !== undefined) {
        pushQuery('BUS:B<x>:RS232C:BITRate:CUSTom', `BUS:${bus.bus}:RS232C:BITRate:CUSTom`, 'BUS_DECODE', `uart_baud_${bus.bus.toLowerCase()}`);
      }
      if (bus.dataBits !== undefined) {
        pushQuery('BUS:B<x>:RS232C:DATaBits', `BUS:${bus.bus}:RS232C:DATaBits`, 'BUS_DECODE', `uart_data_bits_${bus.bus.toLowerCase()}`);
      }
      if (bus.stopBits) {
        pushQuery('BUS:B<x>:RS232C:STOPBits', `BUS:${bus.bus}:RS232C:STOPBits`, 'BUS_DECODE', `uart_stop_bits_${bus.bus.toLowerCase()}`);
      }
      if (bus.parity) {
        pushQuery('BUS:B<x>:RS232C:PARity', `BUS:${bus.bus}:RS232C:PARity`, 'BUS_DECODE', `uart_parity_${bus.bus.toLowerCase()}`);
      }
      if (bus.triggerCondition) {
        pushQuery('TRIGger:A:TYPe', 'TRIGger:A:TYPe', 'TRIGGER', 'trigger_type');
        pushQuery('TRIGger:{A|B}:BUS:SOUrce', 'TRIGger:A:BUS:SOUrce', 'TRIGGER', `trigger_bus_${bus.bus.toLowerCase()}`);
        pushQuery('TRIGger:{A|B}:BUS:B<x>:RS232C:CONDition', `TRIGger:A:BUS:${bus.bus}:RS232C:CONDition`, 'TRIGGER', `uart_cond_${bus.bus.toLowerCase()}`);
      }
    }
    pushBusDisplayLayout();
    pushBusDisplayState();
    return out;
  }

  if (bus.protocol === 'LIN') {
    if (typeRecord) out.push(materialize(typeRecord, `BUS:${bus.bus}:TYPe`, 'LIN', 'BUS_DECODE'));
    if (bus.source1) {
      const sourceRecord = findExactHeader(index, 'BUS:B<x>:LIN:SOUrce', sourceFile);
      if (sourceRecord) {
        out.push(materialize(sourceRecord, `BUS:${bus.bus}:LIN:SOUrce`, bus.source1, 'BUS_DECODE'));
      }
    }
    if (bus.baudRate !== undefined || bus.bitrateBps !== undefined) {
      const rateRecord = findExactHeader(index, 'BUS:B<x>:LIN:BITRate:CUSTom', sourceFile);
      if (rateRecord) {
        out.push(
          materialize(
            rateRecord,
            `BUS:${bus.bus}:LIN:BITRate:CUSTom`,
            String(bus.baudRate ?? bus.bitrateBps),
            'BUS_DECODE'
          )
        );
      }
    }
    if (bus.standard) {
      const standardRecord = findExactHeader(index, 'BUS:B<x>:LIN:STANdard', sourceFile);
      if (standardRecord) {
        out.push(materialize(standardRecord, `BUS:${bus.bus}:LIN:STANdard`, bus.standard, 'BUS_DECODE'));
      }
    }
    if (bus.triggerCondition) {
      pushBusTriggerType();
      pushBusTriggerSource();
      const conditionRecord = findExactHeader(index, 'TRIGger:{A|B}:BUS:B<x>:LIN:CONDition', sourceFile);
      if (conditionRecord) {
        out.push(
          materialize(
            conditionRecord,
            `TRIGger:A:BUS:${bus.bus}:LIN:CONDition`,
            bus.triggerCondition,
            'TRIGGER'
          )
        );
      }
    }
    if (wantsReadBack) {
      pushQuery('BUS:B<x>:TYPe', `BUS:${bus.bus}:TYPe`, 'BUS_DECODE', `bus_${bus.bus.toLowerCase()}_type`);
      if (bus.source1) {
        pushQuery('BUS:B<x>:LIN:SOUrce', `BUS:${bus.bus}:LIN:SOUrce`, 'BUS_DECODE', `lin_source_${bus.bus.toLowerCase()}`);
      }
      if (bus.baudRate !== undefined || bus.bitrateBps !== undefined) {
        pushQuery('BUS:B<x>:LIN:BITRate:CUSTom', `BUS:${bus.bus}:LIN:BITRate:CUSTom`, 'BUS_DECODE', `lin_baud_${bus.bus.toLowerCase()}`);
      }
      if (bus.standard) {
        pushQuery('BUS:B<x>:LIN:STANdard', `BUS:${bus.bus}:LIN:STANdard`, 'BUS_DECODE', `lin_std_${bus.bus.toLowerCase()}`);
      }
      if (bus.triggerCondition) {
        pushQuery('TRIGger:A:TYPe', 'TRIGger:A:TYPe', 'TRIGGER', 'trigger_type');
        pushQuery('TRIGger:{A|B}:BUS:SOUrce', 'TRIGger:A:BUS:SOUrce', 'TRIGGER', `trigger_bus_${bus.bus.toLowerCase()}`);
        pushQuery('TRIGger:{A|B}:BUS:B<x>:LIN:CONDition', `TRIGger:A:BUS:${bus.bus}:LIN:CONDition`, 'TRIGGER', `lin_cond_${bus.bus.toLowerCase()}`);
      }
    }
    pushBusDisplayLayout();
    pushBusDisplayState();
  }

  return out;
}

export async function resolveFastFrameCommands(
  index: CommandIndex,
  fastFrame: ParsedFastFrameIntent | undefined,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  if (!fastFrame) return [];

  const out: ResolvedCommand[] = [];
  if (fastFrame.state !== undefined) {
    const stateRecord = findExactHeader(index, 'HORizontal:FASTframe:STATE', sourceFile);
    if (stateRecord) {
      out.push(
        materialize(
          stateRecord,
          'HORizontal:FASTframe:STATE',
          fastFrame.state ? 'ON' : 'OFF',
          'FASTFRAME'
        )
      );
    }
  }

  if (fastFrame.count !== undefined) {
    const countRecord = findExactHeader(index, 'HORizontal:FASTframe:COUNt', sourceFile);
    if (countRecord) {
      out.push(
        materialize(
          countRecord,
          'HORizontal:FASTframe:COUNt',
          String(fastFrame.count),
          'FASTFRAME'
        )
      );
    }
  }

  return out;
}

export async function resolveCursorCommands(
  index: CommandIndex,
  cursor: ParsedCursorIntent | undefined,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  if (!cursor) return [];

  const out: ResolvedCommand[] = [];
  const isWaveformCursor = cursor.type === 'WAVEform';
  const functionRecord =
    findExactHeader(index, 'CURSor:FUNCtion', sourceFile) ??
    findExactHeader(index, 'DISplay:WAVEView<x>:CURSor:CURSor:FUNCtion', sourceFile);
  if (functionRecord && cursor.type) {
    const header = headersEquivalent(functionRecord.header, 'CURSor:FUNCtion')
      ? 'CURSor:FUNCtion'
      : 'DISplay:WAVEView1:CURSor:CURSor:FUNCtion';
    out.push(materialize(functionRecord, header, cursor.type, 'CURSOR'));
  }

  if (cursor.source) {
    const sourceRecord =
      (isWaveformCursor
        ? findExactHeader(index, 'CURSor:WAVEform:SOUrce1', sourceFile)
        : null) ??
      findExactHeader(index, 'CURSor:SOUrce1', sourceFile) ??
      findExactHeader(index, 'CURSor:SOUrce<x>', sourceFile);
    if (sourceRecord) {
      const sourceHeader = headersEquivalent(sourceRecord.header, 'CURSor:WAVEform:SOUrce1')
        ? 'CURSor:WAVEform:SOUrce1'
        : 'CURSor:SOUrce1';
      out.push(materialize(sourceRecord, sourceHeader, cursor.source, 'CURSOR'));
    } else {
      out.push(buildSyntheticWrite(`CURSor:SOUrce ${cursor.source}`, 'CURSOR'));
    }
  }

  if (!isWaveformCursor && cursor.units) {
    const unitsRecord = findExactHeader(index, 'CURSor:VBArs:UNIts', sourceFile);
    if (unitsRecord) {
      out.push(materialize(unitsRecord, 'CURSor:VBArs:UNIts', cursor.units, 'CURSOR'));
    }
  }

  if (cursor.positionASec !== undefined || cursor.positionBSec !== undefined) {
    const positionRecord =
      (isWaveformCursor
        ? findExactHeader(index, 'CURSor:WAVEform:POSition<x>', sourceFile)
        : null) ??
      findExactHeader(index, 'CURSor:VBArs:POSITION<x>', sourceFile) ??
      findExactHeader(index, 'CURSor:VBArs:POS<x>', sourceFile);

    if (positionRecord) {
      const useWaveformPosition = headersEquivalent(positionRecord.header, 'CURSor:WAVEform:POSition<x>');
      const baseHeader = useWaveformPosition
        ? 'CURSor:WAVEform:POSition'
        : headersEquivalent(positionRecord.header, 'CURSor:VBArs:POSITION<x>')
          ? 'CURSor:VBArs:POSITION'
          : 'CURSor:VBArs:POS';
      if (cursor.positionASec !== undefined) {
        out.push(
          materialize(
            positionRecord,
            `${baseHeader}1`,
            formatValue(cursor.positionASec),
            'CURSOR'
          )
        );
      }
      if (cursor.positionBSec !== undefined) {
        out.push(
          materialize(
            positionRecord,
            `${baseHeader}2`,
            formatValue(cursor.positionBSec),
            'CURSOR'
          )
        );
      }
    }
  }

  if (cursor.deltaTime) {
    const deltaTimeRecord =
      (isWaveformCursor
        ? findExactHeader(index, 'CURSor:WAVEform:HDELTA', sourceFile)
        : null) ??
      findExactHeader(index, 'CURSor:VBArs:DELTa', sourceFile);
    if (deltaTimeRecord) {
      const deltaHeader = headersEquivalent(deltaTimeRecord.header, 'CURSor:WAVEform:HDELTA')
        ? 'CURSor:WAVEform:HDELTA?'
        : 'CURSor:VBArs:DELTa?';
      out.push(
        materialize(
          deltaTimeRecord,
          deltaHeader,
          undefined,
          'CURSOR',
          'query',
          'cursor_delta_time'
        )
      );
    }
  }

  if (cursor.deltaVoltage) {
    const deltaVoltageRecord =
      (isWaveformCursor
        ? findExactHeader(index, 'CURSor:WAVEform:VDELTA', sourceFile)
        : null) ??
      findExactHeader(index, 'CURSor:HBArs:DELTa', sourceFile);
    if (deltaVoltageRecord) {
      const deltaHeader = headersEquivalent(deltaVoltageRecord.header, 'CURSor:WAVEform:VDELTA')
        ? 'CURSor:WAVEform:VDELTA?'
        : 'CURSor:HBArs:DELTa?';
      out.push(
        materialize(
          deltaVoltageRecord,
          deltaHeader,
          undefined,
          'CURSOR',
          'query',
          'cursor_delta_voltage'
        )
      );
    }
  }

  return out;
}

export async function resolveSearchCommands(
  index: CommandIndex,
  search: ParsedSearchIntent | undefined,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  if (!search) return [];

  const out: ResolvedCommand[] = [];
  if (search.showBusTable) {
    const tableRecord = findExactHeader(index, 'BUSTABle:ADDNew', sourceFile);
    if (tableRecord) {
      out.push(materialize(tableRecord, 'BUSTABle:ADDNew', '"TABLE1"', 'SEARCH'));
    }
  }

  const requestedCount = Math.max(1, Math.min(Number(search.count || 1), 4));
  const typeRecord = findExactHeader(index, 'SEARCH:SEARCH<x>:TYPe', sourceFile);
  const stateRecord = findExactHeader(index, 'SEARCH:SEARCH<x>:STATE', sourceFile);
  if (typeRecord && search.type && search.type !== 'UNKNOWN') {
    for (let searchIndex = 1; searchIndex <= requestedCount; searchIndex += 1) {
      out.push(
        materialize(
          typeRecord,
          `SEARCH:SEARCH${searchIndex}:TYPe`,
          search.type,
          'SEARCH'
        )
      );
    }
  }
  if (stateRecord) {
    for (let searchIndex = 1; searchIndex <= requestedCount; searchIndex += 1) {
      out.push(materialize(stateRecord, `SEARCH:SEARCH${searchIndex}:STATE`, '1', 'SEARCH'));
    }
  }

  if (search.type !== 'BUS' || !search.protocol) return out;

  const selectedRecord = findExactHeader(index, 'SEARCH:SELected', sourceFile);
  if (selectedRecord) {
    out.push(materialize(selectedRecord, 'SEARCH:SELected', search.selected || 'SEARCH1', 'SEARCH'));
  }

  const triggerTypeRecord = findExactHeader(index, 'SEARCH:SEARCH<x>:TRIGger:A:TYPe', sourceFile);
  if (triggerTypeRecord) {
    out.push(materialize(triggerTypeRecord, 'SEARCH:SEARCH1:TRIGger:A:TYPe', 'BUS', 'SEARCH'));
  }

  const busSourceRecord = findExactHeader(index, 'SEARCH:SEARCH<x>:TRIGger:A:BUS:SOUrce', sourceFile);
  if (busSourceRecord) {
    out.push(
      materialize(
        busSourceRecord,
        'SEARCH:SEARCH1:TRIGger:A:BUS:SOUrce',
        search.bus || 'B1',
        'SEARCH'
      )
    );
  }

  if (search.protocol === 'CAN' || search.protocol === 'CANFD') {
    const conditionRecord = findExactHeader(index, 'SEARCH:SEARCH<x>:TRIGger:A:BUS:CAN:CONDition', sourceFile);
    if (conditionRecord && search.condition) {
      out.push(
        materialize(
          conditionRecord,
          'SEARCH:SEARCH1:TRIGger:A:BUS:CAN:CONDition',
          search.condition,
          'SEARCH'
        )
      );
    }

    const frameTypeRecord = findExactHeader(index, 'SEARCH:SEARCH<x>:TRIGger:A:BUS:CAN:FRAMEtype', sourceFile);
    if (frameTypeRecord && search.frameType) {
      out.push(
        materialize(
          frameTypeRecord,
          'SEARCH:SEARCH1:TRIGger:A:BUS:CAN:FRAMEtype',
          search.frameType,
          'SEARCH'
        )
      );
    }

    const errTypeRecord = findExactHeader(index, 'SEARCH:SEARCH<x>:TRIGger:A:BUS:CAN:ERRType', sourceFile);
    if (errTypeRecord && search.errType) {
      out.push(
        materialize(
          errTypeRecord,
          'SEARCH:SEARCH1:TRIGger:A:BUS:CAN:ERRType',
          search.errType,
          'SEARCH'
        )
      );
    }
  }

  if (search.protocol === 'USB') {
    const complianceRecord = findExactHeader(
      index,
      'SEARCH:SEARCH<x>:TRIGger:A:BUS:USB:COMPliance',
      sourceFile
    );
    if (complianceRecord && search.condition) {
      out.push(
        materialize(
          complianceRecord,
          'SEARCH:SEARCH1:TRIGger:A:BUS:USB:COMPliance',
          search.condition,
          'SEARCH'
        )
      );
    }
  }

  if (search.queryFastFrameTimestamps) {
    const timestampAllRecord = findExactHeader(index, 'HORizontal:FASTframe:TIMEStamp:ALL', sourceFile);
    if (timestampAllRecord) {
      out.push(
        materialize(
          timestampAllRecord,
          'HORizontal:FASTframe:TIMEStamp:ALL?',
          undefined,
          'FASTFRAME',
          'query',
          'fastframe_timestamps'
        )
      );
    }
  }

  return out;
}

export async function resolveSaveCommands(
  save: ParsedSaveIntent | undefined,
  modelFamily: string
): Promise<ResolvedCommand[]> {
  if (!save) return [];

  const out: ResolvedCommand[] = [];
  const isDpo = /DPO|5K|7K|70K/i.test(modelFamily);

  if (save.screenshot) {
    out.push({
      group: 'SAVE',
      header: 'STEP:save_screenshot',
      concreteCommand: 'save_screenshot',
      commandType: 'set',
      stepType: 'save_screenshot',
      stepParams: {
        filename: 'screenshot.png',
        scopeType: isDpo ? 'legacy' : 'modern',
        method: 'pc_transfer',
      },
      verified: true,
      sourceFile: 'tekautomate',
      syntax: {},
      arguments: [],
      examples: [],
    });
  }

  if (!save.waveformSources?.length && /\b(save|export)\b/i.test(String(save.setupPath || save.sessionPath || ''))) {
    // no-op guard; explicit paths are already represented by setup/session steps below
  }

  const waveformExportMap = new Map<string, { source: string; format: 'bin' | 'csv' | 'wfm' | 'mat' }>();
  for (const entry of save.waveformExports || []) {
    waveformExportMap.set(entry.source.toUpperCase(), {
      source: entry.source.toUpperCase(),
      format: entry.format,
    });
  }
  for (const source of save.waveformSources || []) {
    const key = source.toUpperCase();
    if (!waveformExportMap.has(key)) {
      waveformExportMap.set(key, {
        source: key,
        format: save.format || 'bin',
      });
    }
  }
  const waveformExports = Array.from(waveformExportMap.values());

  for (const { source, format } of waveformExports) {
    const filename = save.fastFrameExport ? `fastframe_${source.toLowerCase()}.${format}` : `${source.toLowerCase()}_data.${format}`;
    out.push({
      group: 'SAVE',
      header: 'STEP:save_waveform',
      concreteCommand: `save_waveform ${source}`,
      commandType: 'set',
      stepType: 'save_waveform',
      stepParams: {
        source,
        filename,
        format,
      },
      verified: true,
      sourceFile: 'tekautomate',
      syntax: {},
      arguments: [],
      examples: [],
    });
  }

  // When waveform sources are specified, also add raw transfer setup commands
  if (waveformExports.length > 0) {
    out.push(buildSyntheticWrite(`DATa:SOUrce ${waveformExports[0].source}`, 'WAVEFORM_TRANSFER'));
    out.push(buildSyntheticWrite('DATa:ENCdg SRIBinary', 'WAVEFORM_TRANSFER'));
    out.push(buildSyntheticWrite('DATa:STARt 1', 'WAVEFORM_TRANSFER'));
    out.push(buildSyntheticWrite(`DATa:STOP ${waveformExports.length > 0 ? '10000' : '1000'}`, 'WAVEFORM_TRANSFER'));
  }

  if (save.setupPath) {
    out.push(buildSyntheticWrite(`SAVe:SETUp "${save.setupPath}"`, 'SAVE'));
  }

  if (save.sessionPath) {
    out.push(buildSyntheticWrite(`SAVe:SESsion "${save.sessionPath}"`, 'SAVE'));
  }

  return out;
}

export async function resolveRecallCommands(
  index: CommandIndex,
  recall: ParsedRecallIntent | undefined,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  if (!recall) return [];
  const out: ResolvedCommand[] = [];

  if (recall.sessionPath) {
    out.push({
      group: 'RECALL',
      header: 'STEP:recall',
      concreteCommand: `recall SESSION ${recall.sessionPath}`,
      commandType: 'set',
      stepType: 'recall',
      stepParams: {
        recallType: 'SESSION',
        filePath: recall.sessionPath,
      },
      verified: true,
      sourceFile: 'tekautomate',
      syntax: {},
      arguments: [],
      examples: [],
    });
  }

  if (recall.setupName) {
    out.push({
      group: 'RECALL',
      header: 'STEP:recall',
      concreteCommand: `recall SETUP ${recall.setupName}`,
      commandType: 'set',
      stepType: 'recall',
      stepParams: {
        recallType: 'SETUP',
        filePath: recall.setupName,
      },
      verified: true,
      sourceFile: 'tekautomate',
      syntax: {},
      arguments: [],
      examples: [],
    });
  }

  return out;
}

export async function resolveStatusCommands(
  index: CommandIndex,
  status: ParsedStatusIntent | undefined,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  if (!status) return [];
  const out: ResolvedCommand[] = [];

  if (status.esr) {
    const esrRecord = findExactHeader(index, '*ESR?', sourceFile);
    if (esrRecord) {
      out.push(materialize(esrRecord, '*ESR?', undefined, 'STATUS', 'query', 'status_esr'));
    } else {
      out.push(buildSyntheticQuery('*ESR?', 'STATUS', 'status_esr'));
    }
  }

  if (status.opc) {
    const opcRecord = findExactHeader(index, '*OPC?', sourceFile);
    if (opcRecord) {
      out.push(materialize(opcRecord, '*OPC?', undefined, 'STATUS', 'query', 'status_opc'));
    } else {
      out.push(buildSyntheticQuery('*OPC?', 'STATUS', 'status_opc'));
    }
  }

  return out;
}

export async function resolveSystemCommands(
  index: CommandIndex,
  reset: boolean | undefined,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  if (!reset) return [];

  const out: ResolvedCommand[] = [];
  const rstRecord = findExactHeader(index, '*RST', sourceFile);
  out.push(
    rstRecord
      ? materialize(rstRecord, '*RST', undefined, 'SYSTEM')
      : buildSyntheticWrite('*RST', 'SYSTEM')
  );

  const opcRecord = findExactHeader(index, '*OPC?', sourceFile);
  out.push(
    opcRecord
      ? materialize(opcRecord, '*OPC?', undefined, 'SYSTEM', 'query', 'opc_reset')
      : buildSyntheticQuery('*OPC?', 'SYSTEM', 'opc_reset')
  );

  const clsRecord = findExactHeader(index, '*CLS', sourceFile);
  out.push(
    clsRecord
      ? materialize(clsRecord, '*CLS', undefined, 'SYSTEM')
      : buildSyntheticWrite('*CLS', 'SYSTEM')
  );

  return out;
}

export async function resolveErrorCheckCommands(
  index: CommandIndex,
  errorCheck: boolean | undefined,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  if (!errorCheck) return [];
  const esrRecord = findExactHeader(index, '*ESR?', sourceFile);
  if (esrRecord) {
    return [materialize(esrRecord, '*ESR?', undefined, 'ERROR_CHECK', 'query', 'error_status')];
  }
  return [buildSyntheticQuery('*ESR?', 'ERROR_CHECK', 'error_status')];
}

export async function resolveIeee488Commands(
  index: CommandIndex,
  ieee: { idn?: boolean; optionsQuery?: boolean } | undefined,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  if (!ieee?.idn && !ieee?.optionsQuery) return [];
  const out: ResolvedCommand[] = [];
  if (ieee.idn) {
    const idnRecord = findExactHeader(index, '*IDN?', sourceFile);
    out.push(
      idnRecord
        ? materialize(idnRecord, '*IDN?', undefined, 'IEEE488', 'query', 'idn')
        : buildSyntheticQuery('*IDN?', 'IEEE488', 'idn')
    );
  }
  if (ieee.optionsQuery) {
    const optRecord = findExactHeader(index, '*OPT?', sourceFile);
    out.push(
      optRecord
        ? materialize(optRecord, '*OPT?', undefined, 'IEEE488', 'query', 'options')
        : buildSyntheticQuery('*OPT?', 'IEEE488', 'options')
    );
  }
  return out;
}

export async function resolveAfgCommands(
  index: CommandIndex,
  afg: ParsedAfgIntent | undefined,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  if (!afg) return [];

  const out: ResolvedCommand[] = [];
  const channel = String(afg.channel);

  if (afg.function) {
    const functionRecord = findExactHeader(index, `SOURce${channel}:FUNCtion`, sourceFile);
    if (functionRecord) {
      out.push(materialize(functionRecord, `SOURce${channel}:FUNCtion`, afg.function, 'AFG_SOURCE'));
    }
  }
  if (afg.frequencyHz !== undefined) {
    const frequencyRecord = findExactHeader(index, `SOURce${channel}:FREQuency:FIXed`, sourceFile);
    if (frequencyRecord) {
      out.push(
        materialize(
          frequencyRecord,
          `SOURce${channel}:FREQuency:FIXed`,
          String(afg.frequencyHz),
          'AFG_SOURCE'
        )
      );
    }
  }
  if (afg.sweepStartHz !== undefined && afg.sweepStopHz !== undefined) {
    const frequencyModeRecord = findExactHeader(index, `SOURce${channel}:FREQuency:MODE SWEep`, sourceFile);
    if (frequencyModeRecord) {
      out.push(materialize(frequencyModeRecord, `SOURce${channel}:FREQuency:MODE SWEep`, undefined, 'AFG_SOURCE'));
    }
    const startRecord = findExactHeader(index, `SOURce${channel}:FREQuency:STARt {freq}`, sourceFile);
    if (startRecord) {
      out.push(materialize(startRecord, `SOURce${channel}:FREQuency:STARt`, String(afg.sweepStartHz), 'AFG_SOURCE'));
    }
    const stopRecord = findExactHeader(index, `SOURce${channel}:FREQuency:STOP {freq}`, sourceFile);
    if (stopRecord) {
      out.push(materialize(stopRecord, `SOURce${channel}:FREQuency:STOP`, String(afg.sweepStopHz), 'AFG_SOURCE'));
    }
    const sweepTimeRecord = findExactHeader(index, `SOURce${channel}:SWEep:TIME {time}`, sourceFile);
    if (sweepTimeRecord) {
      out.push(materialize(sweepTimeRecord, `SOURce${channel}:SWEep:TIME`, String(afg.sweepTimeSec ?? 2), 'AFG_SOURCE'));
    }
    const spacingRecord = findExactHeader(index, `SOURce${channel}:SWEep:SPACing {spacing}`, sourceFile);
    if (spacingRecord) {
      out.push(materialize(spacingRecord, `SOURce${channel}:SWEep:SPACing`, 'LINear', 'AFG_SOURCE'));
    }
    const sweepModeRecord = findExactHeader(index, `SOURce${channel}:SWEep:MODE {mode}`, sourceFile);
    if (sweepModeRecord) {
      out.push(materialize(sweepModeRecord, `SOURce${channel}:SWEep:MODE`, 'AUTO', 'AFG_SOURCE'));
    }
    const outputRecord = findExactHeader(index, `OUTPut${channel}:STATe`, sourceFile);
    if (outputRecord) {
      out.push(materialize(outputRecord, `OUTPut${channel}:STATe`, 'ON', 'AFG_OUTPUT'));
    }
  }
  if (afg.amplitudeVpp !== undefined) {
    const amplitudeRecord = findExactHeader(
      index,
      `SOURce${channel}:VOLTage:LEVel:IMMediate:AMPLitude`,
      sourceFile
    );
    if (amplitudeRecord) {
      out.push(
        materialize(
          amplitudeRecord,
          `SOURce${channel}:VOLTage:LEVel:IMMediate:AMPLitude`,
          String(afg.amplitudeVpp),
          'AFG_SOURCE'
        )
      );
    }
  }
  if (afg.offsetVolts !== undefined) {
    const offsetRecord = findExactHeader(
      index,
      `SOURce${channel}:VOLTage:LEVel:IMMediate:OFFSet`,
      sourceFile
    );
    if (offsetRecord) {
      out.push(
        materialize(
          offsetRecord,
          `SOURce${channel}:VOLTage:LEVel:IMMediate:OFFSet`,
          String(afg.offsetVolts),
          'AFG_SOURCE'
        )
      );
    }
  }
  if (afg.dutyCyclePct !== undefined) {
    const dutyRecord = findExactHeader(index, `SOURce${channel}:PULSe:DCYCle`, sourceFile);
    if (dutyRecord) {
      out.push(
        materialize(dutyRecord, `SOURce${channel}:PULSe:DCYCle`, String(afg.dutyCyclePct), 'AFG_SOURCE')
      );
    }
  }
  if (afg.impedance) {
    const impedanceRecord = findExactHeader(index, `OUTPut${channel}:IMPedance`, sourceFile);
    if (impedanceRecord) {
      out.push(
        materialize(
          impedanceRecord,
          `OUTPut${channel}:IMPedance`,
          afg.impedance === 'HIGHZ' ? 'INF' : '50',
          'AFG_OUTPUT'
        )
      );
    }
  }
  if (afg.outputOn !== undefined) {
    const outputRecord = findExactHeader(index, `OUTPut${channel}:STATe`, sourceFile);
    if (outputRecord) {
      out.push(
        materialize(outputRecord, `OUTPut${channel}:STATe`, afg.outputOn ? 'ON' : 'OFF', 'AFG_OUTPUT')
      );
    }
  }
  if (afg.burstCycles !== undefined) {
    const cyclesRecord = findExactHeader(index, `SOURce${channel}:BURSt:NCYCles`, sourceFile);
    if (cyclesRecord) {
      out.push(
        materialize(
          cyclesRecord,
          `SOURce${channel}:BURSt:NCYCles`,
          String(afg.burstCycles),
          'AFG_BURST'
        )
      );
    }
  }
  if (afg.burstMode) {
    const burstModeRecord = findExactHeader(index, `SOURce${channel}:BURSt:MODE`, sourceFile);
    if (burstModeRecord) {
      out.push(materialize(burstModeRecord, `SOURce${channel}:BURSt:MODE`, afg.burstMode, 'AFG_BURST'));
    }
  }
  if (afg.amState) {
    const amStateRecord = findExactHeader(index, `SOURce${channel}:AM:STATe`, sourceFile);
    if (amStateRecord) {
      out.push(materialize(amStateRecord, `SOURce${channel}:AM:STATe`, 'ON', 'AFG_MODULATION'));
    }
  }
  if (afg.amFrequencyHz !== undefined) {
    const amFreqRecord = findExactHeader(index, `SOURce${channel}:AM:INTernal:FREQuency`, sourceFile);
    if (amFreqRecord) {
      out.push(
        materialize(
          amFreqRecord,
          `SOURce${channel}:AM:INTernal:FREQuency`,
          String(afg.amFrequencyHz),
          'AFG_MODULATION'
        )
      );
    }
  }
  if (afg.amDepthPct !== undefined) {
    const amDepthRecord = findExactHeader(index, `SOURce${channel}:AM:DEPTh`, sourceFile);
    if (amDepthRecord) {
      out.push(
        materialize(
          amDepthRecord,
          `SOURce${channel}:AM:DEPTh`,
          String(afg.amDepthPct),
          'AFG_MODULATION'
        )
      );
    }
  }

  return out;
}

export async function resolveAwgCommands(
  index: CommandIndex,
  awg: ParsedAwgIntent | undefined,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  if (!awg) return [];

  const out: ResolvedCommand[] = [];
  const channel = String(awg.channel);

  if (awg.waveformName) {
    const waveformRecord = findExactHeader(index, `SOURce${channel}:WAVeform`, sourceFile);
    if (waveformRecord) {
      out.push(materialize(waveformRecord, `SOURce${channel}:WAVeform`, `"${awg.waveformName}"`, 'AWG_WAVEFORM'));
    }
  }
  if (awg.amplitudeVpp !== undefined) {
    const amplitudeRecord = findExactHeader(
      index,
      `SOURce${channel}:VOLTage:LEVel:IMMediate:AMPLitude`,
      sourceFile
    );
    if (amplitudeRecord) {
      out.push(
        materialize(
          amplitudeRecord,
          `SOURce${channel}:VOLTage:LEVel:IMMediate:AMPLitude`,
          String(awg.amplitudeVpp),
          'AWG_WAVEFORM'
        )
      );
    }
  }
  if (awg.outputOn !== undefined) {
    const outputRecord = findExactHeader(index, `OUTPut${channel}:STATe`, sourceFile);
    if (outputRecord) {
      out.push(
        materialize(outputRecord, `OUTPut${channel}:STATe`, awg.outputOn ? 'ON' : 'OFF', 'AWG_OUTPUT')
      );
    }
  }
  if (awg.runMode) {
    const runModeRecord = findExactHeader(index, 'AWGControl:RMODe', sourceFile);
    if (runModeRecord) {
      out.push(materialize(runModeRecord, 'AWGControl:RMODe', awg.runMode, 'AWG_SEQUENCE'));
    }
  }

  return out;
}

export async function resolveSmuCommands(
  index: CommandIndex,
  smu: ParsedSmuIntent | undefined,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  if (!smu) return [];

  const out: ResolvedCommand[] = [];

  if (smu.sourceFunction) {
    const functionRecord = findExactHeader(index, ':SOURce:FUNCtion', sourceFile);
    if (functionRecord) {
      out.push(materialize(functionRecord, ':SOURce:FUNCtion', smu.sourceFunction, 'SMU_SOURCE'));
    }
  }
  if (smu.sourceLevel !== undefined) {
    const levelHeader =
      smu.sourceFunction === 'CURRent' ? ':SOURce:CURRent:LEVel' : ':SOURce:VOLTage:LEVel';
    const levelRecord = findExactHeader(index, levelHeader, sourceFile);
    if (levelRecord) {
      out.push(materialize(levelRecord, levelHeader, String(smu.sourceLevel), 'SMU_SOURCE'));
    }
  }
  if (smu.complianceLevel !== undefined) {
    const complianceHeader =
      smu.sourceFunction === 'CURRent'
        ? ':SENSe:VOLTage:PROTection'
        : ':SENSe:CURRent:PROTection';
    const complianceRecord = findExactHeader(index, complianceHeader, sourceFile);
    if (complianceRecord) {
      out.push(
        materialize(complianceRecord, complianceHeader, String(smu.complianceLevel), 'SMU_SOURCE')
      );
    }
  }
  if (smu.outputOn !== undefined) {
    const outputRecord = findExactHeader(index, ':OUTPut:STATe', sourceFile);
    if (outputRecord) {
      out.push(materialize(outputRecord, ':OUTPut:STATe', smu.outputOn ? 'ON' : 'OFF', 'SMU_OUTPUT'));
    }
  }
  if (smu.measureFunction) {
    const senseRecord = findExactHeader(index, ':SENSe:FUNCtion', sourceFile);
    if (senseRecord) {
      out.push(
        materialize(senseRecord, ':SENSe:FUNCtion', `"${smu.measureFunction}"`, 'SMU_MEASURE')
      );
    }
    const measureHeader =
      smu.measureFunction === 'CURRent'
        ? ':MEASure:CURRent:DC'
        : smu.measureFunction === 'VOLTage'
          ? ':MEASure:VOLTage:DC'
          : smu.measureFunction === 'RESistance'
            ? ':MEASure:RESistance'
            : smu.measureFunction === 'POWer'
              ? ':MEASure:POWer'
              : undefined;
    if (measureHeader) {
      const measureRecord = findExactHeader(index, measureHeader, sourceFile);
      if (measureRecord) {
        out.push(
          materialize(
            measureRecord,
            `${measureHeader}?`,
            undefined,
            'SMU_MEASURE',
            'query',
            `smu_${smu.measureFunction.toLowerCase()}`
          )
        );
      }
    }
  }
  if (smu.sweepStart !== undefined) {
    const startRecord = findExactHeader(index, ':SOURce:VOLTage:STARt', sourceFile);
    if (startRecord) {
      out.push(materialize(startRecord, ':SOURce:VOLTage:STARt', String(smu.sweepStart), 'SMU_SWEEP'));
    }
  }
  if (smu.sweepStop !== undefined) {
    const stopRecord = findExactHeader(index, ':SOURce:VOLTage:STOP', sourceFile);
    if (stopRecord) {
      out.push(materialize(stopRecord, ':SOURce:VOLTage:STOP', String(smu.sweepStop), 'SMU_SWEEP'));
    }
  }
  if (smu.sweepPoints !== undefined) {
    const pointsRecord = findExactHeader(index, ':SOURce:SWEep:POINts', sourceFile);
    if (pointsRecord) {
      out.push(materialize(pointsRecord, ':SOURce:SWEep:POINts', String(smu.sweepPoints), 'SMU_SWEEP'));
    }
  }
  if (smu.traceReadback) {
    const clearRecord = findExactHeader(index, ':TRACe:CLEar', sourceFile);
    if (clearRecord) {
      out.push(materialize(clearRecord, ':TRACe:CLEar', undefined, 'SMU_BUFFER'));
    }
    const traceRecord = findExactHeader(index, ':TRACe:DATA? {start},{count}', sourceFile);
    if (traceRecord) {
      out.push(
        materialize(
          traceRecord,
          ':TRACe:DATA? 1,100',
          undefined,
          'SMU_BUFFER',
          'query',
          'smu_trace_data'
        )
      );
    }
  }
  if ((smu.sourceLevel !== undefined || smu.sweepStart !== undefined) && smu.outputOn === undefined) {
    const outputRecord = findExactHeader(index, ':OUTPut:STATe', sourceFile);
    if (outputRecord) {
      out.push(materialize(outputRecord, ':OUTPut:STATe', 'ON', 'SMU_OUTPUT'));
    }
  }

  return out;
}

export async function resolveSpectrumViewCommands(
  index: CommandIndex,
  spectrumView: ParsedSpectrumViewIntent | undefined,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  if (!spectrumView) return [];

  const out: ResolvedCommand[] = [];
  const stateRecord = findExactHeader(index, 'CH<x>:SV:STATE', sourceFile);
  if (stateRecord) {
    out.push(materialize(stateRecord, `${spectrumView.channel}:SV:STATE`, 'ON', 'SPECTRUM'));
  }
  if (spectrumView.centerFreqHz !== undefined) {
    const centerRecord = findExactHeader(index, 'CH<x>:SV:CENTERFrequency', sourceFile);
    if (centerRecord) {
      out.push(
        materialize(
          centerRecord,
          `${spectrumView.channel}:SV:CENTERFrequency`,
          formatValue(spectrumView.centerFreqHz),
          'SPECTRUM'
        )
      );
    }
  }
  if (spectrumView.spanHz !== undefined) {
    const spanRecord =
      findExactHeader(index, 'SV:SPAN', sourceFile) ??
      findExactHeader(index, 'CH<x>:SV:SPAN', sourceFile) ??
      findExactHeader(index, 'CH<x>:SV:SPANABovebw', sourceFile);
    if (spanRecord && headersEquivalent(spanRecord.header, 'SV:SPAN')) {
      out.push(
        materialize(
          spanRecord,
          'SV:SPAN',
          formatValue(spectrumView.spanHz),
          'SPECTRUM'
        )
      );
    } else if (spanRecord && headersEquivalent(spanRecord.header, 'CH<x>:SV:SPAN')) {
      out.push(
        materialize(
          spanRecord,
          `${spectrumView.channel}:SV:SPAN`,
          formatValue(spectrumView.spanHz),
          'SPECTRUM'
        )
      );
    }
  }

  return out;
}

export function parseChannelIntent(message: string): ParsedChannelIntent[] {
  const channels = new Map<string, ParsedChannelIntent>();
  const clauses = extractChannelClauses(message);

  const channelSegmentRegex = /\b(CH[1-8])\b([\s\S]*?)(?=(?:\bCH[1-8]\b)|$)/gi;
  for (const match of Array.from(message.matchAll(channelSegmentRegex))) {
    const channel = String(match[1] || '').toUpperCase();
    const segment = `${channel}${String(match[2] || '')}`;
    if (!channel) continue;
    if (!/\b(set|configure|make|put|to|scale|offset|ac|dc|50ohm|1mohm|termination|bandwidth|label)\b/i.test(segment)) {
      continue;
    }

    const existing = channels.get(channel) ?? { channel };
    const offsetVolts = parseOffsetInVolts(segment);
    const scaleVolts =
      parseScaleVolts(segment) ??
      inferScaleFromChannelClause(segment, offsetVolts) ??
      inferScaleFromAnalogContext(segment);
    const couplingMatch = segment.match(COUPLING_REGEX);
    const terminationMatch = segment.match(TERMINATION_REGEX);
    const bandwidthHz = parseBandwidthHz(segment);
    const labelMatch = segment.match(/\blabel\s+(?:channel|ch)\s*[1-8]\s+(?:as|to)\s+["']?([^"']+?)["']?$/i);

    if (scaleVolts !== undefined && existing.scaleVolts === undefined) existing.scaleVolts = scaleVolts;
    if (offsetVolts !== undefined && existing.offsetVolts === undefined) existing.offsetVolts = offsetVolts;
    if (couplingMatch && existing.coupling === undefined) {
      existing.coupling = couplingMatch[0].toUpperCase() as ParsedChannelIntent['coupling'];
    }
    if (terminationMatch && existing.terminationOhms === undefined) {
      existing.terminationOhms = parseTerminationOhms(terminationMatch[0]);
    }
    if (bandwidthHz !== undefined && existing.bandwidthHz === undefined) {
      existing.bandwidthHz = bandwidthHz;
    }
    if (labelMatch && existing.label === undefined) {
      existing.label = labelMatch[1].trim();
    }
    channels.set(channel, existing);
  }

  if (/\bturn\s+on\b[^.!?\n\r]*\b(?:channel|ch)\s*[1-4](?:[^.!?\n\r]*\b(?:and|,)\b[^.!?\n\r]*)?(?:channel|ch)\s*[1-4]/i.test(message)) {
    for (const channel of extractChannels(message)) {
      const existing = channels.get(channel) ?? { channel };
      existing.displayState = true;
      channels.set(channel, existing);
    }
  }

  for (const clause of clauses) {
    const configClause = clause
      .split(/\b(?:configure|decode|bus|trigger|measure(?:ment)?|add|query|save|screenshot|waveform|search)\b/i)[0]
      ?.trim();
    if (!configClause || isMeasurementClause(configClause)) continue;
    if (
      /\b(rising|falling|slope|normal|auto|holdoff|level)\b/i.test(configClause) &&
      !/\b(scale|offset|ac|dc|50ohm|50|1mohm|1m)\b/i.test(configClause)
    ) {
      continue;
    }
    if (!CHANNEL_REGEX.test(configClause)) continue;
    CHANNEL_REGEX.lastIndex = 0;

    const clauseChannels = extractChannels(configClause);
    const offsetVolts = parseOffsetInVolts(configClause);
    const scaleVolts =
      parseScaleVolts(configClause) ??
      inferScaleFromChannelClause(configClause, offsetVolts) ??
      inferScaleFromAnalogContext(configClause);
    const couplingMatch = configClause.match(COUPLING_REGEX);
    const terminationMatch = configClause.match(TERMINATION_REGEX);
    const bandwidthHz = parseBandwidthHz(configClause);
    const labelMatch = configClause.match(/\blabel\s+(?:channel|ch)\s*[1-4]\s+(?:as|to)\s+["']?([^"']+?)["']?$/i);
    const displayState =
      /\bturn\s+on\b[^.!?\n\r]*(?:channel|ch)\s*[1-4]\b|\b(turn|switch|set|make)\s+(?:channel|ch)\s*[1-4]\s+on\b|\bshow\s+(?:channel|ch)\s*[1-4]\b|\bunhide\s+(?:channel|ch)\s*[1-4]\b/i.test(configClause)
        ? true
        : /\bturn\s+off\b[^.!?\n\r]*(?:channel|ch)\s*[1-4]\b|\b(turn|switch|set|make)\s+(?:channel|ch)\s*[1-4]\s+off\b|\bhide\s+(?:channel|ch)\s*[1-4]\b|\bdisable\s+(?:channel|ch)\s*[1-4]\b/i.test(configClause)
          ? false
          : undefined;

    for (const channel of clauseChannels) {
      const existing = channels.get(channel) ?? { channel };
      if (scaleVolts !== undefined && existing.scaleVolts === undefined) existing.scaleVolts = scaleVolts;
      if (offsetVolts !== undefined && existing.offsetVolts === undefined) existing.offsetVolts = offsetVolts;
      if (couplingMatch && existing.coupling === undefined) {
        existing.coupling = couplingMatch[0].toUpperCase() as ParsedChannelIntent['coupling'];
      }
      if (terminationMatch && existing.terminationOhms === undefined) {
        existing.terminationOhms = parseTerminationOhms(terminationMatch[0]);
      }
      if (bandwidthHz !== undefined && existing.bandwidthHz === undefined) {
        existing.bandwidthHz = bandwidthHz;
      }
      if (labelMatch && existing.label === undefined) {
        existing.label = labelMatch[1].trim();
      }
      if (displayState !== undefined && existing.displayState === undefined) {
        existing.displayState = displayState;
      }
      channels.set(channel, existing);
    }
  }

  const normalizedChannels = Array.from(channels.values());
  if (/\bboth\s+dc\s+coupling\b/i.test(message) && normalizedChannels.length >= 2) {
    for (const channel of normalizedChannels) channel.coupling = channel.coupling ?? 'DC';
  }
  if (/\bboth\s+ac\s+coupling\b/i.test(message) && normalizedChannels.length >= 2) {
    for (const channel of normalizedChannels) channel.coupling = channel.coupling ?? 'AC';
  }

  return normalizedChannels.sort((left, right) =>
    left.channel.localeCompare(right.channel)
  );
}

export function parseTriggerIntent(
  message: string,
  aliasMaps: IntentAliasMaps
): ParsedTriggerIntent | undefined {
  const clause = findTriggerClause(message, false);
  return clause ? parseTriggerClause(clause, aliasMaps) : undefined;
}

export function parseSecondaryTriggerIntent(
  message: string,
  aliasMaps: IntentAliasMaps
): ParsedTriggerIntent | undefined {
  const clause = findTriggerClause(message, true);
  if (!clause) return undefined;
  const parsed = parseTriggerClause(clause, aliasMaps) ?? {};
  const delayMatch =
    message.match(/\bb\s*trigger\b[^.!?\n\r]*?\btime\s+delay\s+(\d+(?:\.\d+)?)\s*(ps|ns|us|ms|s|picoseconds?|nanoseconds?|microseconds?|milliseconds?|seconds?)\b/i) ||
    message.match(/\bb\s*trigger\b[^.!?\n\r]*?\bdelay\s+(\d+(?:\.\d+)?)\s*(ps|ns|us|ms|s|picoseconds?|nanoseconds?|microseconds?|milliseconds?|seconds?)\b/i) ||
    clause.match(/\btime\s+delay\s+(\d+(?:\.\d+)?)\s*(ps|ns|us|ms|s|picoseconds?|nanoseconds?|microseconds?|milliseconds?|seconds?)\b/i) ||
    clause.match(/\bdelay\s+(\d+(?:\.\d+)?)\s*(ps|ns|us|ms|s|picoseconds?|nanoseconds?|microseconds?|milliseconds?|seconds?)\b/i);
  if (delayMatch) {
    parsed.sequenceBy = 'TIMe';
    parsed.delaySeconds = toSeconds(delayMatch[1], delayMatch[2]);
  }
  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

export function parseMeasurementIntent(
  message: string,
  context: ParseContext,
  aliasMaps: IntentAliasMaps
): ParsedMeasurementIntent[] {
  const clauses = extractMeasurementClauses(message);
  const measurements: ParsedMeasurementIntent[] = [];
  const seen = new Set<string>();
  const mathSourceMatch = message.match(/\b(MATH\d+)\b/i);
  const explicitMessageChannels = Array.from(new Set(extractChannels(message)));
  const defaultSource =
    mathSourceMatch?.[1]?.toUpperCase() ||
    (explicitMessageChannels.length === 1 ? explicitMessageChannels[0] : undefined) ||
    context.channels[0]?.channel;

  for (const clause of clauses) {
    if (isBusDecodeClause(clause) && !/\b(add|measure|measurement|query)\b/i.test(clause)) {
      continue;
    }
    if (/\b(?:save|saved|recall|load)\b[^.!?\n\r]*\bsetup\b/i.test(clause)) continue;
    if (/\bhorizontal\s+setup\b/i.test(clause) || /\bhorizontal\s+settings\b/i.test(clause)) continue;
    if (/\btrigger\b/i.test(clause) && /\bhalf\s+the\s+waveform\s+height\b/i.test(clause)) continue;
    if (/\btrigger\b/i.test(clause) && /\btime\s+delay\b/i.test(clause)) continue;
    if (/\btrigger\b/i.test(clause) && /\b(?:logic|pattern)\b/i.test(clause)) continue;
    const clauseTypes = filterMeasurementTypes(clause, matchAliasValues(clause, aliasMaps.measurementAliases));
    const clauseSources = parseMeasurementSources(clause, defaultSource);
    const segments = splitMeasurementSegments(clause);
    let inheritedTypes = clauseTypes;

    for (const segment of segments) {
      const segmentTypes = filterMeasurementTypes(
        segment,
        matchAliasValues(segment, aliasMaps.measurementAliases)
      );
      const effectiveTypes =
        segmentTypes.length > 0
          ? segmentTypes
          : inheritedTypes.length > 0 && /\b(on|from|to)\s+CH[1-4]\b/i.test(segment)
            ? inheritedTypes
            : [];
      if (/\bnoise\b/i.test(segment)) {
        const rmsIndex = effectiveTypes.indexOf('RMS');
        if (rmsIndex >= 0) effectiveTypes[rmsIndex] = 'RMSNOISE';
      }
      if (!isMeasurementClause(segment) && effectiveTypes.length === 0) continue;
      if (effectiveTypes.length > 0) inheritedTypes = effectiveTypes;

      let { source1, source2 } = parseMeasurementSources(segment, defaultSource);
      if (!source1 && clauseSources.source1) source1 = clauseSources.source1;
      if (!source2 && clauseSources.source2) source2 = clauseSources.source2;
      if (!source2 && (effectiveTypes.includes('SKEW') || effectiveTypes.includes('DELAY'))) {
        const measurementChannels = extractChannels(segment);
        if (measurementChannels.length >= 2) {
          source1 = measurementChannels[0];
          source2 = measurementChannels[1];
        } else if (context.channels.length >= 2) {
          source1 = context.channels[0]?.channel;
          source2 = context.channels[1]?.channel;
        }
      }
      for (const measurementType of effectiveTypes) {
        const key = `${measurementType}:${source1 ?? ''}:${source2 ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        measurements.push({
          type: measurementType as ParsedMeasurementIntent['type'],
          source1,
          source2,
        });
      }
    }
  }

  const lowerMessage = message.toLowerCase();
  const addSyntheticMeasurement = (
    type: ParsedMeasurementIntent['type'],
    source1?: string,
    source2?: string
  ) => {
    const key = `${type}:${source1 ?? ''}:${source2 ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    measurements.push({ type, source1, source2 });
  };

  if (/\bripple\b/i.test(lowerMessage)) {
    addSyntheticMeasurement('PK2PK', defaultSource);
  }
  if (/\bnoise\b/i.test(lowerMessage) && /\brms\b/i.test(lowerMessage)) {
    addSyntheticMeasurement('RMSNOISE', defaultSource);
  }
  if (/\beye\s+height\b/i.test(lowerMessage)) {
    addSyntheticMeasurement('EYEHEIGHT', defaultSource);
  }
  if (/\beye\s+width\b/i.test(lowerMessage)) {
    addSyntheticMeasurement('EYEWIDTH', defaultSource);
  }
  if (/\b(?:vpk|vmax|positive peak)\b/i.test(lowerMessage)) {
    addSyntheticMeasurement('HIGH', defaultSource);
  }
  if (/\bfrequency\s+measurement\b|\bmeasure\s+frequency\b/i.test(lowerMessage)) {
    addSyntheticMeasurement('FREQUENCY', context.channels[0]?.channel);
  }
  if (/\b(adc\s+clock\s+jitter|clock\s+jitter|too\s+much\s+jitter|jitter)\b/i.test(lowerMessage)) {
    addSyntheticMeasurement('JITTERSUMMARY', context.channels[0]?.channel);
  }
  if (/\btime\s+interval\s+error\b|\btie\b/i.test(lowerMessage)) {
    addSyntheticMeasurement('TIE', context.channels[0]?.channel);
  }
  if (/\bcompare\s+clock\s+arrival\b|\bstarts?\s+before\b|\barrival\b/i.test(lowerMessage)) {
    const channels = context.channels.map((channel) => channel.channel);
    if (channels.length >= 2) addSyntheticMeasurement('DELAY', channels[0], channels[1]);
  }

  return measurements;
}

export function parseBusIntents(message: string, aliasMaps: IntentAliasMaps): ParsedBusIntent[] {
  const intents: ParsedBusIntent[] = [];
  const busAnchors = Array.from(message.matchAll(/\bon\s+(B[1-4])\b/gi));

  if (busAnchors.length > 0) {
    for (let index = 0; index < busAnchors.length; index += 1) {
      const anchor = busAnchors[index];
      // Include a short prefix before "on Bx" so protocol tokens like
      // "SPI on B3" are part of the same parse segment.
      const segmentStart = Math.max(0, (anchor.index ?? 0) - 48);
      const segmentEnd = busAnchors[index + 1]?.index ?? message.length;
      const segment = message.slice(segmentStart, segmentEnd);
      const forcedBusSlot = anchor[1].toUpperCase();
      const parsed = parseBusIntent(segment, aliasMaps, forcedBusSlot);
      if (parsed) intents.push(parsed);
    }
  } else {
    const parsed = parseBusIntent(message, aliasMaps);
    if (parsed) intents.push(parsed);
  }

  const deduped = new Map<string, ParsedBusIntent>();
  for (const intent of intents) {
    const key = [
      intent.bus || '',
      intent.protocol,
      intent.source1 || '',
      intent.source2 || '',
      intent.source3 || '',
      intent.chipSelect || '',
    ].join('|');
    if (!deduped.has(key)) deduped.set(key, intent);
  }
  return Array.from(deduped.values());
}

export function parseBusIntent(
  message: string,
  aliasMaps: IntentAliasMaps,
  forcedBusSlot?: string,
  forcedProtocol?: ParsedBusIntent['protocol']
): ParsedBusIntent | undefined {
  const protocol = forcedProtocol || matchFirstAliasValue(message, aliasMaps.busProtocolAliases);
  if (!protocol) return undefined;

  const bus: ParsedBusIntent = {
    protocol: protocol as ParsedBusIntent['protocol'],
  };

  const busSlotMatch = message.match(BUS_SLOT_REGEX);
  if (forcedBusSlot) bus.bus = forcedBusSlot.toUpperCase();
  else if (busSlotMatch) bus.bus = busSlotMatch[1].toUpperCase();
  else bus.bus = 'B1';

  const clockMatch = message.match(/\bclock\s+(CH[1-4])\b/i);
  const reverseClockMatch = message.match(/\b(CH[1-4])\s+clock\b/i);
  const spiLeadingClockMatch = message.match(/\bspi\s+(CH[1-4])\s+clock\b/i);
  const pairedClockDataMatch = message.match(/\b(CH[1-4])\s+clock\s+(CH[1-4])\s+data\b/i);
  if (pairedClockDataMatch) {
    bus.clockSource = pairedClockDataMatch[1].toUpperCase();
    bus.source1 = bus.clockSource;
    bus.dataSource = pairedClockDataMatch[2].toUpperCase();
    bus.source2 = bus.dataSource;
  } else if (clockMatch) {
    bus.clockSource = clockMatch[1].toUpperCase();
    bus.source1 = bus.clockSource;
  } else if (reverseClockMatch) {
    bus.clockSource = reverseClockMatch[1].toUpperCase();
    bus.source1 = bus.clockSource;
  } else if (spiLeadingClockMatch) {
    bus.clockSource = spiLeadingClockMatch[1].toUpperCase();
    bus.source1 = bus.clockSource;
  }

  const dataMatch = message.match(/\bdata\s+(CH[1-4])\b/i);
  const reverseDataMatch = message.match(/\b(CH[1-4])\s+data\b/i);
  if (dataMatch) {
    bus.dataSource = dataMatch[1].toUpperCase();
    bus.source2 = bus.dataSource;
  } else if (reverseDataMatch) {
    bus.dataSource = reverseDataMatch[1].toUpperCase();
    bus.source2 = bus.dataSource;
  }

  const mosiMatch = message.match(/\bmosi(?:\s+(?:is|on|source))?\s*(CH[1-4])\b/i);
  if (mosiMatch) bus.source2 = mosiMatch[1].toUpperCase();
  const misoMatch = message.match(/\bmiso(?:\s+(?:is|on|source))?\s*(CH[1-4])\b/i);
  if (misoMatch) bus.source3 = misoMatch[1].toUpperCase();

  const sourceMatch = message.match(/\bsource\s+(CH[1-4])\b/i);
  if (sourceMatch && (bus.protocol === 'UART' || bus.protocol === 'RS232' || bus.protocol === 'RS232C')) {
    bus.source1 = sourceMatch[1].toUpperCase();
  }

  if (!bus.source1) {
    const genericSourceMatches = extractChannels(message);
    if (genericSourceMatches.length > 0) {
      bus.source1 = genericSourceMatches[0];
      bus.source2 = genericSourceMatches[1];
    }
  }

  if (
    bus.protocol === 'SPI' &&
    (!bus.source1 || !bus.source2) &&
    /\b(set up the channels|decode the bytes|spi transaction|chip select)\b/i.test(message)
  ) {
    bus.source1 = bus.source1 || 'CH1';
    bus.source2 = bus.source2 || 'CH2';
    bus.chipSelect = bus.chipSelect || 'CH3';
    if (!bus.selectPolarity) bus.selectPolarity = 'LOW';
  }

  const bitrateMatch = message.match(BITRATE_REGEX);
  if (bitrateMatch) bus.bitrateBps = toBitrate(bitrateMatch[1], bitrateMatch[2]);
  if (bus.protocol === 'I2C' && bus.bitrateBps === undefined) {
    const i2cRateMatch = message.match(/(\d+(?:\.\d+)?)\s*(khz|mhz)\b/i);
    if (i2cRateMatch) bus.bitrateBps = toHz(i2cRateMatch[1], i2cRateMatch[2]);
  }

  const dataPhaseMatch = message.match(/data\s+phase\s+(\d+(?:\.\d+)?)\s*(kbps|mbps)\b/i);
  if (dataPhaseMatch) {
    bus.dataPhaseBitrateBps = toBitrate(dataPhaseMatch[1], dataPhaseMatch[2]);
  }

  const explicitNonIso = /\b(?:non[\s-]?iso|fdnoniso)\b/i.test(message);
  const explicitIso = /\biso\s+standard\b|\biso\b/i.test(message) && !explicitNonIso;
  if (/\bcan\s*fd\b/i.test(message)) {
    if (explicitNonIso) bus.standard = 'FDNONISO';
    else if (explicitIso) bus.standard = 'FDISO';
  } else if (explicitIso) {
    bus.standard = 'ISO';
  }

  const sharedThresholdMatch = message.match(
    /\b(?:at\s+)?(-?\d+(?:\.\d+)?)\s*(mV|V)\s+thresholds?\b/i
  );
  const clockThresholdMatch =
    message.match(/\bclock\b[^.]*?\bat\s+(-?\d+(?:\.\d+)?)\s*(mV|V)\s+threshold/i) ||
    message.match(/\bclock\b[^.]*?(-?\d+(?:\.\d+)?)\s*(mV|V)\s+threshold/i);
  const dataThresholdMatch =
    message.match(/\bdata\b[^.]*?\bat\s+(-?\d+(?:\.\d+)?)\s*(mV|V)\s+threshold/i) ||
    message.match(/\bdata\b[^.]*?(-?\d+(?:\.\d+)?)\s*(mV|V)\s+threshold/i);
  if (bus.protocol === 'I2C') {
    if (clockThresholdMatch) {
      bus.clockThresholdVolts = toVolts(clockThresholdMatch[1], clockThresholdMatch[2]);
    }
    if (dataThresholdMatch) {
      bus.dataThresholdVolts = toVolts(dataThresholdMatch[1], dataThresholdMatch[2]);
    }
    if (sharedThresholdMatch) {
      const sharedThreshold = toVolts(sharedThresholdMatch[1], sharedThresholdMatch[2]);
      if (bus.clockThresholdVolts === undefined) bus.clockThresholdVolts = sharedThreshold;
      if (bus.dataThresholdVolts === undefined) bus.dataThresholdVolts = sharedThreshold;
    }
  } else if (sharedThresholdMatch) {
    bus.thresholdVolts = toVolts(sharedThresholdMatch[1], sharedThresholdMatch[2]);
  }

  const chipSelectMatch = message.match(/\b(cs|chip\s*select)\s+(CH[1-4])\b/i);
  if (chipSelectMatch) {
    bus.chipSelect = chipSelectMatch[2].toUpperCase();
  }
  if (/\bactive\s+high\b|\bselect\s+high\b/i.test(message)) {
    bus.selectPolarity = 'HIGH';
  } else if (/\bactive\s+low\b|\bselect\s+low\b/i.test(message)) {
    bus.selectPolarity = 'LOW';
  }

  const baudMatch = message.match(/(\d+(?:\.\d+)?)\s*(baud|kbps|mbps)\b/i);
  if (baudMatch && /uart|rs232/i.test(message)) {
    bus.baudRate = /baud/i.test(baudMatch[2])
      ? Number(baudMatch[1])
      : toBitrate(baudMatch[1], baudMatch[2]);
  } else if (baudMatch && bus.protocol === 'LIN') {
    bus.baudRate = /baud/i.test(baudMatch[2])
      ? Number(baudMatch[1])
      : toBitrate(baudMatch[1], baudMatch[2]);
  } else if (/uart|rs232/i.test(message)) {
    const commonBaudMatch = message.match(/\b(1200|2400|4800|9600|19200|38400|57600|115200|230400|460800|921600)\b/);
    if (commonBaudMatch) bus.baudRate = Number(commonBaudMatch[1]);
  } else if (bus.protocol === 'LIN') {
    const linBaudMatch = message.match(/\b(1200|2400|4800|9600|19200|38400|57600|115200)\b/);
    if (linBaudMatch) bus.baudRate = Number(linBaudMatch[1]);
  }

  const dataBitsMatch = message.match(/\b([789])\s*data\s*bits?\b/i);
  if (dataBitsMatch) {
    bus.dataBits = Number(dataBitsMatch[1]);
  }
  const stopBitsMatch = message.match(/\b([12])\s*stop\s*bits?\b/i);
  if (stopBitsMatch) {
    bus.stopBits = stopBitsMatch[1] === '2' ? 'TWO' : 'ONE';
  }
  const framingMatch = message.match(/\b([78])\s*n\s*([12])\b/i);
  if (framingMatch) {
    bus.dataBits = Number(framingMatch[1]);
    bus.parity = 'NONe';
    bus.stopBits = framingMatch[2] === '2' ? 'TWO' : 'ONE';
  }
  if (/\beven\s+parity\b|\bparity\s+even\b/i.test(message)) bus.parity = 'EVEN';
  else if (/\bodd\s+parity\b|\bparity\s+odd\b/i.test(message)) bus.parity = 'ODD';
  else if (/\bno\s+parity\b|\bparity\s+none\b/i.test(message)) bus.parity = 'NONe';

  if (/\brising\b|\brise\b/i.test(message)) bus.slope = 'RISe';
  else if (/\bfalling\b|\bfall\b/i.test(message)) bus.slope = 'FALL';

  if (bus.protocol === 'UART' || bus.protocol === 'RS232' || bus.protocol === 'RS232C') {
    if (/\btrigger\b[^.]*\bstart\s*bit\b/i.test(message) || /\bstart\s*bit\b/i.test(message)) {
      bus.triggerCondition = 'STARt';
    }
  }

  if (bus.protocol === 'I2C') {
    if (/\btrigger\b[^.]*\baddress\b/i.test(message) || /\baddress\s+0x[0-9a-f]+\b/i.test(message)) {
      bus.triggerCondition = 'ADDRess';
    }
    if (/\btrigger\b[^.]*\b(any|all)\s+address\b/i.test(message)) {
      bus.triggerCondition = 'ADDRess';
    }
    if (/\bread\b/i.test(message)) bus.triggerDirection = 'READ';
    else if (/\bwrite\b/i.test(message)) bus.triggerDirection = 'WRITE';
    const addressHexMatch = message.match(/\baddress\s+0x([0-9a-f]+)\b/i);
    if (addressHexMatch) {
      bus.triggerAddress = Number.parseInt(addressHexMatch[1], 16);
    }
  }

  if (bus.protocol === 'SPI') {
    if (/\btrigger\b[^.]*\bss\b/i.test(message) || /\bon\s+ss\b/i.test(message)) {
      bus.triggerCondition = 'SS';
    }
    if (/\bchip\s*select\b/i.test(message)) {
      bus.triggerCondition = bus.triggerCondition || 'SS';
    }
    if (/\bwrites?\s+only\b/i.test(message)) {
      bus.triggerDirection = 'WRITE';
    }
  }

  if (bus.protocol === 'LIN') {
    if (/\blin\s*2(?:\.|x)\s*x?\b/i.test(message) || /\blin\s*2x\b/i.test(message)) {
      bus.standard = 'LIN2X';
    } else if (/\blin\s*1(?:\.|x)\s*x?\b/i.test(message) || /\blin\s*1x\b/i.test(message)) {
      bus.standard = 'LIN1X';
    }
    if (
      /\btrigger\b[^.]*\b(any|all)\s+lin\s+frame\b/i.test(message) ||
      /\b(any|all)\s+lin\s+frame\b/i.test(message) ||
      /\btrigger\b[^.]*\b(any|all)\s+frame\b/i.test(message)
    ) {
      bus.triggerCondition = 'FRAME';
    }
  }

  if (bus.protocol === 'SENT') {
    if (/\btrigger\b[^.]*\b(any|all)\b[^.]*\bmessage\b/i.test(message) || /\bfast\s+channel\s+message\b/i.test(message)) {
      bus.triggerCondition = 'FAST';
    }
  }

  const canIdMatch = message.match(/\bID\s+0x([0-9a-f]+)\b/i);

  if (bus.protocol === 'CAN' || bus.protocol === 'CANFD') {
    if (/\btrigger\b[^.]*\berror\s+frame\b|\btrigger\b[^.]*\bany\s+error\b/i.test(message)) {
      bus.triggerCondition = 'FRAMEtype';
    }
    if (/\btrigger\b[^.]*\bidentifier\b|\btrigger\b[^.]*\bid\b/i.test(message) && canIdMatch) {
      bus.triggerCondition = 'IDentifier';
    }
    if (/\berror\s+frame\b|\bany\s+error\b/i.test(message)) {
      bus.triggerCondition = bus.triggerCondition || 'FRAMEtype';
    }
  }

  if (
    /\bread\s*(?:it\s*)?back\b|\breadback\b|\bverify\b|\bverification\b|\bquery\b|\bcheck\b|\bconfirm\b|\bread\s+the\s+settings\b|\bread\s+trigger\b/i.test(message) &&
    !/\bfastframe\b/i.test(message)
  ) {
    bus.readBackRequested = true;
  }

  if ((bus.protocol === 'CAN' || bus.protocol === 'CANFD') && canIdMatch) {
    if (/\b(search|find|mark)\b/i.test(message)) {
      bus.searchIdentifier = `0x${canIdMatch[1].toUpperCase()}`;
    }
  }

  if (/\b(show labels|line up under the waveform|under the waveform)\b/i.test(message)) {
    bus.displayLayout = 'BUSANDWAVEFORM';
  }

  return bus;
}

export function parseAcquisitionIntent(
  message: string,
  aliasMaps: IntentAliasMaps
): ParsedAcquisitionIntent | undefined {
  const acquisition: ParsedAcquisitionIntent = {};
  const mode = matchFirstAliasValue(message, aliasMaps.acquisitionModeAliases);
  if (mode) acquisition.mode = mode as ParsedAcquisitionIntent['mode'];
  if (/\bfastacq\b|\bfast\s+acq\b/i.test(message)) {
    acquisition.mode = 'FASTAcq';
    if (/\btemperature\s+palette\b|\bpalette\b[^.!?\n\r]*\btemperature\b/i.test(message)) {
      acquisition.fastAcqPalette = 'TEMPerature';
    } else if (/\bspectral\s+palette\b|\bpalette\b[^.!?\n\r]*\bspectral\b/i.test(message)) {
      acquisition.fastAcqPalette = 'SPECtral';
    } else if (/\binverted\s+palette\b|\bpalette\b[^.!?\n\r]*\binverted\b/i.test(message)) {
      acquisition.fastAcqPalette = 'INVErted';
    } else if (/\bnormal\s+palette\b|\bpalette\b[^.!?\n\r]*\bnormal\b/i.test(message)) {
      acquisition.fastAcqPalette = 'NORMal';
    }
  }
  if (!acquisition.mode && /\b(adc\s+clock\s+jitter|clock\s+jitter|too\s+much\s+jitter|jitter)\b/i.test(message)) {
    acquisition.mode = 'HIRes';
  }
  if (!acquisition.mode && /\b(ripple|power rail|supply|droop|vdd)\b/i.test(message)) {
    acquisition.mode = 'SAMple';
  }

  const numAvgMatch = message.match(ACQ_NUMAVG_REGEX);
  if (numAvgMatch) acquisition.numAvg = Number(numAvgMatch[1] ?? numAvgMatch[2] ?? numAvgMatch[3]);

  if (ACQ_STOP_AFTER_REGEX.test(message)) acquisition.stopAfter = 'SEQuence';
  if (/\brun\s+continuous(?:ly)?\b|\bcontinuous(?:ly)?\b/i.test(message) && !acquisition.stopAfter) {
    acquisition.runContinuous = true;
  }

  const fastFrameMatch = message.match(FASTFRAME_REGEX);
  if (fastFrameMatch) {
    acquisition.fastFrameCount = Number(
      fastFrameMatch[1] ?? fastFrameMatch[2] ?? fastFrameMatch[3] ?? fastFrameMatch[4]
    );
    if (
      acquisition.stopAfter === undefined &&
      /(\bcapture\b|\bfirst\b|\bstartup\s+pulses?\b|\bdump\b|\bsave\b|\bexport\b)/i.test(message)
    ) {
      acquisition.stopAfter = 'SEQuence';
    }
  }

  if (
    acquisition.recordLength === undefined &&
    /\b(ripple|power rail|supply|droop|vdd)\b/i.test(message) &&
    /\bbest approach|best way|good approach|good default|best default\b/i.test(message)
  ) {
    acquisition.recordLength = 1_000_000;
  }

  if (
    acquisition.horizontalScaleSeconds === undefined &&
    /\b(ripple|power rail|supply|droop|vdd)\b/i.test(message) &&
    /\bbest approach|best way|good approach|good default|best default\b/i.test(message)
  ) {
    acquisition.horizontalScaleSeconds = 1e-3;
  }

  return Object.keys(acquisition).length > 0 ? acquisition : undefined;
}

export function parseHorizontalIntent(message: string): ParsedHorizontalIntent | undefined {
  const horizontal: ParsedHorizontalIntent = {};
  const scaleMatch = message.match(HORIZONTAL_SCALE_REGEX);
  if (scaleMatch) horizontal.scaleSeconds = toSeconds(scaleMatch[1], scaleMatch[2]);
  if (horizontal.scaleSeconds === undefined) {
    const explicitScaleMatch = message.match(
      /\bhorizontal\s+scale\s+(\d+(?:\.\d+)?)\s*(ps|ns|us|ms|s|picoseconds?|nanoseconds?|microseconds?|milliseconds?|seconds?)\b/i
    );
    if (explicitScaleMatch) horizontal.scaleSeconds = toSeconds(explicitScaleMatch[1], explicitScaleMatch[2]);
  }
  if (horizontal.scaleSeconds === undefined) {
    const acrossScreenMatch = message.match(HORIZONTAL_ACROSS_SCREEN_REGEX);
    if (acrossScreenMatch) {
      const value = acrossScreenMatch[1] ?? acrossScreenMatch[3];
      const unit = acrossScreenMatch[2] ?? acrossScreenMatch[4];
      if (value && unit) {
        horizontal.scaleSeconds = toSeconds(value, unit) / 10;
      }
    }
  }
  if (horizontal.scaleSeconds === undefined) {
    const inferredScale = inferHorizontalScaleFromFrequency(message);
    if (inferredScale !== undefined) horizontal.scaleSeconds = inferredScale;
  }
  const positionMatch = message.match(HORIZONTAL_POSITION_REGEX);
  if (positionMatch) horizontal.positionSeconds = toSeconds(positionMatch[1], positionMatch[2]);
  const recordLengthMatch = message.match(RECORD_LENGTH_REGEX);
  if (recordLengthMatch) {
    horizontal.recordLength = parseScaledInteger(recordLengthMatch[1] ?? recordLengthMatch[2] ?? recordLengthMatch[3]);
  }
  return Object.keys(horizontal).length > 0 ? horizontal : undefined;
}

export function parseFastFrameIntent(message: string): ParsedFastFrameIntent | undefined {
  const match = message.match(FASTFRAME_REGEX);
  if (!match) return undefined;
  return {
    count: Number(match[1] ?? match[2] ?? match[3] ?? match[4]),
    state: true,
  };
}

export function parseMathIntent(message: string): ParsedMathIntent | undefined {
  if (!/\bmath\b|\bfft\b|\bmath\s+(add|subtract|multiply|divide)\b|\bmath\d+\b|\bminus\b/i.test(message)) {
    return undefined;
  }

  const sources = extractChannels(message);
  let operation: ParsedMathIntent['operation'] = 'UNKNOWN';
  if (/\bfft\b/i.test(message)) operation = 'FFT';
  else if (/\bmath\s+subtract\b/i.test(message)) operation = 'SUBTRACT';
  else if (/\bmath\s+multiply\b/i.test(message)) operation = 'MULTIPLY';
  else if (/\bmath\s+divide\b/i.test(message)) operation = 'DIVIDE';
  else if (/\bmath\s+add\b/i.test(message)) operation = 'ADD';
  else if (/\bminus\b|CH[1-4]\s*-\s*CH[1-4]/i.test(message)) operation = 'SUBTRACT';

  let expression: string | undefined;
  const explicitMathExpression = message.match(/\bMATH\d+\b[^.!?\n\r]*?\b(?:as|=)\s*(CH[1-4])\s*(?:-|minus|subtract)\s*(CH[1-4])\b/i);
  if (explicitMathExpression) {
    expression = `${explicitMathExpression[1].toUpperCase()}-${explicitMathExpression[2].toUpperCase()}`;
  } else {
    const subtractExpression = message.match(/\b(CH[1-4])\s*(?:-|minus|subtract)\s*(CH[1-4])\b/i);
    if (subtractExpression) {
      expression = `${subtractExpression[1].toUpperCase()}-${subtractExpression[2].toUpperCase()}`;
    }
  }

  return {
    expression,
    operation,
    sources: sources.length > 0 ? Array.from(new Set(sources)) : undefined,
    displayState: true,
  };
}

export function parseCursorIntent(message: string): ParsedCursorIntent | undefined {
  if (!/\bcursor\b/i.test(message)) return undefined;

  const cursor: ParsedCursorIntent = {};
  if (/\bvertical cursor\b/i.test(message)) cursor.type = 'VERTical';
  else if (/\bhorizontal cursor\b/i.test(message)) cursor.type = 'HORizontal';
  else cursor.type = 'WAVEform';

  const sourceMatch = message.match(/\bon\s+(CH[1-4])\b/i);
  if (sourceMatch) cursor.source = sourceMatch[1].toUpperCase();
  if (!cursor.source) {
    const explicitSourceMatch = message.match(/\bsource\s+(CH[1-4])\b/i);
    if (explicitSourceMatch) cursor.source = explicitSourceMatch[1].toUpperCase();
  }
  if (/\bdelta\s+time\b|\bdelta\s+t\b|\bdt\b/i.test(message)) cursor.deltaTime = true;
  if (/\bdelta\s+voltage\b|\bdelta\s+v\b|\bdv\b/i.test(message)) cursor.deltaVoltage = true;
  if (/\b500\s*ns\s+later\b|\btime\b/i.test(message)) cursor.units = 'SEConds';
  const laterMatch = message.match(/\bcursor\s+b\b[^.!?\n\r]*?\b(\d+(?:\.\d+)?)\s*(ps|ns|us|ms|s)\s+later\b/i)
    ?? message.match(/\b(\d+(?:\.\d+)?)\s*(ps|ns|us|ms|s)\s+later\b/i);
  if (laterMatch) {
    cursor.positionASec = 0;
    cursor.positionBSec = toSeconds(laterMatch[1], laterMatch[2]);
  }

  return cursor;
}

export function parseSearchIntent(
  message: string,
  bus?: ParsedBusIntent
): ParsedSearchIntent | undefined {
  const isSearch =
    /\bsearch\b|\bfind\b|\bmark\b|\bbus\s+event\b|(?:\busb\b[^.!?\n\r]*\bcompliance\b|\bcompliance\b[^.!?\n\r]*\busb\b)/i.test(message);
  if (!isSearch) return undefined;

  let type: ParsedSearchIntent['type'] = 'UNKNOWN';
  if (/\bsetup\s*time|\bhold\s*time/i.test(message)) type = 'SETUPHOLD';
  else if (/\bedge\b/i.test(message)) type = 'EDGE';
  else if (/\bpulse\b/i.test(message)) type = 'PULSE';
  else if (/\btransition\b/i.test(message)) type = 'TRANSITION';
  else if (/\bwindow\b/i.test(message)) type = 'WINDOW';
  else if (bus) type = 'BUS';

  let searchType: ParsedSearchIntent['searchType'] = 'ANYFIELD';
  if (/\berror\s+frames?\b/i.test(message)) searchType = 'ERRFRAME';
  else if (/\baddress\b/i.test(message)) searchType = 'ADDRESS';
  else if (/\bdata\b/i.test(message)) searchType = 'DATA';

  const protocol = bus?.protocol;
  const busMatch = message.match(BUS_SLOT_REGEX);

  let condition: string | undefined;
  let frameType: string | undefined;
  let errType: string | undefined;
  if (protocol === 'CAN' || protocol === 'CANFD') {
    if (searchType === 'ERRFRAME') {
      condition = 'FRAMEtype';
      frameType = 'ERRor';
    } else if (searchType === 'DATA') {
      condition = 'DATa';
    } else if (searchType === 'ADDRESS') {
      condition = 'IDentifier';
    }
    if (/\bany\s+error\b|\berror\s+frame\b/i.test(message)) {
      errType = 'ANYERRor';
    }
  }

  if (protocol === 'USB' && /\bcompliance\b/i.test(message)) {
    condition = 'COMPliance';
  }

  const queryFastFrameTimestamps =
    /\bfast\s*frame\b|\bfastframe\b/i.test(message) &&
    /\btimestamps?\b/i.test(message);

  return {
    type,
    bus: busMatch?.[1]?.toUpperCase() || bus?.bus || 'B1',
    protocol,
    searchType,
    condition,
    frameType,
    errType,
    queryFastFrameTimestamps,
  };
}

export function parseAfgIntent(message: string): ParsedAfgIntent | undefined {
  if (!/\bafg\b|function gen|sine|square|ramp|pulse|noise|arb|am modulation|burst/i.test(message)) return undefined;

  const channel = /ch(?:annel)?\s*2/i.test(message) ? 2 : 1;
  const sweepRequested = /\bsweep\b/i.test(message);
  const sweepRangeMatch = message.match(
    /\bsweep\b[^.!?\n\r]*?(\d+(?:\.\d+)?)\s*(hz|khz|mhz|ghz)\b[^.!?\n\r]*?\bto\b[^.!?\n\r]*?(\d+(?:\.\d+)?)\s*(hz|khz|mhz|ghz)\b/i
  );
  const sweepTimeMatch = message.match(/\bover\b[^.!?\n\r]*?(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds)\b/i);
  const functionMatch = message.match(
    /\b(sin(?:e|usoid)?|squ(?:are)?|ramp|pulse|dc|noise|arb(?:itrary)?)\b/i
  );
  const frequencyMatches = Array.from(message.matchAll(/(\d+(?:\.\d+)?)\s*(Hz|kHz|MHz|GHz)\b/gi));
  const frequencyMatch = sweepRequested ? undefined : frequencyMatches[0];
  const modulationFrequencyMatch = sweepRequested ? undefined : frequencyMatches[1];
  const amplitudeMatch = message.match(/(\d+(?:\.\d+)?)\s*(mVpp|Vpp)\b/i);
  const offsetMatch = message.match(/offset\s+(-?\d+(?:\.\d+)?)\s*(mV|V)\b/i);
  const dutyMatch = message.match(/(\d+(?:\.\d+)?)\s*%\s*duty\b/i);
  const burstMatch = message.match(/burst\s+(\d+)\s*cycles?\b/i);
  const amDepthMatch = message.match(/(\d+(?:\.\d+)?)\s*%\s*(?:am|modulation|depth)\b/i);
  const outputOn = /\b(output\s+on|enable\s+output|generate|drive the dut)\b/i.test(message) ? true : undefined;
  const hiZ = /\bhi.?z|high.?z|high\s+imp/i.test(message);
  const explicitFiftyOhm = /\b50\s*ohm\b/i.test(message);
  const burstTriggered = /\bonce per trigger\b|\bper trigger\b|\btriggered burst\b/i.test(message);
  const amState = /\bam modulation\b|\bmodulating tone\b/i.test(message) ? true : undefined;

  return {
    channel,
    function: functionMatch ? normalizeAfgFunction(functionMatch[1]) : undefined,
    frequencyHz: frequencyMatch ? toHz(frequencyMatch[1], frequencyMatch[2]) : undefined,
    amplitudeVpp: amplitudeMatch ? toVolts(amplitudeMatch[1], amplitudeMatch[2]) : undefined,
    offsetVolts: offsetMatch ? toVolts(offsetMatch[1], offsetMatch[2]) : undefined,
    dutyCyclePct: dutyMatch ? Number(dutyMatch[1]) : undefined,
    impedance: hiZ ? 'HIGHZ' : explicitFiftyOhm ? '50' : undefined,
    outputOn,
    burstCycles: burstMatch ? Number(burstMatch[1]) : undefined,
    burstState: burstMatch || burstTriggered ? true : undefined,
    burstMode: burstTriggered ? 'TRIGgered' : undefined,
    amState,
    amFrequencyHz:
      amState && modulationFrequencyMatch ? toHz(modulationFrequencyMatch[1], modulationFrequencyMatch[2]) : undefined,
    amDepthPct: amDepthMatch ? Number(amDepthMatch[1]) : undefined,
    sweepRequested,
    sweepStartHz: sweepRangeMatch ? toHz(sweepRangeMatch[1], sweepRangeMatch[2]) : undefined,
    sweepStopHz: sweepRangeMatch ? toHz(sweepRangeMatch[3], sweepRangeMatch[4]) : undefined,
    sweepTimeSec: sweepRequested ? Number(sweepTimeMatch?.[1] || 2) : undefined,
  };
}

export function parseAwgIntent(message: string): ParsedAwgIntent | undefined {
  if (!/\bawg\b|arbitrary wave/i.test(message)) return undefined;

  const channelMatch = message.match(/\b(?:awg\s*)?(?:channel|ch)\s*(\d+)\b/i);
  const waveformMatch = message.match(
    /\b(sine|sinusoid|square|ramp|pulse|arb(?:itrary)?|gaussian)\b/i
  );
  const frequencyMatch = message.match(/(\d+(?:\.\d+)?)\s*(Hz|kHz|MHz|GHz)\b/i);
  const amplitudeMatch = message.match(/(\d+(?:\.\d+)?)\s*(mVpp|Vpp)\b/i);
  const sampleRateMatch = message.match(/sample\s+rate\s+(\d+(?:\.\d+)?)\s*(Hz|kHz|MHz|GHz)\b/i);
  const outputOn = /\b(output\s+on|enable\s+output)\b/i.test(message) ? true : undefined;

  let runMode: ParsedAwgIntent['runMode'];
  if (/\bsequence\b/i.test(message)) runMode = 'SEQuence';
  else if (/\btriggered\b/i.test(message)) runMode = 'TRIGgered';
  else if (/\bgated\b/i.test(message)) runMode = 'GATed';
  else if (/\bcontinuous\b/i.test(message)) runMode = 'CONTinuous';

  return {
    channel: channelMatch ? Number(channelMatch[1]) : 1,
    waveformName: waveformMatch ? normalizeWaveformName(waveformMatch[1]) : undefined,
    frequencyHz: frequencyMatch ? toHz(frequencyMatch[1], frequencyMatch[2]) : undefined,
    amplitudeVpp: amplitudeMatch ? toVolts(amplitudeMatch[1], amplitudeMatch[2]) : undefined,
    outputOn,
    sampleRateHz: sampleRateMatch ? toHz(sampleRateMatch[1], sampleRateMatch[2]) : undefined,
    runMode,
  };
}

export function parseSmuIntent(message: string): ParsedSmuIntent | undefined {
  const isCurrentSource =
    /\b(source|force)\s+current\b|current\s+source\b|\bforce\s+\d+(?:\.\d+)?\s*(mA|A|uA|milliamps?|amps?|microamps?)\b/i.test(message);
  const isVoltageSource =
    /\b(source|force)\s+volt(?:age)?\b|\bsource\s+\d+(?:\.\d+)?\s*(V|volts?)\b/i.test(message);
  const voltageMatch = message.match(/(-?\d+(?:\.\d+)?)\s*(V|mV|volts?|millivolts?)\b(?!\s*pp)/i);
  const currentMatch = message.match(/(-?\d+(?:\.\d+)?)\s*(mA|A|uA|milliamps?|amps?|microamps?)\b/i);
  const complianceMatch = message.match(
    /(?:compliance|current limit|voltage limit)\s+(-?\d+(?:\.\d+)?)\s*(mA|A|uA|V|mV|milliamps?|amps?|microamps?|volts?|millivolts?)\b/i
  );
  const sweepMatch = message.match(
    /sweep.*?(-?\d+(?:\.\d+)?)\s*(V|mV|A|mA|uA|volts?|millivolts?|amps?|milliamps?|microamps?).*?to\s+(-?\d+(?:\.\d+)?)\s*(V|mV|A|mA|uA|volts?|millivolts?|amps?|milliamps?|microamps?)/i
  );
  const stepMatch = message.match(/(\d+(?:\.\d+)?)\s*(mV|V|A|mA|uA|volts?|millivolts?|amps?|milliamps?|microamps?)\s*steps?\b/i);
  const pointsMatch = message.match(/\b(\d+)\s*points\b/i);
  const outputOn = /\b(output\s+on|enable\s+output)\b/i.test(message) ? true : /\b(output\s+off|turn\s+the\s+output\s+off|disable\s+output)\b/i.test(message) ? false : undefined;
  const measureVoltage = /\b(measure|query|read\s+back|read)\s+volt/i.test(message);
  const measureCurrent = /\b(measure|query|log|tell me(?:\s+what)?|read\s+back|read)\s+curr/i.test(message) || /\blog the current\b/i.test(message);
  const measureResistance = /\b(measure|query)\s+res/i.test(message);
  const measurePower = /\b(measure|query)\s+power/i.test(message);
  const traceReadback = /\blog\b|\bsave the readings\b|\breadings\b|\biv curve\b/i.test(message);

  if (
    voltageMatch === null &&
    currentMatch === null &&
    complianceMatch === null &&
    sweepMatch === null &&
    outputOn === undefined &&
    !measureVoltage &&
    !measureCurrent &&
    !measureResistance &&
    !measurePower
  ) {
    return undefined;
  }

  const inferredPoints =
    pointsMatch
      ? Number(pointsMatch[1])
      : sweepMatch && stepMatch
        ? Math.max(2, Math.round((toVoltsOrAmps(sweepMatch[3], sweepMatch[4]) - toVoltsOrAmps(sweepMatch[1], sweepMatch[2])) / toVoltsOrAmps(stepMatch[1], stepMatch[2])) + 1)
        : /\bfine steps\b|\biv curve\b/i.test(message)
          ? 101
          : undefined;

  return {
    sourceFunction: isCurrentSource ? 'CURRent' : isVoltageSource || voltageMatch ? 'VOLTage' : undefined,
    sourceLevel: isCurrentSource
      ? currentMatch
        ? toAmps(currentMatch[1], currentMatch[2])
        : undefined
      : voltageMatch
        ? toVolts(voltageMatch[1], voltageMatch[2])
        : currentMatch
          ? toAmps(currentMatch[1], currentMatch[2])
          : undefined,
    complianceLevel: complianceMatch ? toVoltsOrAmps(complianceMatch[1], complianceMatch[2]) : undefined,
    outputOn,
    measureFunction: measureResistance
      ? 'RESistance'
      : measureCurrent
        ? 'CURRent'
        : measureVoltage
          ? 'VOLTage'
          : measurePower
            ? 'POWer'
            : undefined,
    sweepStart: sweepMatch ? toVoltsOrAmps(sweepMatch[1], sweepMatch[2]) : undefined,
    sweepStop: sweepMatch ? toVoltsOrAmps(sweepMatch[3], sweepMatch[4]) : undefined,
    sweepPoints: inferredPoints,
    traceReadback,
  };
}

export function parseRsaIntent(message: string): ParsedRsaIntent | undefined {
  if (!/\brsa\b|spectrum anal|center frequency|span|rbw|reference level/i.test(message)) {
    return undefined;
  }

  const centerMatch = message.match(
    /\bcenter\s+frequency\s+(-?\d+(?:\.\d+)?)\s*(Hz|kHz|MHz|GHz)\b/i
  );
  const spanMatch = message.match(/\bspan\s+(-?\d+(?:\.\d+)?)\s*(Hz|kHz|MHz|GHz)\b/i);
  const rbwMatch = message.match(/\brbw\s+(-?\d+(?:\.\d+)?)\s*(Hz|kHz|MHz|GHz)\b/i);
  const refLevelMatch = message.match(/\breference\s+level\s+(-?\d+(?:\.\d+)?)\s*dBm\b/i);

  let triggerType: ParsedRsaIntent['triggerType'];
  if (/\bexternal trigger\b|\bext trigger\b|\btrigger ext\b/i.test(message)) triggerType = 'EXT';
  else if (/\bif trigger\b/i.test(message)) triggerType = 'IF';
  else if (/\btime trigger\b/i.test(message)) triggerType = 'TIME';
  else if (/\bfree run\b|\bfree trigger\b/i.test(message)) triggerType = 'FREE';

  let traceType: ParsedRsaIntent['traceType'];
  if (/\bmax hold\b/i.test(message)) traceType = 'MAXHold';
  else if (/\bmin hold\b/i.test(message)) traceType = 'MINHold';
  else if (/\baverage trace\b|\btrace average\b/i.test(message)) traceType = 'AVErage';
  else if (/\bwrite trace\b|\bclear write\b/i.test(message)) traceType = 'WRITe';

  let measurementType: ParsedRsaIntent['measurementType'];
  if (/\bdpx\b/i.test(message)) measurementType = 'DPX';
  else if (/\bdemod\b/i.test(message)) measurementType = 'DEMOD';
  else if (/\bpulse\b/i.test(message)) measurementType = 'PULSE';
  else if (centerMatch || spanMatch || rbwMatch || /\bspectrum\b/i.test(message)) {
    measurementType = 'SPECTRUM';
  }

  const rsa: ParsedRsaIntent = {
    centerFreqHz: centerMatch ? toHz(centerMatch[1], centerMatch[2]) : undefined,
    spanHz: spanMatch ? toHz(spanMatch[1], spanMatch[2]) : undefined,
    rbwHz: rbwMatch ? toHz(rbwMatch[1], rbwMatch[2]) : undefined,
    refLevelDbm: refLevelMatch ? Number(refLevelMatch[1]) : undefined,
    triggerType,
    traceType,
    measurementType,
  };

  return Object.values(rsa).some((value) => value !== undefined) ? rsa : undefined;
}

export function parseSpectrumViewIntent(message: string): ParsedSpectrumViewIntent | undefined {
  if (!/\bspectrum\s+view\b|\bsv\b/i.test(message)) return undefined;
  const channelMatch = message.match(/\bon\s+(CH[1-8])\b/i) || message.match(/\b(CH[1-8])\b/i);
  const centerMatch = message.match(/\bcenter\s+frequency\s+(\d+(?:\.\d+)?)\s*(hz|khz|mhz|ghz)\b/i);
  const spanMatch = message.match(/\bspan\s+(\d+(?:\.\d+)?)\s*(hz|khz|mhz|ghz)\b/i);
  const channel = channelMatch?.[1]?.toUpperCase() || 'CH1';
  return {
    channel,
    centerFreqHz: centerMatch ? toHz(centerMatch[1], centerMatch[2]) : undefined,
    spanHz: spanMatch ? toHz(spanMatch[1], spanMatch[2]) : undefined,
  };
}

export function parseSaveIntent(
  message: string,
  context: Pick<ParseContext, 'channels'>
): ParsedSaveIntent | undefined {
  const save: ParsedSaveIntent = {};
  const clauses = splitClauses(message);
  const explicitSaveVerb = /\b(save|export|exported|capture|dump|download|transfer)\b/i.test(message);
  const waitForCompletionRequested =
    /\bafter\s+(?:it|capture|acquisition)\s+(?:finishes|finished|completes|completing|is done)\b/i.test(message) ||
    /\bwhen\s+(?:it|capture|acquisition)\s+finishes\b/i.test(message);

  if (SAVE_SCREENSHOT_REGEX.test(message)) save.screenshot = true;

  if (
    /\b(save|export|dump|download|transfer)\b[^.!?\n\r]*\b(waveform|data)\b/i.test(message) &&
    context.channels.length > 0
  ) {
    save.waveformSources = context.channels.map((channel) => channel.channel);
    save.format = parseSaveFormat(message) ?? 'bin';
  }
  const explicitWaveformSources = Array.from(
    new Set(Array.from(message.matchAll(/\bCH([1-8])\b/gi)).map((match) => `CH${match[1]}`))
  );
  if (/\b(save|export|dump|download)\b[^.!?\n\r]*\bwaveforms?\b/i.test(message) && explicitWaveformSources.length > 0) {
    save.waveformSources = explicitWaveformSources;
    save.format = parseSaveFormat(message) ?? save.format ?? 'bin';
  }

  const waveformClauses = clauses.filter((clause) => SAVE_WAVEFORM_REGEX.test(clause));
  if (waveformClauses.length > 0) {
    const waveformSources = new Set<string>();
    const waveformExports: Array<{ source: string; format: 'bin' | 'csv' | 'wfm' | 'mat' }> = [];
    for (const clause of waveformClauses) {
      for (const match of clause.matchAll(CHANNEL_REGEX)) {
        waveformSources.add(toChannelId(match[1]));
      }
      if (/\bmath\s+trace\b|\bmath\b/i.test(clause)) waveformSources.add('MATH1');

      const perSourcePattern = /\b(?:channel|ch)\s*([1-4])\b[^.!?\n\r]*?\b(?:to|as)\s+(csv|wfm|mat|binary|bin)\b/gi;
      for (const match of clause.matchAll(perSourcePattern)) {
        const source = toChannelId(match[1]);
        const formatToken = String(match[2] || '').toLowerCase();
        const format = formatToken === 'binary' ? 'bin' : (formatToken as 'bin' | 'csv' | 'wfm' | 'mat');
        waveformSources.add(source);
        waveformExports.push({ source, format });
      }
    }
    if (/\bsave\s+all\b|\bexport\s+all\b|\bsave\s+everything\b/i.test(message) && waveformSources.size === 0) {
      for (const channel of context.channels) waveformSources.add(channel.channel);
    }
    if (waveformSources.size === 0) {
      if (context.channels.length > 0) {
        for (const channel of context.channels) waveformSources.add(channel.channel);
      } else if (/\bwaveform\b/i.test(message)) {
        waveformSources.add('CH1');
      }
    }
    if (waveformSources.size > 0) save.waveformSources = Array.from(waveformSources.values());
    if (waveformExports.length > 0) {
      const mergedExports = new Map<string, 'bin' | 'csv' | 'wfm' | 'mat'>();
      for (const item of waveformExports) mergedExports.set(item.source, item.format);
      save.waveformExports = Array.from(mergedExports.entries()).map(([source, format]) => ({ source, format }));
    }
    save.format = parseSaveFormat(message) ?? 'bin';
  }

  const setupPathMatch = explicitSaveVerb ? message.match(SAVE_PATH_REGEX) : null;
  if (setupPathMatch) save.setupPath = setupPathMatch[0];
  else if (/\b(save|export)\b[^.!?\n\r]*\b(whole\s+session|session|setup)\b/i.test(message)) {
    save.setupPath = 'C:/tek/session.set';
  }

  const sessionPathMatch = explicitSaveVerb ? message.match(SAVE_SESSION_PATH_REGEX) : null;
  if (sessionPathMatch && /\.tss$/i.test(sessionPathMatch[0])) {
    save.sessionPath = sessionPathMatch[0];
  } else if (/\b(save|export)\b[^.!?\n\r]*\bsession\b/i.test(message)) {
    save.sessionPath = 'C:/tek/session.tss';
  }

  if (/\bsave\s+everything\b/i.test(message)) {
    save.screenshot = true;
    if (!save.setupPath) save.setupPath = 'C:/tek/session.set';
  }

  if (
    explicitSaveVerb &&
    !save.waveformSources?.length &&
    ((/(?:channel|ch)\s*[1-4]\b/i.test(message) && /\b(csv|wfm|binary|waveform)\b/i.test(message)) ||
      (/\bmath\s+trace\b/i.test(message) && /\b(wfm|csv|binary|waveform)\b/i.test(message)))
  ) {
    const inferredSources = extractChannels(message);
    if (/\bmath\s+trace\b/i.test(message)) inferredSources.push('MATH1');
    save.waveformSources = Array.from(new Set(inferredSources));
    save.format = parseSaveFormat(message) ?? (/binary/i.test(message) ? 'bin' : 'csv');
  }

  if (
    explicitSaveVerb &&
    /\b(save|export)\s+all\b/i.test(message) &&
    !save.waveformSources?.length
  ) {
    save.waveformSources = context.channels.length ? context.channels.map((channel) => channel.channel) : ['CH1'];
    save.format = parseSaveFormat(message) ?? 'csv';
  }

  if (
    explicitSaveVerb &&
    /\ball\s+4\s+channels?\b|\bCH1\s*(?:through|-)\s*CH4\b/i.test(message)
  ) {
    save.waveformSources = ['CH1', 'CH2', 'CH3', 'CH4'];
    if (!save.waveformExports?.length) {
      const format = parseSaveFormat(message) ?? (/binary/i.test(message) ? 'bin' : 'csv');
      save.waveformExports = save.waveformSources.map((source) => ({ source, format }));
    }
    save.format = parseSaveFormat(message) ?? (/binary/i.test(message) ? 'bin' : 'csv');
  }

  if (
    explicitSaveVerb &&
    /\b(dump|download|save|export)\b[^.!?\n\r]*\bdata\b/i.test(message) &&
    !save.waveformSources?.length
  ) {
    save.waveformSources = context.channels.length ? context.channels.map((channel) => channel.channel) : ['CH1'];
    save.format = /\bfastframe\b/i.test(message) ? 'bin' : parseSaveFormat(message) ?? 'csv';
  }

  if (/\bfastframe\b/i.test(message) && /\b(dump|download|save|export)\b[^.!?\n\r]*\bdata\b/i.test(message)) {
    if (!save.waveformSources?.length) save.waveformSources = context.channels.length ? context.channels.map((channel) => channel.channel) : ['CH1'];
    if (!save.waveformExports?.length) {
      save.waveformExports = (save.waveformSources || ['CH1']).map((source) => ({
        source,
        format: 'bin' as const,
      }));
    }
    save.format = 'bin';
    save.fastFrameExport = true;
  }

  if (waitForCompletionRequested && (save.screenshot || save.waveformSources?.length || save.setupPath || save.sessionPath)) {
    save.waitForCompletion = true;
  }

  return Object.keys(save).length > 0 ? save : undefined;
}

export function parseRecallIntent(message: string): ParsedRecallIntent | undefined {
  const recall: ParsedRecallIntent = {};
  if (RECALL_FACTORY_REGEX.test(message)) recall.factory = true;
  const sessionPathMatch = message.match(RECALL_SESSION_REGEX);
  if (sessionPathMatch) recall.sessionPath = sessionPathMatch[0];
  const setupNameMatch =
    message.match(/\brecall\s+setup\s+([A-Za-z0-9_.-]+)\b/i) ||
    message.match(/\bload\s+setup\s+([A-Za-z0-9_.-]+)\b/i) ||
    message.match(/\bsetup\b[^.!?\n\r]*\bcalled\s+([A-Za-z0-9_.-]+)\b/i);
  if (setupNameMatch) recall.setupName = setupNameMatch[1];
  return Object.keys(recall).length > 0 ? recall : undefined;
}

export function parseStatusIntent(message: string): ParsedStatusIntent | undefined {
  if (!STATUS_QUERY_REGEX.test(message)) return undefined;
  const status: ParsedStatusIntent = {};
  if (/\besr\b|\bevent status\b|\bstatus quer(?:y|ies)\b|\bstatus checks?\b|\bcheck status\b/i.test(message)) {
    status.esr = true;
  }
  if (/\bopc\b|\boperation complete\b/i.test(message)) {
    status.opc = true;
  }
  return Object.keys(status).length > 0 ? status : undefined;
}

function normalizeMessage(message: string): string {
  return message.replace(/\s+/g, ' ').trim();
}

function splitClauses(message: string): string[] {
  return message
    .split(/[,\n;\r]+/)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function extractChannelClauses(message: string): string[] {
  const clauses = splitClauses(message);
  const segments: string[] = [];
  const isFollowOnChannelConfig = (clause: string) =>
    !/\b(?:CH|channel)\s*[1-4]\b/i.test(clause) &&
    /\b(scale|sensitive|sensible|offset|coupl|ac\b|dc\b|bandwidth|clock|ripple|noise|volt(?:s)?\s+per\s+division|set it up)\b/i.test(
      clause
    );

  for (let clauseIndex = 0; clauseIndex < clauses.length; clauseIndex += 1) {
    const clause = clauses[clauseIndex];
    const matches = Array.from(clause.matchAll(CHANNEL_REGEX));
    if (matches.length === 0) continue;
    if (
      matches.length > 1 &&
      /\b(both|same|each)\b/i.test(clause) &&
      /\b(scale|offset|coupl|ac\b|dc\b|50ohm|50\b|1mohm|1m\b|mv\b|millivolts?\b|volts?\b)\b/i.test(clause)
    ) {
      segments.push(clause.trim());
      continue;
    }

    for (let index = 0; index < matches.length; index += 1) {
      const start = matches[index].index ?? 0;
      const separatorStarts = [
        clause.lastIndexOf(' and ', start),
        clause.lastIndexOf(',', start),
        clause.lastIndexOf(';', start),
      ].filter((value) => value >= 0);
      const contextStart =
        separatorStarts.length > 0 ? Math.max(...separatorStarts) + 1 : Math.max(0, start - 48);
      const nextStart = matches[index + 1]?.index ?? clause.length;
      let rawSegment = clause.slice(contextStart, nextStart);
      if (index === matches.length - 1) {
        let lookaheadIndex = clauseIndex + 1;
        while (lookaheadIndex < clauses.length && isFollowOnChannelConfig(clauses[lookaheadIndex])) {
          rawSegment += `, ${clauses[lookaheadIndex]}`;
          lookaheadIndex += 1;
        }
      }
      const trimmedSegment = rawSegment.split(/\b(?:trigger|add|measure|save|single|acquisition|decode|bus)\b/i)[0]?.trim();
      if (trimmedSegment) {
        segments.push(trimmedSegment);
      }
    }
  }

  return segments;
}

function extractMeasurementClauses(message: string): string[] {
  const clauses = splitClauses(message);
  const segments: string[] = [];

  for (const clause of clauses) {
    if (!/\b(add|measure|measurement|query)\b/i.test(clause)) {
      segments.push(clause);
      continue;
    }

    const match = clause.match(/\b(add|measure|measurement|query)\b/i);
    const start = match?.index ?? 0;
    const segment = clause
      .slice(start)
      .split(/\b(?:save|screenshot|single|acquisition|trigger|decode|bus)\b/i)[0]
      ?.trim();
    if (segment) {
      segments.push(segment);
    }
  }

  return segments.length > 0 ? segments : clauses;
}

function findTriggerClause(message: string, secondary: boolean): string | undefined {
  const clauses = splitClauses(message);
  if (secondary) {
    return clauses.find((clause) => /\btrigger\s*b\b|\bb\s*trigger\b/i.test(clause));
  }
  const matchedClause = clauses.find(
    (clause) =>
      ((/\btrigger(?:ing|ed)?\b/i.test(clause) || /\bcatch\b/i.test(clause)) &&
        !/\btrigger\s*b\b|\bb\s*trigger\b/i.test(clause)) ||
      /\b(edge|pulse|runt|logic|burst)\b/i.test(clause)
  );
  if (matchedClause) {
    return message;
  }
  return undefined;
}

function parseTriggerClause(
  clause: string,
  aliasMaps: IntentAliasMaps
): ParsedTriggerIntent | undefined {
  if (
    /\b(start\s*bit|address|read|write|ss|chip\s*select)\b/i.test(clause) &&
    /\b(i2c|spi|uart|rs-?232|can|lin|arinc|mil)\b/i.test(clause)
  ) {
    return undefined;
  }

  const trigger: ParsedTriggerIntent = {};
  const matchedType = matchFirstAliasValue(clause, aliasMaps.triggerTypeAliases);
  if (
    matchedType &&
    ['EDGE', 'WIDth', 'TIMEOut', 'RUNt', 'WINdow', 'LOGIc', 'SETHold', 'BUS', 'TRANsition'].includes(
      matchedType
    )
  ) {
    trigger.type = matchedType as ParsedTriggerIntent['type'];
  }

  const sourceMatch = clause.match(TRIGGER_SOURCE_REGEX);
  const explicitTriggerSource = parseExplicitTriggerSource(clause);
  if (explicitTriggerSource) trigger.source = explicitTriggerSource;
  else if (sourceMatch) trigger.source = toChannelId(sourceMatch[1]);

  if (TRIGGER_SLOPE_RISE_REGEX.test(clause)) trigger.slope = 'RISe';
  else if (TRIGGER_SLOPE_FALL_REGEX.test(clause)) trigger.slope = 'FALL';

  const levelAtMatch = clause.match(TRIGGER_LEVEL_AT_REGEX);
  if (levelAtMatch) {
    trigger.levelVolts = toVolts(levelAtMatch[1], levelAtMatch[2]);
  } else if (/\blevel\b|\bthreshold\b/i.test(clause)) {
    const voltages = Array.from(clause.matchAll(VOLTAGE_REGEX));
    if (voltages.length > 0) {
      const lastMatch = voltages[voltages.length - 1];
      trigger.levelVolts = toVolts(lastMatch[1], lastMatch[2]);
    }
  }
  if (trigger.levelVolts === undefined) {
    const inferredLevel = inferTriggerLevelVolts(clause);
    if (inferredLevel !== undefined) trigger.levelVolts = inferredLevel;
  }
  if (trigger.levelVolts === undefined) {
    const edgeVoltageMatch = clause.match(
      /\b(?:edge|rising|falling|rise|fall)\b[^.!?\n\r]*?(-?\d+(?:\.\d+)?)\s*(mV|V)\b/i
    );
    if (edgeVoltageMatch) {
      trigger.levelVolts = toVolts(edgeVoltageMatch[1], edgeVoltageMatch[2]);
    }
  }
  if (
    trigger.levelVolts === undefined &&
    /\bhalf\s+the\s+waveform\s+height\b|\bhalf\s+the\s+signal\b|\bmid[\s-]?level\b/i.test(clause)
  ) {
    trigger.autoSetLevel = true;
  }

  const modeMatch = clause.match(TRIGGER_MODE_REGEX);
  if (modeMatch) trigger.mode = modeMatch[1].toLowerCase() === 'normal' ? 'NORMal' : 'AUTO';
  else if (/\btrigger(?:ing)?\s+cleanly\b|\bcatch\b|\bcapture\b/i.test(clause)) {
    trigger.mode = 'NORMal';
  }

  const holdoffMatch = clause.match(TRIGGER_HOLDOFF_REGEX);
  if (holdoffMatch) trigger.holdoffSeconds = toSeconds(holdoffMatch[1], holdoffMatch[2]);

  const widerThanMatch = clause.match(/\bpulse(?:\s+width)?\b[^.!?\n\r]*?\bwider than\s+(\d+(?:\.\d+)?)\s*(ps|ns|us|ms|s|picoseconds?|nanoseconds?|microseconds?|milliseconds?|seconds?)\b/i);
  if (widerThanMatch) {
    trigger.type = 'WIDth';
    trigger.widthCondition = 'MORETHAN';
    trigger.widthSeconds = toSeconds(widerThanMatch[1], widerThanMatch[2]);
  }

  const narrowerThanMatch =
    clause.match(/\bpulse(?:\s+width)?\b[^.!?\n\r]*?\bnarrower than\s+(\d+(?:\.\d+)?)\s*(ps|ns|us|ms|s|picoseconds?|nanoseconds?|microseconds?|milliseconds?|seconds?)\b/i) ||
    clause.match(/\bpulse(?:\s+width)?\b[^.!?\n\r]*?\btoo narrow\b/i);
  if (narrowerThanMatch) {
    trigger.type = 'WIDth';
    trigger.widthCondition = 'LESSTHAN';
    if (Array.isArray(narrowerThanMatch) && narrowerThanMatch[1] && narrowerThanMatch[2]) {
      trigger.widthSeconds = toSeconds(narrowerThanMatch[1], narrowerThanMatch[2]);
    }
  }

  if (/\brunt\b/i.test(clause)) {
    trigger.type = 'RUNT';
    if (!trigger.slope) trigger.slope = 'RISe';
    if (trigger.levelVolts === undefined) {
      const signalAmplitude = parseLastVoltageInVolts(clause);
      if (signalAmplitude !== undefined) trigger.levelVolts = roundNiceValue(signalAmplitude / 2);
    }
  }

  if (/\b(first\s+burst|long\s+idle|after\s+idle)\b/i.test(clause)) {
    if (!trigger.type) trigger.type = 'TIMEOut';
    if (!trigger.mode) trigger.mode = 'NORMal';
    if (!trigger.slope) trigger.slope = 'RISe';
  }

  if (!trigger.type && (trigger.source || trigger.levelVolts !== undefined || trigger.slope || trigger.mode)) {
    trigger.type = 'EDGE';
  }

  return Object.keys(trigger).length > 0 ? trigger : undefined;
}

function isMeasurementClause(clause: string): boolean {
  if (/\b(trigger|screenshot|waveform|decode|recall|factory|reset)\b/i.test(clause)) {
    return false;
  }
  if (/\bdata\s+phase\b/i.test(clause) && isBusDecodeClause(clause)) {
    return false;
  }
  return /\b(add|measure|measurement|query|overshoot|undershoot|frequency|delay|phase|period|rise\s*time|fall\s*time|pk2pk|rms|mean)\b/i.test(clause);
}

function isBusDecodeClause(clause: string): boolean {
  return /\b(bus|decode|can(?:\s*fd)?|uart|rs-?232|i2c|spi|lin|arinc|mil(?:1553b)?)\b/i.test(clause);
}

function filterMeasurementTypes(clause: string, matchedTypes: string[]): string[] {
  const sanitizedClause = clause.replace(/\bactive\s+(?:high|low)\b/gi, ' ');
  const canonicalMatchedTypes = matchedTypes
    .map((type) => canonicalizeMeasurementType(type))
    .filter((type): type is ParsedMeasurementIntent['type'] => Boolean(type));
  let types = canonicalMatchedTypes.filter(
    (type) => sanitizedClause.toLowerCase().includes(type.toLowerCase()) || canonicalMatchedTypes.length === 1
  );
  if (!types.length) types = matchedTypes as Array<ParsedMeasurementIntent['type']>;
  types = types
    .map((type) => canonicalizeMeasurementType(type))
    .filter((type): type is ParsedMeasurementIntent['type'] => Boolean(type));
  if (/\bactive\s+low\b/i.test(clause)) {
    types = types.filter((type) => type !== 'LOW');
  }
  if (/\bactive\s+high\b/i.test(clause)) {
    types = types.filter((type) => type !== 'HIGH');
  }
  return types;
}

function splitMeasurementSegments(clause: string): string[] {
  const normalized = clause.trim();
  if (/\bbetween\b/i.test(normalized)) return [normalized];
  if (!/\band\b/i.test(normalized)) return [normalized];
  return normalized
    .split(/\band\b/gi)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function parseMeasurementSources(
  clause: string,
  defaultSource?: string
): { source1?: string; source2?: string } {
  const mathOnSourceMatch = clause.match(/\bon\s+(MATH\d+)\b/i);
  const mathFromSourceMatch = clause.match(/\bfrom\s+(MATH\d+)\b/i);
  const betweenMatch = clause.match(/\bbetween\s+(?:CH|channel)\s*([1-4])\s+and\s+(?:CH|channel)\s*([1-4])\b/i);
  const explicitOnSourceMatch = clause.match(/\bon\s+(?:CH|channel)\s*([1-4])\b/i);
  const explicitFromSourceMatch = clause.match(/\bfrom\s+(?:CH|channel)\s*([1-4])\b/i);
  const explicitToSourceMatch = clause.match(/\bto\s+(?:CH|channel)\s*([1-4])\b/i);
  return {
    source1:
      (mathOnSourceMatch?.[1] ? mathOnSourceMatch[1].toUpperCase() : undefined) ||
      (mathFromSourceMatch?.[1] ? mathFromSourceMatch[1].toUpperCase() : undefined) ||
      (betweenMatch?.[1] ? toChannelId(betweenMatch[1]) : undefined) ||
      (explicitOnSourceMatch?.[1] ? toChannelId(explicitOnSourceMatch[1]) : undefined) ||
      (explicitFromSourceMatch?.[1] ? toChannelId(explicitFromSourceMatch[1]) : undefined) ||
      defaultSource,
    source2:
      (betweenMatch?.[2] ? toChannelId(betweenMatch[2]) : undefined) ||
      (explicitToSourceMatch?.[1] ? toChannelId(explicitToSourceMatch[1]) : undefined),
  };
}

function toChannelId(value: string): string {
  return `CH${String(value || '').replace(/[^1-4]/g, '')}`;
}

function extractChannels(input: string): string[] {
  return Array.from(input.matchAll(CHANNEL_REGEX)).map((match) => toChannelId(match[1]));
}

function parseScaleVolts(input: string): number | undefined {
  const voltsPerDivMatch = input.match(
    /\b(?:(half|quarter)|(-?\d+(?:\.\d+)?))\s*(?:a\s+)?(mV|V|millivolts?|volts?)?\s*(?:\/div|per\s+division|per\s+div)\b/i
  );
  const scaleToMatch =
    input.match(/\bscale\s+(?:to\s+)?(-?\d+(?:\.\d+)?)\s*(mV|V|millivolts?|volts?)\b/i) ||
    input.match(/\b(?:channel|ch)\s*[1-8]\b[^.!?\n\r]*?\bscale\s+(?:to\s+)?(-?\d+(?:\.\d+)?)\s*(mV|V|millivolts?|volts?)\b/i);
  if (voltsPerDivMatch) {
    const wordValue = voltsPerDivMatch[1]?.toLowerCase();
    const numericValue =
      wordValue === 'half'
        ? 0.5
        : wordValue === 'quarter'
          ? 0.25
          : Number(voltsPerDivMatch[2]);
    const unit = normalizeVoltageUnit(voltsPerDivMatch[3] || 'V');
    return Number.isFinite(numericValue) ? toVolts(String(numericValue), unit) : undefined;
  }
  if (scaleToMatch) {
    const numericValue = Number(scaleToMatch[1]);
    const unit = normalizeVoltageUnit(scaleToMatch[2] || 'V');
    return Number.isFinite(numericValue) ? toVolts(String(numericValue), unit) : undefined;
  }
  return undefined;
}

function parseCompareFrequencyNominalHz(message: string): number | undefined {
  const nominalMatch = message.match(
    /\bcompare\s+frequency\b[^.!?\n\r]*?\bto\b[^.!?\n\r]*?(\d+(?:\.\d+)?)\s*(hz|khz|mhz|ghz)\b[^.!?\n\r]*\bnominal\b/i
  );
  if (!nominalMatch) return undefined;
  return toHz(nominalMatch[1], nominalMatch[2]);
}

function normalizeVoltageUnit(unit: string): string {
  const normalized = String(unit || '').toLowerCase();
  if (/^millivolt/.test(normalized)) return 'mv';
  if (/^volt/.test(normalized)) return 'v';
  return normalized;
}

function parseLastVoltageInVolts(input: string): number | undefined {
  const matches = Array.from(input.matchAll(VOLTAGE_REGEX));
  if (matches.length === 0) return undefined;
  const lastMatch = matches[matches.length - 1];
  return toVolts(lastMatch[1], lastMatch[2]);
}

function roundNiceValue(value: number): number {
  const candidates = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10];
  for (const candidate of candidates) {
    if (value <= candidate) return candidate;
  }
  return value;
}

function normalizeTimeUnit(unit: string): string {
  const normalized = String(unit || '').toLowerCase();
  if (/^pico/.test(normalized)) return 'ps';
  if (/^nano/.test(normalized)) return 'ns';
  if (/^micro/.test(normalized)) return 'us';
  if (/^milli/.test(normalized)) return 'ms';
  if (/^second/.test(normalized)) return 's';
  return normalized;
}

function inferScaleFromAnalogContext(clause: string): number | undefined {
  if (!/\b(sensible|clock|lvcmos|digital line|ringing|more sensitive|set it up)\b/i.test(clause)) {
    return undefined;
  }
  const signalAmplitude = parseLastVoltageInVolts(clause);
  if (signalAmplitude === undefined) {
    if (/\bmore sensitive\b/i.test(clause)) return 0.5;
    return undefined;
  }
  return roundNiceValue(signalAmplitude / 4);
}

function inferScaleFromChannelClause(clause: string, offsetVolts?: number): number | undefined {
  if (offsetVolts !== undefined) return undefined;
  if (
    !/\b(?:set|configure|make|put)\b/i.test(clause) &&
    !/\bCH[1-8]\b[^.!?\n\r]*\bto\b/i.test(clause) &&
    !/\bCH[1-8]\b[^.!?\n\r]*?\d+(?:\.\d+)?\s*(mV|V)\b/i.test(clause)
  ) {
    return undefined;
  }
  if (!/\b(?:CH|channel)\s*[1-4]\b/i.test(clause)) return undefined;
  if (!/\b(coupl|ac\b|dc\b|50ohm|50\b|1mohm|1m\b|both)\b/i.test(clause)) return undefined;
  if (/\boffset\b|\btrigger\b|\bthreshold\b/i.test(clause)) return undefined;
  const voltages = Array.from(clause.matchAll(VOLTAGE_REGEX));
  if (!voltages.length) return undefined;
  if (/\brail\b|\bsupply\b|\bvdd\b/i.test(clause) && voltages.length >= 2) {
    return toVolts(voltages[0][1], voltages[0][2]);
  }
  const lastMatch = voltages[voltages.length - 1];
  return toVolts(lastMatch[1], lastMatch[2]);
}

function parseBandwidthHz(clause: string): number | undefined {
  const match =
    clause.match(/\bbandwidth\s+(?:at|to)?\s*(\d+(?:\.\d+)?)\s*(hz|khz|mhz|ghz|meg)\b/i) ||
    clause.match(/\bcap\b[^.!?\n\r]*?\b(\d+(?:\.\d+)?)\s*(hz|khz|mhz|ghz|meg)\b/i);
  if (!match) return undefined;
  const unit = match[2].toLowerCase() === 'meg' ? 'mhz' : match[2];
  return toHz(match[1], unit);
}

function inferHorizontalScaleFromFrequency(message: string): number | undefined {
  if (!/\b(five|5)\s+cycles\b|\btimebase\b/i.test(message)) return undefined;
  const matches = Array.from(message.matchAll(FREQUENCY_REGEX));
  if (matches.length === 0) return undefined;
  const last = matches[matches.length - 1];
  const frequencyHz = toHz(last[1], last[2]);
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) return undefined;
  const cycles = /\bfive\s+cycles\b/i.test(message) ? 5 : /\b(\d+)\s+cycles\b/i.exec(message)?.[1];
  const cycleCount = typeof cycles === 'string' ? Number(cycles) : cycles ?? 5;
  if (!Number.isFinite(cycleCount) || cycleCount <= 0) return undefined;
  return (cycleCount / frequencyHz) / 10;
}

function inferTriggerLevelVolts(clause: string): number | undefined {
  if (!/\bmid[\s-]?level\b|\btriggering?\s+cleanly\b|\btrigger on it\b|\bhalf\s+the\s+waveform\s+height\b|\bhalf\s+the\s+signal\b/i.test(clause)) {
    return undefined;
  }
  const signalAmplitude = parseLastVoltageInVolts(clause);
  if (signalAmplitude !== undefined) return roundNiceValue(signalAmplitude / 2);
  const scaleVolts = parseScaleVolts(clause);
  if (scaleVolts !== undefined) return roundNiceValue(scaleVolts);
  return undefined;
}

function parseExplicitTriggerSource(clause: string): string | undefined {
  const patterns = [
    /\btrigger\s+(?:off|on)\s+(?:CH|channel)\s*([1-4])\b/i,
    /\buse\s+(?:CH|channel)\s*([1-4])\s+for\s+the\s+trigger\b/i,
    /\b(?:actually\s+)?use\s+(?:CH|channel)\s*([1-4])\s+for\s+the\s+trigger\b/i,
  ];
  for (const pattern of patterns) {
    const match = clause.match(pattern);
    if (match) return toChannelId(match[1]);
  }
  return undefined;
}

function parseTerminationOhms(value: string): number {
  return value.toLowerCase().startsWith('1m') ? 1_000_000 : 50;
}

function normalizeAfgFunction(value: string): ParsedAfgIntent['function'] {
  const normalized = value.toLowerCase();
  if (normalized.startsWith('sin')) return 'SINusoid';
  if (normalized.startsWith('squ')) return 'SQUare';
  if (normalized.startsWith('ramp')) return 'RAMP';
  if (normalized.startsWith('pul')) return 'PULSe';
  if (normalized.startsWith('dc')) return 'DC';
  if (normalized.startsWith('noi')) return 'NOISe';
  return 'ARBitrary';
}

function normalizeWaveformName(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.startsWith('sin')) return 'SINE';
  if (normalized.startsWith('squ')) return 'SQUARE';
  if (normalized.startsWith('ramp')) return 'RAMP';
  if (normalized.startsWith('pul')) return 'PULSE';
  if (normalized.startsWith('gauss')) return 'GAUSSIAN';
  return 'ARBITRARY';
}

function parseSaveFormat(message: string): ParsedSaveIntent['format'] | undefined {
  if (/\.csv\b|\bcsv\b/i.test(message)) return 'csv';
  if (/\.wfm\b|\bwfm\b/i.test(message)) return 'wfm';
  if (/\.mat\b|\bmat\b/i.test(message)) return 'mat';
  if (/\.bin\b|\bbinary\b/i.test(message)) return 'bin';
  return undefined;
}

function toVolts(value: string, unit: string): number {
  const numericValue = Number(value);
  const normalizedUnit = normalizeVoltageUnit(unit);
  if (normalizedUnit === 'mv' || normalizedUnit === 'mvpp') return numericValue / 1000;
  return numericValue;
}

function toSeconds(value: string, unit: string): number {
  const numericValue = Number(value);
  switch (normalizeTimeUnit(unit)) {
    case 'ps':
      return numericValue / 1_000_000_000_000;
    case 'ms':
      return numericValue / 1000;
    case 'us':
      return numericValue / 1_000_000;
    case 'ns':
      return numericValue / 1_000_000_000;
    default:
      return numericValue;
  }
}

function toHz(value: string, unit: string): number {
  const numericValue = Number(value);
  switch (unit.toLowerCase()) {
    case 'ghz':
      return numericValue * 1_000_000_000;
    case 'mhz':
      return numericValue * 1_000_000;
    case 'khz':
      return numericValue * 1000;
    default:
      return numericValue;
  }
}

function toBitrate(value: string, unit: string): number {
  const numericValue = Number(value);
  return unit.toLowerCase() === 'mbps' ? numericValue * 1_000_000 : numericValue * 1000;
}

function toAmps(value: string, unit: string): number {
  const numericValue = Number(value);
  switch (unit.toLowerCase()) {
    case 'ma':
    case 'milliamp':
    case 'milliamps':
      return numericValue / 1000;
    case 'ua':
    case 'microamp':
    case 'microamps':
      return numericValue / 1_000_000;
    default:
      return numericValue;
  }
}

function toVoltsOrAmps(value: string, unit: string): number {
  return /v/i.test(unit) ? toVolts(value, unit) : toAmps(value, unit);
}

function parseScaledInteger(value: string): number {
  const normalized = String(value || '').trim();
  const wordMatch = normalized.match(/^(\d+(?:\.\d+)?)\s+(million|thousand)$/i);
  if (wordMatch) {
    const numericValue = Number(wordMatch[1]);
    const word = wordMatch[2].toLowerCase();
    if (word === 'million') return Math.round(numericValue * 1_000_000);
    if (word === 'thousand') return Math.round(numericValue * 1000);
  }
  const match = normalized.match(/^(\d+(?:\.\d+)?)([kKmM]?)$/);
  if (!match) return Number(value);
  const numericValue = Number(match[1]);
  const suffix = match[2].toLowerCase();
  if (suffix === 'k') return Math.round(numericValue * 1000);
  if (suffix === 'm') return Math.round(numericValue * 1_000_000);
  return Math.round(numericValue);
}

function parseOffsetInVolts(clause: string): number | undefined {
  if (/\b(zero\s+out|zero|reset)\b[^.!?\n\r]*\boffset\b|\boffset\b[^.!?\n\r]*\b(?:to\s+)?zero\b/i.test(clause)) {
    return 0;
  }
  const match = clause.match(/\boffset\s+(?:to\s+)?(-?\d+(?:\.\d+)?)\s*(mV|V)?\b/i);
  if (!match) return undefined;
  return toVolts(match[1], match[2] || 'V');
}

function dedupeGroups(groups: IntentGroup[]): IntentGroup[] {
  return Array.from(new Set(groups));
}

function buildBindings(intent: PlannerIntent): Record<string, string> {
  const bindings: Record<string, string> = {};
  if (intent.channels[0]?.channel) bindings['CH<x>'] = intent.channels[0].channel;
  if (intent.buses[0]?.bus) bindings['B<x>'] = intent.buses[0].bus;
  return bindings;
}

function getPrimaryFamilyHint(modelFamily: string): string | undefined {
  const normalized = (modelFamily || '').toUpperCase();
  if (/DPO70000/.test(normalized)) return 'DPO70000';
  if (/DPO7000|7K/.test(normalized)) return 'DPO7000';
  if (/DPO5000|5K/.test(normalized)) return 'DPO5000';
  if (/MSO7/.test(normalized)) return 'MSO7';
  if (/MSO6/.test(normalized)) return 'MSO6';
  if (/MSO5/.test(normalized)) return 'MSO5';
  if (/MSO4/.test(normalized)) return 'MSO4';
  if (/MSO2/.test(normalized)) return 'MSO2';
  return undefined;
}

function findExactHeader(
  index: CommandIndex,
  header: string,
  sourceFile: string
): CommandRecord | null {
  const matches = index
    .getEntries()
    .filter((entry) => headersEquivalent(entry.header, header));

  const sourceMatch = matches.find((entry) => entry.sourceFile === sourceFile) ?? null;
  if (sourceFile === 'MSO_DPO_5k_7k_70K.json') {
    const legacyOverride =
      matches.find((entry) => entry.sourceFile === 'legacy_scope_manual_overrides.json') ?? null;
    return sourceMatch ?? legacyOverride;
  }

  return sourceMatch ?? matches[0] ?? null;
}

function findHeaderStartsWith(
  index: CommandIndex,
  headerPrefix: string,
  sourceFile: string
): CommandRecord | null {
  const prefix = canonicalizeHeader(headerPrefix);
  const matches = index
    .getEntries()
    .filter((entry) => canonicalizeHeader(entry.header).startsWith(prefix));

  const sourceMatch = matches.find((entry) => entry.sourceFile === sourceFile) ?? null;
  return sourceMatch ?? matches[0] ?? null;
}

function materialize(
  record: CommandRecord,
  concreteHeader: string,
  value: string | undefined,
  group: IntentGroup,
  commandType: 'set' | 'query' = 'set',
  saveAs?: string
): ResolvedCommand {
  const concreteCommand =
    value !== undefined ? `${concreteHeader} ${value}` : concreteHeader;

  return {
    group,
    header: record.header,
    concreteCommand,
    commandType,
    saveAs,
    verified: true,
    sourceFile: record.sourceFile,
    syntax: record.syntax || {},
    arguments: transformArguments(record.arguments, record.raw),
    examples: transformExamples(record.codeExamples),
    notes: record.notes,
    relatedCommands: record.relatedCommands,
  };
}

function buildSyntheticQuery(
  command: string,
  group: IntentGroup,
  saveAs?: string
): ResolvedCommand {
  return {
    group,
    header: command.replace(/\?$/, ''),
    concreteCommand: command,
    commandType: 'query',
    saveAs,
    verified: true,
    sourceFile: 'synthetic_common',
    syntax: { query: command },
    arguments: [],
    examples: [{ scpi: command }],
    notes: ['Synthetic fallback for standard IEEE/status query.'],
  };
}

function buildSyntheticWrite(
  command: string,
  group: IntentGroup
): ResolvedCommand {
  return {
    group,
    header: command.split(/\s+/)[0] || command,
    concreteCommand: command,
    commandType: 'set',
    verified: true,
    sourceFile: 'synthetic_common',
    syntax: { set: command },
    arguments: [],
    examples: [{ scpi: command }],
    notes: ['Synthetic fallback for standard write command.'],
  };
}

function buildSyntheticStep(
  stepType: string,
  group: IntentGroup,
  stepParams: Record<string, unknown>,
  label?: string
): ResolvedCommand {
  return {
    group,
    header: `STEP:${stepType}`,
    concreteCommand: label || stepType,
    commandType: 'set',
    stepType,
    stepParams,
    verified: true,
    sourceFile: 'synthetic_common',
    syntax: { set: stepType },
    arguments: [],
    examples: [],
    notes: ['Synthetic built-in step emitted by planner.'],
  };
}

function transformArguments(
  args: CommandArgument[],
  raw: Record<string, unknown>
): ResolvedCommandArgument[] {
  const rawParams = Array.isArray(raw.params)
    ? (raw.params as Array<Record<string, unknown>>)
    : [];

  return args.map((arg, index) => {
    const rawParam = rawParams[index] ?? {};
    const validValues = extractValidValues(arg.validValues, rawParam);

    return {
      name: arg.name,
      type: arg.type,
      required: arg.required,
      validValues: validValues.length > 0 ? validValues : undefined,
      min: coerceNumber(rawParam.min),
      max: coerceNumber(rawParam.max),
      unit: typeof rawParam.unit === 'string' ? rawParam.unit : undefined,
      description: arg.description,
    };
  });
}

function transformExamples(examples: CommandCodeExample[]): ResolvedCommandExample[] {
  return (examples || []).map((example) => ({
    scpi: example.scpi?.code,
    tm_devices: example.tm_devices?.code,
  }));
}

function extractValidValues(
  validValues: Record<string, unknown>,
  rawParam: Record<string, unknown>
): string[] {
  const fromValues = Array.isArray(validValues.values)
    ? (validValues.values as unknown[]).map(String)
    : [];
  const fromOptions = Array.isArray(rawParam.options)
    ? (rawParam.options as unknown[]).map(String)
    : [];
  return Array.from(new Set([...fromValues, ...fromOptions]));
}

function coerceNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function hasBusDecodeDetails(bus: ParsedBusIntent): boolean {
  return Boolean(
    bus.source1 ||
      bus.source2 ||
      bus.source3 ||
      bus.clockSource ||
      bus.dataSource ||
      bus.bitrateBps !== undefined ||
      bus.dataPhaseBitrateBps !== undefined ||
      bus.standard ||
      bus.thresholdVolts !== undefined ||
      bus.clockThresholdVolts !== undefined ||
      bus.dataThresholdVolts !== undefined ||
      bus.chipSelect ||
      bus.selectPolarity ||
      bus.baudRate !== undefined ||
      bus.dataBits !== undefined ||
      bus.stopBits ||
      bus.parity ||
      bus.slope ||
      bus.triggerCondition ||
      bus.triggerAddress !== undefined ||
      bus.triggerDirection ||
      bus.displayLayout ||
      bus.searchIdentifier
  );
}

function headersEquivalent(left: string, right: string): boolean {
  return canonicalizeHeader(left) === canonicalizeHeader(right);
}

function canonicalizeHeader(header: string): string {
  return header
    .trim()
    .split(/\s+/)[0]
    .replace(/^:/, '')
    .replace(/\?/g, '')
    .replace(/\{A\|B\}/gi, 'A')
    .replace(/\{CH\}|\{ch\}|\[1\|2\]/g, '<x>')
    .replace(/\{M\}|\{m\}/g, '<x>')
    .replace(/\{[^}]+\}/g, '')
    .replace(/\bCH\d+\b/gi, 'CH<x>')
    .replace(/\bSOURce\d+\b/gi, 'SOURce<x>')
    .replace(/\bOUTPut\d+\b/gi, 'OUTPut<x>')
    .replace(/\bB\d+\b/gi, 'B<x>')
    .replace(/\bMEAS\d+\b/gi, 'MEAS<x>')
    .replace(/\bWAVEVIEW\d+\b/gi, 'WAVEView<x>')
    .toUpperCase();
}
