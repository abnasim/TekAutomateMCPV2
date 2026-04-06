import { getCommandIndex, type CommandRecord } from './commandIndex.js';
import { classifyIntent, filterCommandsByGroups, type IntentResult } from './intentMap';
import { buildMeasurementSearchPlan } from './measurementCatalog';
import type { ToolResult } from './schemas.js';

interface SmartScpiRequest {
  query: string;
  modelFamily?: string;
  context?: string;
  /** When 'build', skip conversational prompts and auto-select the best match */
  mode?: 'build' | 'chat';
}

interface SmartScpiToolResult extends ToolResult<string[]> {
  conversationalPrompt?: string;
  summary: string;
}

/** Convert a CommandSuggestion to compact text (~150 tokens vs ~500 for JSON) */
function commandSuggestionToText(cmd: CommandSuggestion): string {
  const lines: string[] = [];
  lines.push(`Command: ${cmd.header}`);
  if (cmd.shortDescription) lines.push(`Description: ${cmd.shortDescription}`);
  if (cmd.syntax?.set) lines.push(`Set: ${cmd.syntax.set}`);
  if (cmd.syntax?.query) lines.push(`Query: ${cmd.syntax.query}`);
  if (cmd.arguments?.length) {
    lines.push('Parameters:');
    for (const arg of cmd.arguments.slice(0, 6)) {
      const desc = (arg.description || '').slice(0, 80);
      lines.push(`  ${arg.name} (${arg.type}${arg.required ? ', required' : ''}): ${desc}`);
    }
  }
  if (cmd.codeExamples?.[0]?.scpi?.code) {
    const ex = cmd.codeExamples[0];
    lines.push(`Example: ${ex.scpi!.code}${ex.description ? ' — ' + ex.description : ''}`);
  }
  if (cmd.relatedCommands?.length) {
    lines.push(`Related: ${cmd.relatedCommands.slice(0, 5).join(', ')}`);
  }
  return lines.join('\n');
}

interface SmartScpiResult {
  commands: CommandRecord[];
  intent: string;
  groups: string[];
  workflow?: string[];
  responseTime: number;
  conversationalPrompt?: string;
}

export interface CommandSuggestion {
  header: string;
  description: string;
  shortDescription: string;
  group: string;
  category: string;
  commandType: 'set' | 'query' | 'both';
  families: string[];
  models: string[];
  syntax: {
    set?: string;
    query?: string;
  };
  arguments: Array<{
    name: string;
    type: string;
    required: boolean;
    description: string;
    validValues: Record<string, unknown>;
    defaultValue?: unknown;
  }>;
  queryResponse?: string;
  codeExamples: Array<{
    description: string;
    scpi?: { code: string };
    python?: { code: string };
    tm_devices?: { code: string };
  }>;
  relatedCommands: string[];
  usage: string;
}

/**
 * Smart SCPI Assistant - Fast, intelligent command lookup for real-time AI + instrument control
 * Response time: <300ms
 */
export class SmartScpiAssistant {
  private commandIndex: Promise<CommandRecord[]>;

  constructor() {
    this.commandIndex = this.loadCommands();
  }

  private async loadCommands(): Promise<CommandRecord[]> {
    const index = await getCommandIndex();
    // Load ALL commands from the index to ensure no commands are missed
    const allCommands = index.getEntries();
    console.log(`[SmartAssistant] Loaded ${allCommands.length} unique commands`);
    return allCommands;
  }

