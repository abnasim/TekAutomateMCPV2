export interface MeasurementCatalogEntry {
  id: string;
  tab: string;
  section: string;
  label: string;
  aliases: string[];
  sourceMode:
    | 'single_source'
    | 'dual_source'
    | 'voltage_current'
    | 'voltage_current_gate'
    | 'power_rail'
    | 'power_device';
  addHeaders: string[];
  configHeaders: string[];
  resultHeaders: string[];
  resultTokens: string[];
  searchHints: string[];
}

export interface MeasurementCatalogMatch {
  entry: MeasurementCatalogEntry;
  score: number;
  matchedAliases: string[];
}

export interface MeasurementSearchPlan {
  matches: MeasurementCatalogMatch[];
  exactHeaders: string[];
  searchTerms: string[];
  resultTokens: string[];
  wantsResults: boolean;
}

function entry(
  id: string,
  tab: string,
  section: string,
  label: string,
  aliases: string[],
  sourceMode: MeasurementCatalogEntry['sourceMode'],
  addHeaders: string[],
  configHeaders: string[],
  resultHeaders: string[],
  resultTokens: string[],
  searchHints: string[]
): MeasurementCatalogEntry {
  return {
    id,
    tab,
    section,
    label,
    aliases,
    sourceMode,
    addHeaders,
    configHeaders,
    resultHeaders,
    resultTokens,
    searchHints,
  };
}

const STANDARD_ADD_HEADERS = ['MEASUrement:ADDMEAS', 'MEASUrement:MEAS<x>:SOURCE'];
const JITTER_SUMMARY_HEADERS = [
  'MEASUrement:ADDMEAS',
  'MEASUrement:MEAS<x>:SOURCE',
  'MEASUrement:MEAS<x>:JITTERSummary:TIE',
  'MEASUrement:MEAS<x>:JITTERSummary:TJBER',
  'MEASUrement:MEAS<x>:JITTERSummary:RJ',
  'MEASUrement:MEAS<x>:JITTERSummary:DJ',
  'MEASUrement:MEAS<x>:JITTERSummary:PJ',
  'MEASUrement:MEAS<x>:JITTERSummary:DDJ',
  'MEASUrement:MEAS<x>:JITTERSummary:DCD',
  'MEASUrement:MEAS<x>:JITTERSummary:EYEWIDTHBER',
];
const STANDARD_RESULT_HEADERS = [
  'MEASUrement:MEAS<x>:RESUlts:CURRentacq:MEAN',
  'MEASUrement:MEAS<x>:RESUlts:CURRentacq:MAXimum',
  'MEASUrement:MEAS<x>:RESUlts:CURRentacq:MINimum',
];

const POWER_ADD_HEADERS = ['POWer:ADDNew', 'POWer:POWer<x>:TYPe'];
const POWER_RESULT_HEADERS = [
  'POWer:POWer<x>:RESUlts:CURRentacq:FREQUENCY?',
  'POWer:POWer<x>:RESUlts:CURRentacq:IRMS?',
  'POWer:POWer<x>:RESUlts:CURRentacq:VRMS?',
  'POWer:POWer<x>:RESUlts:CURRentacq:MAXimum?',
  'POWer:POWer<x>:RESUlts:CURRentacq:MEAN?',
  'POWer:POWer<x>:RESUlts:ALLAcqs:MAXimum?',
];

const WBG_ADD_HEADERS = ['POWer:ADDNew', 'POWer:POWer<x>:TYPe'];

