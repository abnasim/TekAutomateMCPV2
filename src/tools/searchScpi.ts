import { getCommandIndex, type CommandType, type CommandRecord } from '../core/commandIndex';
import { classifyIntent } from '../core/intentMap';
import { buildMeasurementSearchPlan } from '../core/measurementCatalog';
import type { ToolResult } from '../core/schemas';
import { serializeCommandResult, serializeCommandSearchResult } from './commandResultShape';

interface SearchScpiInput {
  query: string;
  modelFamily?: string;
  limit?: number;
  offset?: number;
  commandType?: CommandType;
  verbosity?: 'summary' | 'full';
  sourceMetaMode?: 'compact' | 'full';
}

const DEFAULT_SEARCH_LIMIT = 10;

function buildSearchSourceMeta(
  entries: CommandRecord[],
  mode: 'compact' | 'full' = 'compact',
): ToolResult<unknown[]>['sourceMeta'] {
  if (mode === 'full') {
    return entries.map((e) => ({
      file: e.sourceFile,
      commandId: e.commandId,
      section: e.group,
    }));
  }
  const seen = new Set<string>();
  const compact: ToolResult<unknown[]>['sourceMeta'] = [];
  for (const entry of entries) {
    const key = `${entry.sourceFile}:${entry.group}`;
    if (seen.has(key)) continue;
    seen.add(key);
    compact.push({
      file: entry.sourceFile,
      section: entry.group,
    });
  }
  return compact;
}

// ── Group affinity map ───────────────────────────────────────────────
// Maps intent → groups that SHOULD appear in results.
// Everything else gets penalized.
const GROUP_AFFINITY: Record<string, Set<string>> = {
  trigger: new Set(['Trigger']),
  measurement: new Set(['Measurement']),
  power: new Set(['Power', 'Digital Power Management']),
  bus: new Set(['Bus', 'Trigger']),
  vertical: new Set(['Vertical']),
  horizontal: new Set(['Horizontal', 'Acquisition']),
  display: new Set(['Display', 'Cursor']),
  save: new Set(['Save and Recall', 'File System', 'Save on', 'PI Only']),
  acquisition: new Set(['Acquisition', 'Horizontal']),
  math: new Set(['Math', 'Spectrum view']),
  mask: new Set(['Mask']),
  search: new Set(['Search and Mark']),
  digital: new Set(['Digital']),
  dvm: new Set(['DVM']),
  dpm: new Set(['Digital Power Management']),
  imda: new Set(['Inverter Motors and Drive Analysis']),
  wbg: new Set(['Wide Band Gap Analysis (WBG)']),
  misc: new Set(['Miscellaneous', 'Status and Error', 'PI Only']),
  status: new Set(['Status and Error', 'Miscellaneous', 'PI Only']),
  // New intents from expanded intentMap
  ieee488: new Set(['PI Only', 'Miscellaneous', 'Status and Error']),
  awg: new Set(['AWG', 'AWG Plugin', 'Miscellaneous']),
  rsa: new Set(['SignalVu', 'RSA', 'Miscellaneous']),
  afg: new Set(['AFG']),
  network: new Set(['Ethernet', 'Miscellaneous']),
  calibration: new Set(['Calibration', 'Miscellaneous']),
  filesystem: new Set(['File System', 'Save and Recall']),
  event: new Set(['Act On Event', 'Save on']),
  waveform: new Set(['Waveform Transfer', 'Acquisition']),
  power: new Set(['Power', 'Measurement']),
};

// Groups that should NEVER appear for non-matching intents
const HARD_PENALIZED_GROUPS = new Set([
  'Power', 'Digital Power Management', 'Inverter Motors and Drive Analysis',
  'Wide Band Gap Analysis (WBG)', 'AFG',
]);

// Groups that are noisy — they contain "trigger" or "search" keywords
// but are NOT the primary Trigger or Search group
const NOISY_GROUPS_FOR_TRIGGER = new Set([
  'Search and Mark', 'Bus',
]);

function headerCandidates(raw: string): string[] {
  const q = raw.trim();
  if (!q) return [];
  const candidates = new Set<string>([q]);
  candidates.add(q.replace(/\?$/, ''));
  candidates.add(q.replace(/\bCH\d+_D\d+\b/gi, 'CH<x>_D<x>'));
  candidates.add(q.replace(/\bCH\d+\b/gi, 'CH<x>'));
  candidates.add(q.replace(/\bREF\d+\b/gi, 'REF<x>'));
  candidates.add(q.replace(/\bMATH\d+\b/gi, 'MATH<x>'));
  candidates.add(q.replace(/\bBUS\d+\b/gi, 'BUS<x>'));
  candidates.add(q.replace(/:MEAS\d+/gi, ':MEAS<x>'));
  candidates.add(q.replace(/\bMEAS\d+\b/gi, 'MEAS<x>'));
  candidates.add(q.replace(/:SOURCE\d+/gi, ':SOURCE'));
  candidates.add(q.replace(/\bSOURCE\d+\b/gi, 'SOURCE'));
  candidates.add(q.replace(/\bEDGE\d+\b/gi, 'EDGE'));
  candidates.add(q.replace(/\bREFLEVELS\d+\b/gi, 'REFLevels'));
  candidates.add(q.replace(/:RESUlts\d+/gi, ':RESUlts'));
  return Array.from(candidates).filter(Boolean);
}