  private async mergeMeasurementCatalogCommands(
    commands: CommandRecord[],
    query: string,
    modelFamily?: string,
    fallbackCommands: CommandRecord[] = []
  ): Promise<CommandRecord[]> {
    const measurementPlan = buildMeasurementSearchPlan(query);
    if (!measurementPlan) return fallbackCommands;

    const index = await getCommandIndex();
    const directMatches = measurementPlan.exactHeaders
      .map((header) => index.getByHeader(header, modelFamily))
      .filter((cmd): cmd is CommandRecord => Boolean(cmd));
    const searchMatches = measurementPlan.searchTerms.flatMap((term) =>
      index.searchByQuery(term, modelFamily, 4)
    );

    // When user isn't explicitly asking for power analysis, prefer MEASUrement over POWer
    const queryLower = query.toLowerCase();
    const wantsPower = /\b(power|wbg|dpm|switching|inductance|magnetic|efficiency)\b/i.test(queryLower);

    const preferredRoots = new Set(
      directMatches
        .map((cmd) => String(cmd.header || '').split(':')[0])
        .filter(Boolean)
    );
    const queryHasMeasurement = /\bmeasurement\b/i.test(query);
    const matchesPreferredRoot = (cmd: CommandRecord): boolean =>
      preferredRoots.size === 0
      || preferredRoots.has(String(cmd.header || '').split(':')[0])
      || (queryHasMeasurement && String(cmd.header || '').startsWith('MEASUrement'));
    const filteredSearchMatches = searchMatches.filter(matchesPreferredRoot);
    const filteredFallbackCommands = fallbackCommands.filter(matchesPreferredRoot);

    const seen = new Set<string>();
    let merged = [...directMatches, ...filteredSearchMatches, ...filteredFallbackCommands].filter((cmd) => {
      const key = `${cmd.sourceFile}:${cmd.commandId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // When not explicitly requesting power, sort MEASUrement headers before POWer headers
    if (!wantsPower && merged.length > 1) {
      merged.sort((a, b) => {
        const aIsMeas = String(a.header || '').startsWith('MEASUrement');
        const bIsMeas = String(b.header || '').startsWith('MEASUrement');
        if (aIsMeas && !bIsMeas) return -1;
        if (!aIsMeas && bIsMeas) return 1;
        return 0;
      });
    }

    return merged.length > 0 ? merged : fallbackCommands;
  }

  /**
   * Search commands across multiple groups intelligently
   */
  private async searchCommands(
    commands: CommandRecord[],
    intent: ReturnType<typeof classifyIntent>,
    originalQuery?: string
  ): Promise<CommandRecord[]> {
    const { groups, subject, action } = intent;

    console.log(`[SmartAssistant] Intent classification result:`);
    console.log(`  Groups: [${groups.join(', ')}]`);
    console.log(`  Subject: "${subject}"`);
    console.log(`  Action: "${action}"`);

    // ── STEP 1: Filter to target groups FIRST ──
    const pool = filterCommandsByGroups(commands, groups);
    console.log(`[DEBUG] searchCommands pool size: ${pool.length} from ${commands.length} groups: [${groups.join(', ')}]`);
    console.log(`[SEARCH] Groups: [${groups.join(', ')}] → ${pool.length} commands in pool (from ${commands.length} total)`);
    
    // Log first few commands in pool to verify filtering
    if (pool.length > 0) {
      console.log(`[DEBUG] First 3 commands in pool:`);
      pool.slice(0, 3).forEach((cmd, i) => {
        console.log(`  ${i+1}. ${cmd.header} (group: ${cmd.group})`);
      });
    }

    // FIX BUG-006: If group filter returned nothing, log and fallback to full corpus
    const usedFallback = pool.length === 0 && groups.length > 0;
    if (usedFallback) {
      console.warn(`[WARNING] No commands found in groups [${groups.join(', ')}] for this family. Using full corpus fallback.`);
    }
    
    const searchPool = pool.length > 0 ? pool : commands;

    // ── STEP 2: Exact header match (only for SCPI-style queries with : or *) ──
    const subjectLower = subject.toLowerCase();
    const queryLower = (originalQuery || subject).toLowerCase();
    const isScpiStyleQuery = queryLower.includes(':') || queryLower.startsWith('*');

    if (isScpiStyleQuery) {
      const exactMatches = searchPool.filter(cmd => {
        const headerLower = cmd.header.toLowerCase();
        const headerClean = headerLower.replace(/[^a-z:*]/g, '');

        // Match against full query (for when user types exact SCPI header)
        if (headerLower === queryLower) return true;
        if (headerClean === queryLower.replace(/[^a-z:*]/g, '')) return true;

        return false;
      });

      if (exactMatches.length > 0) {
        console.log(`[EXACT_MATCH] Found ${exactMatches.length} exact matches`);
        return exactMatches.slice(0, 1);
      }
    }

    // ── STEP 3: BM25 search WITHIN the filtered pool ──
    // Build a mini BM25 index over just the filtered commands
    const searchTexts = searchPool.map(cmd =>
      `${cmd.header} ${cmd.shortDescription} ${cmd.description} ${cmd.tags.join(' ')}`.toLowerCase()
    );

    // Score each command against the full query (not just subject)
    const scored = searchPool.map((cmd, i) => {
      const text = searchTexts[i];
      let score = 0;

      // Subject keyword matching
      const subjectWords = subject.split(/[_\s]+/).filter(w => w.length > 1); // Split on underscore or space
      const headerLower = cmd.header.toLowerCase();
      for (const word of subjectWords) {
        if (text.includes(word)) score += 3;
        if (headerLower.includes(word)) score += 8; // header match weighted much higher than description
      }
      // Direct header keyword boosts for common scope operations
      const headerBoosts: Record<string, RegExp> = {
        scale: /scale/i, offset: /offset/i, position: /position/i,
        bandwidth: /bandwidth/i, coupling: /coupling/i, termination: /termination/i,
        horizontal: /horizontal/i, trigger: /trigger/i, mode: /mode/i,
        invert: /invert/i, probe: /probe/i, deskew: /deskew/i, label: /label/i,
        recall: /recall/i, save: /save/i, fastframe: /fastframe/i,
        edge: /edge/i, level: /level/i, slope: /slope/i,
      };
      for (const word of subjectWords) {
        const boost = headerBoosts[word];
        if (boost && boost.test(cmd.header)) score += 10;
      }
      // Full query word matching against header (catch words the subject split misses)
      const queryWords = (originalQuery || subject).toLowerCase().split(/\s+/).filter(w => w.length > 2);
      for (const qw of queryWords) {
        if (headerLower.includes(qw) && !subjectWords.includes(qw)) score += 4;
      }

      // Synonym expansion: map natural-language words to SCPI header tokens
      const synonymMap: Record<string, string> = {
        rising: 'edge', falling: 'edge', slope: 'edge',
        screenshot: 'image', capture: 'image', print: 'image',
        serial: 'rs232', uart: 'rs232',
      };
      for (const qw of queryWords) {
        const mapped = synonymMap[qw];
        if (mapped && headerLower.includes(mapped) && !subjectWords.includes(mapped)) {
          score += 6;
        }
      }

      // Subject-specific header boosts for disambiguation within a group
      // IEEE 488.2 commands: boost exact *-prefixed headers for their subjects
      const ieeeBoosts: Record<string, RegExp> = {
        reset: /^\*RST$/i,
        identify: /^\*IDN/i,
        opc: /^\*OPC/i,
        cls: /^\*CLS$/i,
        tst: /^\*TST/i,
        esr: /^\*ESR/i,
        wai: /^\*WAI$/i,
        sre: /^\*SRE/i,
        ese: /^\*ESE/i,
        opt: /^\*OPT/i,
        psc: /^\*PSC/i,
        trg: /^\*TRG$/i,
        lrn: /^\*LRN/i,
        ddt: /^\*DDT/i,
        status: /^\*ESR/i,
      };
      const ieeeBoost = ieeeBoosts[subjectLower];
      if (ieeeBoost && ieeeBoost.test(cmd.header)) {
        score += 30;
      }

      // "edge" subject: boost commands with EDGE in header path (e.g. TRIGger:A:EDGE:SLOpe)
      if (subjectLower === 'edge' && /edge/i.test(cmd.header)) {
        score += 15;
      }
      // Also boost SLOpe when "rising" or "falling" appears in query
      if (subjectLower === 'edge' && /slope/i.test(cmd.header) && /\b(rising|falling)\b/i.test(originalQuery || '')) {
        score += 10;
      }
      // Trigger source: boost EDGE:SOUrce
      if (subjectLower === 'trigger_source' && /edge.*source/i.test(cmd.header)) {
        score += 20;
      }
      // Horizontal position: boost HORizontal:POSition
      if (subjectLower === 'horizontal_position' && /horizontal.*position/i.test(cmd.header)) {
        score += 20;
      }
      // Horizontal scale: prefer HORizontal:SCAle over HORizontal:MODe:SCAle (shorter = more direct)
      if (subjectLower === 'horizontal_scale' && /^horizontal:scale$/i.test(cmd.header.replace(/[^a-z:]/gi, ''))) {
        score += 20;
      }
      // Probe: boost PRObe in header
      if ((subjectLower === 'probe' || subjectLower === 'probe_atten') && /probe/i.test(cmd.header)) {
        score += 15;
      }
      // Recall session: boost RECAll:SESsion
      if (subjectLower === 'recall_session' && /recall.*session/i.test(cmd.header)) {
        score += 25;
      }
      // Measurement source: boost MEAS<x>:SOUrce<x> (Measurement group, the standard one)
      // NOT MEAS<x>:SOURCE (IMDA group, for motor drive analysis only)
      if (subjectLower === 'measurement_source') {
        if (/MEAS<x>:SOUrce<x>$/i.test(cmd.header)) {
          score += 30;
        } else if (/MEAS.*source/i.test(cmd.header) && !/GATing|LOGIC|COMMON|HARMONICS|Symbol/i.test(cmd.header)) {
          score += 15;
        }
      }
      // Statistics: boost STATIstics
      if (subjectLower === 'statistics' && /statist/i.test(cmd.header)) {
        score += 20;
      }
      // Screenshot: boost SAVe:IMAGe (user says "screenshot", header says "IMAGe")
      if (subjectLower === 'screenshot' && /SAVe:IMAGe/i.test(cmd.header)) {
        score += 25;
      }
      // Save waveform: boost SAVe:WAVEform
      if (subjectLower === 'save_waveform' && /SAVe:WAVEform/i.test(cmd.header)) {
        score += 25;
      }
      // Sample rate: boost SAMPlerate/MAXSamplerate
      if (subjectLower === 'sample_rate' && /samp.*rate/i.test(cmd.header)) {
        score += 20;
      }

      // Action matching — use word boundaries to avoid substring matches (e.g. POWer:ADDNew matching "add")
      if (action === 'add' && /(?:ADDNEW|ADDMEAS)/i.test(cmd.header)) score += 12;
      if (action === 'remove' && /(?:DELETE|DELete|DELETEALL|CLEAR|REMOVE)/i.test(cmd.header)) score += 12;
      if (action === 'query' && cmd.commandType !== 'set') score += 2;
      if (action === 'configure' && cmd.commandType !== 'query') score += 3;

      // Group membership bonus (in case we're searching full corpus as fallback)
      if (groups.length > 0) {
        const inTargetGroup = groups.some(g =>
          cmd.group.toLowerCase() === g.toLowerCase()
        );
        if (inTargetGroup) score += 10;
      }

      return { cmd, score };
    });

    // Sort by score and return top results
    scored.sort((a, b) => b.score - a.score);

    const topCommands = scored
      .filter(item => item.score > 0)
      .slice(0, 8)
      .map(item => item.cmd);

    return topCommands;
  }

  /**
   * Generate workflow suggestions
   */
  private generateWorkflow(commands: CommandRecord[], intent: IntentResult): string[] {
    const primary = intent.intent;
    const action = intent.action;
    const workflow: string[] = [];

    // Power + Harmonics workflow
    if (primary === 'power' && intent.groups.includes('Measurement')) {
      const powerCmd = commands.find(c => c.header.includes('POWer:ADDNew'));
      const typeCmd = commands.find(c => c.header.includes('POWer:POWer') && c.header.includes('TYPe'));
      const harmCmd = commands.find(c => c.header.includes('MEAS') && c.header.includes('HARMonics'));

      if (powerCmd) workflow.push(powerCmd.header);
      if (typeCmd) workflow.push(`${typeCmd.header} HARMonics`);
      if (harmCmd) workflow.push(harmCmd.header);
    }

    // Bus setup workflow
    if (primary === 'bus' && action === 'setup') {
      const busCmds = commands.filter(c => c.header.includes('BUS:'));
      workflow.push(...busCmds.slice(0, 3).map(c => c.header));
    }

    // Trigger setup workflow
    if (primary === 'trigger' && action === 'setup') {
      const trigCmds = commands.filter(c => c.header.includes('TRIGger:')).slice(0, 3);
      workflow.push(...trigCmds.map(c => c.header));
    }

    return workflow.length > 0 ? workflow : undefined;
  }

  /**
   * Main smart lookup method - <300ms response time
   */
  async smartLookup(request: SmartScpiRequest): Promise<SmartScpiResult> {
    const startTime = Date.now();

    let commands = await this.commandIndex;

    // Apply family filtering if modelFamily is specified
    // BUT skip filtering for universal groups (Math, Display, etc.)
    const universalGroups = new Set(['Math', 'Display', 'Utility', 'System']);
    
    if (request.modelFamily) {
      const familyMap: Record<string, string[]> = {
        'mso_5_series': ['MSO5', 'MSO6', 'MSO7', 'MSO5000'],
        'mso_4_series': ['MSO4'],
        'mso_2_series': ['MSO2'],
        'dpo_7_series': ['DPO7000', 'DPO70000'],
        'dpo_5_series': ['DPO5000'],
        'tekscopepc': ['MSO4', 'MSO5', 'MSO6', 'MSO7', 'MSO5000', 'DPO5000', 'DPO7000', 'DPO70000'],
        'tekscope_pc': ['MSO4', 'MSO5', 'MSO6', 'MSO7', 'MSO5000', 'DPO5000', 'DPO7000', 'DPO70000'],
        'tekscope pc': ['MSO4', 'MSO5', 'MSO6', 'MSO7', 'MSO5000', 'DPO5000', 'DPO7000', 'DPO70000'],
      };

      const targetFamilies = familyMap[request.modelFamily.toLowerCase()] || [request.modelFamily];

      // First classify intent to check if we should skip family filtering
      const intentPreview = classifyIntent(request.query);
      const hasUniversalGroup = intentPreview.groups.some(g => universalGroups.has(g));
      
      if (!hasUniversalGroup) {
        // Only apply family filter for non-universal groups
        commands = commands.filter(cmd =>
          cmd.families.some(family =>
            targetFamilies.some(target =>
              family.toLowerCase().includes(target.toLowerCase()) ||
              target.toLowerCase().includes(family.toLowerCase())
            )
          )
        );

        console.log(`[FAMILY_FILTER] Model family: ${request.modelFamily} | Target families: ${targetFamilies.join(', ')} | Commands after filtering: ${commands.length}`);
      } else {
        console.log(`[FAMILY_FILTER] Skipping family filter for universal groups: [${intentPreview.groups.join(', ')}]`);
      }
    }

    // ── USE NEW INTENT CLASSIFIER ──
    const intent = classifyIntent(request.query);
    console.log(`[INTENT] query="${request.query}" → intent=${intent.intent}, subject=${intent.subject}, groups=[${intent.groups.join(', ')}], confidence=${intent.confidence}`);

    // ── NEW: Detect embedded value (user wants to SET something specific) ──
    const valueMatch = request.query.match(/\b(\d+\.?\d*(?:e[+-]?\d+)?)\s*$/i)  // trailing number
      || request.query.match(/\bto\s+(\d+\.?\d*(?:e[+-]?\d+)?)/i)               // "to 10000"
      || request.query.match(/\b(\d+\.?\d*)\s*(?:v|mv|ns|us|ms|s|hz|khz|mhz)\b/i); // "0.5V"

    const embeddedValue = valueMatch ? valueMatch[1] : null;

    const relevantCommands = await this.searchCommands(commands, intent, request.query);
    // Only merge measurement catalog when intent is actually measurement/power related
    // Otherwise it overrides correct results with MEASUrement:ADDMEAS for unrelated queries
    const shouldMergeCatalog = intent.intent === 'measurement' || intent.intent === 'power' || intent.intent === 'wbg';
    const catalogBoostedCommands = shouldMergeCatalog
      ? await this.mergeMeasurementCatalogCommands(commands, request.query, request.modelFamily, relevantCommands)
      : relevantCommands;

    const responseTime = Date.now() - startTime;

    // BUILD MODE: Auto-select the best matching commands instead of showing
    // conversational exploration prompts. Build mode needs actionable commands,
    // not "which category would you like to explore?" menus.
    if (request.mode === 'build' && catalogBoostedCommands.length > 0) {
      // In build mode with an embedded value, narrow to set-capable commands
      let topCommands: CommandRecord[];
      if (embeddedValue) {
        const setCapable = catalogBoostedCommands.filter(cmd =>
          cmd.commandType === 'set' || cmd.commandType === 'both'
        );
        topCommands = setCapable.length > 0 ? setCapable.slice(0, 1) : catalogBoostedCommands.slice(0, 1);
      } else {
        topCommands = catalogBoostedCommands.slice(0, 3);
      }
      console.log(`[BUILD_MODE] Auto-selecting ${topCommands.length} command(s): ${topCommands.map(c => c.header).join(', ')}`);
      return {
        commands: topCommands,
        intent: intent.intent,
        groups: intent.groups,
        workflow: [],
        responseTime,
        // No conversationalPrompt — let the caller materialize into ACTIONS_JSON
      };
    }

    // ── Chat mode: If user provided a value, this is a specific SET request ──
    // Return top 1-2 set-capable commands, not 8 with a menu
    if (embeddedValue && catalogBoostedCommands.length > 0) {
      const setCapable = catalogBoostedCommands.filter(cmd =>
        cmd.commandType === 'set' || cmd.commandType === 'both'
      );
      // Prefer commands where the subject keyword matches the header (e.g. "scale" → CH<x>:SCAle)
      const subjectWords = intent.subject.split(/[_\s]+/).filter((w: string) => w.length > 2);
      const headerMatched = setCapable.filter((cmd: any) =>
        subjectWords.some((w: string) => cmd.header.toLowerCase().includes(w.toLowerCase()))
      );
      const topCmd = headerMatched[0] || setCapable[0] || catalogBoostedCommands[0];

      return {
        commands: [topCmd],
        intent: intent.intent,
        groups: intent.groups,
        workflow: [],
        responseTime,
        conversationalPrompt: this.generateSetCommandResponse(topCmd, embeddedValue, intent),
      };
    }

    // EXPLORATORY INTERFACE (chat mode) - provide guided exploration
    // Check if this is a more specific query that should show detailed commands
    if (this.isSpecificQuery(request.query, catalogBoostedCommands)) {
      console.log(`[SPECIFIC_QUERY] Detected specific query: "${request.query}"`);
      console.log(`[SPECIFIC_QUERY] Found ${catalogBoostedCommands.length} relevant commands`);
      if (catalogBoostedCommands.length > 0) {
        console.log(`[SPECIFIC_QUERY] First command: ${catalogBoostedCommands[0].header}`);
      }

      // Return 5-6 most relevant commands for cleaner AI output
      const commandsToShow = catalogBoostedCommands.slice(0, 6);
      return {
        commands: commandsToShow, // Return actual commands for apply card
        intent: intent.intent,
        groups: intent.groups,
        workflow: [],
        responseTime,
        conversationalPrompt: this.generateDetailedCommandView(commandsToShow, intent)
      };
    }

    // Check if this is a follow-up question (contains references to previous results)
    if (this.isFollowUpQuestion(request.query, catalogBoostedCommands)) {
      console.log(`[FOLLOWUP_QUERY] Detected follow-up query: "${request.query}"`);
      return {
        commands: catalogBoostedCommands.slice(0, 6), // Always return commands for tool results
        intent: intent.intent,
        groups: intent.groups,
        workflow: [],
        responseTime,
        conversationalPrompt: this.handleFollowUpQuestion(catalogBoostedCommands, intent)
      };
    }

    // Exploratory interface - always include found commands alongside the prompt
    return {
      commands: catalogBoostedCommands.slice(0, 6), // Always return commands for tool results
      intent: intent.intent,
      groups: intent.groups,
      workflow: [],
      responseTime,
      conversationalPrompt: this.generateExploratoryInterface(catalogBoostedCommands, intent, request.query)
    };
  }

  /**
   * Generate exploratory interface for browsing SCPI commands
   */
  private generateExploratoryInterface(commands: CommandRecord[], intent: any, originalQuery?: string): string {
    const queryToUse = originalQuery || intent.action;

    if (commands.length === 0) {
      return `I couldn't find any SCPI commands matching "${queryToUse}".

Try being more specific:
- Include the measurement type (power, voltage, frequency, etc.)
- Mention the instrument type (oscilloscope, spectrum analyzer, etc.)
- Describe what you want to accomplish

Examples:
- "bus trigger I2C commands"
- "power measurement harmonics"
- "voltage RMS measurement"`;
    }

    // Check if this is a more specific query that should show detailed commands
    if (this.isSpecificQuery(queryToUse, commands)) {
      console.log(`[SPECIFIC_QUERY] Detected specific query: "${queryToUse}"`);
      return this.generateDetailedCommandView(commands, intent);
    }

    // Check if this is a follow-up question (contains references to previous results)
    if (this.isFollowUpQuestion(queryToUse, commands)) {
      console.log(`[FOLLOWUP_QUERY] Detected follow-up query: "${queryToUse}"`);
      return this.handleFollowUpQuestion(commands, intent);
    }

    // Group commands for exploration
    const categories = this.groupCommandsByCategory(commands);
    const categoryCount = Object.keys(categories).length;

    if (categoryCount === 1 && Object.values(categories)[0].length <= 5) {
      // Small single category - show detailed exploration
      return this.generateDetailedCommandView(Object.values(categories)[0], intent);
    }

    // Multiple categories or large category - show top-level exploration
    return this.generateTopLevelExploration(categories, commands.length, intent);
  }

  /**
   * Check if this is a specific query that should show detailed commands
   */
  private isSpecificQuery(query: string, commands: CommandRecord[]): boolean {
    const queryLower = query.toLowerCase();

    // Check if it's a specific SCPI command (contains colons and is longer)
    const isScpiCommand = query.includes(':') && query.split(':').length >= 2;

    // Specific indicators - user knows what they want
    const specificPatterns = [
      'i2c', 'spi', 'can', 'lin', 'i3c', 'milstd', 'spacewire', 'uart',
      'harmonics', 'thd', 'power quality', 'rms', 'peak', 'average',
      'rising', 'falling', 'both', 'edge', 'pulse', 'width',
      'video', 'hd', 'sd', 'pal', 'ntsc', 'secam',
      'logic', 'pattern', 'and', 'or', 'nand', 'nor',
      'fastframe', 'fast frame', 'frame', 'horizontal', 'trigger', 'acquire',
      // Add nested command patterns
      'save', 'setup', 'display', 'math', 'cursor', 'graticule', 'intensity',
      'persistence', 'waveform', 'export', 'record', 'delay', 'scale', 'position',
      // Add more specific nested patterns
      'time', 'acquisition', 'duration', 'divisions', 'add', 'delete', 'source',
      'expression', 'spectrum', 'on', 'off'
    ];

    // Check for specific patterns
    const hasSpecificPattern = specificPatterns.some(pattern =>
      queryLower.includes(pattern)
    );

    // Check if query is longer (more specific)
    const queryWords = query.split(' ').length;
    const isLongQuery = queryWords >= 3;

    return isScpiCommand || hasSpecificPattern || isLongQuery;
  }

  /**
   * Check if this is a follow-up question
   */
  private isFollowUpQuestion(query: string, commands: CommandRecord[]): boolean {
    const queryLower = query.toLowerCase();

    // Follow-up indicators
    const followUpPatterns = [
      'tell me about',
      'show me',
      'what about',
      'explain',
      'more info',
      'details',
      'which one',
      'help me choose',
      'compare',
      'difference',
      'vs',
      'versus'
    ];

    // Check for follow-up patterns
    const hasFollowUpPattern = followUpPatterns.some(pattern =>
      queryLower.includes(pattern)
    );

    // Check for category/command references
    const hasReferences = commands.some(cmd =>
      queryLower.includes(cmd.header.toLowerCase()) ||
      queryLower.includes(cmd.category.toLowerCase()) ||
      queryLower.includes(cmd.group.toLowerCase())
    );

    return hasFollowUpPattern || hasReferences;
  }

  /**
   * Handle follow-up questions with more detailed responses
   */
  private handleFollowUpQuestion(commands: CommandRecord[], intent: any): string {
    const queryLower = intent.action.toLowerCase();

    // Check if user is asking about a specific category
    const categories = this.groupCommandsByCategory(commands);
    const referencedCategory = Object.keys(categories).find(cat =>
      queryLower.includes(cat.toLowerCase())
    );

    if (referencedCategory) {
      const categoryCommands = categories[referencedCategory];
      return this.generateDetailedCommandView(categoryCommands, intent, referencedCategory);
    }

    // Check if user is asking about specific commands
    const referencedCommands = commands.filter(cmd =>
      queryLower.includes(cmd.header.toLowerCase())
    );

    if (referencedCommands.length > 0) {
      return this.generateDetailedCommandView(referencedCommands, intent);
    }

    // Generic follow-up - show 5-6 most relevant commands with more detail
    return this.generateDetailedCommandView(commands.slice(0, 6), intent);
  }

  /**
   * Generate top-level exploration interface
   */
  private generateTopLevelExploration(categories: Record<string, CommandRecord[]>, totalCommands: number, intent: any): string {
    const categoryList = Object.entries(categories)
      .map(([category, cmds], i) => {
        const description = this.getCategoryDescription(category);
        const examples = cmds.slice(0, 2).map(cmd => `• ${cmd.header}`).join('\n   ');
        return `${i + 1}. **${category}** (${cmds.length} commands)
   ${description}
   Examples:
   ${examples}`;
      })
      .join('\n\n');

    return `I found ${totalCommands} SCPI commands related to **${intent.intent}**. Here are the main categories:

${categoryList}

**How to explore:**
- Tell me the category number (e.g., "1" for Bus Trigger)
- Or ask about a specific category (e.g., "Tell me about Bus Trigger")
- Or ask for more details (e.g., "Show me details about category 1")
- Or be more specific (e.g., "I2C bus trigger commands")

Which category would you like to explore?`;
  }

  /**
   * Generate detailed command view for exploration
   */
  private generateDetailedCommandView(commands: CommandRecord[], intent: any, categoryName?: string): string {
    const label = categoryName || intent.intent || 'SCPI';

    // Build structured command cards for frontend rendering
    const cards = commands.slice(0, 10).map((cmd) => {
      const shortDesc = cmd.shortDescription || cmd.description || '';
      // Pick an example SCPI command to use when adding to flow
      const exampleCommand = cmd.syntax.set
        ? cmd.syntax.set.replace(/\s*\{[^}]+\}/g, '').replace(/\s*<[^>]+>/g, '').trim()
        : cmd.syntax.query || cmd.header;
      return {
        header: cmd.header,
        description: shortDesc.slice(0, 120),
        set: cmd.syntax.set || null,
        query: cmd.syntax.query || null,
        type: cmd.commandType,
        group: cmd.group || '',
        families: cmd.families,
        example: exampleCommand,
      };
    });

    // Emit structured JSON that the frontend renders as cards with action pills
    return `Found ${cards.length} ${label} commands:\n\nSCPI_COMMANDS:${JSON.stringify(cards)}`;
  }

  /**
   * Get description for command categories
   */
  private getCategoryDescription(category: string): string {
    const descriptions: Record<string, string> = {
      'Bus Trigger': 'Commands for triggering on serial communication protocols like I2C, SPI, CAN, LIN',
      'Edge Trigger': 'Commands for triggering on signal edges (rising, falling, both)',
      'Video Trigger': 'Commands for triggering on video signals and standards',
      'Pulse Width Trigger': 'Commands for triggering based on pulse width characteristics',
      'Logic Trigger': 'Commands for triggering on digital logic patterns',
      'Power Measurement': 'Commands for measuring power, harmonics, THD, and power quality',
      'Voltage Measurement': 'Commands for measuring voltage levels, RMS, peak-to-peak',
      'Frequency Measurement': 'Commands for measuring frequency, spectral analysis',
      'Time Measurement': 'Commands for measuring timing, rise time, fall time, period',
      'Acquisition': 'Commands for data acquisition and waveform capture',
      'Display': 'Commands for display settings and visualization',
      'Measurement': 'General measurement commands and configuration'
    };

    return descriptions[category] || `Commands related to ${category}`;
  }

  /**
   * Group commands by category for guided selection
   */
  private groupCommandsByCategory(commands: CommandRecord[]): Record<string, CommandRecord[]> {
    const groups: Record<string, CommandRecord[]> = {};

    commands.forEach(cmd => {
      const category = cmd.category || 'General';
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(cmd);
    });

    return groups;
  }

  /**
   * Group commands by trigger type for guided selection
   */
  private groupCommandsByTriggerType(commands: CommandRecord[]): Record<string, CommandRecord[]> {
    const groups: Record<string, CommandRecord[]> = {};

    commands.forEach(cmd => {
      const desc = cmd.description.toLowerCase();
      let triggerType = 'General';

      if (desc.includes('edge') || desc.includes('rising') || desc.includes('falling')) {
        triggerType = 'Edge Trigger';
      } else if (desc.includes('i2c') || desc.includes('spi') || desc.includes('can') || desc.includes('lin')) {
        triggerType = 'Bus Trigger';
      } else if (desc.includes('video') || desc.includes('hd') || desc.includes('sd')) {
        triggerType = 'Video Trigger';
      } else if (desc.includes('pulse') || desc.includes('width')) {
        triggerType = 'Pulse Width Trigger';
      } else if (desc.includes('logic')) {
        triggerType = 'Logic Trigger';
      }

      if (!groups[triggerType]) {
        groups[triggerType] = [];
      }
      groups[triggerType].push(cmd);
    });

    return groups;
  }

  /**
   * Determine if we should use conversational hierarchy instead of returning commands
   */
  private shouldUseConversationalHierarchy(commands: CommandRecord[], intent: any): boolean {
    // Use conversational hierarchy for broad queries with many results
    if (commands.length > 5) {
      return true;
    }

    // Use conversational hierarchy for trigger queries
    if (intent.intent === 'trigger') {
      return true;
    }

    // Use conversational hierarchy for bus queries
    if (intent.intent === 'bus') {
      return true;
    }

    // Use conversational hierarchy for broad measurement queries
    if (intent.intent === 'measurement' && commands.length > 3) {
      return true;
    }

    return false;
  }

  /**
   * Get command groups for conversational hierarchy
   */
  private getCommandGroups(commands: CommandRecord[]): string[] {
    const groups = new Set<string>();
    commands.forEach(cmd => {
      if (cmd.category) groups.add(cmd.category);
    });
    return Array.from(groups);
  }

  /**
   * Generate conversational prompt for user selection
   */
  private generateConversationalPrompt(commands: CommandRecord[], intent: any): string {
    if (intent.intent === 'trigger') {
      const triggerTypes = this.groupCommandsByType(commands, ['trigger', 'edge', 'bus']);
      return `I found several trigger types available:\n${Object.entries(triggerTypes).map(([type, cmds], i) => `${i+1}. ${type.charAt(0).toUpperCase() + type.slice(1)} (${cmds.length} commands)`).join('\n')}\n\nWhich trigger type would you like to configure?`;
    }

    if (intent.intent === 'bus') {
      const busTypes = this.groupCommandsByType(commands, ['i2c', 'spi', 'can', 'lin', 'rs232']);
      return `I found several bus protocols available:\n${Object.entries(busTypes).map(([type, cmds], i) => `${i+1}. ${type.toUpperCase()} (${cmds.length} commands)`).join('\n')}\n\nWhich bus protocol would you like to use?`;
    }

    if (intent.intent === 'measurement') {
      const measurementTypes = this.groupCommandsByType(commands, ['power', 'harmonics', 'frequency', 'voltage', 'current']);
      return `I found several measurement types available:\n${Object.entries(measurementTypes).map(([type, cmds], i) => `${i+1}. ${type.charAt(0).toUpperCase() + type.slice(1)} (${cmds.length} commands)`).join('\n')}\n\nWhich measurement type would you like to configure?`;
    }

    // Default fallback
    const categories = this.getCommandGroups(commands);
    return `I found several command categories available:\n${categories.map((cat, i) => `${i+1}. ${cat}`).join('\n')}\n\nWhich category would you like to explore?`;
  }

  /**
   * Group commands by type for conversational hierarchy
   */
  private groupCommandsByType(commands: CommandRecord[], keywords: string[]): Record<string, CommandRecord[]> {
    const groups: Record<string, CommandRecord[]> = {};

    keywords.forEach(keyword => {
      const matching = commands.filter(cmd =>
        cmd.header.toLowerCase().includes(keyword) ||
        cmd.description.toLowerCase().includes(keyword)
      );
      if (matching.length > 0) {
        groups[keyword] = matching;
      }
    });

    return groups;
  }

  /**
   * Format results for user-friendly output with conversational hierarchy
   */
  formatResults(result: SmartScpiResult): {
    summary: string;
    commands: CommandSuggestion[];
    workflow?: string[];
    responseTime: number;
    conversationalPrompt?: string;
  } {
    console.log(`[FORMAT_RESULTS] Input: commands=${result.commands.length}, hasPrompt=${!!result.conversationalPrompt}`);

    // If we have commands AND conversational prompt, return both
    if (result.conversationalPrompt && result.commands.length > 0) {
      console.log(`[FORMAT_RESULTS] Returning commands + prompt: ${result.commands.length} commands`);
      const commandSuggestions: CommandSuggestion[] = result.commands.map(cmd => ({
        header: cmd.header,
        description: cmd.description,
        shortDescription: cmd.shortDescription,
        group: cmd.group,
        category: cmd.category,
        commandType: cmd.commandType,
        syntax: cmd.syntax,
        families: cmd.families,
        models: cmd.families,
        arguments: this.generateCommandArguments(cmd), // Generate proper arguments
        codeExamples: this.generateCodeExamples(cmd), // Generate proper examples
        relatedCommands: this.findRelatedCommands(cmd, result.commands), // Find related commands
        usage: cmd.syntax.set || cmd.syntax.query || 'No syntax available',
        // fullEntry removed — saves ~5KB per command in AI responses
      }));
      return {
        summary: `Found ${result.commands.length} commands ready to apply`,
        commands: commandSuggestions, // Return converted commands for apply card
        workflow: result.workflow,
        responseTime: result.responseTime,
        conversationalPrompt: result.conversationalPrompt
      };
    }

    // If we have a conversational prompt but no commands, return just the prompt
    if (result.conversationalPrompt) {
      return {
        summary: `Found ${result.commands.length} command types - please specify which you'd like to use`,
        commands: [], // No commands when using conversational prompt
        workflow: result.workflow,
        responseTime: result.responseTime,
        conversationalPrompt: result.conversationalPrompt
      };
    }

    // Return the top commands (limited to 2)
    const commands: CommandSuggestion[] = result.commands.slice(0, 2).map(cmd => ({
      header: cmd.header,
      description: cmd.description,
      shortDescription: cmd.shortDescription,
      group: cmd.group,
      category: cmd.category,
      commandType: cmd.commandType,
      families: cmd.families,
      models: cmd.models,
      syntax: {
        set: cmd.syntax.set,
        query: cmd.syntax.query
      },
      arguments: cmd.arguments,
      queryResponse: cmd.queryResponse,
      codeExamples: cmd.codeExamples,
      relatedCommands: cmd.relatedCommands,
      usage: this.generateUsageExample(cmd),
      // fullEntry removed — saves ~5KB per command in AI responses
    }));

    // Build mode (no conversationalPrompt) should NOT add conversational menus —
    // the caller will materialize these commands into ACTIONS_JSON directly.
    // Only add conversational hierarchy prompts for chat-mode (exploratory) queries.
    let conversationalPrompt: string | undefined;

    if (!result.conversationalPrompt) {
      // Build mode path: smartLookup deliberately omitted the prompt.
      // Return commands without adding any conversational "which category?" menus.
      return {
        summary: `Found ${commands.length} command(s) for ${result.intent}: ${commands.map(c => c.header).join(', ')}`,
        commands,
        workflow: result.workflow || undefined,
        responseTime: result.responseTime,
        // No conversationalPrompt — let MCP-only mode materialize into ACTIONS_JSON
      };
    }

    // Chat mode: add conversational hierarchy for broad queries
    let triggerTypes: string[] | undefined;
    let busProtocols: string[] | undefined;

    if (result.intent === 'trigger' && result.commands.length > 5) {
      // Broad trigger query - offer trigger types
      const triggerGroups = this.groupCommandsByTypeForHierarchy(result.commands, [
        'edge', 'bus', 'logic', 'pulse', 'width', 'video', 'pattern', 'glitch', 'runt', 'window', 'timeout'
      ]);

      triggerTypes = Object.keys(triggerGroups).map(type =>
        `${type.charAt(0).toUpperCase() + type.slice(1)} Trigger (${triggerGroups[type].length} commands)`
      );

      conversationalPrompt = `I found several trigger types available:\n${triggerTypes.map((type, i) => `${i+1}. ${type}`).join('\n')}\n\nWhich trigger type would you like to configure?`;
    }

    if (result.intent === 'bus' && result.commands.length > 3) {
      // Bus query - offer protocols
      const protocolGroups = this.groupCommandsByTypeForHierarchy(result.commands, [
        'i2c', 'spi', 'can', 'lin', 'rs232', 'rs422', 'rs485', 'mil', '1553', 'ethernet', 'usb'
      ]);

      busProtocols = Object.keys(protocolGroups).map(protocol =>
        `${protocol.toUpperCase()}` + (protocolGroups[protocol].length > 0 ? ` (${protocolGroups[protocol].length} commands)` : '')
      );

      conversationalPrompt = `For bus triggering, I can help with these protocols:\n${busProtocols.map((proto, i) => `${i+1}. ${proto}`).join('\n')}\n\nWhich bus protocol would you like to configure?`;
    }

    return {
      summary: `Found ${result.commands.length} commands for ${result.intent} in groups: ${result.groups.join(', ')}`,
      commands,
      workflow: result.workflow || undefined,
      responseTime: result.responseTime,
      conversationalPrompt
    };
  }