export const MEASUREMENT_CATALOG: MeasurementCatalogEntry[] = [
  entry(
    'standard.amplitude.amplitude',
    'Standard',
    'Amplitude Measurements',
    'Amplitude',
    ['amplitude', 'cycle amplitude'],
    'single_source',
    STANDARD_ADD_HEADERS,
    [],
    STANDARD_RESULT_HEADERS,
    ['AMPL'],
    ['standard amplitude measurement']
  ),
  entry(
    'standard.amplitude.maximum',
    'Standard',
    'Amplitude Measurements',
    'Maximum',
    ['maximum', 'max'],
    'single_source',
    STANDARD_ADD_HEADERS,
    [],
    STANDARD_RESULT_HEADERS,
    ['MAX'],
    ['standard maximum measurement']
  ),
  entry(
    'standard.amplitude.minimum',
    'Standard',
    'Amplitude Measurements',
    'Minimum',
    ['minimum', 'min'],
    'single_source',
    STANDARD_ADD_HEADERS,
    [],
    STANDARD_RESULT_HEADERS,
    ['MIN'],
    ['standard minimum measurement']
  ),
  entry(
    'standard.amplitude.pkpk',
    'Standard',
    'Amplitude Measurements',
    'Peak-to-Peak',
    ['peak-to-peak', 'peak to peak', 'pkpk', 'pk2pk', 'vpp'],
    'single_source',
    STANDARD_ADD_HEADERS,
    [],
    STANDARD_RESULT_HEADERS,
    ['PKPK'],
    ['standard peak to peak measurement']
  ),
  entry(
    'standard.amplitude.mean',
    'Standard',
    'Amplitude Measurements',
    'Mean',
    ['mean', 'average', 'avg'],
    'single_source',
    STANDARD_ADD_HEADERS,
    [],
    STANDARD_RESULT_HEADERS,
    ['MEAN'],
    ['standard mean measurement']
  ),
  entry(
    'standard.amplitude.rms',
    'Standard',
    'Amplitude Measurements',
    'RMS',
    ['rms', 'vrms'],
    'single_source',
    STANDARD_ADD_HEADERS,
    [],
    STANDARD_RESULT_HEADERS,
    ['RMS'],
    ['standard rms measurement']
  ),
  entry(
    'standard.time.period',
    'Standard',
    'Time Measurements',
    'Period',
    ['period', 'cycle period'],
    'single_source',
    STANDARD_ADD_HEADERS,
    [],
    STANDARD_RESULT_HEADERS,
    ['PRIOD', 'PERIOD'],
    ['standard period measurement']
  ),
  entry(
    'standard.time.frequency',
    'Standard',
    'Time Measurements',
    'Frequency',
    ['frequency', 'freq', 'cycle frequency'],
    'single_source',
    STANDARD_ADD_HEADERS,
    ['MEASUrement:MEAS<x>:FREQ'],
    ['MEASUrement:MEAS<x>:CCRESUlts:CURRentacq:MEAN'],
    ['FREQ', 'FREQUENCY'],
    ['standard frequency measurement', 'measurement addmeas frequency', 'measurement meas freq']
  ),
  entry(
    'standard.time.rise_time',
    'Standard',
    'Time Measurements',
    'Rise Time',
    ['rise time', 'risetime'],
    'single_source',
    STANDARD_ADD_HEADERS,
    [],
    STANDARD_RESULT_HEADERS,
    ['RISETIME'],
    ['standard rise time measurement']
  ),
  entry(
    'standard.time.fall_time',
    'Standard',
    'Time Measurements',
    'Fall Time',
    ['fall time', 'falltime'],
    'single_source',
    STANDARD_ADD_HEADERS,
    [],
    STANDARD_RESULT_HEADERS,
    ['FALLTIME'],
    ['standard fall time measurement']
  ),
  entry(
    'standard.time.setup_time',
    'Standard',
    'Time Measurements',
    'Setup Time',
    ['setup time', 'setup'],
    'dual_source',
    STANDARD_ADD_HEADERS,
    ['MEASUrement:MEAS<x>:SOUrce2'],
    STANDARD_RESULT_HEADERS,
    ['SETUP'],
    ['standard setup measurement']
  ),
  entry(
    'standard.time.hold_time',
    'Standard',
    'Time Measurements',
    'Hold Time',
    ['hold time', 'hold'],
    'dual_source',
    STANDARD_ADD_HEADERS,
    ['MEASUrement:MEAS<x>:SOUrce2'],
    STANDARD_RESULT_HEADERS,
    ['HOLD'],
    ['standard hold measurement']
  ),
  entry(
    'standard.eye.eye_height',
    'Standard',
    'Eye Diagram Measurements',
    'Eye Height',
    ['eye height', 'eyeheight', 'eye diagram height'],
    'single_source',
    STANDARD_ADD_HEADERS,
    [],
    STANDARD_RESULT_HEADERS,
    ['EYEHIGH'],
    ['standard eye height measurement', 'measurement addmeas eyehigh', 'add eye height']
  ),
  entry(
    'standard.eye.eye_width',
    'Standard',
    'Eye Diagram Measurements',
    'Eye Width',
    ['eye width', 'eyewidth', 'eye diagram width'],
    'single_source',
    STANDARD_ADD_HEADERS,
    [],
    STANDARD_RESULT_HEADERS,
    ['WIDTHBER', 'EYEWIDTH'],
    ['standard eye width measurement', 'measurement addmeas eyewidth', 'add eye width']
  ),
  entry(
    'jitter.summary',
    'Jitter',
    'Jitter Measurements',
    'Jitter Summary',
    ['jitter summary', 'summary jitter', 'full jitter summary'],
    'single_source',
    JITTER_SUMMARY_HEADERS,
    [],
    STANDARD_RESULT_HEADERS,
    ['TIE', 'TJBER', 'RJ', 'DJ', 'PJ', 'DDJ', 'DCD', 'WIDTHBER'],
    ['jitter summary measurement', 'jittersummary', 'data rate pattern length jitter']
  ),
  entry(
    'jitter.tie',
    'Jitter',
    'Jitter Measurements',
    'TIE',
    ['tie', 'time interval error'],
    'single_source',
    STANDARD_ADD_HEADERS,
    [],
    STANDARD_RESULT_HEADERS,
    ['TIE'],
    ['jitter tie measurement']
  ),
  entry(
    'jitter.rj',
    'Jitter',
    'Jitter Measurements',
    'RJ',
    ['rj', 'random jitter'],
    'single_source',
    STANDARD_ADD_HEADERS,
    [],
    STANDARD_RESULT_HEADERS,
    ['RJ'],
    ['random jitter measurement']
  ),
  entry(
    'jitter.dj',
    'Jitter',
    'Jitter Measurements',
    'DJ',
    ['dj', 'deterministic jitter'],
    'single_source',
    STANDARD_ADD_HEADERS,
    [],
    STANDARD_RESULT_HEADERS,
    ['DJ'],
    ['deterministic jitter measurement']
  ),
  entry(
    'jitter.pj',
    'Jitter',
    'Jitter Measurements',
    'PJ',
    ['pj', 'periodic jitter'],
    'single_source',
    STANDARD_ADD_HEADERS,
    [],
    STANDARD_RESULT_HEADERS,
    ['PJ'],
    ['periodic jitter measurement']
  ),
  entry(
    'jitter.phase_noise',
    'Jitter',
    'Jitter Measurements',
    'Phase Noise',
    ['phase noise'],
    'single_source',
    STANDARD_ADD_HEADERS,
    [],
    STANDARD_RESULT_HEADERS,
    ['PHASENOISE'],
    ['jitter phase noise measurement']
  ),
  entry(
    'power.input.power_quality',
    'Power',
    'Input Analysis',
    'Power Quality',
    ['power quality', 'power factor', 'true power', 'apparent power', 'reactive power'],
    'voltage_current',
    POWER_ADD_HEADERS,
    [
      'POWer:POWer<x>:POWERQUALITY:VSOURce',
      'POWer:POWer<x>:POWERQUALITY:ISOURce',
      'POWer:POWer<x>:POWERQUALITY:STYPe',
    ],
    [
      'POWer:POWer<x>:RESUlts:CURRentacq:FREQUENCY?',
      'POWer:POWer<x>:RESUlts:CURRentacq:IRMS?',
      'POWer:POWer<x>:RESUlts:CURRentacq:VRMS?',
    ],
    ['TRUEPWR', 'APPPWR', 'REPWR', 'PWRFACTOR', 'PHASE', 'PWRFREQ', 'ICFACTOR', 'VCFACTOR', 'IRMS', 'VRMS'],
    ['power quality voltage current source']
  ),
  entry(
    'power.input.harmonics',
    'Power',
    'Input Analysis',
    'Harmonics',
    ['harmonics', 'power harmonics', 'thd', 'harmonic distortion'],
    'voltage_current',
    POWER_ADD_HEADERS,
    [
      'POWer:POWer<x>:HARMONICS:VSOURce',
      'POWer:POWer<x>:HARMONICS:ISOURce',
      'POWer:POWer<x>:HARMONICS:HSOURce',
      'POWer:POWer<x>:HARMONICS:STANDard',
      'POWer:POWer<x>:HARMONICS:CLASs',
      'POWer:POWer<x>:HARMONICS:HORDer',
      'POWer:POWer<x>:HARMONICS:POWERRating',
      'POWer:POWer<x>:HARMONICS:RCURRent',
      'POWer:POWer<x>:HARMONICS:IPOWer',
    ],
    [
      'POWer:POWer<x>:RESUlts:CURRentacq:FREQUENCY?',
      'POWer:POWer<x>:RESUlts:CURRentacq:IRMS?',
      'POWer:POWer<x>:RESUlts:CURRentacq:VRMS?',
      'POWer:POWer<x>:RESUlts:CURRentacq:F1MAG?',
      'POWer:POWer<x>:RESUlts:CURRentacq:F3MAG?',
    ],
    ['THDF', 'THDR', 'FREQUENCY', 'IRMS', 'VRMS', 'F1MAG', 'F3MAG'],
    ['power harmonics voltage current source', 'harmonics thdf thdr']
  ),
  entry(
    'power.input.inrush_current',
    'Power',
    'Input Analysis',
    'Inrush Current',
    ['inrush current', 'inrush'],
    'single_source',
    POWER_ADD_HEADERS,
    ['POWer:POWer<x>:INRUSHcurrent:INPUTSOurce', 'POWer:POWer<x>:INRUSHcurrent:PEAKCURRent'],
    POWER_RESULT_HEADERS,
    ['INRUSH'],
    ['power inrush current measurement']
  ),
  entry(
    'power.input.input_capacitance',
    'Power',
    'Input Analysis',
    'Input Capacitance',
    ['input capacitance', 'capacitance'],
    'voltage_current',
    POWER_ADD_HEADERS,
    [
      'POWer:POWer<x>:INPUTCAP:VSOURce',
      'POWer:POWer<x>:INPUTCAP:ISOURce',
      'POWer:POWer<x>:INPUTCAP:PEAKVOLTage',
      'POWer:POWer<x>:INPUTCAP:PEAKCURRent',
    ],
    POWER_RESULT_HEADERS,
    ['CAPACITANCE'],
    ['power input capacitance measurement']
  ),
  entry(
    'power.magnetic.inductance',
    'Power',
    'Magnetic Analysis',
    'Inductance',
    ['inductance', 'power inductance'],
    'voltage_current',
    POWER_ADD_HEADERS,
    [
      'POWer:POWer<x>:INDUCTANCE:VSOURce',
      'POWer:POWer<x>:INDUCTANCE:ISOURce',
      'POWer:POWer<x>:INDUCTANCE:EDGESource',
    ],
    POWER_RESULT_HEADERS,
    ['INDUCT'],
    ['power inductance magnetic analysis']
  ),
  entry(
    'power.magnetic.magnetic_property',
    'Power',
    'Magnetic Analysis',
    'Magnetic Property',
    ['magnetic property', 'bpeak', 'permeability'],
    'voltage_current',
    POWER_ADD_HEADERS,
    [
      'POWer:POWer<x>:MAGPROPERTY:ISOURce',
      'POWer:POWer<x>:MAGPROPERTY:VSOURce',
      'POWer:POWer<x>:MAGPROPERTY:AREAofcrosssection',
      'POWer:POWer<x>:MAGPROPERTY:LENgth',
      'POWer:POWer<x>:MAGPROPERTY:PRIMARYTURNs',
      'POWer:POWer<x>:MAGPROPERTY:UNITs',
    ],
    POWER_RESULT_HEADERS,
    ['BPEAK', 'BR', 'HC', 'HMAX', 'IRIPPLE', 'DELTAB', 'DELTAH', 'PERMEABILITY'],
    ['power magnetic property measurement']
  ),
  entry(
    'power.magnetic.magnetic_loss',
    'Power',
    'Magnetic Analysis',
    'Magnetic Loss',
    ['magnetic loss', 'magloss'],
    'voltage_current',
    POWER_ADD_HEADERS,
    ['POWer:POWer<x>:MAGNETICLOSS:VSOURce', 'POWer:POWer<x>:MAGNETICLOSS:ISOURce'],
    POWER_RESULT_HEADERS,
    ['MAGLOSS'],
    ['power magnetic loss measurement']
  ),
  entry(
    'power.magnetic.i_vs_integral_v',
    'Power',
    'Magnetic Analysis',
    'I vs. ∫V',
    ['i vs integral v', 'i vs int v', 'ivsintv', 'i versus integral v'],
    'voltage_current',
    POWER_ADD_HEADERS,
    ['POWer:POWer<x>:IVSINTEGRALV:VSOURce', 'POWer:POWer<x>:IVSINTEGRALV:ISOURce'],
    POWER_RESULT_HEADERS,
    ['IVSINTV'],
    ['power ivs integral v measurement']
  ),
  entry(
    'imda.electrical.power_quality',
    'IMDA',
    'Electrical Analysis',
    'Power Quality',
    ['imda power quality', 'motor power quality'],
    'single_source',
    POWER_ADD_HEADERS,
    [],
    POWER_RESULT_HEADERS,
    ['TRUEPWR', 'APPPWR', 'REPWR', 'PWRFACTOR', 'PHASE'],
    ['imda electrical power quality']
  ),
  entry(
    'imda.electrical.harmonics',
    'IMDA',
    'Electrical Analysis',
    'Harmonics',
    ['imda harmonics', 'motor harmonics'],
    'single_source',
    POWER_ADD_HEADERS,
    ['POWer:POWer<x>:HARMONICS:HSOURce'],
    POWER_RESULT_HEADERS,
    ['THDF', 'THDR', 'FREQUENCY'],
    ['imda harmonics']
  ),
  entry(
    'imda.electrical.ripple',
    'IMDA',
    'Electrical Analysis',
    'Ripple',
    ['imda ripple', 'motor ripple'],
    'single_source',
    POWER_ADD_HEADERS,
    [],
    POWER_RESULT_HEADERS,
    ['IRIPPLE'],
    ['imda ripple measurement']
  ),
  entry(
    'imda.electrical.efficiency',
    'IMDA',
    'Electrical Analysis',
    'Efficiency',
    ['imda efficiency', 'motor efficiency', 'efficiency'],
    'single_source',
    POWER_ADD_HEADERS,
    ['POWer:POWer<x>:EFFICIENCY:VSOUrce', 'POWer:POWer<x>:EFFICIENCY:ISOUrce'],
    POWER_RESULT_HEADERS,
    ['EFFICIENCY1', 'TOTALEFFICIENCY', 'INPUTPWR', 'OUTPUT1PWR'],
    ['imda efficiency measurement']
  ),
  entry(
    'imda.electrical.dq0',
    'IMDA',
    'Electrical Analysis',
    'DQ0',
    ['dq0', 'park transform'],
    'single_source',
    POWER_ADD_HEADERS,
    [],
    POWER_RESULT_HEADERS,
    ['DQ0'],
    ['imda dq0 measurement']
  ),
  entry(
    'dpm.ripple.ripple',
    'DPM',
    'Ripple Analysis',
    'Ripple',
    ['dpm ripple', 'dc ripple', 'ripple'],
    'power_rail',
    POWER_ADD_HEADERS,
    ['POWer:POWer<x>:LINERIPPLE:INPUTSOurce', 'POWer:POWer<x>:LINERIPPLE:LFREQuency'],
    POWER_RESULT_HEADERS,
    ['LRIPRMS', 'LRIPPKPK', 'SWRIPRMS', 'SWRIPPKPK'],
    ['dpm ripple analysis power rail']
  ),
  entry(
    'dpm.jitter.tie',
    'DPM',
    'Jitter Analysis',
    'TIE',
    ['dpm tie', 'power rail tie'],
    'power_rail',
    POWER_ADD_HEADERS,
    [],
    POWER_RESULT_HEADERS,
    ['TIE'],
    ['dpm jitter tie']
  ),
  entry(
    'dpm.jitter.eye_height',
    'DPM',
    'Jitter Analysis',
    'Eye Height',
    ['dpm eye height', 'eye height'],
    'power_rail',
    POWER_ADD_HEADERS,
    [],
    POWER_RESULT_HEADERS,
    ['EYEHIGH'],
    ['dpm eye height']
  ),
  entry(
    'dpm.jitter.eye_width',
    'DPM',
    'Jitter Analysis',
    'Eye Width',
    ['dpm eye width', 'eye width'],
    'power_rail',
    POWER_ADD_HEADERS,
    [],
    POWER_RESULT_HEADERS,
    ['WIDTHBER'],
    ['dpm eye width']
  ),
  entry(
    'wbg.parameter.eon',
    'WBG-DPT',
    'Switching Parameter Analysis',
    'Eon',
    ['eon', 'turn on energy'],
    'voltage_current_gate',
    WBG_ADD_HEADERS,
    ['POWer:POWer<x>:TYPe'],
    POWER_RESULT_HEADERS,
    ['TONENRG'],
    ['wbg dpt turn on energy']
  ),
  entry(
    'wbg.parameter.eoff',
    'WBG-DPT',
    'Switching Parameter Analysis',
    'Eoff',
    ['eoff', 'turn off energy'],
    'voltage_current_gate',
    WBG_ADD_HEADERS,
    ['POWer:POWer<x>:TYPe'],
    POWER_RESULT_HEADERS,
    ['TOFFENRG'],
    ['wbg dpt turn off energy']
  ),
  entry(
    'wbg.parameter.vpeak',
    'WBG-DPT',
    'Switching Parameter Analysis',
    'Vpeak',
    ['vpeak', 'peak voltage'],
    'voltage_current_gate',
    WBG_ADD_HEADERS,
    ['POWer:POWer<x>:TYPe'],
    POWER_RESULT_HEADERS,
    ['MAX'],
    ['wbg dpt vpeak']
  ),
  entry(
    'wbg.parameter.ipeak',
    'WBG-DPT',
    'Switching Parameter Analysis',
    'Ipeak',
    ['ipeak', 'peak current'],
    'voltage_current_gate',
    WBG_ADD_HEADERS,
    ['POWer:POWer<x>:TYPe'],
    POWER_RESULT_HEADERS,
    ['MAX'],
    ['wbg dpt ipeak']
  ),
  entry(
    'wbg.parameter.rdson',
    'WBG-DPT',
    'Switching Parameter Analysis',
    'RDS(on)',
    ['rds on', 'rds(on)', 'rdson'],
    'voltage_current_gate',
    WBG_ADD_HEADERS,
    ['POWer:POWer<x>:RDSON:VSOURce', 'POWer:POWer<x>:RDSON:ISOURce', 'POWer:POWer<x>:RDSON:DEVICEType'],
    POWER_RESULT_HEADERS,
    ['RDS'],
    ['wbg dpt rdson']
  ),
  entry(
    'wbg.timing.tdon',
    'WBG-DPT',
    'Switching Timing Analysis',
    'Td(on)',
    ['td on', 'td(on)', 'turn on delay', 'turn-on delay'],
    'voltage_current_gate',
    WBG_ADD_HEADERS,
    ['POWer:POWer<x>:REFLevels:METHod', 'POWer:POWer<x>:REFLevels:PERCent:RISEMid'],
    POWER_RESULT_HEADERS,
    ['OUTPUT1'],
    ['wbg dpt td on']
  ),
  entry(
    'wbg.timing.tdoff',
    'WBG-DPT',
    'Switching Timing Analysis',
    'Td(off)',
    ['td off', 'td(off)', 'turn off delay', 'turn-off delay'],
    'voltage_current_gate',
    WBG_ADD_HEADERS,
    ['POWer:POWer<x>:REFLevels:METHod', 'POWer:POWer<x>:REFLevels:PERCent:FALLMid'],
    POWER_RESULT_HEADERS,
    ['OUTPUT2'],
    ['wbg dpt td off']
  ),
  entry(
    'wbg.timing.tr',
    'WBG-DPT',
    'Switching Timing Analysis',
    'Tr',
    ['tr', 'rise transition'],
    'voltage_current_gate',
    WBG_ADD_HEADERS,
    ['POWer:POWer<x>:REFLevels:METHod'],
    POWER_RESULT_HEADERS,
    ['DVBYDT'],
    ['wbg dpt tr']
  ),
  entry(
    'wbg.timing.tf',
    'WBG-DPT',
    'Switching Timing Analysis',
    'Tf',
    ['tf', 'fall transition'],
    'voltage_current_gate',
    WBG_ADD_HEADERS,
    ['POWer:POWer<x>:REFLevels:METHod'],
    POWER_RESULT_HEADERS,
    ['DIBYDT'],
    ['wbg dpt tf']
  ),
];