/**
 * Re-rank search results using intent classification and group-aware scoring.
 * Uses the same classifyIntent() as smart_scpi_lookup so both paths converge.
 *
 * The key insight: BM25 returns commands that mention query keywords anywhere
 * (header, description, tags). But "edge trigger level" should return
 * TRIGger:A:EDGE:LEVel, not SEARCH:SEARCH<x>:TRIGger:A:BUS:CPHY:...
 * even though both mention "trigger" in their header.
 *
 * We fix this by:
 * 1. Boosting commands in the correct group (+25)
 * 2. Hard-penalizing commands from wrong specialty groups (-60)
 * 3. Penalizing noisy cross-group matches (-30 for Search/Bus when intent is Trigger)
 * 4. Boosting header TOKEN matches (not just substring) for query words
 * 5. Penalizing deeply nested headers (SEARCH:SEARCH<x>:TRIGger:A:BUS:CPHY:... is 8 tokens deep)
 */
function reRankWithIntent(
  results: CommandRecord[],
  query: string,
): CommandRecord[] {
  if (results.length <= 1) return results;

  const intent = classifyIntent(query);
  const affinityGroups = GROUP_AFFINITY[intent.intent];
  const queryLower = query.toLowerCase();
  const wantsPower = /\b(power|wbg|dpm|switching|inductance|magnetic|efficiency|harmonics|soa)\b/i.test(queryLower);

  // Split query into meaningful words for token matching
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
  const subjectWords = intent.subject.split(/[_\s]+/).filter(w => w.length > 1);

  const scored = results.map((cmd) => {
    let score = 0;
    const cmdGroup = cmd.group || '';
    const headerLower = cmd.header.toLowerCase();
    // Keep original-case tokens for SCPI mnemonic matching
    const headerTokensRaw = cmd.header.replace(/[{}<>?|]/g, '').split(/[:\s]+/).filter(Boolean);
    const headerTokens = headerTokensRaw.map(t => t.toLowerCase());

    // Also extract SCPI argument names/values from the command record
    const argNames = (cmd.arguments || []).map(a => a.name.toLowerCase());
    const argDescriptions = (cmd.arguments || []).map(a => a.description.toLowerCase()).join(' ');

    // ── 1. Group affinity ──
    if (affinityGroups) {
      if (affinityGroups.has(cmdGroup)) {
        score += 25;  // Right group
      } else if (HARD_PENALIZED_GROUPS.has(cmdGroup) && !wantsPower) {
        score -= 60;  // Specialty group, definitely wrong
      } else if (intent.intent === 'trigger' && NOISY_GROUPS_FOR_TRIGGER.has(cmdGroup)) {
        score -= 30;  // Search/Bus commands with "trigger" in path — noisy
      } else {
        score -= 15;  // Wrong group, mild penalty
      }
    }

    // ── 2. SCPI mnemonic-aware token matching ──
    // SCPI uses mixed-case mnemonics: LEVel, SLOpe, SOUrce, FREQuency
    // The uppercase part is the abbreviation. We match query words against:
    //   - Full token lowercase: "level" matches "level" in "LEVel"
    //   - SCPI abbreviation: extract uppercase chars → "LEV" from "LEVel"
    //   - startsWith in both directions
    // This is a BIG improvement — "level" now matches LEVel in TRIGger:A:LEVel
    // even when the BM25 raw header is "trigger:a:level:ch<x>"

    const scpiAbbreviations = headerTokensRaw.map(t => {
      // Extract uppercase letters as the SCPI abbreviation
      const upper = t.replace(/[^A-Z]/g, '');
      return upper.length >= 2 ? upper.toLowerCase() : t.toLowerCase();
    });

    let tokenMatchCount = 0;
    for (const word of queryWords) {
      const matched = headerTokens.some(t => t === word || t.startsWith(word) || word.startsWith(t))
        || scpiAbbreviations.some(a => a === word || a.startsWith(word) || word.startsWith(a))
        || argNames.some(a => a === word || a.startsWith(word));
      if (matched) {
        score += 10;
        tokenMatchCount++;
      }
    }
    for (const word of subjectWords) {
      const wordLower = word.toLowerCase();
      const matched = headerTokens.some(t => t === wordLower || t.startsWith(wordLower) || wordLower.startsWith(t))
        || scpiAbbreviations.some(a => a === wordLower || a.startsWith(wordLower) || wordLower.startsWith(a));
      if (matched) {
        score += 15;
        tokenMatchCount++;
      }
    }
    // Bonus for matching MULTIPLE query words (compound match = better fit)
    if (tokenMatchCount >= 3) score += 12;
    else if (tokenMatchCount >= 2) score += 6;

    // ── Focus word boost ──
    // The last meaningful word in the query is usually the most specific part.
    // "edge trigger level" → focus is "level", not "edge" or "trigger"
    // "save waveform to usb" → focus is "waveform" (skip stop words like "to", "usb")
    const focusWord = queryWords.filter(w => !['to', 'the', 'a', 'an', 'on', 'in', 'for', 'of', 'with'].includes(w)).pop();
    if (focusWord) {
      const focusMatched = headerTokens.some(t => t === focusWord || t.startsWith(focusWord) || focusWord.startsWith(t))
        || scpiAbbreviations.some(a => a === focusWord || a.startsWith(focusWord) || focusWord.startsWith(a));
      if (focusMatched) {
        score += 12;  // Strong boost for matching the focus word
      }
    }

    // ── 3. Header depth/simplicity preference ──
    // Shorter headers are usually the primary command, longer ones are sub-settings.
    // Graduated bonus: fewer tokens = more likely to be the main command.
    const tokenBonus = Math.max(0, 12 - headerTokens.length * 2);  // 2 tokens=+8, 3=+6, 4=+4, 5=+2, 6+=0
    score += tokenBonus;

    // ── 4. Prefer TRIGger:A over TRIGger:B and RESET variants ──
    if (intent.intent === 'trigger') {
      if (headerLower.includes('trigger:a:') || headerLower.includes('trigger:{a|b}')) {
        score += 10;  // Primary trigger
      }
      if (headerLower.includes('trigger:b:') && !headerLower.includes('{a|b}')) {
        score -= 15;  // Secondary trigger — user almost never means B specifically
      }
      if (headerLower.includes(':reset:')) {
        score -= 20;  // RESET is a sub-variant of trigger B, rarely wanted
      }
    }

    // ── 5. Prefer STATE/enable commands for feature queries ──
    if (headerTokens.some(t => t === 'state' || t === 'enable')) {
      score += 5;
    }

    // ── 5b. Subject-specific header boosts ──
    // zone_trigger → VISual:* commands, not SEARCH:* or TRIGger:*
    // This needs to be DOMINANT because BM25 scores for CPHY/bus commands are very high
    if (intent.subject === 'zone_trigger') {
      if (headerLower.startsWith('visual')) {
        score += 80;
      } else {
        score -= 40;
      }
    }
    // trigger_level → commands with LEVel in header
    if (intent.subject === 'trigger_level') {
      if (headerTokens.some(t => t === 'level' || t.startsWith('lev'))) {
        score += 20;
      }
    }
    // trigger_slope → commands with SLOpe in header
    if (intent.subject === 'trigger_slope') {
      if (headerTokens.some(t => t === 'slope' || t.startsWith('slo'))) {
        score += 20;
      }
    }

    // spectrum_view → SV:* commands
    if (intent.subject === 'spectrum_view') {
      if (headerLower.startsWith('sv:') || headerLower.includes(':sv:')) {
        score += 80;
      } else {
        score -= 40;
      }
    }
    // eye_diagram → Measurement eye/jitter commands, not RSA/audio
    if (intent.subject === 'eye_diagram') {
      if (headerLower.includes('measurement') || headerLower.includes('eyemask')) {
        score += 20;
      }
      // Penalize RSA/audio/DPX commands
      if (headerLower.includes('fetch:') || headerLower.includes('read:') || headerLower.includes('audio')) {
        score -= 50;
      }
    }
    // power_harmonics → POWer:* HARMONICS commands, not audio THD
    if (intent.subject === 'power_harmonics') {
      if (headerLower.includes('power') && headerLower.includes('harmonics')) {
        score += 40;
      } else if (headerLower.startsWith('power:')) {
        score += 15;
      }
      if (headerLower.includes('audio') || headerLower.includes('fetch:')) {
        score -= 50;
      }
    }

    // power_soa → POWer:*:SOA commands
    if (intent.subject === 'power_soa') {
      if (headerLower.includes('soa')) {
        score += 60;
      } else if (headerLower.startsWith('power:')) {
        score += 10;
      } else {
        score -= 30;
      }
    }
    // afg → AFG:* commands, not measurement frequency
    if (intent.subject === 'afg') {
      if (headerLower.startsWith('afg:')) {
        score += 80;
      } else {
        score -= 40;
      }
    }
    // histogram_box → HIStogram:BOX commands
    if (intent.subject === 'histogram_box') {
      if (headerLower.includes('histogram') || headerLower.includes('hist')) {
        score += 40;
      } else {
        score -= 20;
      }
    }

    // dvm → DVM:* commands, not measurement RMS
    if (intent.subject === 'dvm') {
      if (headerLower.startsWith('dvm')) {
        score += 80;
      } else {
        score -= 40;
      }
    }
    // dphy/cphy → BUS:B<x>:DPHY/CPHY commands
    if (intent.subject === 'dphy' || intent.subject === 'cphy') {
      const proto = intent.subject.toUpperCase();
      if (headerLower.includes(proto.toLowerCase())) {
        score += 40;
      }
      if (headerLower.startsWith('bus:')) {
        score += 15;
      }
    }
    // rise_time → measurement commands, penalize SEARCH timeout
    if (intent.subject === 'rise_time') {
      if (headerLower.includes('measurement') || headerLower.includes('addmeas')) {
        score += 20;
      }
      if (headerLower.startsWith('search:')) {
        score -= 20;
      }
    }

    // statistics + "badge" in query → DISPlaystat commands
    if (intent.subject === 'statistics' && /badge/i.test(queryLower)) {
      if (headerLower.includes('displaystat')) {
        score += 40;
      }
    }

    // plot → PLOT:* commands, not measurement jitter
    if (intent.subject === 'plot') {
      if (headerLower.startsWith('plot:')) {
        score += 60;
      } else {
        score -= 30;
      }
    }
    // waveform_preamble → WFMOutpre:* commands
    if (intent.subject === 'waveform_preamble') {
      if (headerLower.startsWith('wfmoutpre')) {
        score += 80;
      } else {
        score -= 40;
      }
    }
    // trigger_sequence → TRIGger:B:BY/TIMe, not Ethernet TCP SEQnum
    if (intent.subject === 'trigger_sequence') {
      if (headerLower.includes('trigger:b:') || headerLower.includes('trigger:{a|b}')) {
        score += 40;
      }
      if (headerLower.includes('ethernet') || headerLower.includes('tcp') || headerLower.includes('seq')) {
        score -= 50;
      }
    }

    // channel_on/off → DISplay:GLObal:CH<x>:STATE, not IF output
    if (intent.subject === 'channel_on' || intent.subject === 'channel_off') {
      if (headerLower.includes('display:global') || headerLower.includes('ch<x>:state')) {
        score += 40;
      }
      if (headerLower.includes('output') || headerLower.includes('if:')) {
        score -= 40;
      }
    }
    // digital_threshold → CH<x>:DIGItal:THReshold, not probe degauss
    if (intent.subject === 'digital_threshold') {
      if (headerLower.includes('digital') && headerLower.includes('threshold')) {
        score += 50;
      }
      if (headerLower.includes('probe') || headerLower.includes('degauss')) {
        score -= 40;
      }
    }
    // search_navigate → MARK:SELECTED:NEXT/PREV, not SEARCHTABle:DELete
    if (intent.subject === 'search_navigate') {
      if (headerLower.includes('mark:') || headerLower.includes('navigate')) {
        score += 40;
      }
      if (headerLower.includes('delete') || headerLower.includes('table')) {
        score -= 30;
      }
    }
    // math_channel → MATH:DEFine or MATH:ADDNew, not MATH:STATE
    if (intent.subject === 'math_channel') {
      if (headerLower.includes('define') || headerLower.includes('addnew')) {
        score += 30;
      }
      if (headerLower.includes(':state') && !headerLower.includes('addnew')) {
        score -= 15;
      }
    }

    // runt trigger → RUNT commands, not SETHold
    if (intent.subject === 'runt') {
      if (headerLower.includes('runt')) {
        score += 40;
      }
      if (headerLower.includes('sethold') || headerLower.includes('holdtime')) {
        score -= 30;
      }
    }
    // averaging → ACQuire:NUMAVg, not horizontal record length
    if (intent.subject === 'averaging') {
      if (headerLower.includes('numavg') || headerLower.includes('acquire:mode')) {
        score += 40;
      }
      if (headerLower.includes('horizontal') || headerLower.includes('record')) {
        score -= 20;
      }
    }

    // bus intent → prefer TRIGger:A:BUS over SEARCH:SEARCH<x>:TRIGger:A:BUS
    if (intent.intent === 'bus') {
      if (headerLower.startsWith('trigger:') || headerLower.startsWith('trigger:{')) {
        score += 10;
      }
      if (headerLower.startsWith('search:search')) {
        score -= 10;
      }
      if (headerLower.startsWith('bus:')) {
        score += 15;
      }
    }

    // waveform_transfer → WFMOutpre/DATa/CURVe commands, not trigger
    if (intent.subject === 'waveform_transfer') {
      if (headerLower.includes('wfmoutpre') || headerLower.includes('data:') || headerLower.startsWith('curve')) {
        score += 40;
      }
      if (headerLower.includes('trigger')) {
        score -= 30;
      }
    }
    // dpm → DPM-specific measurement commands
    if (intent.subject === 'dpm') {
      if (headerLower.includes('dpm')) {
        score += 30;
      }
    }

    // ── 6. Exact SCPI-style match boost ──
    if (queryLower.includes(':') && headerLower.includes(queryLower.replace(/\?$/, ''))) {
      score += 50;
    }

    // ── 7. POWer:ADDNew specific penalty ──
    if (headerLower === 'power:addnew' && !wantsPower) {
      score -= 40;
    }

    // ── AWG intent boosting ──
    if (intent.intent === 'awg') {
      // Strong boost for AWG-specific commands
      if (headerLower.startsWith('awgcontrol') || headerLower.startsWith('outp') ||
          headerLower.startsWith('clock') || headerLower.startsWith('wplugin') ||
          headerLower.startsWith('hsserial') || headerLower.startsWith('radar:') ||
          headerLower.startsWith('pulse:') || headerLower.startsWith('source') ||
          headerLower.startsWith('slist') || headerLower.startsWith('wlist')) {
        score += 40;
      }
      // Strong penalty for scope-specific commands when AWG intent
      if (headerLower.startsWith('trigger:') || headerLower.startsWith('trig:') ||
          headerLower.startsWith('acquire:') || headerLower.startsWith('acq:') ||
          headerLower.startsWith('measurement:') || headerLower.startsWith('meas:') ||
          headerLower.startsWith('bus:') || headerLower.startsWith('search:') ||
          headerLower.startsWith('horizontal:') || headerLower.startsWith('hor:') ||
          headerLower.startsWith('ch1:') || headerLower.startsWith('ch2:')) {
        score -= 50;
      }
      // Subject-specific boosts
      if (intent.subject === 'awg_plugin' || intent.subject === 'awg_radar' || intent.subject === 'awg_hsserial') {
        if (headerLower.includes('wplugin') || headerLower.includes('active')) score += 30;
        if (headerLower.includes('hsserial') || headerLower.includes('radar') || headerLower.includes('pulse:')) score += 30;
      }
      if (intent.subject === 'awg_run') {
        if (headerLower.includes('awgcontrol') && headerLower.includes('run')) score += 50;
        if (headerLower.includes('immediate')) score += 20;
      }
      if (intent.subject === 'awg_compile') {
        if (headerLower.includes('compile') || headerLower.includes('overwrite') || headerLower.includes('play')) score += 40;
      }
      if (intent.subject === 'awg_output') {
        if (headerLower.match(/outp(ut)?\d*:state/i)) score += 50;
      }
      if (intent.subject === 'awg_clock') {
        if (headerLower.includes('clock') && headerLower.includes('srate')) score += 50;
        if (headerLower.includes('awgcontrol:clock')) score += 30;
      }
      if (intent.subject === 'awg_prbs') {
        if (headerLower.includes('prbs') || headerLower.includes('bdata')) score += 50;
      }
    }

    // ── IEEE 488 / misc intent boosting ──
    if (intent.intent === 'ieee488') {
      // Hard boost for star commands and PI Only commands
      if (headerLower.startsWith('*') || headerLower === 'header' || headerLower === 'allev') {
        score += 60;
      }
      if (headerLower === 'autoset' || headerLower === 'autoset:execute') {
        score += 50;
      }
      // Penalize everything else heavily
      if (!headerLower.startsWith('*') && !['header', 'allev', 'autoset', 'autoset:execute'].includes(headerLower)) {
        if (intent.subject === 'rst') {
          if (headerLower.includes('reset') || headerLower.includes('rst')) score += 30;
          else score -= 30;
        }
        if (intent.subject === 'cls') {
          if (headerLower.includes('cls') || headerLower.includes('clear')) score += 20;
        }
        if (intent.subject === 'idn') {
          if (headerLower.includes('idn') || headerLower.includes('ident')) score += 30;
          else score -= 20;
        }
        if (intent.subject === 'allev' || intent.subject === 'error_queue') {
          if (headerLower.includes('allev') || headerLower.includes('system:error')) score += 50;
        }
        if (intent.subject === 'header') {
          if (headerLower === 'header') score += 100;
          else score -= 20;
        }
        if (intent.subject === 'autoset') {
          if (headerLower === 'autoset' || headerLower === 'autoset:execute') score += 80;
          else score -= 20;
        }
      }
    }

    // ── RSA / SignalVu intent boosting ──
    if (intent.intent === 'rsa') {
      if (headerLower.startsWith('instrument:') || headerLower.includes('instrument:connect') ||
          headerLower.includes('instrument:disconnect') || headerLower.includes('system:preset') ||
          headerLower.startsWith('signalvu') || headerLower.includes(':connect') || headerLower.includes(':disconnect')) {
        score += 60;
      }
      if (intent.subject === 'rsa_connect') {
        if (headerLower.includes('instrument') && (headerLower.includes('connect') || headerLower.includes('disconnect'))) {
          score += 80;
        }
      }
      if (intent.subject === 'rsa_preset') {
        if (headerLower.includes('system:preset') || headerLower.includes('preset')) {
          score += 50;
        }
      }
    }

    // ── 8. RSA/Audio command penalty ──
    // RSA spectrum analyzer and audio commands pollute scope queries.
    // Only show them when explicitly asked for RSA/audio.
    const wantsRsa = /\b(rsa|signalvu|audio|spectrum\s*anal|connect.*scope|signalvu.?pc)\b/i.test(queryLower);
    if (!wantsRsa) {
      const isRsaAudio = headerLower.startsWith('fetch:') || headerLower.startsWith('read:')
        || headerLower.startsWith('[sense]') || headerLower.includes(':audio:')
        || headerLower.includes(':ofdm:') || headerLower.includes(':dpx:');
      if (isRsaAudio) {
        score -= 60;
      }
    }

    return { cmd, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.cmd);
}

export async function searchScpi(input: SearchScpiInput): Promise<ToolResult<unknown[]>> {
  const q = (input.query || '').trim();
  if (!q) {
    return { ok: true, data: [], sourceMeta: [], warnings: ['Empty query'] };
  }
  const index = await getCommandIndex();
  const limit = input.limit || DEFAULT_SEARCH_LIMIT;
  const offset = Math.max(0, input.offset || 0);
  const measurementPlan = buildMeasurementSearchPlan(q);

  // ── Query expansion for terms that don't match SCPI keywords ──
  // "zone trigger" → SCPI uses "VISual" not "zone"
  // "screenshot" → SCPI uses "SAVe:IMAGe" not "screenshot"
  const QUERY_EXPANSIONS: Array<{ pattern: RegExp; expand: string }> = [
    { pattern: /\bzone\s*trigger/i, expand: 'VISual AREA trigger zone' },
    { pattern: /\bvisual\s*trigger/i, expand: 'VISual AREA trigger' },
    { pattern: /\bscreenshot|save\s*image|screen\s*capture|hardcopy/i, expand: 'SAVe IMAGe HARDCopy screenshot image' },
    { pattern: /\bbaud\s*rate/i, expand: 'BITRate baud rate' },
    { pattern: /\brecord\s*length/i, expand: 'RECOrdlength horizontal record' },
    { pattern: /\bsample\s*rate/i, expand: 'SAMPLERate sample rate horizontal' },
    { pattern: /\barinc\s*429/i, expand: 'ARINC429A arinc bus' },
    { pattern: /\bmil.?std.?1553|mil.?1553/i, expand: 'MIL1553B mil bus' },
    { pattern: /\bstandard\s*dev/i, expand: 'STATIstics statistics STDDev measurement' },
    { pattern: /\bbadge\b.*\bstat/i, expand: 'DISPlaystat ENABle measurement badge statistics' },
    { pattern: /\bstat.*\bbadge/i, expand: 'DISPlaystat ENABle measurement badge statistics' },
    { pattern: /\bbadge/i, expand: 'DISPlaystat badge measurement display' },
    { pattern: /\bpreamble/i, expand: 'WFMOutpre preamble waveform transfer encoding' },
    { pattern: /\bsequence\b.*\btrigger|trigger\b.*\bsequence/i, expand: 'TRIGger:B:BY trigger sequence A B delayed' },
    // IEEE 488 star commands — natural language → SCPI header
    { pattern: /\b(reset|rst)\b.*(oscilloscope|scope|instrument|awg|afg|smu)/i, expand: '*RST reset instrument factory' },
    { pattern: /\b(clear\s*(the\s*)?(instrument|scope|status)|status\s*clear)\b/i, expand: '*CLS clear status event' },
    { pattern: /\b(identification|idn\s*query|query.*\bidn\b|instrument\s*id)\b/i, expand: '*IDN identification query manufacturer' },
    { pattern: /\b(error\s*queue|check\s*error|allev)\b/i, expand: 'ALLEv SYSTem:ERRor error queue event' },
    { pattern: /\b(display\s*header|turn\s*off\s*header|header\s*(on|off))\b/i, expand: 'HEADer header off on' },
    { pattern: /\bheader\b(?!.*\b(bus|manchester|length|bits|frame|sync|preamble))/i, expand: 'HEADer header off on' },
    // AWG plugin / HSSerial
    { pattern: /\b(load|activate)\b.*(plugin|module|hsserial|high.?speed.?serial)\b.*\bawg\b/i, expand: 'WPLugin ACTive HSSerial plugin awg' },
    { pattern: /\bawg\b.*(load|activate)\b.*(plugin|module|hsserial)/i, expand: 'WPLugin ACTive HSSerial plugin awg' },
    { pattern: /\bload\b.*(high.?speed.?serial|hsserial|radar|pulse)\b.*\bawg\b/i, expand: 'WPLugin ACTive plugin awg' },
    { pattern: /\bawg\b.*(plugin|hsserial|high.?speed.?serial)/i, expand: 'WPLugin ACTive HSSerial plugin awg' },
    { pattern: /\bawg\b.*(radar|load\s*radar|radar\s*plugin)\b/i, expand: 'WPLugin RADar ACTive plugin awg' },
    { pattern: /\b(prbs7|prbs15|prbs31|prbs\d+)\b/i, expand: 'HSSerial BDATa PRBS pattern awg' },
    { pattern: /\b(nrz)\b.*(awg|serial|encoding)/i, expand: 'HSSerial ENCode SCHeme NRZ encoding awg' },
    { pattern: /\bawg\b.*(run|play|start)\b/i, expand: 'AWGControl RUN IMMediate play' },
    { pattern: /\b(run|play)\b.*\bawg\b/i, expand: 'AWGControl RUN IMMediate play' },
    { pattern: /\bawg\b.*\bcompile\b/i, expand: 'HSSerial COMPile OVERwrite compile awg' },
    { pattern: /\bcompile\b.*(waveform|awg|overwrite)/i, expand: 'HSSerial COMPile OVERwrite compile awg' },
    { pattern: /\bcompile\s*and\s*play\b/i, expand: 'RADar COMPile PLAY compile play awg' },
    { pattern: /\bawg\b.*(sample\s*rate|clock|srate)\b/i, expand: 'CLOCk SRATe sample rate awg clock' },
    { pattern: /\bawg\b.*(output|channel).*(state|on|off)\b/i, expand: 'OUTPut STATe channel output awg' },
    // AWG radar plugin details
    { pattern: /\bradar\b.*(carrier|frequency|cf)\b/i, expand: 'RADar PTRain CARRier FREQuency carrier' },
    { pattern: /\bradar\b.*(pulse.?width|pw|width)\b/i, expand: 'RADar PULSe PENVelope WIDTh pulse width' },
    { pattern: /\bradar\b.*(pri|pulse\s*repetition)\b/i, expand: 'RADar PULSe PENVelope PRI repetition' },
    { pattern: /\bradar\b.*(lfm|modulation|sweep)\b/i, expand: 'RADar PULSe MODulation LFM SRANge sweep' },
    // SignalVu / RSA
    { pattern: /\b(connect|disconnect)\b.*(signalvu|rsa|spectrum.*pc)/i, expand: 'INSTrument CONNect DISConnect signalvu connect' },
    { pattern: /\b(signalvu|rsa)\b.*(connect|disconnect)\b/i, expand: 'INSTrument CONNect DISConnect signalvu connect' },
    { pattern: /\bsignalvu\b.*(preset|reset)\b/i, expand: 'SYSTem PRESet preset signalvu' },
    // Scope AFG (built-in)
    { pattern: /\bafg\b.*(frequency|freq)\b/i, expand: 'AFG FREQuency frequency afg' },
    { pattern: /\bafg\b.*(amplitude|ampl)\b/i, expand: 'AFG AMPLitude amplitude afg' },
    { pattern: /\bafg\b.*(function|waveform|shape)\b/i, expand: 'AFG FUNCtion function waveform afg' },
    { pattern: /\bafg\b.*(impedance|load|50\s*ohm)\b/i, expand: 'AFG OUTPut LOAd IMPEDance impedance afg' },
    // External AFG (AFG31000)
    { pattern: /\bexternal\s*afg\b.*(clock|reference)\b/i, expand: 'ROSCillator SOURce clock reference external' },
    { pattern: /\b(aux\s*out|auxout)\b/i, expand: 'AUXout SOUrce aux out reference clock' },
    // CAN FD
    { pattern: /\bcan\s*fd\b.*(standard|iso)\b/i, expand: 'BUS CAN FD STANDard ISO standard' },
    { pattern: /\bcan\s*fd\b.*(bit\s*rate|data\s*phase)\b/i, expand: 'BUS CAN FD BITRate data phase bit rate' },
    // UART/RS232
    { pattern: /\buart\b.*(source|channel)\b/i, expand: 'BUS RS232C RS232 SOUrce source uart' },
    { pattern: /\buart\b.*(data\s*bits|databits)\b/i, expand: 'BUS RS232C DATABits data bits uart' },
    // Search CAN error frames
    { pattern: /\bsearch\b.*(can|bus).*(error|frame)\b/i, expand: 'SEARCH TRIGger BUS CAN FRAMEtype error frame search' },
    // Measurement table / results table
    { pattern: /\b(results?\s*table|measurement\s*table|meas.*table)\b/i, expand: 'MEASTABle CUSTOMTABle ADDNew results table' },
    // Waveform data source
    { pattern: /\bwaveform\b.*(data\s*source|source\s*channel|data.*channel)\b/i, expand: 'DATa SOUrce data source waveform' },
  ];
  let expandedQuery = q;
  for (const { pattern, expand } of QUERY_EXPANSIONS) {
    if (pattern.test(q)) {
      expandedQuery = `${q} ${expand}`;
      break;
    }
  }

  // Fetch more candidates than needed so re-ranking has room to work
  const fetchLimit = Math.max((offset + limit) * 4, 30);
  // Search with both original and expanded queries
  let searchEntries = index.searchByQuery(expandedQuery, input.modelFamily, fetchLimit, input.commandType);
  if (expandedQuery !== q) {
    // Also search original to not lose direct matches
    const originalEntries = index.searchByQuery(q, input.modelFamily, fetchLimit, input.commandType);
    searchEntries = [...searchEntries, ...originalEntries];
  }

  const headerLike = q.includes(':') || q.startsWith('*');
  const directEntries = headerLike
    ? headerCandidates(q)
        .map((h) => index.getByHeader(h, input.modelFamily))
        .filter((v): v is NonNullable<typeof v> => Boolean(v))
    : [];
  const measurementDirectEntries = measurementPlan
    ? measurementPlan.exactHeaders
        .map((h) => index.getByHeader(h, input.modelFamily))
        .filter((v): v is NonNullable<typeof v> => Boolean(v))
    : [];
  const measurementSearchEntries = measurementPlan
    ? measurementPlan.searchTerms.flatMap((term) => index.searchByQuery(term, input.modelFamily, 4, input.commandType))
    : [];

  // Merge and dedup all candidates
  const merged: CommandRecord[] = [];
  const seen = new Set<string>();

  // ── Intent-based header injection ──
  // When BM25 can't find the right commands (no keyword overlap between
  // natural language and SCPI headers), inject known headers directly.
  // This is extensible — add entries as you discover gaps.
  const INTENT_HEADER_INJECTIONS: Record<string, string[]> = {
    zone_trigger: [
      'VISual:ENABLE', 'VISual:AREA<x>:SHAPE', 'VISual:AREA<x>:SOUrce',
      'VISual:AREA<x>:HITType', 'VISual:AREA<x>:HEIGht', 'VISual:AREA<x>:VERTICES',
      'VISual:AREA<x>:RESET', 'VISual:AREA<x>:ROTAtion',
    ],
    spectrum_view: [
      'SV:CENTERFrequency', 'SV:SPAN', 'SV:RBW', 'SV:WINDOW',
      'SV:SPANRBWRatio', 'CH<x>:SV:STATE', 'CH<x>:SV:CENTERFrequency',
    ],
    eye_diagram: [
      'MEASUrement:MEAS<x>:RESUlts:CURRentacq:MEAN?',
      'MEASUrement:ADDMEAS', 'MEASUrement:ENABLEPjitter',
    ],
    power_harmonics: [
      'POWer:POWer<x>:TYPe', 'POWer:ADDNew',
      'POWer:POWer<x>:HARMONICS:CLASs', 'POWer:POWer<x>:HARMONICS:STANDard',
      'POWer:POWer<x>:HARMONICS:UNITs', 'POWer:POWer<x>:HARMONICS:FUNDamental',
    ],
    power_soa: [
      'POWer:POWer<x>:SOA:POINT<x>', 'POWer:POWer<x>:TYPe',
      'POWer:ADDNew',
    ],
    afg: [
      'AFG:FUNCtion', 'AFG:FREQuency', 'AFG:AMPLitude', 'AFG:OFFSet',
      'AFG:OUTPut:STATE', 'AFG:PERIod', 'AFG:SYMMetry', 'AFG:PHASe',
    ],
    dvm: [
      'DVM:MODe', 'DVM:AUTORange', 'DVM:SOUrce', 'DVM:MEASUrement:FREQuency?',
      'DVM:MEASUrement:VALue?',
    ],
    dphy: [
      'BUS:B<x>:DPHY:CLOCk:SOUrce', 'BUS:B<x>:DPHY:CLOCk:THRESHold',
      'BUS:B<x>:DPHY:LP:THRESHold', 'BUS:B<x>:DPHY:PROTocol:TYPe',
    ],
    cphy: [
      'BUS:B<x>:CPHY:A:SOUrce', 'BUS:B<x>:CPHY:A:THRESHold',
      'BUS:B<x>:CPHY:SUBTYPe',
    ],
    statistics: [
      'MEASUrement:MEAS<x>:DISPlaystat:ENABle', 'MEASUrement:STATIstics:CYCLEMode',
      'MEASUrement:STATIstics:COUNt', 'MEASUrement:STATIstics:MODe',
    ],
    add_measurement: [
      'MEASUrement:ADDMEAS', 'MEASUrement:ADDNew',
      'MEASUrement:MEAS<x>:TYPe', 'MEASUrement:MEAS<x>:SOUrce<x>',
    ],
    add_bus: [
      'BUS:B<x>:TYPe', 'BUS:ADDNew',
      'DISplay:WAVEView<x>:BUS:B<x>:STATE',
    ],
    add_math: [
      'MATH:ADDNew', 'MATH<x>:DEFine', 'MATH<x>:TYPe',
    ],
    add_plot: [
      'PLOTView<x>:PLOT<x>:TYPe', 'HISTogram:HISTogram<x>:SOUrce',
    ],
    add_search: [
      'SEARCH:ADDNew', 'SEARCH:SEARCH<x>:TRIGger:A:TYPe',
    ],
    rise_time: [
      'MEASUrement:ADDMEAS', 'MEASUrement:MEAS<x>:TYPe',
    ],
    histogram_box: [
      'HIStogram:BOX', 'HIStogram:BOXPcnt',
      'HIStogram:DISplay', 'HIStogram:MODe',
    ],
    waveform_transfer: [
      'WFMOutpre:ENCdg', 'DATa:ENCdg', 'DATa:SOUrce', 'DATa:STARt', 'DATa:STOP',
      'CURVe', 'WFMOutpre:BYT_Nr', 'WFMOutpre:XINcr', 'WFMOutpre:YMUlt',
    ],
    dpm: [
      'MEASUrement:MEAS<x>:DPM:TYPE',
    ],
    recall_setup: [
      'RECAll:SETUp', 'RECAll:SESsion',
    ],
    recall_session: [
      'RECAll:SESsion', 'RECAll:SETUp',
    ],
    recall_waveform: [
      'RECAll:WAVEform', 'RECAll:WAVEform:FILEPath',
    ],
    save_waveform: [
      'SAVe:WAVEform', 'SAVe:WAVEform:FILEFormat',
    ],
    trigger_level: [
      'TRIGger:{A|B}:LEVel:CH<x>', 'TRIGger:A:LEVel:CH<x>',
    ],
    screenshot: [
      'SAVe:IMAGe', 'SAVe:IMAGe:FILEFormat',
    ],
    plot: [
      'PLOT:PLOT<x>:SOUrce<x>', 'PLOT:PLOT<x>:TYPe', 'PLOT:ADDNew', 'PLOT:DELEte',
    ],
    waveform_preamble: [
      'WFMOutpre:ENCdg', 'WFMOutpre:BYT_Nr', 'WFMOutpre:BIT_Nr',
      'WFMOutpre:XINcr', 'WFMOutpre:XZEro', 'WFMOutpre:YMUlt',
      'WFMOutpre:YOFf', 'WFMOutpre:YZEro',
    ],
    trigger_sequence: [
      'TRIGger:B:BY', 'TRIGger:B:TIMe', 'TRIGger:B:STATE',
      'TRIGger:B:EDGE:SOUrce', 'TRIGger:B:EDGE:SLOpe',
    ],
    channel_on: [
      'DISplay:GLObal:CH<x>:STATE', 'CH<x>:STATE',
    ],
    channel_off: [
      'DISplay:GLObal:CH<x>:STATE', 'CH<x>:STATE',
    ],
    digital_threshold: [
      'CH<x>:DIGItal:THReshold', 'CH<x>:DIGItal:MAGnivu:POSition',
    ],
    search_navigate: [
      'MARK:SELECTED:NEXT', 'MARK:SELECTED:PREVious', 'MARK:CREAte',
      'MARK:DELEte', 'SEARCH:SEARCH<x>:NAVigate',
    ],
    math_channel: [
      'MATH:ADDNew', 'MATH<x>:DEFine', 'MATH:MATH<x>:DEFine',
    ],
    runt: [
      'TRIGger:{A|B}:RUNT:POLarity', 'TRIGger:{A|B}:RUNT:THReshold:HIGH',
      'TRIGger:{A|B}:RUNT:THReshold:LOW', 'TRIGger:{A|B}:RUNT:WIDth',
    ],
    averaging: [
      'ACQuire:NUMAVg', 'ACQuire:MODe',
    ],
    horizontal_scale: [
      'HORizontal:SCAle', 'HORizontal:POSition', 'HORizontal:MODe',
    ],
    fastframe: [
      'HORizontal:FASTframe:STATE', 'HORizontal:FASTframe:COUNt',
      'HORizontal:FASTframe:MAXFRames', 'HORizontal:FASTframe:SELECTED',
    ],
  };

  const intent = classifyIntent(q);
  const injectionHeaders = INTENT_HEADER_INJECTIONS[intent.subject] || [];
  for (const h of injectionHeaders) {
    const entry = index.getByHeader(h, input.modelFamily);
    if (entry) {
      const key = `${entry.sourceFile}:${entry.commandId}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(entry);
      }
    }
  }

  for (const entry of [...measurementDirectEntries, ...directEntries, ...measurementSearchEntries, ...searchEntries]) {
    const key = `${entry.sourceFile}:${entry.commandId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }

  // Re-rank using intent classification and group-aware scoring
  let reRanked = reRankWithIntent(merged, q);

  // For intents with injected headers, force them to the top.
  // BM25 scores can be so high that additive boosts can't overcome them.
  if (injectionHeaders.length > 0) {
    // Build set of injected headers for exact matching.
    // Also include the resolved form (e.g. "sv:span" from "SV:SPAN")
    const injectedSet = new Set<string>();
    for (const h of injectionHeaders) {
      injectedSet.add(h.toLowerCase());
      // Add the prefix before any placeholder as a fallback
      const stripped = h.replace(/<[^>]+>/g, '').replace(/:$/, '').toLowerCase();
      if (stripped !== h.toLowerCase()) injectedSet.add(stripped);
    }
    const isInjected = (cmd: CommandRecord) => {
      const hdr = cmd.header.toLowerCase();
      return injectedSet.has(hdr);
    };
    const top = reRanked.filter(isInjected);
    const rest = reRanked.filter(c => !isInjected(c));
    reRanked = [...top, ...rest];
  }

  const exactPinnedHeaders = new Set(
    [...measurementDirectEntries, ...directEntries].map((entry) => entry.header.toLowerCase())
  );
  if (exactPinnedHeaders.size > 0) {
    const top = reRanked.filter((cmd) => exactPinnedHeaders.has(cmd.header.toLowerCase()));
    const rest = reRanked.filter((cmd) => !exactPinnedHeaders.has(cmd.header.toLowerCase()));
    reRanked = [...top, ...rest];
  }

  const total = reRanked.length;
  const final = reRanked.slice(offset, offset + limit);
  const hasMore = offset + final.length < total;

  return {
    ok: true,
    data: final.map((e) =>
      input.verbosity === 'full' ? serializeCommandResult(e) : serializeCommandSearchResult(e)
    ),
    sourceMeta: input.verbosity === 'full' ? buildSearchSourceMeta(final, input.sourceMetaMode || 'compact') : undefined,
    warnings: final.length ? [] : ['No commands matched query'],
    paging: {
      offset,
      limit,
      returned: final.length,
      hasMore,
    },
    debug: {
      intent: intent.intent,
      subject: intent.subject,
      groups: intent.groups,
      injected: injectionHeaders.length,
      expanded: expandedQuery !== q,
    },
  } as ToolResult<unknown[]>;
}