  /**
   * Group commands by type for conversational hierarchy
   */
  private groupCommandsByTypeForHierarchy(commands: CommandRecord[], keywords: string[]): Record<string, CommandRecord[]> {
    const groups: Record<string, CommandRecord[]> = {};

    commands.forEach(cmd => {
      const searchText = `${cmd.header} ${cmd.shortDescription} ${cmd.description}`.toLowerCase();

      for (const keyword of keywords) {
        if (searchText.includes(keyword)) {
          if (!groups[keyword]) groups[keyword] = [];
          groups[keyword].push(cmd);
          break; // Only assign to first matching category
        }
      }
    });

    return groups;
  }

  /**
   * Generate command arguments from syntax
   */
  private generateCommandArguments(cmd: CommandRecord): any[] {
    const args: any[] = [];
    const syntax = cmd.syntax.set || cmd.syntax.query || '';

    // Parse arguments from syntax like "{LIVE|ALL}" or "<NR1>"
    const argMatches = syntax.match(/\{([^}]+)\}|<([^>]+)>/g);
    if (argMatches) {
      argMatches.forEach((match, index) => {
        const cleanMatch = match.replace(/[{}<>]/g, '');
        const isEnum = cleanMatch.includes('|');

        args.push({
          name: `param${index + 1}`,
          type: isEnum ? 'enum' : 'number',
          description: isEnum ? `Select one of: ${cleanMatch}` : `Numeric value`,
          options: isEnum ? cleanMatch.split('|').map(opt => ({ value: opt, label: opt })) : undefined,
          required: true
        });
      });
    }