/**
 * Dictionary mapping user-friendly measurement names to ADDMEAS enum values.
 * Used to resolve "add eye height" → MEASUrement:ADDMEAS EYEHIGH
 */
export const ADDMEAS_DICTIONARY: Record<string, string> = {
  // Eye diagram
  'eye height': 'EYEHIGH',
  'eyeheight': 'EYEHIGH',
  'eye width': 'WIDTHBER',
  'eyewidth': 'WIDTHBER',
  // Jitter
  'jitter': 'TIE',
  'tie': 'TIE',
  'time interval error': 'TIE',
  'random jitter': 'RJ',
  'rj': 'RJ',
  'deterministic jitter': 'DJ',
  'dj': 'DJ',
  'periodic jitter': 'PJ',
  'pj': 'PJ',
  'total jitter': 'TJ',
  'tj': 'TJ',
  // Time
  'rise time': 'RISETIME',
  'risetime': 'RISETIME',
  'fall time': 'FALLTIME',
  'falltime': 'FALLTIME',
  'period': 'PERIOD',
  'frequency': 'FREQUENCY',
  'freq': 'FREQUENCY',
  'duty cycle': 'PDUTY',
  'positive duty': 'PDUTY',
  'negative duty': 'NDUTY',
  'positive width': 'PWIDTH',
  'negative width': 'NWIDTH',
  'burst width': 'BURST',
  'delay': 'DELAY',
  'phase': 'PHASE',
  'setup time': 'SETUP',
  'hold time': 'HOLD',
  // Amplitude
  'amplitude': 'AMPLITUDE',
  'maximum': 'MAXIMUM',
  'max': 'MAXIMUM',
  'minimum': 'MINIMUM',
  'min': 'MINIMUM',
  'peak to peak': 'PK2PK',
  'pk2pk': 'PK2PK',
  'peak-to-peak': 'PK2PK',
  'pkpk': 'PK2PK',
  'mean': 'MEAN',
  'average': 'MEAN',
  'rms': 'RMS',
  'high': 'HIGH',
  'low': 'LOW',
  'overshoot': 'POVERSHOOT',
  'positive overshoot': 'POVERSHOOT',
  'negative overshoot': 'NOVERSHOOT',
  'undershoot': 'NOVERSHOOT',
  'preshoot': 'PRESHOOT',
  'area': 'ACRMS',
  'snr': 'SNR',
  'signal to noise': 'SNR',
  'thd': 'THDF',
};