    return args;
  }

  /**
   * Generate code examples for command
   */
  private generateCodeExamples(cmd: CommandRecord): any[] {
    const examples: any[] = [];
    const setSyntax = cmd.syntax.set;
    const querySyntax = cmd.syntax.query;

    if (setSyntax) {
      // Generate example with default values
      let example = setSyntax;
      example = example.replace(/\{([^|]+)\|[^}]+\}/g, '$1'); // Use first enum option
      example = example.replace(/<NR1>/g, '1'); // Use 1 for numeric values
      examples.push({
        description: `Set ${cmd.header}`,
        scpi: { code: example },
        python: { code: `instrument.write("${example}")` },
        tm_devices: { code: example }
      });
    }

    if (querySyntax) {
      examples.push({
        description: `Query ${cmd.header}`,
        scpi: { code: querySyntax },
        python: { code: `result = instrument.query("${querySyntax}")` },
        tm_devices: { code: querySyntax }
      });
    }

    return examples;
  }

  /**
   * Find related commands
   */
  private findRelatedCommands(cmd: CommandRecord, allCommands: CommandRecord[]): string[] {
    const related: string[] = [];
    const cmdLower = cmd.header.toLowerCase();

    // Find commands with similar headers
    allCommands.forEach(otherCmd => {
      if (otherCmd.header !== cmd.header) {
        const otherLower = otherCmd.header.toLowerCase();

        // Same base command (e.g., both FASTframe commands)
        if (cmdLower.split(':')[0] === otherLower.split(':')[0]) {
          related.push(otherCmd.header);
        }
        // Similar functionality
        else if (cmdLower.includes('fastframe') && otherLower.includes('fastframe')) {
          related.push(otherCmd.header);
        }
      }
    });

    return related.slice(0, 5); // Limit to 5 related commands
  }

  /**
   * Generate a direct response for a SET command with a known value.
   * Uses proper markdown formatting like the detailed view.
   */
  private generateSetCommandResponse(
    cmd: CommandRecord,
    value: string,
    intent: IntentResult
  ): string {
    const syntax = cmd.syntax.set || cmd.header;
    const concrete = `${cmd.header} ${value}`;

    let response = `## 📋 1 ${intent.intent} Command Found\n\n`;
    response += `---\n\n`;
    response += `### **${cmd.header}**\n\n`;
    response += `**📋 Description:** ${cmd.shortDescription || cmd.description}\n\n`;

    if (cmd.description !== cmd.shortDescription && cmd.shortDescription) {
      response += `**📖 Details:** ${cmd.description}\n\n`;
    }

    response += `**⚙️ Set:** **\`${concrete}\`**\n\n`;

    if (cmd.syntax.query) {
      response += `**🔧 Query:** **\`${cmd.syntax.query}\`**\n\n`;
    }

    // Show valid values/range if available
    if (cmd.arguments.length > 0) {
      const arg = cmd.arguments[0];
      if (arg.validValues && Object.keys(arg.validValues).length > 0) {
        const vals = arg.validValues;
        if (vals.min !== undefined || vals.max !== undefined) {
          response += `**📏 Range:** ${vals.min ?? '—'} to ${vals.max ?? '—'}`;
          if (vals.default !== undefined) response += ` (default: ${vals.default})`;
          response += '\n\n';
        }
      }
    }

    response += `**🏭 Supported Families:** ${cmd.families.join(', ')}\n\n`;
    response += `**📂 Group:** ${cmd.group}`;

    return response;
  }

  /**
   * Generate usage example for command
   */
  private generateUsageExample(cmd: CommandRecord): string {
    if (cmd.syntax.set && cmd.syntax.query) {
      return `Set: ${cmd.syntax.set} | Query: ${cmd.syntax.query}`;
    } else if (cmd.syntax.set) {
      return `Set: ${cmd.syntax.set}`;
    } else if (cmd.syntax.query) {
      return `Query: ${cmd.syntax.query}`;
    } else {
      return cmd.header;
    }
  }
}

// Singleton instance
let assistantInstance: SmartScpiAssistant | null = null;

export function getSmartScpiAssistant(): SmartScpiAssistant {
  if (!assistantInstance) {
    assistantInstance = new SmartScpiAssistant();
  }
  return assistantInstance;
}

/**
 * Fast SCPI lookup tool for MCP server
 */
export async function smartScpiLookup(input: SmartScpiRequest): Promise<SmartScpiToolResult> {
  try {
    const assistant = getSmartScpiAssistant();
    const result = await assistant.smartLookup(input);
    const formatted = assistant.formatResults(result);

    // Cap to 3 commands max — the model only needs the top matches
    const topCommands = formatted.commands.slice(0, 3);

    // Omit conversationalPrompt when we have commands (build/action mode)
    // It's only useful for chat exploration menus, not workflow building
    const includePrompt = topCommands.length === 0 && formatted.conversationalPrompt;

    return {
      ok: true,
      data: topCommands.map(commandSuggestionToText),
      sourceMeta: [],
      warnings: [],
      summary: formatted.summary,
      ...(includePrompt ? { conversationalPrompt: formatted.conversationalPrompt } : {}),
    };
  } catch (error) {
    return {
      ok: false,
      data: [],
      sourceMeta: [],
      warnings: [`Smart SCPI lookup failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
      summary: 'Error occurred'
    };
  }
}