/**
 * Resolve a user query to an ADDMEAS enum value using the dictionary.
 * Returns null if no match found.
 */
export function resolveAddmeasValue(query: string): string | null {
  const q = query.toLowerCase().trim();
  // Try exact match first
  if (ADDMEAS_DICTIONARY[q]) return ADDMEAS_DICTIONARY[q];
  // Try matching substrings
  for (const [key, value] of Object.entries(ADDMEAS_DICTIONARY)) {
    if (q.includes(key)) return value;
  }
  return null;
}

function normalizeQuery(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[()]/g, ' ')
    .replace(/[^a-z0-9+\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsAlias(normalizedQuery: string, aliasText: string): boolean {
  if (!aliasText) return false;
  if (aliasText.length <= 3) {
    const escaped = aliasText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`).test(normalizedQuery);
  }
  return normalizedQuery.includes(aliasText);
}

export function findMeasurementCatalogMatches(query: string): MeasurementCatalogMatch[] {
  const normalized = normalizeQuery(query);
  if (!normalized) return [];

  const matches: MeasurementCatalogMatch[] = [];
  MEASUREMENT_CATALOG.forEach((entry) => {
    let score = 0;
    const matchedAliases: string[] = [];

    const tabText = normalizeQuery(entry.tab);
    const sectionText = normalizeQuery(entry.section);
    const labelText = normalizeQuery(entry.label);

    if (containsAlias(normalized, labelText)) {
      score += 8;
      matchedAliases.push(entry.label);
    }
    if (normalized.includes(tabText)) score += 2;
    if (normalized.includes(sectionText)) score += 3;

    entry.aliases.forEach((alias) => {
      const aliasText = normalizeQuery(alias);
      if (!aliasText) return;
      if (containsAlias(normalized, aliasText)) {
        score += Math.max(4, aliasText.split(' ').length + 3);
        matchedAliases.push(alias);
      }
    });

    entry.searchHints.forEach((hint) => {
      const hintText = normalizeQuery(hint);
      if (hintText && normalized.includes(hintText)) score += 2;
    });

    if (score >= 4) {
      matches.push({ entry, score, matchedAliases: Array.from(new Set(matchedAliases)) });
    }
  });

  return matches.sort((a, b) => b.score - a.score).slice(0, 6);
}

export function buildMeasurementSearchPlan(query: string): MeasurementSearchPlan | null {
  const matches = findMeasurementCatalogMatches(query);
  if (!matches.length) return null;

  const normalizedQuery = normalizeQuery(query);
  const wantsResults =
    /\b(query|read|return|results?|value|values|stat|statistics|max(?:imum)?|min(?:imum)?|mean|avg|average)\b/.test(
      normalizedQuery
    ) && !/\b(add|create|setup|configure|set)\b/.test(normalizedQuery);

  const exactHeaders = Array.from(
    new Set(
      matches.flatMap((match) => {
        const headers = wantsResults
          ? [...match.entry.resultHeaders, ...match.entry.addHeaders, ...match.entry.configHeaders]
          : [...match.entry.addHeaders, ...match.entry.configHeaders];
        return headers;
      })
    )
  );

  const searchTerms = Array.from(
    new Set(
      matches.flatMap((match) => {
        const focusedTerms = [
          match.entry.label,
          `${match.entry.tab} ${match.entry.label}`,
          ...match.entry.aliases,
          ...match.entry.searchHints,
        ];
        if (wantsResults) focusedTerms.push(...match.entry.resultTokens);
        return focusedTerms;
      })
    )
  );

  const resultTokens = Array.from(new Set(matches.flatMap((match) => match.entry.resultTokens)));

  return {
    matches,
    exactHeaders,
    searchTerms,
    resultTokens,
    wantsResults,
  };
}
