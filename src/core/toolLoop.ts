import { loadPromptFile } from './promptLoader';
import type { McpChatRequest } from './schemas';
import { postCheckResponse } from './postCheck';
import { buildContext } from './contextBuilder';
import { getProviderCatalog, providerSupplementsEnabled } from './providerCatalog';
import { findProviderSupplementMatches } from './providerMatcher';
import { cleanRouter } from './cleanRouter';
import { cleanPlanner, type CleanPlan } from './cleanPlanner';
import { getToolDefinitions, runTool } from '../tools';
import { getCommandIndex } from './commandIndex';
import { dispatchRouterTool, getRouterTools } from './routerIntegration';
import { executeBuild } from './buildAction';
import { buildCommandGroupSeedQuery, suggestCommandGroups } from './commandGroups';
import { planIntent, type PlannerOutput } from './intentPlanner';
import { formatVerboseProbeResult, probeCommandProxy } from './instrumentProxy';
import { decodeCommandStatus, decodeStatusFromText } from './statusDecoder';
import type { CommandSuggestion } from './smartScpiAssistant';
import {
  getOrCreateSession,
  incrementTurn,
  recordToolResult,
  updateContextDiagnostics,
  buildSessionContext,
  cleanupStaleSessions,
} from './liveSession';
import { storeTempVisionImage } from './tempImageStore';

/**
 * Build shortcut from clean plan
 */
function buildShortcutFromCleanPlan(plan: CleanPlan, req: McpChatRequest): string {
  const actions = [];
  
  // Add command actions
  for (const command of plan.commands) {
    actions.push({
      type: 'insert_step_after',
      targetStepId: null,
      newStep: {
        type: command.type,
        label: command.description,
        params: {
          command: command.command,
          ...(command.parameters || {})
        }
      }
    });
  }
  
  // Add addition actions
  for (const addition of plan.additions) {
    actions.push({
      type: 'insert_step_after',
      targetStepId: addition.stepId || null,
      newStep: {
        type: addition.type,
        label: addition.description,
        params: {}
      }
    });
  }
  
  return `ACTIONS_JSON: ${JSON.stringify({
    summary: `Planned ${plan.intent} with ${plan.confidence} confidence`,
    findings: [plan.reasoning],
    suggestedFixes: plan.confidence < 0.8 ? ['Consider providing more specific details'] : [],
    actions
  })}`;
}

/**
 * Run deterministic tool loop for MCP-only mode (no OpenAI calls)
 */
async function runDeterministicToolLoop(req: McpChatRequest, flowCommandIssues: string[], maxRounds: number) {
  console.log('[DETERMINISTIC_TOOL_LOOP] Starting deterministic tool execution');
  const startedAt = Date.now();

  try {
    const routeDecision = cleanRouter.makeRouteDecision(req);
    const msg = req.userMessage.toLowerCase().trim();

    // Validation intent: "check my flow", "validate flow", "review flow"
    if (cleanRouter.isValidationIntent(msg)) {
      console.log('[DETERMINISTIC_TOOL_LOOP] Validation intent detected');
      return await runFlowValidation(req);
    }

    // Question intent: "what is X", "explain X", "describe X"
    if (cleanRouter.isQuestionIntent(msg)) {
      console.log('[DETERMINISTIC_TOOL_LOOP] Question intent detected');
      return await runQuestionLookup(req);
    }

    // Browse intent: "browse commands", "browse trigger", "browse trigger edge"
    const browseIntent = cleanRouter.isBrowseIntent(msg);
    if (browseIntent.isBrowse) {
      console.log('[DETERMINISTIC_TOOL_LOOP] Browse intent detected');
      return await runBrowseCommands(req, browseIntent.group, browseIntent.filter);
    }

    if (cleanRouter.isKnowledgeSearchIntent(msg)) {
      console.log('[DETERMINISTIC_TOOL_LOOP] Knowledge search intent detected');
      return await runSearchKnowledge(req);
    }

    // Smart SCPI + RAG enrichment
    if (routeDecision.route === 'smart_scpi') {
      console.log('[DETERMINISTIC_TOOL_LOOP] Using Smart SCPI Assistant');
      const scpiResult = await runSmartScpiAssistant(req);
      return await enrichWithRag(scpiResult, req.userMessage, req.flowContext?.modelFamily);
    }

    if (routeDecision.route === 'tm_devices') {
      console.log('[DETERMINISTIC_TOOL_LOOP] Using TM Devices');
      return await runTmDevices(req);
    }

    // Fallback
    console.log('[DETERMINISTIC_TOOL_LOOP] No deterministic route found');
    return {
      text: 'No deterministic tool available for this request in MCP-only mode. Try rephrasing as a specific SCPI command question, or switch to AI mode for conversational assistance.',
      assistantThreadId: undefined,
      errors: [],
      warnings: ['No deterministic route matched'],
      metrics: {
        totalMs: Date.now() - startedAt, usedShortcut: false,
        iterations: 0, toolCalls: 0, toolMs: 0, modelMs: 0,
        promptChars: { system: 0, user: 0 }
      },
      debug: { toolTrace: [], resolutionPath: 'deterministic:no_route' }
    };
  } catch (error) {
    console.log('[DETERMINISTIC_TOOL_LOOP] Error:', error);
    return {
      text: `Deterministic tool loop error: ${error}`,
      assistantThreadId: undefined,
      errors: [String(error)],
      warnings: [],
      metrics: {
        totalMs: Date.now() - startedAt, usedShortcut: false,
        iterations: 0, toolCalls: 0, toolMs: 0, modelMs: 0,
        promptChars: { system: 0, user: 0 }
      },
      debug: { toolTrace: [], resolutionPath: 'deterministic:error' }
    };
  }
}

/**
 * Run Smart SCPI Assistant directly
 */
async function runSmartScpiAssistant(req: McpChatRequest) {
  try {
    // FIX BUG-003: Wrap dynamic import in try/catch to prevent unhandled rejections
    let smartScpiLookup: any;
    try {
      const module = await import('./smartScpiAssistant');
      smartScpiLookup = module.smartScpiLookup;
    } catch (importError) {
      throw new Error(`Failed to load SmartScpiAssistant: ${
        importError instanceof Error ? importError.message : String(importError)
      }`);
    }

    if (!smartScpiLookup) {
      throw new Error('smartScpiLookup function not found in module');
    }
    
    // Include text attachments as additional context for the query
    const attachmentCtx = buildAttachmentContext(req);
    const queryWithContext = attachmentCtx
      ? `${req.userMessage}\n\n${attachmentCtx}`
      : req.userMessage;

    const toolResult = await smartScpiLookup({
      query: queryWithContext,
      modelFamily: req.flowContext.modelFamily,
      context: `${req.flowContext.deviceType || 'SCOPE'} ${req.flowContext.backend || 'pyvisa'}`,
      mode: 'build'  // MCP-only mode should auto-select best match, not show conversational menus
    });

    if (!toolResult) {
      throw new Error('smartScpiLookup returned no result');
    }

    // Fallback: if smart lookup returned no results, show browse results directly
    if ((!toolResult.data || toolResult.data.length === 0) && !toolResult.conversationalPrompt) {
      console.log('[SMART_SCPI] No results — falling back to browse_scpi_commands');
      const { browseScpiCommands } = await import('../tools/browseScpiCommands');
      const browseResult = await browseScpiCommands({});
      const groups = (browseResult.data as any)?.groups || [];
      const groupList = groups.map((g: any) => `- **${g.name}** (${g.commandCount} commands) — ${g.description}`).join('\n');

      return {
        text: `I couldn't find a direct match for "${req.userMessage}".\n\n` +
          `Try rephrasing, or browse by group:\n\n${groupList}\n\n` +
          `Type **"browse \<group name\>"** to see commands in a group, e.g. **"browse Trigger"**.\n` +
          `Type **"browse Trigger edge"** to filter within a group.`,
        assistantThreadId: undefined,
        errors: [],
        warnings: ['No direct match — browse groups listed'],
        metrics: {
          totalMs: 0, usedShortcut: false, iterations: 1, toolCalls: 1, toolMs: 0, modelMs: 0,
          promptChars: { system: 0, user: req.userMessage.length }
        },
        debug: {
          toolTrace: [{
            name: 'smart_scpi_lookup',
            args: { query: req.userMessage },
            startedAt: new Date().toISOString(),
            resultSummary: { ok: true, count: 0 }
          }],
          resolutionPath: 'deterministic:smart_scpi_fallback_browse'
        }
      };
    }

    // Handle conversational prompts - return the conversational response with commands
    if (toolResult.conversationalPrompt) {
      return {
        text: toolResult.conversationalPrompt,
        commands: toolResult.data || [], // Include commands for apply card (data property from ToolResult)
        assistantThreadId: undefined,
        errors: [],
        warnings: [],
        metrics: {
          totalMs: 0,
          usedShortcut: false,
          iterations: 1,
          toolCalls: 1,
          toolMs: 0,
          modelMs: 0,
          promptChars: { system: 0, user: req.userMessage.length }
        },
        debug: {
          toolTrace: [{
            name: 'smart_scpi_lookup',
            args: { query: req.userMessage },
            startedAt: new Date().toISOString(),
            resultSummary: { ok: true, count: 0, conversational: true }
          }],
          resolutionPath: 'deterministic:smart_scpi_conversational'
        }
      };
    }
    
    // Build mode: materialize matched commands into applyable ACTIONS_JSON flow steps.
    // Detect if user wants a query vs set from their message
    const userWords = req.userMessage.toLowerCase().split(/\s+/);
    const userWantsQuery = /\b(query|read|get|check|what\s*is|show|display|current|value)\b/i.test(req.userMessage);

    // Extract user-provided values and channel/bus numbers from the message
    const channelMatch = req.userMessage.match(/\b(?:ch(?:annel)?\s*)(\d+)\b/i);
    const busMatch = req.userMessage.match(/\b(?:bus\s*)(\d+)\b/i);
    const measMatch = req.userMessage.match(/\b(?:meas(?:urement)?\s*)(\d+)\b/i);
    const mathMatch = req.userMessage.match(/\b(?:math\s*)(\d+)\b/i);
    const refMatch = req.userMessage.match(/\b(?:ref(?:erence)?\s*)(\d+)\b/i);
    const searchMatch = req.userMessage.match(/\b(?:search\s*)(\d+)\b/i);
    const defaultChannel = channelMatch?.[1] || '1';
    const defaultBus = busMatch?.[1] || '1';
    const defaultMeas = measMatch?.[1] || '1';
    // Extract numeric value with optional unit (e.g. "2v", "500mv", "200mhz", "50")
    // Strip out channel/bus/meas references first so "channel 1 scale to 2v" doesn't pick "1" as the value
    const msgWithoutRefs = req.userMessage
      .replace(/\b(?:ch(?:annel)?|bus|meas(?:urement)?|math|ref(?:erence)?|search)\s*\d+\b/gi, '')
      .replace(/\b(?:ch|b|meas)\d+\b/gi, '');
    const valueMatch = msgWithoutRefs.match(/\b(?:to\s+)?(\d+(?:\.\d+)?)\s*(mv|v|uv|us|ns|ms|s|hz|khz|mhz|ghz|%)?(?:\b|$)/i);

    function resolvePlaceholders(command: string): string {
      let resolved = command;
      // Resolve template placeholders with user-provided or default values
      resolved = resolved.replace(/CH<x>/gi, `CH${defaultChannel}`);
      resolved = resolved.replace(/\{A\|B\}/gi, 'A');
      resolved = resolved.replace(/\{A\|B\|B:RESET\}/gi, 'A');
      resolved = resolved.replace(/B<x>/gi, `B${defaultBus}`);
      resolved = resolved.replace(/MEAS<x>/gi, `MEAS${defaultMeas}`);
      resolved = resolved.replace(/MATH<x>/gi, `MATH${mathMatch?.[1] || '1'}`);
      resolved = resolved.replace(/REF<x>/gi, `REF${refMatch?.[1] || '1'}`);
      resolved = resolved.replace(/SEARCH<x>/gi, `SEARCH${searchMatch?.[1] || '1'}`);
      resolved = resolved.replace(/POWer<x>/gi, 'POWer1');
      resolved = resolved.replace(/PLOT<x>/gi, 'PLOT1');
      resolved = resolved.replace(/SOUrce<x>/gi, `SOUrce${channelMatch?.[1] || '1'}`);
      resolved = resolved.replace(/D<x>/gi, 'D0');
      resolved = resolved.replace(/<x>/gi, '1'); // catch-all for remaining <x>
      return resolved;
    }

    function resolveValue(): string | null {
      if (!valueMatch) return null;
      const num = parseFloat(valueMatch[1]);
      const unit = (valueMatch[2] || '').toLowerCase();
      // Convert to base units for SCPI
      const multipliers: Record<string, number> = {
        'uv': 1e-6, 'mv': 1e-3, 'v': 1, 'kv': 1e3,
        'ns': 1e-9, 'us': 1e-6, 'ms': 1e-3, 's': 1,
        'hz': 1, 'khz': 1e3, 'mhz': 1e6, 'ghz': 1e9,
        '%': 1,
      };
      if (unit && multipliers[unit] !== undefined) {
        return String(num * multipliers[unit]);
      }
      return String(num);
    }

    // Try to resolve ADDMEAS measurement type from user query
    let addmeasValue: string | null = null;
    try {
      const { resolveAddmeasValue } = await import('./measurementCatalog');
      addmeasValue = resolveAddmeasValue(req.userMessage);
    } catch { /* ignore */ }

    // IMPORTANT: toolResult.data is string[] (text for Claude).
    // Use commandSuggestions (raw CommandSuggestion objects) for building ACTIONS_JSON.
    // Using data[] here caused "Cannot read properties of undefined (reading 'replace')"
    // because cmd.header was undefined on a string element.
    const commandObjects: any[] = toolResult.commandSuggestions || [];
    const actions = commandObjects.map((cmd: any, idx: number) => {
      const isSetCapable = cmd.commandType === 'set' || cmd.commandType === 'both';
      const isQueryCapable = cmd.commandType === 'query' || cmd.commandType === 'both';
      // If user explicitly asked for a query, prefer query form
      const useQuery = userWantsQuery && isQueryCapable;
      const useSet = !useQuery && isSetCapable;
      let scpiCommand: string;

      if (useSet && cmd.syntax?.set) {
        let resolved = String(cmd.syntax.set).replace(/\n/g, ' ').replace(/\s+/g, ' ');
        // Resolve placeholders in the header part
        resolved = resolvePlaceholders(resolved);
        // Special handling for ADDMEAS: resolve <QString> to measurement enum value
        if (/ADDMEAS/i.test(resolved) && addmeasValue && /<QString>/i.test(resolved)) {
          resolved = resolved.replace(/<QString>/i, addmeasValue);
        }
        // Match {ENUM1|ENUM2|...} patterns
        const enumMatch = resolved.match(/\{([^}]+)\}/);
        if (enumMatch) {
          const options = enumMatch[1].split('|').map((s: string) => s.trim()).filter(Boolean);
          // Try direct word match first
          let match = options.find((opt: string) =>
            userWords.some((w: string) => w.length >= 3 && (opt.toLowerCase() === w || opt.toLowerCase().includes(w)))
          );
          // If no match but user mentioned a channel and options include CH<n>, pick that
          if (!match && channelMatch) {
            const chOpt = options.find((opt: string) => opt === `CH${defaultChannel}` || opt.toLowerCase() === `ch${defaultChannel}`);
            if (chOpt) match = chOpt;
          }
          // If options include a "default first" like ON/OFF, RISe/FALL etc, pick the first one
          if (match) {
            resolved = resolved.replace(enumMatch[0], match).trim();
          } else {
            // No match — strip the enum for a cleaner command
            resolved = resolved.replace(/\s*\{[^}]+\}/, '').trim();
          }
        }
        // Replace any <NRx>/<NRf>/<NR1>/<NR2>/<NR3> with the user's value if available
        const userValue = resolveValue();
        const nrPattern = /<NR[f1-9x]>/i;
        if (userValue && nrPattern.test(resolved)) {
          resolved = resolved.replace(nrPattern, userValue).trim();
        }
        // Fallback: if user provided a value but no NR placeholder matched, append it
        // (guard: only if the last token of resolved isn't already a number)
        if (userValue && !resolved.includes(userValue) && !/^\d/.test((resolved.split(/\s+/).pop() || ''))) {
          resolved = `${resolved} ${userValue}`;
        }
        scpiCommand = resolved;
      } else {
        scpiCommand = resolvePlaceholders(cmd.syntax?.query || `${cmd.header}?`);
      }

      const stepType = useQuery ? 'query' : (useSet ? 'write' : 'query');
      const stepLabel = stepType === 'query' ? `Query ${cmd.header}` : `Set ${cmd.header}`;
      const stepParams: Record<string, unknown> = { command: scpiCommand };
      if (stepType === 'query') {
        stepParams.saveAs = `result_${cmd.header.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;
      }

      return {
        type: 'insert_step_after' as const,
        targetStepId: null,
        newStep: {
          id: `smart_scpi_${idx + 1}`,
          type: stepType as 'write' | 'query',
          label: stepLabel,
          params: stepParams
        }
      };
    });

    // Build SCPI command cards for the rich widget renderer in TekAutomate UI.
    // The SCPI_COMMANDS: format renders each command as a card with + Query / + Write
    // buttons, plus an "Apply All to Flow" bulk button at the bottom.
    // resolvedCommand carries the RESOLVED command (value substituted) from the actions array,
    // so the card footer and Write button show "CH1:SCALERATio 2" not "CH<x>:SCALERATio <NR2>".
    const scpiCards = commandObjects.map((cmd: any, idx: number) => {
      const resolvedAction = actions[idx];
      const resolvedCommand: string | null =
        (resolvedAction?.newStep?.params?.command as string | undefined) || null;
      return {
        header: cmd.header,
        description: cmd.shortDescription || cmd.description || '',
        set: cmd.syntax?.set || null,
        query: cmd.syntax?.query || null,
        resolvedCommand,   // resolved write command (value-substituted), null if query-only
        type: cmd.commandType || 'both',
        group: cmd.group || '',
        families: cmd.families || [],
        example: resolvedCommand || cmd.codeExamples?.[0]?.scpi?.code || cmd.syntax?.set || cmd.syntax?.query || '',
      };
    });

    return {
      text: `SCPI_COMMANDS: ${JSON.stringify({
        summary: toolResult.summary,
        commands: scpiCards,
        actions,
      })}`,
      assistantThreadId: undefined,
      errors: [],
      warnings: [],
      metrics: {
        totalMs: 0,
        usedShortcut: false,
        iterations: 1,
        toolCalls: 1,
        toolMs: 0,
        modelMs: 0,
        promptChars: { system: 0, user: req.userMessage.length }
      },
      debug: {
        toolTrace: [{
          name: 'smart_scpi_lookup',
          args: { query: req.userMessage },
          startedAt: new Date().toISOString(),
          resultSummary: { ok: true, count: toolResult.data.length }
        }],
        resolutionPath: 'deterministic:smart_scpi'
      }
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[SMART_SCPI] Error:', errorMessage);
    
    return {
      text: `Smart SCPI Assistant error: ${errorMessage}`,
      assistantThreadId: undefined,
      errors: [errorMessage],
      warnings: [],
      metrics: {
        totalMs: 0,
        usedShortcut: false,
        iterations: 0,
        toolCalls: 0,
        toolMs: 0,
        modelMs: 0,
        promptChars: { system: 0, user: 0 }
      },
      debug: {
        toolTrace: [],
        resolutionPath: 'deterministic:smart_scpi_error'
      }
    };
  }
}

/**
 * Run question lookup — return full command entry, not build steps
 */
async function runQuestionLookup(req: McpChatRequest) {
  try {
    let smartScpiLookup: any;
    try {
      const module = await import('./smartScpiAssistant');
      smartScpiLookup = module.smartScpiLookup;
    } catch (importError) {
      throw new Error(`Failed to load SmartScpiAssistant: ${
        importError instanceof Error ? importError.message : String(importError)
      }`);
    }

    // Strip question prefixes to get the actual subject
    const subject = req.userMessage
      .replace(/^\s*(what\s+is|what\s+are|what\s+does|explain|describe|tell\s+me\s+about|how\s+does|how\s+do\s+i|how\s+to)\s+/i, '')
      .trim();

    const toolResult = await smartScpiLookup({
      query: subject,
      modelFamily: req.flowContext.modelFamily,
      context: `${req.flowContext.deviceType || 'SCOPE'} ${req.flowContext.backend || 'pyvisa'}`,
      mode: 'chat'
    });

    if (!toolResult || !toolResult.data || toolResult.data.length === 0) {
      return {
        text: `I couldn't find any SCPI commands matching "${subject}". Try being more specific about the measurement, channel, or instrument feature.`,
        assistantThreadId: undefined,
        errors: [],
        warnings: [],
        metrics: { totalMs: 0, usedShortcut: false, iterations: 1, toolCalls: 1, toolMs: 0, modelMs: 0, promptChars: { system: 0, user: req.userMessage.length } },
        debug: { toolTrace: [], resolutionPath: 'deterministic:question_no_results' }
      };
    }

    // Format the full command entry for the user
    const cmd = toolResult.data[0];
    let response = `## ${cmd.header}\n\n`;
    response += `**Description:** ${cmd.description || cmd.shortDescription || 'No description available'}\n\n`;
    if (cmd.syntax?.set) response += `**Set syntax:** \`${cmd.syntax.set}\`\n\n`;
    if (cmd.syntax?.query) response += `**Query syntax:** \`${cmd.syntax.query}\`\n\n`;
    if (cmd.arguments && cmd.arguments.length > 0) {
      response += `**Arguments:**\n`;
      for (const arg of cmd.arguments) {
        response += `- **${arg.name}** (${arg.type}${arg.required ? ', required' : ''}): ${arg.description || ''}`;
        if (arg.validValues && typeof arg.validValues === 'object') {
          const vv = arg.validValues as Record<string, unknown>;
          if (vv.min !== undefined || vv.max !== undefined) {
            response += ` — Range: ${vv.min ?? '—'} to ${vv.max ?? '—'}`;
          }
          if (arg.options && Array.isArray(arg.options)) {
            response += ` — Values: ${arg.options.map((o: any) => o.value || o).join(', ')}`;
          }
        }
        response += '\n';
      }
      response += '\n';
    }
    if (cmd.codeExamples && cmd.codeExamples.length > 0) {
      response += `**Examples:**\n`;
      for (const ex of cmd.codeExamples) {
        if (ex.scpi?.code) response += `- \`${ex.scpi.code}\` — ${ex.description || ''}\n`;
      }
      response += '\n';
    }
    if (cmd.relatedCommands && cmd.relatedCommands.length > 0) {
      response += `**Related commands:** ${cmd.relatedCommands.slice(0, 5).join(', ')}\n\n`;
    }
    response += `**Group:** ${cmd.group || 'N/A'} | **Families:** ${(cmd.families || []).join(', ') || 'All'}`;

    return {
      text: response,
      commands: toolResult.data,
      assistantThreadId: undefined,
      errors: [],
      warnings: [],
      metrics: { totalMs: 0, usedShortcut: false, iterations: 1, toolCalls: 1, toolMs: 0, modelMs: 0, promptChars: { system: 0, user: req.userMessage.length } },
      debug: { toolTrace: [{ name: 'smart_scpi_lookup', args: { query: subject }, startedAt: new Date().toISOString(), resultSummary: { ok: true, count: toolResult.data.length } }], resolutionPath: 'deterministic:question_lookup' }
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      text: `Question lookup error: ${errorMessage}`,
      assistantThreadId: undefined,
      errors: [errorMessage],
      warnings: [],
      metrics: { totalMs: 0, usedShortcut: false, iterations: 0, toolCalls: 0, toolMs: 0, modelMs: 0, promptChars: { system: 0, user: 0 } },
      debug: { toolTrace: [], resolutionPath: 'deterministic:question_error' }
    };
  }
}

/**
 * Run flow validation — full command validation including arguments and syntax
 */
async function runFlowValidation(req: McpChatRequest) {
  try {
    const { verifyScpiCommands } = await import('../tools/verifyScpiCommands');
    const index = await getCommandIndex();

    // Extract commands from the flow steps
    const steps = req.flowContext?.steps || [];
    const commands: string[] = steps
      .filter((s: any) => s.params?.command && typeof s.params.command === 'string')
      .map((s: any) => String(s.params.command).trim())
      .filter(Boolean);

    if (commands.length === 0) {
      return {
        text: 'No SCPI commands found in the current flow to validate. Add some commands first.',
        assistantThreadId: undefined,
        errors: [],
        warnings: ['No commands in flow'],
        metrics: { totalMs: 0, usedShortcut: false, iterations: 1, toolCalls: 0, toolMs: 0, modelMs: 0, promptChars: { system: 0, user: req.userMessage.length } },
        debug: { toolTrace: [], resolutionPath: 'deterministic:validate_empty' }
      };
    }

    // Run header verification
    const headerResult = await verifyScpiCommands({
      commands,
      modelFamily: req.flowContext?.modelFamily,
      requireExactSyntax: true,
    });

    // Deep validation: check each command for missing args, invalid values, set/query mismatch
    const issues: string[] = [];
    for (const command of commands) {
      const parts = command.trim().split(/\s+/);
      const header = parts[0];
      const argStr = parts.slice(1).join(' ').trim();
      const isQuery = header.endsWith('?');

      const entry = index.getByHeader(header.replace(/\?$/, ''), req.flowContext?.modelFamily)
        || index.getByHeader(header, req.flowContext?.modelFamily)
        || index.getByHeaderPrefix(header.replace(/\?$/, ''), req.flowContext?.modelFamily);

      if (!entry) continue; // already caught by header verification

      // Check set vs query form mismatch
      if (isQuery && !entry.syntax?.query) {
        issues.push(`\`${command}\` — query form used but command only supports SET`);
      }
      if (!isQuery && argStr && !entry.syntax?.set) {
        issues.push(`\`${command}\` — set form used but command only supports QUERY`);
      }

      // Check if set command is missing required argument
      if (!isQuery && entry.syntax?.set) {
        const syntaxStr = entry.syntax.set;
        const hasRequiredArg = /<NR[f13]>|\{[^}]+\}|<QString>/.test(syntaxStr);
        if (hasRequiredArg && !argStr) {
          const argHint = syntaxStr.replace(/^[^\s]+\s*/, '').trim();
          const hint = argHint.length > 80 ? argHint.slice(0, 80) + '...' : argHint;
          issues.push(`\`${command}\` — missing required argument: \`${hint}\``);
        }
      }

      // Check if argument value matches valid enum values
      if (!isQuery && argStr && entry.syntax?.set) {
        const enumMatch = entry.syntax.set.match(/\{([^}]+)\}/);
        if (enumMatch) {
          const validOptions = enumMatch[1].split('|').map(s => s.trim().toUpperCase());
          const userVal = argStr.toUpperCase().trim();
          if (validOptions.length > 0 && !validOptions.some(opt => opt === userVal || userVal.startsWith(opt))) {
            // Only flag if arg is clearly not a numeric value
            if (!/^[\d.eE+-]+$/.test(argStr)) {
              const optionsList = validOptions.length > 10
                ? validOptions.slice(0, 10).join(', ') + ` ... (${validOptions.length} total)`
                : validOptions.join(', ');
              issues.push(`\`${command}\` — invalid value \`${argStr}\`. Valid: ${optionsList}`);
            }
          }
        }
      }
    }

    // Build response
    const headerResults = (headerResult.data || []) as Array<{ command: string; verified: boolean; reason?: string }>;
    const unverified = headerResults.filter(r => !r.verified);

    let response = `## Flow Validation Results\n\n`;
    response += `**Commands checked:** ${commands.length}\n\n`;

    if (unverified.length === 0 && issues.length === 0) {
      response += `All ${commands.length} commands passed validation.\n`;
    } else {
      if (unverified.length > 0) {
        response += `### Unrecognized Commands\n`;
        for (const r of unverified) {
          response += `- \`${r.command}\` — ${r.reason || 'not found in command database'}\n`;
        }
        response += '\n';
      }
      if (issues.length > 0) {
        response += `### Argument / Syntax Issues\n`;
        for (const issue of issues) {
          response += `- ${issue}\n`;
        }
        response += '\n';
      }
    }

    return {
      text: response,
      assistantThreadId: undefined,
      errors: [],
      warnings: headerResult.warnings || [],
      metrics: { totalMs: 0, usedShortcut: false, iterations: 1, toolCalls: 1, toolMs: 0, modelMs: 0, promptChars: { system: 0, user: req.userMessage.length } },
      debug: { toolTrace: [{ name: 'verify_scpi_commands', args: { commands }, startedAt: new Date().toISOString(), resultSummary: { ok: true, count: commands.length } }], resolutionPath: 'deterministic:validate_flow' }
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      text: `Flow validation error: ${errorMessage}`,
      assistantThreadId: undefined,
      errors: [errorMessage],
      warnings: [],
      metrics: { totalMs: 0, usedShortcut: false, iterations: 0, toolCalls: 0, toolMs: 0, modelMs: 0, promptChars: { system: 0, user: 0 } },
      debug: { toolTrace: [], resolutionPath: 'deterministic:validate_error' }
    };
  }
}

/**
 * Map model family to allowed RAG source files.
 * Filters out irrelevant instrument families (RSA, AWG, AFG, SMU, DPOJET, TEKEXP).
 */
const RAG_SOURCE_ALLOW: Record<string, RegExp> = {
  mso_2_series: /mso_2_4_5_6_7|mso_manual/i,
  mso_4_series: /mso_2_4_5_6_7|mso_manual/i,
  mso_5_series: /mso_2_4_5_6_7|mso_manual/i,
  mso_6_series: /mso_2_4_5_6_7|mso_manual/i,
  mso_7_series: /mso_2_4_5_6_7|mso_manual/i,
  dpo_5_series: /MSO_DPO_5k_7k|dpojet|legacy_scope/i,
  dpo_7_series: /MSO_DPO_5k_7k|dpojet|legacy_scope/i,
  tekscopepc:   /mso_2_4_5_6_7|MSO_DPO_5k_7k|mso_manual|legacy_scope/i,
  tekscope_pc:  /mso_2_4_5_6_7|MSO_DPO_5k_7k|mso_manual|legacy_scope/i,
};

/**
 * Enrich a toolLoop result with RAG context snippets.
 * Searches the scpi corpus for the query and appends relevant knowledge.
 * Filters out chunks from irrelevant instrument families.
 */
async function enrichWithRag(result: any, query: string, modelFamily?: string): Promise<any> {
  try {
    const { retrieveRagChunks } = await import('../tools/retrieveRagChunks');
    const ragResult = await retrieveRagChunks({ corpus: 'scpi', query, topK: 8 });
    let chunks = (ragResult.data || []) as Array<{title: string; body: string; source?: string}>;

    // Filter to relevant source files for the user's model family
    const familyKey = (modelFamily || '').toLowerCase().replace(/\s+/g, '_');
    const allowPattern = RAG_SOURCE_ALLOW[familyKey];
    if (allowPattern) {
      chunks = chunks.filter(c => allowPattern.test(c.source || ''));
    } else {
      // Unknown family: at minimum exclude RSA, AWG, AFG, SMU (non-scope instruments)
      chunks = chunks.filter(c => !/\b(rsa|awg|afg|smu)\b/i.test(c.source || ''));
    }

    // Only keep chunks whose title has words overlapping with the query
    const queryWords = new Set(query.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    chunks = chunks.filter(c => {
      const titleWords = (c.title || '').toLowerCase().split(/\s+/);
      return titleWords.some((w: string) => queryWords.has(w));
    }).slice(0, 2);

    if (chunks.length > 0) {
      const ragSection = chunks
        .map(c => `**${c.title}** — ${String(c.body || '').replace(/\n/g, ' ').slice(0, 120)}`)
        .join('\n');
      result.text += `\n\n---\n${ragSection}`;
    }
  } catch { /* non-fatal */ }
  return result;
}

/**
 * Run knowledge base search — search RAG chunks directly
 */
async function runSearchKnowledge(req: McpChatRequest) {
  try {
    const { retrieveRagChunks } = await import('../tools/retrieveRagChunks');
    // Strip "search knowledge/docs/rag" prefix to get the actual query
    const query = req.userMessage
      .replace(/^\s*(search|find|look\s*up)\s+(knowledge|docs|documentation|rag|manual|help)\s*(base|for)?\s*/i, '')
      .replace(/^\s*(knowledge|docs|rag)\s+(search|lookup|find)\s*/i, '')
      .trim() || req.userMessage;

    // Pick relevant corpora based on query keywords
    const qLower = query.toLowerCase();
    const wantsErrors = /\b(error|bug|fix|issue|fail|timeout|crash|debug)\b/i.test(qLower);
    const wantsArch = /\b(architect|workflow|blockly|steps|flow|schema|template|pattern)\b/i.test(qLower);
    const wantsPyvisa = /\b(pyvisa|tekhsi|connect|visa|socket|grpc)\b/i.test(qLower);
    const wantsScopeLogic = /\b(clipping|clip|9\.91e\+37|overshoot|ringing|signal\s+integrity|probe\s+comp|probe\s+compensation|setup\s+scope|auto\s+setup|autoset|optimize\s+display)\b/i.test(qLower);
    const corpora: Array<'scpi' | 'errors' | 'app_logic' | 'templates' | 'pyvisa_tekhsi' | 'scope_logic'> = ['scpi'];
    if (wantsErrors) corpora.push('errors');
    if (wantsScopeLogic) corpora.push('scope_logic');
    if (wantsArch) corpora.push('app_logic', 'templates');
    if (wantsPyvisa) corpora.push('pyvisa_tekhsi');
    // If nothing specific, add scope/app context as secondary
    if (corpora.length === 1) corpora.push('scope_logic', 'app_logic');

    const allResults: Array<{corpus: string; title: string; body: string; source?: string}> = [];

    // Filter RAG by model family — exclude irrelevant instrument families
    const familyKey = (req.flowContext?.modelFamily || '').toLowerCase().replace(/\s+/g, '_');
    const allowPattern = RAG_SOURCE_ALLOW[familyKey];

    for (const corpus of corpora) {
      try {
        const r = await retrieveRagChunks({ corpus, query, topK: 4 });
        let chunks = (r.data || []) as Array<{corpus: string; title: string; body: string; source?: string}>;
        if (corpus === 'scpi') {
          if (allowPattern) {
            chunks = chunks.filter(c => allowPattern.test(c.source || ''));
          } else {
            chunks = chunks.filter(c => !/\b(rsa|awg|afg|smu)\b/i.test(c.source || ''));
          }
        }
        for (const c of chunks.slice(0, 2)) {
          allResults.push({ corpus, title: c.title, body: c.body, source: c.source });
        }
      } catch { /* skip failed corpus */ }
    }

    if (allResults.length === 0) {
      return {
        text: `No results for "${query}". Try different keywords.`,
        assistantThreadId: undefined,
        errors: [],
        warnings: [],
        metrics: { totalMs: 0, usedShortcut: false, iterations: 1, toolCalls: 1, toolMs: 0, modelMs: 0, promptChars: { system: 0, user: req.userMessage.length } },
        debug: { toolTrace: [], resolutionPath: 'deterministic:knowledge_empty' }
      };
    }

    // Compact output — no section headers, just tagged results
    let response = `**Knowledge: "${query}"**\n\n`;
    for (const c of allResults) {
      const tag = c.corpus === 'scpi' ? 'SCPI' : c.corpus === 'app_logic' ? 'Docs' : c.corpus === 'errors' ? 'Issue' : c.corpus === 'templates' ? 'Template' : c.corpus;
      const body = String(c.body || '').replace(/\n/g, ' ').slice(0, 120);
      response += `[${tag}] **${c.title}** — ${body}\n\n`;
    }

    return {
      text: response,
      assistantThreadId: undefined,
      errors: [],
      warnings: [],
      metrics: { totalMs: 0, usedShortcut: false, iterations: 1, toolCalls: 1, toolMs: 0, modelMs: 0, promptChars: { system: 0, user: req.userMessage.length } },
      debug: { toolTrace: [{ name: 'retrieve_rag_chunks', args: { query }, startedAt: new Date().toISOString(), resultSummary: { ok: true, count: allResults.length } }], resolutionPath: 'deterministic:knowledge_search' }
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      text: `Knowledge search error: ${errorMessage}`,
      assistantThreadId: undefined,
      errors: [errorMessage],
      warnings: [],
      metrics: { totalMs: 0, usedShortcut: false, iterations: 0, toolCalls: 0, toolMs: 0, modelMs: 0, promptChars: { system: 0, user: 0 } },
      debug: { toolTrace: [], resolutionPath: 'deterministic:knowledge_error' }
    };
  }
}

/**
 * Run browse_scpi_commands in MCP-only deterministic mode.
 * Returns formatted results directly to the user.
 */
async function runBrowseCommands(req: McpChatRequest, group?: string, filter?: string) {
  try {
    const { browseScpiCommands } = await import('../tools/browseScpiCommands');
    const result = await browseScpiCommands({
      group,
      filter,
      modelFamily: req.flowContext?.modelFamily,
    });

    if (!result.ok) {
      return {
        text: `Browse error: ${(result.warnings || []).join(', ')}`,
        assistantThreadId: undefined,
        errors: [],
        warnings: result.warnings || [],
        metrics: { totalMs: 0, usedShortcut: false, iterations: 1, toolCalls: 1, toolMs: 0, modelMs: 0, promptChars: { system: 0, user: req.userMessage.length } },
        debug: { toolTrace: [], resolutionPath: 'deterministic:browse_error' }
      };
    }

    const data = result.data as any;
    let response = '';

    if (data.level === 'group_list') {
      // Compact 2-column format
      response = `**${data.totalGroups} Command Groups** — type \`browse <name>\` to open\n\n`;
      for (const g of data.groups) {
        response += `\`${g.name}\` (${g.commandCount})\n`;
      }
    } else if (data.level === 'group_commands') {
      const filterNote = data.filter ? ` matching "${data.filter}"` : '';
      response = `**${data.groupName}** — ${data.showing} of ${data.totalCommands} commands${filterNote}\n\n`;
      for (const cmd of data.commands) {
        const desc = (cmd.shortDescription || '').split('.')[0].slice(0, 55);
        response += `\`${cmd.header}\` — ${desc}\n`;
      }
      if (data.showing < data.totalCommands && !data.filter) {
        response += `\n*${data.totalCommands - data.showing} more — type \`browse ${data.groupName} <keyword>\` to filter*`;
      }
      response += `\n\nType \`what is <header>\` for full details.`;
    } else if (data.level === 'command_detail') {
      const cmd = data.command;
      response = `**${cmd.header}** (${cmd.commandType})\n`;
      response += `${(cmd.shortDescription || cmd.description || '').slice(0, 120)}\n\n`;
      if (cmd.syntax?.set) response += `Set: \`${cmd.syntax.set}\`\n`;
      if (cmd.syntax?.query) response += `Query: \`${cmd.syntax.query}\`\n`;
      if (cmd.arguments && cmd.arguments.length > 0) {
        response += '\nArgs:\n';
        for (const arg of cmd.arguments.slice(0, 4)) {
          let line = `- **${arg.name}** (${arg.type}): ${(arg.description || '').slice(0, 60)}`;
          if (arg.validValues && typeof arg.validValues === 'object') {
            const vv = arg.validValues as Record<string, unknown>;
            if (vv.min !== undefined) line += ` [${vv.min}–${vv.max ?? '?'}]`;
          }
          response += line + '\n';
        }
        if (cmd.arguments.length > 4) response += `- ... ${cmd.arguments.length - 4} more\n`;
      }
    }

    return {
      text: response,
      assistantThreadId: undefined,
      errors: [],
      warnings: [],
      metrics: { totalMs: 0, usedShortcut: false, iterations: 1, toolCalls: 1, toolMs: 0, modelMs: 0, promptChars: { system: 0, user: req.userMessage.length } },
      debug: { toolTrace: [{ name: 'browse_scpi_commands', args: { group, filter }, startedAt: new Date().toISOString(), resultSummary: { ok: true } }], resolutionPath: 'deterministic:browse' }
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      text: `Browse error: ${errorMessage}`,
      assistantThreadId: undefined,
      errors: [errorMessage],
      warnings: [],
      metrics: { totalMs: 0, usedShortcut: false, iterations: 0, toolCalls: 0, toolMs: 0, modelMs: 0, promptChars: { system: 0, user: 0 } },
      debug: { toolTrace: [], resolutionPath: 'deterministic:browse_error' }
    };
  }
}

/**
 * Run TM Devices directly
 */
async function runTmDevices(req: McpChatRequest) {
  // Implementation for TM Devices deterministic execution
  return {
    text: 'TM Devices deterministic execution not yet implemented',
    assistantThreadId: undefined,
    errors: ['TM Devices deterministic execution not yet implemented'],
    warnings: [],
    metrics: {
      totalMs: 0,
      usedShortcut: false,
      iterations: 0,
      toolCalls: 0,
      toolMs: 0,
      modelMs: 0,
      promptChars: { system: 0, user: 0 }
    },
    debug: {
      toolTrace: [],
      resolutionPath: 'deterministic:tm_devices'
    }
  };
}

interface ToolLoopResult {
  text: string;
  displayText?: string;
  screenshots?: Array<{ base64: string; mimeType: string; capturedAt: string }>;
  commands?: CommandSuggestion[]; // Add commands for apply card
  errors: string[];
  assistantThreadId?: string;
  warnings?: string[];
  metrics?: {
    totalMs: number;
    usedShortcut: boolean;
    provider?: 'openai' | 'anthropic';
    iterations?: number;
    toolCalls?: number;
    toolMs?: number;
    modelMs?: number;
    promptChars?: {
      system: number;
      user: number;
    };
  };
  debug?: {
    promptFileText?: string;
    systemPrompt?: string;
    developerPrompt?: string;
    userPrompt?: string;
    toolDefinitions?: Array<{ name: string; description: string }>;
    toolTrace?: Array<{
      name: string;
      tool?: string;
      args: Record<string, unknown>;
      startedAt: string;
      durationMs?: number;
      resultSummary?: {
        ok?: boolean;
        count?: number;
        warnings?: string[];
        hasImage?: boolean;
      };
      result?: unknown;
      rawResult?: unknown;
    }>;
    rawOutput?: unknown;
    providerRequest?: unknown;
    shortcutResponse?: string;
    resolutionPath?: string;
  };
}

type HostedResponseInputItem = Record<string, unknown>;
type HostedToolDefinition = Record<string, unknown>;
type HostedToolPhase = 'initial' | 'finalize';

interface HostedResponsesRequestOptions {
  inputOverride?: HostedResponseInputItem[];
  previousResponseId?: string | null;
  tools?: HostedToolDefinition[];
  toolChoice?: string | Record<string, unknown>;
  developerMessage?: string;
  routerBaselineText?: string;
  routerBaselineMode?: string;
}

interface HostedPreloadContext {
  contextText: string;
  restrictSearchTools: boolean;
  batchMaterializeOnly: boolean;
  candidateCount: number;
  groupCount: number;
  usedBm25: boolean;
}

interface HostedFunctionCall {
  name: string;
  callId: string;
  argumentsText: string;
}

function buildHostedFinalAnswerInput(toolOutputs: HostedResponseInputItem[]): HostedResponseInputItem[] {
  return [
    ...toolOutputs,
    {
      role: 'user',
      content:
        'Tool retrieval is complete for this turn. Use only the retrieved results already in conversation state and return the final answer now. Do not call more tools. If exact source-of-truth verification is still insufficient, say so briefly and do not emit applyable JSON.',
    },
  ];
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function escapeJsonString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function extractActionsJsonObject(text: string): Record<string, unknown> | null {
  const raw = String(text || '').trim();
  const marker = raw.match(/ACTIONS_JSON:\s*([\s\S]*)$/i);
  const candidate = (marker?.[1] || raw)
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  if (!candidate.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function collectActionSteps(actionsJson: Record<string, unknown> | null): Array<Record<string, unknown>> {
  if (!actionsJson || !Array.isArray(actionsJson.actions)) return [];
  const steps: Array<Record<string, unknown>> = [];
  for (const action of actionsJson.actions as Array<Record<string, unknown>>) {
    const type = String(action.type || action.action_type || '');
    if (type === 'replace_flow') {
      const flow = action.flow && typeof action.flow === 'object' ? (action.flow as Record<string, unknown>) : {};
      if (Array.isArray(flow.steps)) steps.push(...(flow.steps as Array<Record<string, unknown>>));
      continue;
    }
    if (type === 'insert_step_after') {
      const newStep = action.newStep && typeof action.newStep === 'object'
        ? (action.newStep as Record<string, unknown>)
        : null;
      if (newStep) steps.push(newStep);
      continue;
    }
    if (type === 'replace_step') {
      const newStep = action.newStep && typeof action.newStep === 'object'
        ? (action.newStep as Record<string, unknown>)
        : null;
      if (newStep) steps.push(newStep);
    }
  }
  return steps;
}

function flattenActionSteps(steps: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const flat: Array<Record<string, unknown>> = [];
  for (const step of steps) {
    flat.push(step);
    if (Array.isArray(step.children)) {
      flat.push(...flattenActionSteps(step.children as Array<Record<string, unknown>>));
    }
  }
  return flat;
}

function countMeaningfulActionSteps(text: string): number {
  const actionsJson = extractActionsJsonObject(text);
  const steps = flattenActionSteps(collectActionSteps(actionsJson));
  return steps.filter((step) => {
    const type = String(step.type || '').toLowerCase();
    return !['connect', 'disconnect', 'comment', 'group'].includes(type);
  }).length;
}

function collectActionCommandCorpus(text: string): string[] {
  const actionsJson = extractActionsJsonObject(text);
  const steps = flattenActionSteps(collectActionSteps(actionsJson));
  return steps
    .flatMap((step) => {
      const type = String(step.type || '').toLowerCase();
      const params = step.params && typeof step.params === 'object'
        ? (step.params as Record<string, unknown>)
        : {};
      if (['write', 'query', 'set_and_query'].includes(type)) {
        return [String(params.command || '').trim()].filter(Boolean);
      }
      if (type === 'tm_device_command') {
        return [String(params.code || '').trim()].filter(Boolean);
      }
      if (type === 'python') {
        return [`python:${String(params.code || '').trim()}`].filter(Boolean);
      }
      if (type === 'save_waveform') {
        return [`save_waveform:${String(params.source || '')}:${String(params.format || '')}`];
      }
      if (type === 'save_screenshot') {
        return ['save_screenshot'];
      }
      if (type === 'recall') {
        return [`recall:${String(params.recallType || '')}:${String(params.filePath || '')}`];
      }
      return [];
    })
    .filter(Boolean);
}

function missingFromBaseline(baseline: string[], candidate: string[]): string[] {
  const candidateCorpus = candidate.map((item) => item.toLowerCase());
  return baseline.filter((item) => {
    const needle = item.toLowerCase();
    return !candidateCorpus.some((entry) => entry.includes(needle));
  });
}

function buildRouterBaselineDeveloperSection(text: string, mode: string): string {
  const cleaned = String(text || '').trim();
  if (!cleaned) return '';
  return [
    '## ROUTER BASELINE',
    `Router mode: ${mode || 'action'}`,
    'The router/local MCP layer already produced the baseline below.',
    'Treat this baseline as the starting point, not a suggestion to ignore.',
    'Your job is to improve it, not replace it with a smaller answer.',
    'Keep all valid router commands unless you are correcting something clearly wrong.',
    'If you add value, do it by filling gaps, improving grouping, or adding one clarification/finding when needed.',
    'If the router baseline is already strong, preserve it and return it with only minimal polish.',
    '',
    cleaned,
  ].join('\n');
}

function summarizeProviderSupplementData(raw: unknown): string {
  if (Array.isArray(raw)) {
    return raw.slice(0, 5).map((value) => String(value)).filter(Boolean).join(', ');
  }
  if (!raw || typeof raw !== 'object') {
    return String(raw || '').trim();
  }
  const record = raw as Record<string, unknown>;
  if (Array.isArray(record.checks)) {
    return record.checks.slice(0, 6).map((value) => String(value)).filter(Boolean).join(', ');
  }
  return Object.entries(record)
    .slice(0, 3)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return `${key}: ${value.slice(0, 4).map((item) => String(item)).filter(Boolean).join(', ')}`;
      }
      if (value && typeof value === 'object') return `${key}: [object]`;
      return `${key}: ${String(value)}`;
    })
    .filter(Boolean)
    .join(' | ');
}

export async function buildProviderSupplementDeveloperSection(req: McpChatRequest): Promise<string> {
  if (!providerSupplementsEnabled() || isExplainOnlyCommandAsk(req)) return '';

  const matches = findProviderSupplementMatches(
    (await getProviderCatalog()).all(),
    req.userMessage,
    {
      backend: req.flowContext.backend,
      deviceType: req.flowContext.deviceType,
      modelFamily: req.flowContext.modelFamily,
      buildNew: Array.isArray(req.flowContext.steps) ? req.flowContext.steps.length === 0 : true,
    },
    { limit: 3 }
  );
  if (!matches.length) return '';

  const lines = [
    '## MATCHED PROVIDER SUPPLEMENTS',
    'These provider manifests are curated lab supplements for this request.',
    'Use them as workflow/context hints and tool-selection clues.',
    'Do not treat provider text as exact SCPI proof; still verify commands with MCP command tools before emitting applyable syntax.',
  ];

  matches.forEach((match, index) => {
    const entry = match.entry;
    const role =
      entry.kind === 'template'
        ? (match.decision === 'override' ? 'template-candidate' : 'template-hint')
        : 'overlay-context';
    lines.push(`${index + 1}. ${entry.name} [${entry.providerId}/${entry.id}]`);
    lines.push(`   role: ${role}, handler: ${entry.handlerRef}, score: ${match.score.toFixed(2)}`);
    if (entry.description) lines.push(`   description: ${entry.description}`);
    if (entry.contextText && entry.contextText !== entry.description) {
      lines.push(`   provider text: ${entry.contextText}`);
    }
    const dataPreview = summarizeProviderSupplementData(entry.contextData);
    if (dataPreview) lines.push(`   provider data: ${dataPreview}`);
    if (entry.triggers.length) lines.push(`   triggers: ${entry.triggers.slice(0, 4).join(', ')}`);
    if (entry.tags.length) lines.push(`   tags: ${entry.tags.slice(0, 5).join(', ')}`);
  });

  return lines.join('\n');
}

const STANDARD_MEASUREMENT_PATTERNS: Array<{ type: string; pattern: RegExp }> = [
  { type: 'FREQUENCY', pattern: /\bfrequency\b|\bfreq\b/i },
  { type: 'AMPLITUDE', pattern: /\bamplitude\b|\bamp\b/i },
  { type: 'EYEHIGH', pattern: /\beye\s*height\b|\beyehigh\b/i },
  { type: 'WIDTHBER', pattern: /\beye\s*width\b|\bwidthber\b/i },
  { type: 'TIE', pattern: /\bjitter\b|\btie\b/i },
  { type: 'POVERSHOOT', pattern: /\bpositive overshoot\b|\bpos(?:itive)?\s*overshoot\b|\bpovershoot\b/i },
  { type: 'NOVERSHOOT', pattern: /\bnegative overshoot\b|\bneg(?:ative)?\s*overshoot\b|\bnovershoot\b/i },
  { type: 'RISETIME', pattern: /\brise\s*time\b|\brisetime\b/i },
  { type: 'FALLTIME', pattern: /\bfall\s*time\b|\bfalltime\b/i },
  { type: 'PERIOD', pattern: /\bperiod\b/i },
  { type: 'PK2PK', pattern: /\bpk2pk\b|\bpeak[-\s]*to[-\s]*peak\b|\bpeak to peak\b/i },
  { type: 'MEAN', pattern: /\bmean\b|\baverage\b/i },
  { type: 'RMS', pattern: /\brms\b/i },
  { type: 'HIGH', pattern: /(?<!eye\s)\bhigh\b(?!\s*speed)/i },
  { type: 'LOW', pattern: /(?<!eye\s)\blow\b/i },
  { type: 'MAXIMUM', pattern: /\bmaximum\b|\bmax\b/i },
  { type: 'MINIMUM', pattern: /\bminimum\b|\bmin\b/i },
];

const DEFAULT_MEASUREMENT_SET = [
  'FREQUENCY',
  'AMPLITUDE',
  'PERIOD',
  'PK2PK',
  'MEAN',
  'RMS',
];

function isGenericMeasurementWorkflowRequest(req: McpChatRequest): boolean {
  return /\bsmart measurement workflow\b|\bmeasurement workflow\b|\bcurrent scope context\b/i.test(
    req.userMessage
  );
}

function detectMeasurementRequest(req: McpChatRequest): string[] {
  const text = req.userMessage.toLowerCase();
  const found = STANDARD_MEASUREMENT_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ type }) => type);

  if (found.length > 0) {
    return Array.from(new Set(found));
  }

  if (isGenericMeasurementWorkflowRequest(req)) {
    return [...DEFAULT_MEASUREMENT_SET];
  }

  if (!/\bmeas(?:urement)?s?\b/i.test(text)) {
    return [];
  }

  const countMatch =
    text.match(/\b([4-6])\s+meas(?:urement)?s?\b/i) ||
    text.match(/\b(four|five|six)\s+meas(?:urement)?s?\b/i);
  if (!countMatch) {
    return [];
  }

  const countToken = countMatch[1].toLowerCase();
  const requestedCount =
    countToken === 'four'
      ? 4
      : countToken === 'five'
        ? 5
        : countToken === 'six'
          ? 6
          : Number(countToken);

  return DEFAULT_MEASUREMENT_SET.slice(0, Math.max(1, requestedCount));
}

function detectMeasurementChannel(req: McpChatRequest): string | null {
  const text = req.userMessage.toUpperCase();
  const match = text.match(/\bCH([1-8])\b/) || text.match(/\bCHANNEL\s*([1-8])\b/);
  return match ? `CH${match[1]}` : null;
}

function inferMeasurementChannelFromFlow(steps: unknown[]): string | null {
  const flatSteps = flattenSteps(Array.isArray(steps) ? steps : []);
  for (const item of flatSteps) {
    if (!item || typeof item !== 'object') continue;
    const step = item as Record<string, unknown>;
    const params =
      step.params && typeof step.params === 'object' ? (step.params as Record<string, unknown>) : {};
    if (String(step.type || '').toLowerCase() === 'save_waveform') {
      const source = String(params.source || '').toUpperCase();
      if (/^CH[1-8]$/.test(source)) {
        return source;
      }
    }
    const command = String(params.command || '').toUpperCase();
    const match = command.match(/\bCH([1-8])\b/);
    if (match) {
      return `CH${match[1]}`;
    }
  }
  return null;
}

interface ScopedMeasurementRequest {
  measurement: string;
  channel: string;
}

interface DelayMeasurementRequest {
  fromChannel: string;
  toChannel: string;
  fromEdge: 'RISe' | 'FALL';
  toEdge: 'RISe' | 'FALL';
  thresholdVolts?: number;
}

interface SetupHoldMeasurementRequest {
  measurement: 'SETUP' | 'HOLD';
  source1: string;
  source2: string;
}

interface CanSearchConfig {
  bus: string;
  condition: 'ERRor' | 'FRAMEtype' | 'FDBITS' | 'DATA';
  frameType?: string;
  errType?: string;
  brsBit?: 'ONE' | 'ZERo' | 'NOCARE';
  esiBit?: 'ONE' | 'ZERo' | 'NOCARE';
  dataOffset?: number;
}

function normalizeMeasurementSaveAs(channel: string, measurement: string): string {
  const normalizedMeasurement = measurement.toLowerCase();
  if (measurement === 'POVERSHOOT') return `${channel.toLowerCase()}_positive_overshoot`;
  if (measurement === 'NOVERSHOOT') return `${channel.toLowerCase()}_negative_overshoot`;
  if (measurement === 'WIDTHBER') return `${channel.toLowerCase()}_eye_width`;
  if (measurement === 'EYEHIGH') return `${channel.toLowerCase()}_eye_height`;
  if (measurement === 'TIE') return `${channel.toLowerCase()}_jitter`;
  return `${channel.toLowerCase()}_${normalizedMeasurement}`;
}

function normalizeSetupHoldSaveAs(item: SetupHoldMeasurementRequest): string {
  return `${item.source1.toLowerCase()}_${item.source2.toLowerCase()}_${item.measurement.toLowerCase()}`;
}

function detectMeasurementTypesInText(text: string): string[] {
  return STANDARD_MEASUREMENT_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ type }) => type);
}

function extractScopedMeasurementRequests(message: string, fallbackChannel = 'CH1'): ScopedMeasurementRequest[] {
  const segments = String(message || '')
    .split(/[.;]\s*/g)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const out: ScopedMeasurementRequest[] = [];

  segments.forEach((segment) => {
    const types = detectMeasurementTypesInText(segment);
    if (!types.length) return;
    const channels = Array.from(segment.toUpperCase().matchAll(/\bCH([1-8])\b/g)).map((match) => `CH${match[1]}`);
    const scopedChannels = channels.length ? Array.from(new Set(channels)) : [fallbackChannel];
    scopedChannels.forEach((channel) => {
      types.forEach((measurement) => out.push({ measurement, channel }));
    });
  });

  if (out.length) {
    return out.filter(
      (item, index, arr) =>
        arr.findIndex((other) => other.channel === item.channel && other.measurement === item.measurement) === index
    );
  }

  const fallbackTypes = detectMeasurementTypesInText(message);
  return fallbackTypes.map((measurement) => ({ measurement, channel: fallbackChannel }));
}

function buildDefaultMeasurementRequests(measurements: string[], fallbackChannel = 'CH1'): ScopedMeasurementRequest[] {
  return Array.from(new Set(measurements)).map((measurement) => ({
    measurement,
    channel: fallbackChannel,
  }));
}

function extractDelayMeasurements(message: string): DelayMeasurementRequest[] {
  const out: DelayMeasurementRequest[] = [];
  const normalized = String(message || '');
  const explicitPattern =
    /\bdelay(?:\s+measurement)?\s+(?:between\s+(CH[1-8])\s+and\s+(CH[1-8])\s+(rising|falling)\s+edges?|from\s+(CH[1-8])\s+(rising|falling)\s+to\s+(CH[1-8])\s+(crossing|rising|falling)(?:\s+edges?)?(?:\s+([-+]?\d+(?:\.\d+)?)\s*(mV|V))?)/gi;

  for (const match of normalized.matchAll(explicitPattern)) {
    if (match[1] && match[2] && match[3]) {
      out.push({
        fromChannel: match[1].toUpperCase(),
        toChannel: match[2].toUpperCase(),
        fromEdge: match[3].toLowerCase() === 'falling' ? 'FALL' : 'RISe',
        toEdge: match[3].toLowerCase() === 'falling' ? 'FALL' : 'RISe',
      });
      continue;
    }

    if (match[4] && match[5] && match[6]) {
      const thresholdVolts = match[8] ? parseVoltageToVolts(`${match[8]}${match[9] || ''}`) : null;
      const rawToEdge = String(match[7] || '').toLowerCase();
      out.push({
        fromChannel: match[4].toUpperCase(),
        toChannel: match[6].toUpperCase(),
        fromEdge: match[5].toLowerCase() === 'falling' ? 'FALL' : 'RISe',
        toEdge: rawToEdge === 'falling' ? 'FALL' : 'RISe',
        thresholdVolts: thresholdVolts === null ? undefined : thresholdVolts,
      });
    }
  }

  return out;
}

function extractSetupHoldMeasurements(
  message: string,
  i2cDecode?: { clockSource: string; dataSource: string } | null
): SetupHoldMeasurementRequest[] {
  const text = String(message || '');
  const wantsSetup = /\bsetup time\b|\bsetup\b/i.test(text);
  const wantsHold = /\bhold time\b|\bhold\b/i.test(text);
  if (!wantsSetup && !wantsHold) return [];

  let source1 = i2cDecode?.clockSource?.toUpperCase() || '';
  let source2 = i2cDecode?.dataSource?.toUpperCase() || '';
  if (!source1 || !source2) {
    const channels = Array.from(text.toUpperCase().matchAll(/\bCH([1-8])\b/g)).map((match) => `CH${match[1]}`);
    const unique = Array.from(new Set(channels));
    if (!source1) source1 = unique[0] || '';
    if (!source2) source2 = unique[1] || source1;
  }

  if (!/^CH[1-8]$/.test(source1) || !/^CH[1-8]$/.test(source2)) return [];

  const out: SetupHoldMeasurementRequest[] = [];
  if (wantsSetup) out.push({ measurement: 'SETUP', source1, source2 });
  if (wantsHold) out.push({ measurement: 'HOLD', source1, source2 });
  return out;
}

function extractCanSearchConfig(message: string, bus: string): CanSearchConfig | null {
  const text = String(message || '');
  if (!/\bsearch\b/i.test(text) || !/\bcan(?:\s+fd)?\b/i.test(text)) return null;

  if (/\berror frames?\b/i.test(text)) {
    return {
      bus,
      condition: 'FRAMEtype',
      frameType: 'ERRor',
    };
  }

  const brsMatch = text.match(/\bbrs\s*bit\s*(1|one|0|zero|nocare|no\s*care)\b/i);
  const esiMatch = text.match(/\besi\s*bit\s*(1|one|0|zero|nocare|no\s*care)\b/i);
  const offsetMatch = text.match(/\bdata\s*offset\s+(\d+)\s*bytes?\b/i);
  if (brsMatch || esiMatch || offsetMatch) {
    const normalizeBit = (raw: string): 'ONE' | 'ZERo' | 'NOCARE' =>
      /^(1|one)$/i.test(raw) ? 'ONE' : /^(0|zero)$/i.test(raw) ? 'ZERo' : 'NOCARE';
    return {
      bus,
      condition: brsMatch || esiMatch ? 'FDBITS' : 'DATA',
      brsBit: brsMatch ? normalizeBit(brsMatch[1]) : undefined,
      esiBit: esiMatch ? normalizeBit(esiMatch[1]) : undefined,
      dataOffset: offsetMatch ? Number(offsetMatch[1]) : undefined,
    };
  }

  const errTypeMatch =
    text.match(/\b(any error|ack(?:\s*miss|\s*missing)?|bit\s*stuff(?:ing)?|form\s*error|crc)\b/i);
  if (errTypeMatch) {
    const token = errTypeMatch[1].toLowerCase().replace(/\s+/g, '');
    const errType =
      token.startsWith('ack') ? 'ACKMISS'
      : token.startsWith('bitstuff') ? 'BITSTUFFing'
      : token.startsWith('form') ? 'FORMERRor'
      : token.startsWith('crc') ? 'CRC'
      : 'ANYERRor';
    return {
      bus,
      condition: 'ERRor',
      errType,
    };
  }

  return null;
}

function shouldQueryMeasurementResults(req: McpChatRequest): boolean {
  return /\b(query|read|result|results|save result|save results|mean\?|value|values)\b/i.test(
    req.userMessage
  );
}

function isMeasurementAppendRequest(req: McpChatRequest): boolean {
  return /\bappend\b|\bkeep existing\b|\bpreserve existing\b|\bwithout overwrit(?:e|ing)\b|\bdo not overwrite\b|\bdon't overwrite\b/i.test(
    req.userMessage
  );
}

function isImdaTrendRequest(req: McpChatRequest): boolean {
  const text = req.userMessage.toLowerCase();
  return /\bimda\b/.test(text) && /\b(acq\s*trend|acqtrend|trend\s*plot|time\s*trend)\b/.test(text);
}

function detectImdaMeasurements(req: McpChatRequest): string[] {
  const text = req.userMessage.toLowerCase();
  const out: string[] = [];
  if (/\btorque\b/.test(text)) out.push('IMDATORQUE');
  if (/\bspeed\b/.test(text)) out.push('IMDASPEED');
  if (/\bpower\s*quality\b|\bpwr[_\s-]*quality\b/.test(text)) out.push('PWR_QUALity');
  return out.length ? Array.from(new Set(out)) : ['IMDATORQUE', 'IMDASPEED'];
}

function flattenSteps(steps: unknown[]): Array<Record<string, unknown>> {
  const flat: Array<Record<string, unknown>> = [];
  const walk = (items: unknown[]) => {
    items.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const step = item as Record<string, unknown>;
      flat.push(step);
      if (Array.isArray(step.children)) {
        walk(step.children);
      }
    });
  };
  walk(steps);
  return flat;
}

function splitCommandSegments(command: string): string[] {
  return String(command || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeHeaderForMatch(command: string): string {
  if (!command) return '';
  return command
    .split('?')[0]
    .trim()
    .split(/\s/)[0]
    .replace(/TRIGger:(A|B)\b/gi, 'TRIGger:{A|B}')
    .replace(/\bCH\d+\b/gi, 'CH<x>')
    .replace(/\bMEAS\d+\b/gi, 'MEAS<x>')
    .replace(/\bPLOT\d+\b/gi, 'PLOT<x>')
    .replace(/\bB\d+\b/gi, 'B<x>')
    .replace(/\bSEARCH\d+\b/gi, 'SEARCH<x>')
    .replace(/\bREF\d+\b/gi, 'REF<x>')
    .replace(/\bWAVEVIEW\d+\b/gi, 'WAVEView<x>')
    .replace(/SOUrce\d+/gi, 'SOUrce<x>')
    .toLowerCase();
}

function isRouterEnabled(): boolean {
  return String(process.env.MCP_ROUTER_DISABLED || '').trim() !== 'true';
}

function isRouterEnabledForRequest(req?: McpChatRequest): boolean {
  if (!isRouterEnabled()) return false;
  if (req && req.routerEnabled === false) return false;
  return true;
}

function isRouterPreferredHosted(req?: McpChatRequest): boolean {
  if (!isRouterEnabledForRequest(req)) return false;
  if (req && req.routerPreferred === true) return true;
  return String(process.env.MCP_ROUTER_PREFERRED || '').trim() === 'true';
}

function isRouterOnlyHosted(req?: McpChatRequest): boolean {
  return isRouterEnabledForRequest(req) && Boolean(req?.routerOnly);
}

function shouldForceHostedRouter(req?: McpChatRequest): boolean {
  if (!req || !isRouterEnabledForRequest(req)) return false;
  if (req.mode !== 'mcp_ai') return false;
  if (req.outputMode !== 'steps_json') return false;
  if (isExplainOnlyCommandAsk(req)) return false;

  const msg = String(req.userMessage || '').toLowerCase().trim();
  if (!msg) return false;

  if (Boolean(req.routerOnly)) return true;
  if (isFollowUpCorrectionRequest(req)) return true;
  if (isTmDevicesHostedRequest(req)) return true;

  const normalized = msg.replace(/\s+/g, ' ');
  return /\b(over\s+the\s+next|over\s+\d+\s+acquisitions?|next\s+\d+\s+acquisitions?|minimum\s+and\s+maximum|statistics?|summarize|sweep|jitter|skew|eye\s+diagram|all\s+frames|timestamps?|fastframe|afg|smu|convert.*tm_devices|tm_devices)\b/i.test(
    normalized
  );
}

function getAvailableToolDefinitions(req?: McpChatRequest) {
  return [
    ...getToolDefinitions(),
    ...(isRouterEnabledForRequest(req) ? getRouterTools() : []),
  ];
}

function isNumericLike(value: string): boolean {
  return /^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(value.trim());
}

async function detectFlowCommandIssues(req: McpChatRequest): Promise<string[]> {
  const out: string[] = [];
  const steps = flattenSteps(Array.isArray(req.flowContext.steps) ? req.flowContext.steps : []);
  if (!steps.length) return out;
  const index = await getCommandIndex();

  for (const step of steps) {
    const type = String(step.type || '').toLowerCase();
    if (!['write', 'query', 'set_and_query'].includes(type)) continue;
    const params = (step.params || {}) as Record<string, unknown>;
    const rawCommand = String(params.command || '').trim();
    if (!rawCommand) continue;
    if (type === 'query' && !rawCommand.includes('?')) {
      out.push(`[${String(step.id || '?')}] query step command should usually end with '?': ${rawCommand}`);
    }

    const segments = splitCommandSegments(rawCommand);
    for (const segment of segments) {
      const [headerRaw, ...argParts] = segment.split(/\s+/);
      const header = String(headerRaw || '').trim();
      const args = argParts.join(' ').trim();
      const entry =
        index.getByHeader(header, req.flowContext.modelFamily) ||
        index.getByHeader(header.toUpperCase(), req.flowContext.modelFamily) ||
        index.getByHeaderPrefix(header, req.flowContext.modelFamily);
      if (!entry) {
        out.push(`[${String(step.id || '?')}] command header not verified: ${header}`);
        continue;
      }
      const entryHeader = String(
        ((entry as unknown as Record<string, unknown>).header)
        || ((entry as unknown as Record<string, unknown>).command)
        || ''
      );
      if (normalizeHeaderForMatch(entryHeader) !== normalizeHeaderForMatch(header)) {
        out.push(`[${String(step.id || '?')}] command header not verified: ${header}`);
        continue;
      }
      const requiredArgs = (entry.arguments || []).filter((a) => a.required);
      const firstArg = args.split(',').map((x) => x.trim()).filter(Boolean)[0] || '';
      if (requiredArgs.length > 0 && !firstArg && type !== 'query') {
        const hasSetAndQueryValue =
          type === 'set_and_query' &&
          ((params.paramValues && typeof params.paramValues === 'object' && (
            Object.prototype.hasOwnProperty.call(params.paramValues as Record<string, unknown>, 'value') ||
            Object.prototype.hasOwnProperty.call(params.paramValues as Record<string, unknown>, 'Value')
          )) || false);
        if (!hasSetAndQueryValue) {
          out.push(`[${String(step.id || '?')}] missing required argument for ${header}`);
        }
      }
      const numericArg = requiredArgs.find((a) => /number|numeric|float|nr\d*/i.test(String(a.type || '')));
      if (numericArg && firstArg) {
        const looksToken = /^[A-Za-z_]/.test(firstArg) && !/^(MIN|MAX|DEF|AUTO|ON|OFF)$/i.test(firstArg);
        if (!isNumericLike(firstArg) && looksToken) {
          out.push(
            `[${String(step.id || '?')}] possible invalid numeric value "${firstArg}" for ${header} (${numericArg.name})`
          );
        }
      }
    }
  }
  return out.slice(0, 20);
}

function isFastFrameRequest(req: McpChatRequest): boolean {
  return /\bfast\s*frames?\b|\bfastframes?\b/i.test(req.userMessage);
}

function detectFastFrameCount(req: McpChatRequest): number {
  const match =
    req.userMessage.match(/\b(\d+)\s+fast\s*frames?\b/i) ||
    req.userMessage.match(/\b(\d+)\s+fastframes?\b/i) ||
    req.userMessage.match(/\b(\d+)\s+frames?\b/i) ||
    req.userMessage.match(/\bcount\s+(\d+)\b/i);
  return match ? Math.max(1, Number(match[1])) : 10;
}

function isValidationRequest(req: McpChatRequest): boolean {
  return /\b(validate|validation|verify|verification|review|check flow|is this flow good|is this good|does this look right|does this look good|looks good|briefly)\b/i.test(
    req.userMessage
  );
}

function isFlowValidationRequest(req: McpChatRequest): boolean {
  const msg = req.userMessage.toLowerCase();
  if (!isValidationRequest(req)) return false;
  // If the user explicitly asks for log/runtime review, this is not flow-only validation.
  if (/\b(check logs|run logs?|audit|runtime|executor|stderr|stdout|exit code)\b/.test(msg)) {
    return false;
  }
  return true;
}

function isLogReviewRequest(req: McpChatRequest): boolean {
  return /\b(check logs|run logs?|audit|runtime|executor)\b/i.test(req.userMessage);
}

function runLooksSuccessful(runContext: McpChatRequest['runContext']): boolean {
  const audit = String(runContext.auditOutput || '');
  const log = String(runContext.logTail || '');
  if (/\bAudit:\s*pass\b/i.test(audit) || /\bexecutionPassed["']?\s*:\s*true\b/i.test(audit)) return true;
  if (/\[OK\]\s+Complete/i.test(log) || /\bConnected:\b/i.test(log) && /\bScreenshot saved\b/i.test(log)) return true;
  return false;
}

async function buildPyvisaMeasurementShortcut(req: McpChatRequest): Promise<string | null> {
  if ((req.outputMode || '') !== 'steps_json') return null;
  const backend = (req.flowContext.backend || 'pyvisa').toLowerCase();
  if (backend === 'tm_devices') return null; // handled by other shortcut
  const deviceType = (req.flowContext.deviceType || 'SCOPE').toUpperCase();
  if (deviceType !== 'SCOPE') return null;
  const isLegacyDpoFamily = /\b(DPO|5K|7K|70K)\b/i.test(String(req.flowContext.modelFamily || ''));

  const existingSteps = Array.isArray(req.flowContext.steps) ? req.flowContext.steps : [];
  const flatSteps = flattenSteps(existingSteps);
  const measurements = detectMeasurementRequest(req);
  const genericWorkflow = isGenericMeasurementWorkflowRequest(req);
  const channel =
    detectMeasurementChannel(req) ||
    inferMeasurementChannelFromFlow(existingSteps) ||
    'CH1';
  const imdaTrend = isImdaTrendRequest(req);
  const imdaMeasurements = imdaTrend ? detectImdaMeasurements(req) : [];
  if (!imdaTrend) return null;

  const hasScreenshot = /\bscreenshot\b|\bscreen shot\b|\bcapture screen\b/.test(req.userMessage.toLowerCase());
  const wantsQueries = shouldQueryMeasurementResults(req) || genericWorkflow;
  const appendMode = isMeasurementAppendRequest(req);
  const isBuildNew = existingSteps.length === 0;
  const defaultChannel = channel || 'CH1';

  if (imdaTrend) {
    const addGroup: Record<string, unknown>[] = imdaMeasurements.flatMap((measurement, index) => {
      const slot = index + 1;
      return [
        {
          id: `imda_${slot}_add`,
          type: 'write',
          label: `Add ${measurement} measurement`,
          params: { command: `MEASUrement:ADDMEAS ${measurement}` },
        },
        {
          id: `imda_${slot}_src`,
          type: 'write',
          label: `Set source for MEAS${slot}`,
          params: { command: `MEASUrement:MEAS${slot}:SOUrce1 ${defaultChannel}` },
        },
      ];
    });

    const plotGroup: Record<string, unknown>[] = [
      {
        id: 'imda_plot_1',
        type: 'write',
        label: 'Create IMDA acquisition trend plot',
        params: { command: 'PLOT:PLOT1:TYPe IMDAACQTREND' },
      },
      {
        id: 'imda_plot_bind_1',
        type: 'write',
        label: `Bind plot to MEAS1`,
        params: { command: 'PLOT:PLOT1:SOUrce1 MEAS1' },
      },
    ];
    if (imdaMeasurements.length > 1) {
      plotGroup.push(
        {
          id: 'imda_plot_2',
          type: 'write',
          label: 'Create second IMDA acquisition trend plot',
          params: { command: 'PLOT:PLOT2:TYPe IMDAACQTREND' },
        },
        {
          id: 'imda_plot_bind_2',
          type: 'write',
          label: `Bind second plot to MEAS2`,
          params: { command: 'PLOT:PLOT2:SOUrce1 MEAS2' },
        }
      );
    }

    const addGroupStep: Record<string, unknown> = {
      id: 'g_imda_add',
      type: 'group',
      label: 'Add Measurements',
      params: {},
      collapsed: false,
      children: addGroup,
    };
    const plotGroupStep: Record<string, unknown> = {
      id: 'g_imda_plot',
      type: 'group',
      label: 'Create IMDA Acq Trend Plot',
      params: {},
      collapsed: false,
      children: plotGroup,
    };

    if (isBuildNew) {
      const flow = {
        name: 'IMDA Measurements with Acq Trend',
        description: 'Add IMDA measurements and create acquisition trend plots',
        backend: backend || 'pyvisa',
        deviceType: req.flowContext.deviceType || 'SCOPE',
        steps: [
          { id: '1', type: 'connect', label: 'Connect to scope', params: { instrumentIds: ['scope1'], printIdn: true } },
          addGroupStep,
          plotGroupStep,
          ...(hasScreenshot ? [{ id: 'ss1', type: 'save_screenshot', label: 'Save Screenshot', params: { filename: 'screenshot.png', scopeType: 'modern', method: 'pc_transfer' } }] : []),
          { id: '99', type: 'disconnect', label: 'Disconnect', params: {} },
        ],
      };
      const actions = [{ type: 'replace_flow', flow }];
      return `ACTIONS_JSON: ${JSON.stringify({ summary: 'Added IMDA measurements with verified PLOT-based acquisition trend setup.', findings: [], suggestedFixes: [], actions })}`;
    }

    const flat = flattenSteps(existingSteps);
    const insertAfterId =
      (req.flowContext.selectedStepId && String(req.flowContext.selectedStepId)) ||
      (flat.find((step) => String(step.type || '') === 'connect')?.id as string | undefined) ||
      null;
    // Insert in reverse at same anchor so final order is Add group -> Plot group -> Screenshot.
    const actions = [
      ...(hasScreenshot
        ? [{
            type: 'insert_step_after',
            targetStepId: insertAfterId,
            newStep: { id: 'ss1', type: 'save_screenshot', label: 'Save Screenshot', params: { filename: 'screenshot.png', scopeType: 'modern', method: 'pc_transfer' } },
          }]
        : []),
      { type: 'insert_step_after', targetStepId: insertAfterId, newStep: plotGroupStep },
      { type: 'insert_step_after', targetStepId: insertAfterId, newStep: addGroupStep },
    ];
    return `ACTIONS_JSON: ${JSON.stringify({
      summary: 'Added IMDA torque/speed measurements and IMDAACQTREND plot using verified PLOT commands.',
      findings: ['Avoided unverified DISPlay:ACQTREND and MEAS:ACQTREND command patterns.'],
      suggestedFixes: [],
      actions,
    })}`;
  }

  if (appendMode) {
    return null;
  }

  const measurementSlots = measurements.map((measurement, index) => ({
    measurement,
    slot: index + 1,
    saveAsName: normalizeMeasurementSaveAs(defaultChannel, measurement),
  }));

  const resetCommands = await finalizeShortcutCommands(req, [{
    header: 'MEASUrement:DELETEALL',
    concreteHeader: 'MEASUrement:DELETEALL',
  }]);
  if (!resetCommands || !resetCommands.length) return null;

  const addGroup: Record<string, unknown>[] = [
    buildWriteStep('meas_reset', 'Clear existing measurements', resetCommands),
  ];
  const queryGroup: Record<string, unknown>[] = [];

  for (const { measurement, slot, saveAsName } of measurementSlots) {
    const addCommands = await finalizeShortcutCommands(req, [
      ...(isLegacyDpoFamily
        ? ([
            {
              header: 'MEASUrement:MEAS<x>:TYPe',
              concreteHeader: `MEASUrement:MEAS${slot}:TYPe`,
              value: measurement,
            },
            {
              header: 'MEASUrement:MEAS<x>:SOURCE',
              concreteHeader: `MEASUrement:MEAS${slot}:SOURCE`,
              value: defaultChannel,
            },
          ] satisfies ShortcutFinalizeItem[])
        : ([
            {
              header: 'MEASUrement:ADDMEAS',
              concreteHeader: 'MEASUrement:ADDMEAS',
              value: measurement,
            },
            {
              header: 'MEASUrement:MEAS<x>:SOUrce<x>',
              concreteHeader: `MEASUrement:MEAS${slot}:SOUrce1`,
              value: defaultChannel,
            },
          ] satisfies ShortcutFinalizeItem[])),
    ]);
    if (!addCommands) return null;

    addGroup.push(
      buildWriteStep(
        `meas_${slot}`,
        `Configure ${measurement.toLowerCase()} on ${defaultChannel}`,
        addCommands
      )
    );

    if (wantsQueries) {
      const queryCommands = await finalizeShortcutCommands(req, [{
        header: 'MEASUrement:MEAS<x>:RESUlts:CURRentacq:MEAN',
        concreteHeader: `MEASUrement:MEAS${slot}:RESUlts:CURRentacq:MEAN`,
        commandType: 'query',
      }]);
      if (!queryCommands || !queryCommands[0]) return null;
      queryGroup.push({
        id: `meas_q${slot}`,
        type: 'query',
        label: `Query ${measurement.toLowerCase()} result`,
        params: {
          command: queryCommands[0],
          saveAs: saveAsName,
        },
      });
    }
  }

  const screenshotStep = hasScreenshot ? [{
    id: 'ss1',
    type: 'save_screenshot',
    label: 'Save Screenshot',
    params: { filename: 'screenshot.png', scopeType: 'modern', method: 'pc_transfer' },
  }] : [];

  if (isBuildNew) {
    const flow = {
      name: `${defaultChannel} Measurements`,
      description: `Deterministic measurement workflow for ${defaultChannel}`,
      backend: backend || 'pyvisa',
      deviceType: req.flowContext.deviceType || 'SCOPE',
      steps: [
        { id: '1', type: 'connect', label: 'Connect to scope', params: { instrumentIds: ['scope1'], printIdn: true } },
        {
          id: 'g1', type: 'group', label: `Configure ${defaultChannel} measurements`, params: {}, collapsed: false,
          children: addGroup,
        },
        ...(queryGroup.length
          ? [{
              id: 'g2', type: 'group', label: 'Read measurement results', params: {}, collapsed: false,
              children: queryGroup,
            }]
          : []),
        ...screenshotStep,
        { id: '99', type: 'disconnect', label: 'Disconnect', params: {} },
      ],
    };
    const summaryParts = [`Built a deterministic ${defaultChannel} measurement workflow using explicit MEAS slots.`];
    summaryParts.push('The flow clears the existing measurement table before programming MEAS1 and onward.');
    if (hasScreenshot) summaryParts.push('Screenshot step included.');
    const actions = [{ type: 'replace_flow', flow }];
    return `ACTIONS_JSON: ${JSON.stringify({ summary: summaryParts.join(' '), findings: [], suggestedFixes: [], actions })}`;
  }

  // Existing flow — insert steps just after connect or the selected step.
  const insertAfterId =
    (req.flowContext.selectedStepId && String(req.flowContext.selectedStepId)) ||
    (flatSteps.find((step) => String(step.type || '') === 'connect')?.id as string | undefined) ||
    null;
  const measurementGroupStep = {
    id: 'g_meas_add',
    type: 'group',
    label: genericWorkflow ? 'Smart measurement workflow' : `Configure ${defaultChannel} measurements`,
    params: {},
    collapsed: false,
    children: addGroup,
  };
  const resultGroupStep = queryGroup.length
    ? {
        id: 'g_meas_query',
        type: 'group',
        label: 'Read measurement results',
        params: {},
        collapsed: false,
        children: queryGroup,
      }
    : null;
  const actions: Array<Record<string, unknown>> = [
    { type: 'insert_step_after', targetStepId: insertAfterId, newStep: measurementGroupStep },
  ];
  if (resultGroupStep) {
    actions.push({ type: 'insert_step_after', targetStepId: measurementGroupStep.id, newStep: resultGroupStep });
  }
  if (screenshotStep.length) {
    actions.push({
      type: 'insert_step_after',
      targetStepId: resultGroupStep ? resultGroupStep.id : measurementGroupStep.id,
      newStep: screenshotStep[0],
    });
  }
  const findings = [
    `Clears the scope measurement table with ${resetCommands[0]} before programming explicit MEAS slots.`,
  ];
  if (!detectMeasurementChannel(req) && inferMeasurementChannelFromFlow(existingSteps)) {
    findings.push(`Inferred ${defaultChannel} from the current scope context.`);
  }
  return `ACTIONS_JSON: ${JSON.stringify({
    summary: `Added a deterministic ${defaultChannel} measurement workflow using explicit MEAS1-${measurementSlots.length} slots.`,
    findings,
    suggestedFixes: [],
    actions,
  })}`;
}

function buildPyvisaFastFrameShortcut(req: McpChatRequest): string | null {
  if ((req.outputMode || '') !== 'steps_json') return null;
  const backend = (req.flowContext.backend || 'pyvisa').toLowerCase();
  if (backend === 'tm_devices') return null;
  if (!isFastFrameRequest(req)) return null;

  const existingSteps = Array.isArray(req.flowContext.steps) ? req.flowContext.steps : [];
  const flatSteps = flattenSteps(existingSteps);
  const count = detectFastFrameCount(req);
  const connectStep = flatSteps.find((step) => String(step.type || '') === 'connect') as Record<string, unknown> | undefined;
  const screenshotStep = flatSteps.find((step) => String(step.type || '') === 'save_screenshot') as Record<string, unknown> | undefined;
  const insertAfterId = (connectStep?.id as string | undefined) || (req.flowContext.selectedStepId ? String(req.flowContext.selectedStepId) : null);
  const fastFrameSteps = [
    {
      id: 'ff1',
      type: 'write',
      label: 'Enable FastFrame',
      params: { command: 'HORizontal:FASTframe:STATE ON' },
    },
    {
      id: 'ff2',
      type: 'write',
      label: `Set FastFrame Count to ${count}`,
      params: { command: `HORizontal:FASTframe:COUNt ${count}` },
    },
    {
      id: 'ff3',
      type: 'query',
      label: 'Query FastFrame frames acquired',
      params: { command: 'ACQuire:NUMFRAMESACQuired?', saveAs: 'fastframe_frames_acquired' },
    },
  ];

  if (!existingSteps.length) {
    const flow = {
      name: 'FastFrame Workflow',
      description: `Enable FastFrame with frame count ${count}`,
      backend: backend || 'pyvisa',
      deviceType: req.flowContext.deviceType || 'SCOPE',
      steps: [
        { id: '1', type: 'connect', label: 'Connect to scope', params: { instrumentIds: ['scope1'], printIdn: true } },
        ...fastFrameSteps,
        { id: '99', type: 'disconnect', label: 'Disconnect', params: {} },
      ],
    };
    return `ACTIONS_JSON: ${JSON.stringify({ summary: `Added FastFrame enable and frame count ${count}.`, findings: [], suggestedFixes: [], actions: [{ type: 'replace_flow', flow }] })}`;
  }

  const actions: Record<string, unknown>[] = [];
  if (insertAfterId) {
    // Insert in reverse order at the same anchor so final order is ff1 then ff2 then ff3.
    // This avoids depending on generated IDs from newly inserted steps.
    for (let i = fastFrameSteps.length - 1; i >= 0; i -= 1) {
      actions.push({ type: 'insert_step_after', targetStepId: insertAfterId, newStep: fastFrameSteps[i] });
    }
  } else {
    actions.push(...fastFrameSteps.map((step) => ({ type: 'insert_step_after', targetStepId: null, newStep: step })));
  }

  if (screenshotStep) {
    return `ACTIONS_JSON: ${JSON.stringify({ summary: `Added FastFrame enable and frame count ${count} before the screenshot.`, findings: [], suggestedFixes: [], actions })}`;
  }
  return `ACTIONS_JSON: ${JSON.stringify({ summary: `Added FastFrame enable and frame count ${count}.`, findings: [], suggestedFixes: [], actions })}`;
}

type ShortcutFinalizeItem = {
  header: string;
  concreteHeader?: string;
  commandType?: 'set' | 'query';
  value?: string | number | boolean;
  arguments?: Array<string | number | boolean>;
};

function parseVoltageToVolts(raw: string): number | null {
  const match = String(raw || '').trim().match(/^([-+]?\d+(?:\.\d+)?)\s*(mv|v)$/i);
  if (!match) return null;
  const magnitude = Number(match[1]);
  if (!Number.isFinite(magnitude)) return null;
  return match[2].toLowerCase() === 'mv' ? magnitude / 1000 : magnitude;
}

function parseTimeToSeconds(raw: string): number | null {
  const match = String(raw || '').trim().match(/^([-+]?\d+(?:\.\d+)?)\s*(ps|ns|us|ms|s)$/i);
  if (!match) return null;
  const magnitude = Number(match[1]);
  if (!Number.isFinite(magnitude)) return null;
  const unit = match[2].toLowerCase();
  if (unit === 'ps') return magnitude / 1e12;
  if (unit === 'ns') return magnitude / 1e9;
  if (unit === 'us') return magnitude / 1e6;
  if (unit === 'ms') return magnitude / 1e3;
  return magnitude;
}

function parseScaledInteger(raw: string, scaleWord?: string | null): number | null {
  const magnitude = Number(String(raw || '').trim());
  if (!Number.isFinite(magnitude)) return null;
  const word = String(scaleWord || '').trim().toLowerCase();
  if (!word) return magnitude;
  if (word.startsWith('million')) return Math.round(magnitude * 1_000_000);
  if (word.startsWith('thousand') || word === 'k') return Math.round(magnitude * 1_000);
  return Math.round(magnitude);
}

function detectBusSlot(message: string, fallback = 'B1'): string {
  const match = String(message || '').match(/\bB(\d{1,2})\b/i);
  return match ? `B${match[1]}` : fallback;
}

function channelToBusSourceValue(channel: string): number | null {
  const match = String(channel || '').toUpperCase().match(/^CH([1-8])$/);
  return match ? Number(match[1]) : null;
}

function parseCanRateEnum(raw: string): string | null {
  const match = String(raw || '').trim().match(/^(\d+(?:\.\d+)?)\s*(k|m)(?:bit\/s|bps)$/i);
  if (!match) return null;
  const magnitude = Number(match[1]);
  if (!Number.isFinite(magnitude)) return null;
  const unit = match[2].toLowerCase();
  if (unit === 'k') {
    const rounded = Math.round(magnitude);
    const allowed = new Set([10, 20, 25, 31, 33, 50, 62, 68, 83, 92, 100, 125, 153, 250, 400, 500, 800]);
    return allowed.has(rounded) ? `RATE${rounded}K` : null;
  }
  const rounded = Math.round(magnitude);
  return rounded >= 1 && rounded <= 16 ? `RATE${rounded}M` : null;
}

function parseRs232RateEnum(raw: string): string | null {
  const match = String(raw || '').trim().match(/^(\d+(?:\.\d+)?)\s*(?:baud|bps)$/i);
  if (!match) return null;
  const magnitude = Number(match[1]);
  if (!Number.isFinite(magnitude)) return null;
  if (magnitude >= 900_000) return 'RATE921K';
  if (magnitude >= 110_000) return 'RATE115K';
  if (magnitude >= 38_000) return 'RATE38K';
  if (magnitude >= 19_000) return 'RATE19K';
  if (magnitude >= 9_000) return 'RATE9K';
  if (magnitude >= 2_000) return 'RATE2K';
  if (magnitude >= 1_000) return 'RATE1K';
  return 'RATE300';
}

function parseTerminationOhms(raw: string): number | null {
  const text = String(raw || '').replace(/\s+/g, '').toLowerCase();
  if (!text) return null;
  if (text === '50ohm' || text === '50ohms' || text === '50') return 50;
  if (text === '1mohm' || text === '1megohm' || text === '1000000ohm' || text === '1000000') return 1000000;
  return null;
}

function detectWaveformFormat(message: string): 'bin' | 'csv' | 'wfm' | 'mat' {
  const text = message.toLowerCase();
  if (/\bcsv\b/.test(text)) return 'csv';
  if (/\bmat\b/.test(text)) return 'mat';
  if (/\bwfm\b/.test(text)) return 'wfm';
  return 'bin';
}

function detectSaveSetupPath(message: string): string | null {
  const match = message.match(/\bsave setup to\s+([^\s,]+\.set)\b/i);
  return match ? match[1] : null;
}

function detectRecallSessionPath(message: string): string | null {
  const match = message.match(/\brecall session from\s+([^\s,]+\.tss)\b/i);
  return match ? match[1] : null;
}

function detectWaveformSources(message: string): string[] {
  const text = message.toUpperCase();
  if (/\bsave all 4 channels\b/i.test(text)) {
    return ['CH1', 'CH2', 'CH3', 'CH4'];
  }
  if (/\bsave both channels\b/i.test(text)) {
    return ['CH1', 'CH2'];
  }
  const contextualMatches = Array.from(
    text.matchAll(/\bsave\b[^.]*?\b(CH[1-8])\b[^.]*?\bwaveform\b|\bwaveform\b[^.]*?\b(CH[1-8])\b/gi)
  )
    .map((m) => m[1] || m[2])
    .filter((v): v is string => Boolean(v))
    .map((v) => v.toUpperCase());
  if (contextualMatches.length) {
    return Array.from(new Set(contextualMatches));
  }
  const matches = Array.from(text.matchAll(/\bCH([1-8])\b/g)).map((m) => `CH${m[1]}`);
  if (/\bwaveform\b/i.test(text) && /\bsave\b/i.test(text) && matches.length) {
    return Array.from(new Set(matches));
  }
  return [];
}

function extractChannelConfigs(message: string): Array<{
  channel: string;
  scaleVolts: number;
  coupling?: 'AC' | 'DC' | 'DCR';
  terminationOhms?: number;
}> {
  const results: Array<{
    channel: string;
    scaleVolts: number;
    coupling?: 'AC' | 'DC' | 'DCR';
    terminationOhms?: number;
  }> = [];
  const regex = /\b(CH([1-8]))\b(?:\s+to)?\s+([-+]?\d+(?:\.\d+)?)\s*(mV|V)\b(?:\s+(AC|DC|DCR))?(?:\s+(50\s*ohm|1\s*M(?:ohm)?|1Mohm))?/gi;
  for (const match of message.matchAll(regex)) {
    const scaleVolts = parseVoltageToVolts(`${match[3]}${match[4]}`);
    if (scaleVolts === null) continue;
    const terminationOhms = parseTerminationOhms(match[6] || '');
    results.push({
      channel: String(match[1]).toUpperCase(),
      scaleVolts,
      coupling: match[5] ? (String(match[5]).toUpperCase() as 'AC' | 'DC' | 'DCR') : undefined,
      terminationOhms: terminationOhms === null ? undefined : terminationOhms,
    });
  }
  return results;
}

function extractEdgeTrigger(message: string): {
  source?: string;
  slope?: 'RISe' | 'FALL';
  levelVolts?: number;
  mode?: 'NORMal' | 'AUTO';
  holdoffSeconds?: number;
} {
  const text = String(message || '');
  const out: {
    source?: string;
    slope?: 'RISe' | 'FALL';
    levelVolts?: number;
    mode?: 'NORMal' | 'AUTO';
    holdoffSeconds?: number;
  } = {};
  const triggerSourceMatch = text.match(/\b(?:edge\s+)?trigger(?:\s+on)?\s+(CH[1-8])\b/i);
  if (triggerSourceMatch) out.source = triggerSourceMatch[1].toUpperCase();
  if (/\brising\b/i.test(text)) out.slope = 'RISe';
  if (/\bfalling\b/i.test(text)) out.slope = 'FALL';
  const levelMatch = text.match(/\bat\s+([-+]?\d+(?:\.\d+)?)\s*(mV|V)\b/i);
  if (levelMatch) {
    const volts = parseVoltageToVolts(`${levelMatch[1]}${levelMatch[2]}`);
    if (volts !== null) out.levelVolts = volts;
  }
  if (/\bnormal mode\b|\bmode to normal\b/i.test(text)) out.mode = 'NORMal';
  if (/\bauto mode\b|\bmode to auto\b/i.test(text)) out.mode = 'AUTO';
  const holdoffMatch = text.match(/\bholdoff(?:\s+to)?\s+([-+]?\d+(?:\.\d+)?)\s*(ns|us|ms|s)\b/i);
  if (holdoffMatch) {
    const seconds = parseTimeToSeconds(`${holdoffMatch[1]}${holdoffMatch[2]}`);
    if (seconds !== null) out.holdoffSeconds = seconds;
  }
  return out;
}

function extractHorizontalConfig(message: string): {
  scaleSeconds?: number;
  recordLength?: number;
  fastFrameCount?: number;
  fastAcqPalette?: 'NORMal' | 'TEMPerature' | 'SPECtral' | 'INVErted';
  continuousSeconds?: number;
} {
  const text = String(message || '');
  const out: {
    scaleSeconds?: number;
    recordLength?: number;
    fastFrameCount?: number;
    fastAcqPalette?: 'NORMal' | 'TEMPerature' | 'SPECtral' | 'INVErted';
    continuousSeconds?: number;
  } = {};

  const scaleMatch = text.match(/\b([-+]?\d+(?:\.\d+)?)\s*(ps|ns|us|ms|s)\s+per\s+div\b/i);
  if (scaleMatch) {
    const seconds = parseTimeToSeconds(`${scaleMatch[1]}${scaleMatch[2]}`);
    if (seconds !== null) out.scaleSeconds = seconds;
  }

  const recordMatch =
    text.match(/\brecord length\s+(\d+(?:\.\d+)?)\s*(million|thousand)?(?:\s+samples?)?\b/i) ||
    text.match(/\brecord length\s+(\d+)\b/i);
  if (recordMatch) {
    const recordLength = parseScaledInteger(recordMatch[1], recordMatch[2] || '');
    if (recordLength !== null) out.recordLength = recordLength;
  }

  const fastFrameMatch =
    text.match(/\bfast\s*frame\s+(\d+)\s+frames?\b/i) ||
    text.match(/\bfastframes?\s+(\d+)\b/i) ||
    text.match(/\b(\d+)\s+fast\s*frames?\b/i) ||
    text.match(/\b(\d+)\s+fastframes?\b/i);
  if (fastFrameMatch) {
    out.fastFrameCount = Number(fastFrameMatch[1]);
  }

  if (/\btemperature palette\b/i.test(text)) out.fastAcqPalette = 'TEMPerature';
  else if (/\bspectral palette\b/i.test(text)) out.fastAcqPalette = 'SPECtral';
  else if (/\binverted palette\b/i.test(text)) out.fastAcqPalette = 'INVErted';
  else if (/\bfast acquisition\b|\bfastacq\b/i.test(text)) out.fastAcqPalette = 'NORMal';

  const continuousMatch = text.match(/\brun continuous(?:ly)? for\s+([-+]?\d+(?:\.\d+)?)\s*(ns|us|ms|s|seconds?)\b/i);
  if (continuousMatch) {
    const unit = /^s/i.test(continuousMatch[2]) ? 's' : continuousMatch[2];
    const seconds = parseTimeToSeconds(`${continuousMatch[1]}${unit}`);
    if (seconds !== null) out.continuousSeconds = seconds;
  }

  return out;
}

function extractI2cDecodeConfig(message: string): {
  bus: string;
  clockSource: string;
  dataSource: string;
  clockThresholdVolts?: number;
  dataThresholdVolts?: number;
} | null {
  const text = String(message || '');
  if (!/\bi2c\b/i.test(text)) return null;
  const clockMatch = text.match(/\bclock\s+(CH[1-8])(?:\s+threshold\s+([-+]?\d+(?:\.\d+)?)\s*(mV|V))?/i);
  const dataMatch = text.match(/\bdata\s+(CH[1-8])(?:\s+threshold\s+([-+]?\d+(?:\.\d+)?)\s*(mV|V))?/i);
  if (!clockMatch || !dataMatch) return null;
  const clockThreshold = clockMatch[2] ? parseVoltageToVolts(`${clockMatch[2]}${clockMatch[3]}`) : null;
  const dataThreshold = dataMatch[2] ? parseVoltageToVolts(`${dataMatch[2]}${dataMatch[3]}`) : null;
  return {
    bus: detectBusSlot(text, 'B1'),
    clockSource: clockMatch[1].toUpperCase(),
    dataSource: dataMatch[1].toUpperCase(),
    clockThresholdVolts: clockThreshold === null ? undefined : clockThreshold,
    dataThresholdVolts: dataThreshold === null ? undefined : dataThreshold,
  };
}

function extractCanDecodeConfig(message: string): {
  bus: string;
  sourceChannel: string;
  nominalRate?: string;
  dataRate?: string;
  standard?: 'FDISO' | 'FDNONISO' | 'CAN2X';
} | null {
  const text = String(message || '');
  if (!/\bcan\b/i.test(text)) return null;
  const sourceMatch = text.match(/\bsource\s+(CH[1-8])\b/i);
  if (!sourceMatch) return null;
  const nominalMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(k|m)bps\s+nominal\b/i);
  const dataMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(k|m)bps\s+data(?:\s+phase)?\b/i);
  const nominalRate = nominalMatch ? parseCanRateEnum(`${nominalMatch[1]}${nominalMatch[2]}bps`) : null;
  const dataRate = dataMatch ? parseCanRateEnum(`${dataMatch[1]}${dataMatch[2]}bps`) : null;
  let standard: 'FDISO' | 'FDNONISO' | 'CAN2X' | undefined;
  if (/\bnon[-\s]?iso\b/i.test(text)) standard = 'FDNONISO';
  else if (/\biso standard\b|\bfdiso\b/i.test(text)) standard = 'FDISO';
  else if (/\bcan 2\.?0\b|\bcan2x\b/i.test(text)) standard = 'CAN2X';
  return {
    bus: detectBusSlot(text, 'B1'),
    sourceChannel: sourceMatch[1].toUpperCase(),
    nominalRate: nominalRate || undefined,
    dataRate: dataRate || undefined,
    standard,
  };
}

function extractRs232DecodeConfig(message: string): {
  bus: string;
  sourceChannel: string;
  bitRate?: string;
  dataBits?: 7 | 8 | 9;
  parity?: 'NONe' | 'EVEN' | 'ODD';
} | null {
  const text = String(message || '');
  if (!/\buart\b|\brs-?232\b/i.test(text)) return null;
  const sourceMatch = text.match(/\b(?:uart|rs-?232(?:c)?)\b.*?\b(CH[1-8])\b/i) || text.match(/\bsource\s+(CH[1-8])\b/i);
  if (!sourceMatch) return null;
  const bitRateMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(?:baud|bps)\b/i);
  const dataBitsMatch = text.match(/\b([789])N1\b/i) || text.match(/\b([789])\s*(?:data bits|data-bits)\b/i);
  const parityMatch =
    text.match(/\b([789])([NEO])1\b/i) ||
    text.match(/\bparity\s+(none|even|odd)\b/i);
  let parity: 'NONe' | 'EVEN' | 'ODD' | undefined;
  if (parityMatch) {
    const token = String(parityMatch[2] || parityMatch[1] || '').toLowerCase();
    parity = token.startsWith('e') ? 'EVEN' : token.startsWith('o') ? 'ODD' : 'NONe';
  }
  return {
    bus: detectBusSlot(text, 'B1'),
    sourceChannel: sourceMatch[1].toUpperCase(),
    bitRate: bitRateMatch ? (parseRs232RateEnum(`${bitRateMatch[1]} baud`) || undefined) : undefined,
    dataBits: dataBitsMatch ? (Number(dataBitsMatch[1]) as 7 | 8 | 9) : undefined,
    parity,
  };
}

function extractI2cBusTrigger(message: string): {
  bus: string;
  addressValue?: string;
  addressMode?: 'ADDR7' | 'ADDR10';
  direction?: 'READ' | 'WRITE' | 'NOCARE';
} | null {
  const text = String(message || '');
  if (!/\btrigger\b.*\bi2c\b|\bi2c\b.*\btrigger\b/i.test(text)) return null;
  const addressMatch = text.match(/\baddress\s+0x([0-9a-f]+)\b/i);
  const directionMatch = text.match(/\bdirection\s+(read|write)\b/i);
  if (!addressMatch && !directionMatch) return null;
  return {
    bus: detectBusSlot(text, 'B1'),
    addressValue: addressMatch ? addressMatch[1].toUpperCase() : undefined,
    addressMode: addressMatch && addressMatch[1].length > 2 ? 'ADDR10' : 'ADDR7',
    direction: directionMatch ? (directionMatch[1].toUpperCase() as 'READ' | 'WRITE') : undefined,
  };
}

function wantsFastFrameTimestampQuery(message: string): boolean {
  return /\bfastframe\b.*\btimestamp\b|\btimestamp\b.*\bfastframe\b/i.test(message);
}

function wantsCanErrorSearch(message: string): boolean {
  return /\bsearch\b.*\bcan(?:\s+fd)?\b.*\berror frames?\b|\berror frames?\b.*\bcan(?:\s+fd)?\b/i.test(message);
}

async function finalizeShortcutCommands(
  req: McpChatRequest,
  items: ShortcutFinalizeItem[]
): Promise<string[] | null> {
  if (!items.length) return [];
  const result = await runTool('finalize_scpi_commands', {
    items: items.map((item) => ({
      ...item,
      family: req.flowContext.modelFamily,
    })),
  }) as Record<string, unknown>;
  const data = result.data && typeof result.data === 'object'
    ? (result.data as Record<string, unknown>)
    : {};
  const rows = Array.isArray(data.results) ? (data.results as Array<Record<string, unknown>>) : [];
  if (!rows.length || result.ok !== true) {
    return null;
  }
  const commands = rows
    .map((row) => (typeof row.command === 'string' ? row.command : ''))
    .filter(Boolean);
  return commands.length === rows.length ? commands : null;
}

function buildWriteStep(id: string, label: string, commands: string[]): Record<string, unknown> {
  if (commands.some(isAcquireStateRunCommand) && commands.length > 1) {
    return {
      id,
      type: 'group',
      label,
      params: {},
      collapsed: false,
      children: commands.map((command, index) => ({
        id: `${id}_${index + 1}`,
        type: 'write',
        label: `${label} (${index + 1}/${commands.length})`,
        params: { command },
      })),
    };
  }

  const maxConcatCommands = PLANNER_MAX_CONCAT_COMMANDS;
  if (commands.length > maxConcatCommands) {
    const chunks = chunkCommands(commands, maxConcatCommands);
    return {
      id,
      type: 'group',
      label,
      params: {},
      collapsed: false,
      children: chunks.map((chunk, index) => ({
        id: `${id}_${index + 1}`,
        type: 'write',
        label,
        params: { command: chunk.join(';') },
      })),
    };
  }
  return {
    id,
    type: 'write',
    label,
    params: { command: commands.join(';') },
  };
}

function buildQueryStep(
  id: string,
  label: string,
  command: string,
  saveAs?: string
): Record<string, unknown> {
  const variableName = saveAs || `result_${id}`;
  return {
    id,
    type: 'query',
    label,
    params: { command, saveAs: variableName },
  };
}

function buildShortcutResponse(opts: {
  summary: string;
  steps: Array<Record<string, unknown>>;
  req: McpChatRequest;
  startedAt: number;
}): ToolLoopResult {
  const payload = `ACTIONS_JSON: ${JSON.stringify({
    summary: opts.summary,
    findings: [],
    suggestedFixes: [],
    actions: [
      {
        type: 'replace_flow',
        flow: {
          name: 'Direct Command Flow',
          description: opts.summary,
          backend: opts.req.flowContext.backend,
          deviceType: opts.req.flowContext.deviceType || 'SCOPE',
          deviceDriver: opts.req.flowContext.deviceDriver,
          visaBackend: opts.req.flowContext.visaBackend,
          steps: opts.steps,
        },
      },
    ],
  })}`;

  return {
    text: payload,
    displayText: payload,
    assistantThreadId: resolveOpenAiResponseCursor(opts.req) || undefined,
    errors: [],
    warnings: [],
    metrics: {
      totalMs: Date.now() - opts.startedAt,
      usedShortcut: true,
      provider: opts.req.provider,
      iterations: 0,
      toolCalls: 0,
      toolMs: 0,
      modelMs: 0,
      promptChars: { system: 0, user: 0 },
    },
        debug: {
          shortcutResponse: payload,
          toolTrace: [],
          resolutionPath: 'shortcut',
        },
      };
}

function detectDirectExecution(
  req: McpChatRequest
): { type: 'query' | 'write' | 'error_check'; command: string } | null {
  if (String(req.outputMode || '').toLowerCase() === 'steps_json') return null;
  const msg = String(req.userMessage || '').toLowerCase().trim();

  if (
    /^(query\s+)?(\*idn\??|what is the idn|print idn|get idn|identify scope)$/i.test(msg) ||
    /\bconnect\b.*\b(print|get|query)\b.*\bidn\b/i.test(msg)
  ) {
    return { type: 'query', command: '*IDN?' };
  }
  if (/^(check errors?|query allev|error queue|any errors?|query esr|\*esr\??|event status)$/i.test(msg)) {
    return { type: 'query', command: '*ESR?' };
  }
  if (/^(wait for opc|\*opc\??|opc query)$/i.test(msg)) {
    return { type: 'query', command: '*OPC?' };
  }
  if (/^(busy\??|query busy|instrument busy)$/i.test(msg)) {
    return { type: 'query', command: 'BUSY?' };
  }
  if (/^(event\??|query event)$/i.test(msg)) {
    return { type: 'query', command: 'EVENT?' };
  }
  if (/^(evmsg\??|query evmsg|event message)$/i.test(msg)) {
    return { type: 'query', command: 'EVMsg?' };
  }
  if (/^(query esr|\*esr\??|event status)$/i.test(msg)) {
    return { type: 'query', command: '*ESR?' };
  }
  if (/^(reset scope|\*rst|factory reset|reset to factory)$/i.test(msg)) {
    return { type: 'write', command: '*RST' };
  }

  return null;
}

async function buildMcpOnlyExplainApplyResponse(req: McpChatRequest): Promise<string | null> {
  const userMessage = String(req.userMessage || '').trim();
  if (!userMessage) return null;
  if (!/\b(command|scpi|header|syntax|query|read(?:\s+back)?|write|status)\b/i.test(userMessage)) {
    return null;
  }

  const commandIndex = await getCommandIndex();
  const candidates = commandIndex.searchByQuery(userMessage, req.flowContext.modelFamily, 5);
  if (!candidates.length) return null;

  const best = candidates[0];
  const lower = userMessage.toLowerCase();
  const prefersQuery =
    /\b(query|read|status|value|what is|what's|current)\b/.test(lower) &&
    !/\b(set|write|force|enable|disable|run|start|stop|trigger)\b/.test(lower);

  const command =
    (prefersQuery ? best.syntax.query : best.syntax.set) ||
    best.syntax.query ||
    best.syntax.set ||
    best.header;
  if (!command) return null;

  const isQuery = /\?$/.test(command.trim());
  const safeSaveAs = best.header
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'result';

  const newStep = isQuery
    ? {
        type: 'query',
        label: best.shortDescription || `Query ${best.header}`,
        params: { command, saveAs: safeSaveAs },
      }
    : {
        type: 'write',
        label: best.shortDescription || `Set ${best.header}`,
        params: { command },
      };

  const summaryText =
    `Verified command: ${best.header}${best.syntax.set ? ` (set: ${best.syntax.set})` : ''}` +
    `${best.syntax.query ? ` (query: ${best.syntax.query})` : ''}.`;

  return `${summaryText}\n\nACTIONS_JSON: ${JSON.stringify({
    summary: `Verified ${best.header} from source command index.`,
    findings: [
      best.shortDescription || `Matched ${best.header}.`,
      'Apply will append one step to your flow (it does not auto-run).',
    ],
    suggestedFixes: [],
    actions: [
      {
        type: 'insert_step_after',
        targetStepId: null,
        newStep,
      },
    ],
  })}`;
}

function normalizeScopeModelFamily(req: McpChatRequest): string {
  const current = String(req.flowContext?.modelFamily || '').trim();
  if (current && !/^(unknown|scope|oscilloscope)$/i.test(current)) {
    return current;
  }
  const aliasHint = String(req.flowContext?.alias || '').trim();
  if (/(MSO|DPO|TDS|AFG|AWG|SMU|RSA|70K|7K|5K)/i.test(aliasHint)) {
    return aliasHint;
  }
  return current || '';
}

function shouldAskScopePlatform(req: McpChatRequest): boolean {
  const deviceType = String(req.flowContext?.deviceType || 'SCOPE').toUpperCase();
  if (deviceType !== 'SCOPE') return false;
  const modelFamily = normalizeScopeModelFamily(req);
  if (modelFamily && !/^(unknown|scope|oscilloscope)$/i.test(modelFamily)) return false;
  const message = String(req.userMessage || '');
  if (/\b(MSO|DPO|70K|7K|5K)\b/i.test(message)) return false;
  return /\b(set|configure|trigger|measurement|measure|decode|search|fastframe|save waveform|scpi|flow)\b/i.test(
    message
  );
}

function derivePlannerInstrumentId(req: McpChatRequest): string {
  const mappedAlias =
    Array.isArray(req.flowContext.instrumentMap) &&
    req.flowContext.instrumentMap.length > 0 &&
    typeof req.flowContext.instrumentMap[0]?.alias === 'string'
      ? String(req.flowContext.instrumentMap[0]?.alias)
      : '';
  if (mappedAlias) return mappedAlias;
  if (req.flowContext.alias) return String(req.flowContext.alias);
  const deviceType = String(req.flowContext.deviceType || 'scope').toLowerCase();
  return `${deviceType}1`;
}

function buildPlannerStepLabel(command: string): string {
  const header = command.trim().split(/\s+/)[0] || command;
  if (/\?$/.test(header)) return `Read ${header.replace(/\?$/, '')}`;
  return header;
}

function normalizePlannerCommand(command: string): string {
  return String(command || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function isAcquireStateRunCommand(command: string): boolean {
  const normalized = normalizePlannerCommand(command);
  return /^ACQUIRE:STATE\s+(RUN|ON|1)\b/.test(normalized);
}

function isSingleSequenceStopAfterCommand(command: string): boolean {
  const normalized = normalizePlannerCommand(command);
  return /^ACQUIRE:STOPAFTER\s+SEQUENCE\b/.test(normalized);
}

function isManualOpcEligibleWriteCommand(command: string): boolean {
  const normalized = normalizePlannerCommand(command);
  return (
    /^AUTOSET(\s|:).*EXECUTE\b/.test(normalized) ||
    /^CALIBRATE:INTERNAL(:START)?\b/.test(normalized) ||
    /^CALIBRATE:FACTORY\s+(START|CONTINUE|PREVIOUS)\b/.test(normalized) ||
    /^CH[1-8]:PROBE:(AUTOZERO|DEGAUSS)\s+EXECUTE\b/.test(normalized) ||
    /^DIAG:STATE\s+EXECUTE\b/.test(normalized) ||
    /^FACTORY\b/.test(normalized) ||
    /^RECALL:SETUP\b/.test(normalized) ||
    /^RECALL:WAVEFORM\b/.test(normalized) ||
    /^\*RST\b/.test(normalized) ||
    /^SAVE:IMAGE\b/.test(normalized) ||
    /^SAVE:SETUP\b/.test(normalized) ||
    /^SAVE:WAVEFORM\b/.test(normalized) ||
    /^TEKSECURE\b/.test(normalized) ||
    /^TRIGGER:A\s+SETLEVEL\b/.test(normalized)
  );
}

const PLANNER_MAX_CONCAT_COMMANDS = 3;

const COMMAND_GROUPS = {
  TRIGGER: (cmd: string) => cmd.startsWith('TRIGGER:'),
  BUS_CONFIG: (cmd: string) => cmd.startsWith('BUS:'),
  DISPLAY: (cmd: string) => cmd.startsWith('DISPLAY:'),
  ACQUIRE: (cmd: string) => cmd.startsWith('ACQUIRE:'),
  MEASURE: (cmd: string) => cmd.startsWith('MEASUREMENT:'),
  HORIZONTAL: (cmd: string) => cmd.startsWith('HORIZONTAL:'),
  CHANNEL: (cmd: string) => /^CH\d:/.test(cmd),
};

function plannerWriteBucket(command: string): string {
  const normalized = normalizePlannerCommand(command);
  if (!normalized) return 'UNKNOWN';

  if (COMMAND_GROUPS.BUS_CONFIG(normalized) && /^BUS:B\d+:/.test(normalized)) {
    const bus = normalized.match(/^BUS:(B\d+)/)?.[1] || 'B?';
    return `BUS:${bus}`;
  }
  if (COMMAND_GROUPS.DISPLAY(normalized) && /^DISPLAY:WAVEVIEW\d+:BUS:B\d+:/.test(normalized)) {
    const bus = normalized.match(/:BUS:(B\d+):/)?.[1] || 'B?';
    return `DISPLAY_BUS:${bus}`;
  }
  if (COMMAND_GROUPS.TRIGGER(normalized) && /^TRIGGER:A:BUS:B\d+:/.test(normalized)) {
    const bus = normalized.match(/^TRIGGER:A:BUS:(B\d+):/)?.[1] || 'B?';
    return `TRIGGER_BUS:${bus}`;
  }
  if (COMMAND_GROUPS.TRIGGER(normalized) && /^TRIGGER:A:BUS:SOURCE\s+B\d+\b/.test(normalized)) {
    const bus = normalized.match(/\b(B\d+)\b/)?.[1] || 'B?';
    return `TRIGGER_BUS:${bus}`;
  }
  if (COMMAND_GROUPS.TRIGGER(normalized)) return 'TRIGGER_GENERIC';
  if (COMMAND_GROUPS.ACQUIRE(normalized)) return 'ACQUIRE';
  if (COMMAND_GROUPS.MEASURE(normalized) && /^MEASUREMENT:ADDMEAS\b/.test(normalized)) return 'MEAS_ADD';
  if (COMMAND_GROUPS.MEASURE(normalized) && /^MEASUREMENT:MEAS\d+:SOURCE1\b/.test(normalized)) return 'MEAS_SOURCE';
  if (COMMAND_GROUPS.MEASURE(normalized)) return 'MEAS_OTHER';
  if (COMMAND_GROUPS.DISPLAY(normalized)) return 'DISPLAY_OTHER';
  return normalized.split(':')[0] || 'UNKNOWN';
}

function plannerCommandHeader(command: string): string {
  return normalizePlannerCommand(command).split(/\s+/)[0] || '';
}

function plannerCommandPriority(
  command: PlannerOutput['resolvedCommands'][number]
): number {
  if (command.header.startsWith('STEP:')) {
    if (command.stepType === 'save_waveform' || command.stepType === 'save_screenshot') return 80;
    return 75;
  }
  if (command.group === 'ERROR_CHECK') return 90;

  const normalized = normalizePlannerCommand(command.concreteCommand);
  const header = plannerCommandHeader(command.concreteCommand);

  if (header.startsWith('MEASUREMENT:IMMED:')) return 65;
  if (command.commandType === 'query' && header !== '*OPC?') return 70;
  if (/^CH\d:/.test(header)) return 20;
  if (header.startsWith('BUS:')) return 30;
  if (header.startsWith('TRIGGER:')) return 40;
  if (/^DISPLAY:WAVEVIEW\d+:MATH:MATH\d+:STATE/.test(normalized)) return 57;
  if (header.startsWith('DISPLAY:')) return 50;
  if (header.startsWith('MATH:')) return 55;
  if (
    header.startsWith('ACQUIRE:') ||
    header.startsWith('HORIZONTAL:FASTFRAME') ||
    header === '*OPC?'
  ) {
    return 60;
  }
  if (header.startsWith('MEASUREMENT:')) return command.commandType === 'query' ? 70 : 65;
  if (normalized.startsWith('SAVE:')) return 80;
  return 65;
}

function sortPlannerResolvedCommands(
  commands: PlannerOutput['resolvedCommands']
): PlannerOutput['resolvedCommands'] {
  return commands
    .map((command, index) => ({ command, index }))
    .sort((a, b) => {
      const priorityDelta = plannerCommandPriority(a.command) - plannerCommandPriority(b.command);
      if (priorityDelta !== 0) return priorityDelta;
      return a.index - b.index;
    })
    .map((entry) => entry.command);
}

function plannerMergeFamily(command: string): string {
  const normalized = normalizePlannerCommand(command);
  const header = plannerCommandHeader(normalized);

  const busMatch = header.match(/^BUS:(B\d+):(RS232C|I2C|SPI|CAN|LIN)\b/);
  if (busMatch) return `BUS:${busMatch[1]}:${busMatch[2]}`;

  const triggerBusMatch = header.match(/^TRIGGER:A:BUS:(B\d+):(RS232C|I2C|SPI|CAN|LIN)\b/);
  if (triggerBusMatch) return `TRIGGER:${triggerBusMatch[1]}:${triggerBusMatch[2]}`;

  const triggerSourceBusMatch = normalized.match(/^TRIGGER:A:BUS:SOURCE\s+(B\d+)\b/);
  if (triggerSourceBusMatch) return `TRIGGER:${triggerSourceBusMatch[1]}`;

  const measurementSlotMatch = header.match(/^MEASUREMENT:MEAS(\d+):/);
  if (measurementSlotMatch) return `MEAS:${measurementSlotMatch[1]}`;

  if (header.startsWith('MEASUREMENT:ADDMEAS')) return 'MEAS:ADD';

  return header;
}

function canMergePlannerCommands(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (isAcquireStateRunCommand(left) || isAcquireStateRunCommand(right)) return false;
  if (plannerWriteBucket(left) !== plannerWriteBucket(right)) return false;
  const leftHeader = plannerCommandHeader(left);
  const rightHeader = plannerCommandHeader(right);
  if (leftHeader === rightHeader) return true;
  return plannerMergeFamily(left) === plannerMergeFamily(right);
}

function chunkCommands(commands: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < commands.length; i += size) {
    chunks.push(commands.slice(i, i + size));
  }
  return chunks;
}

function chunkPlannerWriteCommands(commands: string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];

  const flushCurrent = () => {
    if (!current.length) return;
    chunks.push(current);
    current = [];
  };

  for (const command of commands) {
    if (!current.length) {
      current.push(command);
      continue;
    }
    const last = current[current.length - 1];
    const canMerge =
      current.length < PLANNER_MAX_CONCAT_COMMANDS &&
      canMergePlannerCommands(last, command);
    if (!canMerge) {
      flushCurrent();
      current.push(command);
      continue;
    }
    current.push(command);
  }

  flushCurrent();
  return chunks;
}

function buildActionsFromPlanner(
  plannerOutput: PlannerOutput,
  req: McpChatRequest
): string | null {
  if ((req.outputMode || '') !== 'steps_json') return null;
  if (!plannerOutput.resolvedCommands.length) return null;

  const existingSteps = Array.isArray(req.flowContext.steps)
    ? (req.flowContext.steps as Array<Record<string, unknown>>)
    : [];
  const requestedFreshBuild = req.buildNew === true;
  const hasExistingSteps = existingSteps.length > 0 && !requestedFreshBuild;
  const forceReplaceFlow =
    requestedFreshBuild ||
    /\breplace(?:\s+the)?\s+(?:current\s+)?flow\b/i.test(String(req.userMessage || '')) ||
    /\bfrom scratch\b|\bnew flow\b|\bwipe\b/i.test(String(req.userMessage || ''));

  const instrumentId = derivePlannerInstrumentId(req);
  const onlyIeeeQueries = plannerOutput.resolvedCommands.every((command) =>
    /^\*(?:IDN|OPT|ESR)\?$/.test(String(command.concreteCommand || '').trim())
  );
  if (onlyIeeeQueries) {
    const steps: Array<Record<string, unknown>> = [
      {
        id: '1',
        type: 'connect',
        label: 'Connect',
        params: { instrumentIds: [instrumentId], printIdn: true },
      },
    ];
    let stepId = 2;
    for (const command of plannerOutput.resolvedCommands) {
      const concrete = String(command.concreteCommand || '').trim();
      if (command.group === 'ERROR_CHECK' || concrete === '*ESR?') {
        steps.push({
          id: String(stepId++),
          type: 'error_check',
          label: 'Error Check',
          params: { command: concrete || '*ESR?' },
        });
      } else {
        steps.push(
          buildQueryStep(
            String(stepId++),
            buildPlannerStepLabel(concrete),
            concrete,
            command.saveAs
          )
        );
      }
    }
    steps.push({
      id: String(stepId++),
      type: 'disconnect',
      label: 'Disconnect',
      params: { instrumentIds: [instrumentId] },
    });

    return `ACTIONS_JSON: ${JSON.stringify({
      summary: `Built ${plannerOutput.resolvedCommands.length} verified planner steps without a model call.`,
      findings: [],
      suggestedFixes: [],
      actions: [{
        type: 'replace_flow',
        flow: {
          name: `${String(req.flowContext.deviceType || 'Instrument')} Planner Flow`,
          description: String(req.userMessage || '').trim().slice(0, 160),
          backend: req.flowContext.backend,
          deviceType: req.flowContext.deviceType || 'SCOPE',
          deviceDriver: req.flowContext.deviceDriver,
          visaBackend: req.flowContext.visaBackend,
          steps,
        },
      }],
    })}`;
  }

  const flowSteps: Array<Record<string, unknown>> = hasExistingSteps
    ? []
    : [
        {
          id: '1',
          type: 'connect',
          label: 'Connect',
          params: { instrumentIds: [instrumentId], printIdn: true },
        },
      ];

  let nextId = hasExistingSteps ? 1 : 2;
  const nextStepId = () => String(nextId++);
  const pendingWrites: string[] = [];
  let pendingWriteGroup: string | null = null;
  const plannedNewSteps: Array<Record<string, unknown>> = [];
  const collectStep = (step: Record<string, unknown>) => {
    if (hasExistingSteps) {
      plannedNewSteps.push(step);
    } else {
      flowSteps.push(step);
    }
  };

  const flushPendingWrites = () => {
    if (!pendingWrites.length) return;
    const writeChunks = chunkPlannerWriteCommands(
      pendingWrites.splice(0, pendingWrites.length)
    );
    pendingWriteGroup = null;
    for (const [index, chunk] of writeChunks.entries()) {
      const baseLabel = buildPlannerStepLabel(chunk[0]);
      const label = baseLabel;
      collectStep(buildWriteStep(nextStepId(), label, chunk));
    }
  };

  const sortedResolvedCommands = sortPlannerResolvedCommands(plannerOutput.resolvedCommands);
  const plannerHasSingleSequence = sortedResolvedCommands.some((command) =>
    isSingleSequenceStopAfterCommand(command.concreteCommand)
  );
  for (const command of sortedResolvedCommands) {
    if (command.header.startsWith('STEP:') && command.stepType) {
      flushPendingWrites();
      collectStep({
        id: nextStepId(),
        type: command.stepType,
        label: command.concreteCommand.replace(/^save_/, '').replace(/_/g, ' '),
        params: command.stepParams || {},
      });
      continue;
    }

    if (command.group === 'ERROR_CHECK') {
      flushPendingWrites();
      collectStep({
        id: nextStepId(),
        type: 'error_check',
        label: 'Error Check',
        params: { command: command.concreteCommand || '*ESR?' },
      });
      continue;
    }

    if (command.commandType === 'query' || /\?$/.test(command.concreteCommand.trim())) {
      flushPendingWrites();
      collectStep(
        buildQueryStep(
          nextStepId(),
          buildPlannerStepLabel(command.concreteCommand),
          command.concreteCommand,
          command.saveAs
        )
      );
      continue;
    }

    if (isAcquireStateRunCommand(command.concreteCommand)) {
      flushPendingWrites();
      collectStep(
        buildWriteStep(
          nextStepId(),
          buildPlannerStepLabel(command.concreteCommand),
          [command.concreteCommand]
        )
      );
      if (plannerHasSingleSequence) {
        collectStep(
          buildQueryStep(nextStepId(), 'Wait for acquisition complete', '*OPC?', 'acq_complete')
        );
      }
      continue;
    }

    if (isManualOpcEligibleWriteCommand(command.concreteCommand)) {
      flushPendingWrites();
      collectStep(
        buildWriteStep(
          nextStepId(),
          buildPlannerStepLabel(command.concreteCommand),
          [command.concreteCommand]
        )
      );
      collectStep(buildQueryStep(nextStepId(), 'Read operation complete', '*OPC?', 'opc'));
      continue;
    }

    const currentWriteBucket = plannerWriteBucket(command.concreteCommand);
    if (pendingWriteGroup && pendingWriteGroup !== currentWriteBucket) {
      flushPendingWrites();
    }
    pendingWriteGroup = currentWriteBucket;
    pendingWrites.push(command.concreteCommand);
  }

  flushPendingWrites();

  if (!hasExistingSteps) {
    flowSteps.push({
      id: nextStepId(),
      type: 'disconnect',
      label: 'Disconnect',
      params: {},
    });
  }

  const actions: Array<Record<string, unknown>> = [];

  if (!hasExistingSteps || forceReplaceFlow) {
    actions.push({
      type: 'replace_flow',
      flow: {
        name: `${String(req.flowContext.deviceType || 'Instrument')} Planner Flow`,
        description: String(req.userMessage || '').trim().slice(0, 160),
        backend: req.flowContext.backend,
        deviceType: req.flowContext.deviceType || 'SCOPE',
        deviceDriver: req.flowContext.deviceDriver,
        visaBackend: req.flowContext.visaBackend,
        steps: flowSteps,
      },
    });
  } else {
    const selectedStepId =
      req.flowContext.selectedStepId && String(req.flowContext.selectedStepId).trim()
        ? String(req.flowContext.selectedStepId).trim()
        : null;
    const disconnectStep = existingSteps.find((step) => String(step.type || '').toLowerCase() === 'disconnect');
    const fallbackTarget =
      selectedStepId ||
      (disconnectStep ? String(disconnectStep.id || '') : '') ||
      String(existingSteps[existingSteps.length - 1]?.id || '') ||
      '1';
    let targetStepId = fallbackTarget;
    const plannerInsertTs = Date.now();

    plannedNewSteps.forEach((step, idx) => {
      const plannerStepId = `planner_${plannerInsertTs}_${idx + 1}`;
      actions.push({
        type: 'insert_step_after',
        targetStepId,
        newStep: {
          ...step,
          id: plannerStepId,
        },
      });
      targetStepId = plannerStepId;
    });
  }

  const conflictFindings = (plannerOutput.conflicts || []).map((conflict) => {
    const scope = conflict.affectedResources.length
      ? ` [${conflict.affectedResources.join(', ')}]`
      : '';
    const suggestion = conflict.suggestion ? ` Suggestion: ${conflict.suggestion}` : '';
    return `${conflict.severity}: ${conflict.type}${scope} - ${conflict.message}${suggestion}`;
  });

  return `ACTIONS_JSON: ${JSON.stringify({
    summary: `Built ${plannerOutput.resolvedCommands.length} verified planner steps without a model call.`,
    findings: conflictFindings,
    suggestedFixes: [],
    actions,
  })}`;
}

function escapePythonString(value: string): string {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function splitScpiHeaderAndArgs(command: string): { header: string; args: string[]; isQuery: boolean } {
  const trimmed = String(command || '').trim();
  const isQuery = /\?$/.test(trimmed);
  const firstSpace = trimmed.search(/\s/);
  const header = (firstSpace >= 0 ? trimmed.slice(0, firstSpace) : trimmed).trim();
  const argText = firstSpace >= 0 ? trimmed.slice(firstSpace + 1).trim() : '';
  const args = argText ? argText.split(/\s*,\s*|\s+/).filter(Boolean) : [];
  return { header, args, isQuery };
}

function normalizeScpiToken(raw: string): string {
  return String(raw || '')
    .replace(/\?.*$/, '')
    .replace(/\{[^}]+\}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase();
}

function scpiHeaderToTmDevicesMethodPathCandidates(command: string): string[] {
  const { header, isQuery } = splitScpiHeaderAndArgs(command);
  const segments = String(header || '')
    .split(':')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (!segments.length) return [];

  const pathTokens: string[] = [];
  for (const segment of segments) {
    if (/^\*/.test(segment)) return [];
    const bare = segment.replace(/\?$/, '');
    const indexed = bare.match(/^([A-Za-z]+)(\d+)$/);
    if (indexed) {
      const base = normalizeScpiToken(indexed[1]);
      const index = indexed[2];
      pathTokens.push(base.length === 1 ? `${base}[${index}]` : `${base}[${index}]`);
      continue;
    }
    if (/^[AB]$/i.test(bare)) {
      pathTokens.push(bare.toLowerCase());
      continue;
    }
    const normalized = normalizeScpiToken(bare);
    if (!normalized) continue;
    pathTokens.push(normalized);
  }

  if (!pathTokens.length) return [];
  const basePath = pathTokens.join('.');
  const suffixes = isQuery ? ['query'] : ['write'];
  return suffixes.map((suffix) => `${basePath}.${suffix}`);
}

async function resolveTmDevicesCode(
  command: string,
  model: string
): Promise<string> {
  const { args, isQuery } = splitScpiHeaderAndArgs(command);
  const candidatePaths = scpiHeaderToTmDevicesMethodPathCandidates(command);
  for (const candidatePath of candidatePaths) {
    const search = await runTool('search_tm_devices', {
      query: candidatePath,
      model,
      limit: 3,
    }) as Record<string, unknown>;
    const docs = Array.isArray(search.data) ? (search.data as Array<Record<string, unknown>>) : [];
    const exact = docs.find((doc) => String(doc.methodPath || '') === candidatePath) || docs[0];
    if (!exact) continue;
    const methodPath = String(exact.methodPath || '').trim();
    if (!methodPath) continue;
    const materialized = await runTool('materialize_tm_devices_call', {
      methodPath,
      model,
      objectName: 'scope',
      arguments: isQuery ? [] : args,
    }) as Record<string, unknown>;
    if (materialized.ok === true && materialized.data && typeof materialized.data === 'object') {
      const code = String((materialized.data as Record<string, unknown>).code || '').trim();
      if (code) return code;
    }
  }

  if (isQuery) {
    return `result = scope.visa_query("${escapePythonString(command)}")`;
  }
  return `scope.visa_write("${escapePythonString(command)}")`;
}

async function buildTmDevicesActionsFromPlanner(
  plannerOutput: PlannerOutput,
  req: McpChatRequest
): Promise<string | null> {
  if ((req.outputMode || '') !== 'steps_json') return null;
  if ((req.flowContext.backend || '').toLowerCase() !== 'tm_devices') return null;
  if (!plannerOutput.resolvedCommands.length) return null;

  const instrumentId = derivePlannerInstrumentId(req);
  const model = req.flowContext.deviceDriver || req.flowContext.modelFamily || 'MSO6B';
  const steps: Array<Record<string, unknown>> = [
    {
      id: '1',
      type: 'connect',
      label: 'Connect',
      params: { instrumentIds: [instrumentId], printIdn: true },
    },
  ];

  let nextId = 2;
  for (const command of sortPlannerResolvedCommands(plannerOutput.resolvedCommands)) {
    if (command.header.startsWith('STEP:') && command.stepType) {
      steps.push({
        id: String(nextId++),
        type: command.stepType,
        label: buildPlannerStepLabel(command.concreteCommand),
        params: { ...(command.stepParams || {}) },
      });
      continue;
    }
    const code = await resolveTmDevicesCode(
      command.concreteCommand,
      req.flowContext.deviceDriver || req.flowContext.modelFamily || 'MSO6B'
    );
    steps.push({
      id: String(nextId++),
      type: 'tm_device_command',
      label: buildPlannerStepLabel(command.concreteCommand),
      params: {
        code,
        model,
        description: command.concreteCommand,
      },
    });
  }
  steps.push({
    id: String(nextId),
    type: 'disconnect',
    label: 'Disconnect',
    params: { instrumentIds: [instrumentId] },
  });

  return `ACTIONS_JSON: ${JSON.stringify({
    summary: `Built ${plannerOutput.resolvedCommands.length} tm_devices planner steps without a model call.`,
    findings: [],
    suggestedFixes: [],
    actions: [
      {
        type: 'replace_flow',
        flow: {
          name: `${String(req.flowContext.deviceType || 'Instrument')} Planner Flow`,
          description: String(req.userMessage || '').trim().slice(0, 160),
          backend: 'tm_devices',
          deviceType: req.flowContext.deviceType || 'SCOPE',
          deviceDriver: req.flowContext.deviceDriver,
          visaBackend: req.flowContext.visaBackend,
          steps,
        },
      },
    ],
  })}`;
}

function isBackendConversionRequest(message: string): boolean {
  const msg = String(message || '').toLowerCase();
  return /\b(?:do|redo|repeat|convert|switch|change)\b[\s\S]*\btm_devices\b|\btm_devices\b[\s\S]*\binstead\b|\buse tm_devices\b/i.test(msg);
}

async function convertStepToTmDevices(
  step: Record<string, unknown>,
  model: string
): Promise<Record<string, unknown>> {
  const type = String(step.type || '').toLowerCase();
  if (type === 'tm_device_command' || type === 'connect' || type === 'disconnect') {
    return step;
  }
  if (type === 'group') {
    const children = Array.isArray(step.children)
      ? await Promise.all((step.children as Array<Record<string, unknown>>).map((child) => convertStepToTmDevices(child, model)))
      : [];
    return { ...step, children };
  }

  const params = (step.params || {}) as Record<string, unknown>;
  if (type === 'write' && typeof params.command === 'string') {
    const commands = String(params.command)
      .split(';')
      .map((cmd) => cmd.trim())
      .filter(Boolean);
    const code = (await Promise.all(commands.map((cmd) => resolveTmDevicesCode(cmd, model)))).join('\n');
    return {
      ...step,
      type: 'tm_device_command',
      params: {
        code,
        model,
        description: String(step.label || params.command || 'Converted command'),
      },
    };
  }

  if (type === 'query' && typeof params.command === 'string') {
    const command = String(params.command).trim();
    const saveAs = String(params.saveAs || 'result').trim() || 'result';
    const converted = await resolveTmDevicesCode(command, model);
    const queryCode = converted.startsWith('scope.visa_write(')
      ? `${saveAs} = scope.visa_query("${escapePythonString(command)}")`
      : converted.replace(/^scope\./, `${saveAs} = scope.`).replace(/\.write\(([\s\S]*)\)$/, '.query()');
    return {
      ...step,
      type: 'tm_device_command',
      params: {
        code: queryCode,
        model,
        description: String(step.label || params.command || 'Converted query'),
      },
    };
  }

  return step;
}

async function convertStepsToTmDevices(
  steps: Array<Record<string, unknown>>,
  model: string
): Promise<Array<Record<string, unknown>>> {
  return Promise.all(steps.map((step) => convertStepToTmDevices(step, model)));
}

async function buildPyvisaCommonServerShortcut(req: McpChatRequest): Promise<string | null> {
  if ((req.outputMode || '') !== 'steps_json') return null;
  const backend = (req.flowContext.backend || 'pyvisa').toLowerCase();
  if (backend !== 'pyvisa') return null;
  const deviceType = (req.flowContext.deviceType || 'SCOPE').toUpperCase();
  if (deviceType !== 'SCOPE') return null;

  const message = String(req.userMessage || '');
  const text = message.toLowerCase();
  if (/\b(spi|lin)\b/i.test(message)) {
    return null;
  }

  const existingSteps = Array.isArray(req.flowContext.steps) ? (req.flowContext.steps as Array<Record<string, unknown>>) : [];
  const requestedFreshBuild = req.buildNew === true;
  const hasExistingSteps = existingSteps.length > 0 && !requestedFreshBuild;
  const isLegacyDpoFamily = /\b(DPO|5K|7K|70K)\b/i.test(String(req.flowContext.modelFamily || ''));
  const forceReplaceFlow =
    requestedFreshBuild ||
    /\bdisconnect\b/i.test(message) ||
    /\breplace(?:\s+the)?\s+(?:current\s+)?flow\b/i.test(message) ||
    /\bfrom scratch\b|\bfull workflow\b|\bfull flow\b/i.test(message);
  const insertAfterId =
    (req.flowContext.selectedStepId && String(req.flowContext.selectedStepId)) ||
    (existingSteps.find((step) => String(step.type || '').toLowerCase() === 'connect')?.id as string | undefined) ||
    (existingSteps[existingSteps.length - 1]?.id as string | undefined) ||
    null;

  const steps: Array<Record<string, unknown>> = hasExistingSteps
    ? []
    : [{ id: '1', type: 'connect', label: 'Connect', params: { instrumentIds: ['scope1'], printIdn: true } }];
  let nextId = hasExistingSteps ? 1 : 2;
  const nextStepId = () => String(nextId++);
  const channelConfigs = extractChannelConfigs(message);
  const measurementChannel = detectMeasurementChannel(req) || channelConfigs[0]?.channel || 'CH1';
  const requestedMeasurements = detectMeasurementRequest(req);
  const genericMeasurementWorkflow = isGenericMeasurementWorkflowRequest(req);
  const appendMeasurements = isMeasurementAppendRequest(req);
  const busSlot = detectBusSlot(message, 'B1');
  const horizontal = extractHorizontalConfig(message);
  const i2cDecode = extractI2cDecodeConfig(message);
  const canDecode = extractCanDecodeConfig(message);
  const rs232Decode = extractRs232DecodeConfig(message);
  const i2cBusTrigger = extractI2cBusTrigger(message);
  const canSearch = extractCanSearchConfig(message, canDecode?.bus || busSlot);
  const delayMeasurements = extractDelayMeasurements(message);
  const setupHoldMeasurements = extractSetupHoldMeasurements(message, i2cDecode);
  const scopedMeasurements = extractScopedMeasurementRequests(message, measurementChannel);
  const normalizedScopedMeasurements =
    scopedMeasurements.length
      ? scopedMeasurements
      : requestedMeasurements.length
        ? buildDefaultMeasurementRequests(requestedMeasurements, measurementChannel)
        : [];

  const recallSessionPath = detectRecallSessionPath(message);
  if (/\bfactory defaults\b|\breset scope\b|\bfactory default\b/i.test(message)) {
    steps.push({
      id: nextStepId(),
      type: 'recall',
      label: 'Recall factory defaults',
      params: { recallType: 'FACTORY' },
    });
  } else if (recallSessionPath) {
    steps.push({
      id: nextStepId(),
      type: 'recall',
      label: 'Recall session',
      params: { recallType: 'SESSION', filePath: recallSessionPath },
    });
  }

  const wantsIdn = /\b(idn|identify)\b|\*idn\?/i.test(message);
  const wantsOptions = /\boptions?\b|\*opt\?/i.test(message);
  const wantsEsr = /\b(esr|event status)\b|\*esr\?/i.test(message);
  const wantsOpc = /\b(opc|operation complete)\b|\*opc\?/i.test(message);
  const wantsErrorQueue =
    /\b(error queue|allev|any errors?|check errors?|esr)\b/i.test(message);
  if (wantsIdn || wantsOptions || wantsEsr || wantsOpc || wantsErrorQueue) {
    if (wantsIdn) {
      steps.push({
        id: nextStepId(),
        type: 'query',
        label: 'Read instrument ID',
        params: { command: '*IDN?', saveAs: 'idn' },
      });
    }
    if (wantsOptions) {
      steps.push({
        id: nextStepId(),
        type: 'query',
        label: 'Read installed options',
        params: { command: '*OPT?', saveAs: 'options' },
      });
    }
    if (wantsEsr) {
      steps.push({
        id: nextStepId(),
        type: 'query',
        label: 'Read event status',
        params: { command: '*ESR?', saveAs: 'esr' },
      });
    }
    if (wantsOpc) {
      steps.push({
        id: nextStepId(),
        type: 'query',
        label: 'Read operation complete',
        params: { command: '*OPC?', saveAs: 'opc' },
      });
    }
    if (wantsErrorQueue) {
      steps.push({
        id: nextStepId(),
        type: 'query',
        label: 'Read event status for errors',
        params: { command: '*ESR?', saveAs: 'error_status' },
      });
    }
  }

  for (const config of channelConfigs) {
    const channelCommands = await finalizeShortcutCommands(req, [
      {
        header: 'CH<x>:SCAle',
        concreteHeader: `${config.channel}:SCAle`,
        value: config.scaleVolts,
      },
      ...(config.coupling ? [{
        header: 'CH<x>:COUPling',
        concreteHeader: `${config.channel}:COUPling`,
        value: config.coupling,
      } satisfies ShortcutFinalizeItem] : []),
      ...(typeof config.terminationOhms === 'number' ? [{
        header: 'CH<x>:TERmination',
        concreteHeader: `${config.channel}:TERmination`,
        value: config.terminationOhms,
      } satisfies ShortcutFinalizeItem] : []),
    ]);
    if (!channelCommands) return null;
    steps.push(buildWriteStep(nextStepId(), `Configure ${config.channel}`, channelCommands));
  }

  if (i2cDecode) {
    const busCommands = await finalizeShortcutCommands(req, [
      {
        header: 'BUS:ADDNew',
        concreteHeader: 'BUS:ADDNew',
        value: '"I2C"',
      },
      {
        header: 'BUS:B<x>:I2C:CLOCk:SOUrce',
        concreteHeader: `BUS:${i2cDecode.bus}:I2C:CLOCk:SOUrce`,
        value: i2cDecode.clockSource,
      },
      {
        header: 'BUS:B<x>:I2C:DATa:SOUrce',
        concreteHeader: `BUS:${i2cDecode.bus}:I2C:DATa:SOUrce`,
        value: i2cDecode.dataSource,
      },
      ...(typeof i2cDecode.clockThresholdVolts === 'number'
        ? [{
            header: 'BUS:B<x>:I2C:CLOCk:THReshold',
            concreteHeader: `BUS:${i2cDecode.bus}:I2C:CLOCk:THReshold`,
            value: i2cDecode.clockThresholdVolts,
          } satisfies ShortcutFinalizeItem]
        : []),
      ...(typeof i2cDecode.dataThresholdVolts === 'number'
        ? [{
            header: 'BUS:B<x>:I2C:DATa:THReshold',
            concreteHeader: `BUS:${i2cDecode.bus}:I2C:DATa:THReshold`,
            value: i2cDecode.dataThresholdVolts,
          } satisfies ShortcutFinalizeItem]
        : []),
      {
        header: 'DISplay:WAVEView<x>:BUS:B<x>:STATE',
        concreteHeader: `DISplay:WAVEView1:BUS:${i2cDecode.bus}:STATE`,
        value: 'ON',
      },
    ]);
    if (!busCommands) return null;
    steps.push(buildWriteStep(nextStepId(), `Configure ${i2cDecode.bus} I2C decode`, busCommands));
  }

  if (canDecode) {
    const canSource = channelToBusSourceValue(canDecode.sourceChannel);
    if (canSource === null) return null;
    const busCommands = await finalizeShortcutCommands(req, [
      {
        header: 'BUS:ADDNew',
        concreteHeader: 'BUS:ADDNew',
        value: '"CAN"',
      },
      {
        header: 'BUS:B<x>:CAN:SOUrce',
        concreteHeader: `BUS:${canDecode.bus}:CAN:SOUrce`,
        value: canSource,
      },
      ...(canDecode.nominalRate
        ? [{
            header: 'BUS:B<x>:CAN:BITRate',
            concreteHeader: `BUS:${canDecode.bus}:CAN:BITRate`,
            value: canDecode.nominalRate,
          } satisfies ShortcutFinalizeItem]
        : []),
      ...(canDecode.dataRate
        ? [{
            header: 'BUS:B<x>:CAN:FD:BITRate',
            concreteHeader: `BUS:${canDecode.bus}:CAN:FD:BITRate`,
            value: canDecode.dataRate,
          } satisfies ShortcutFinalizeItem]
        : []),
      ...(canDecode.standard
        ? [{
            header: 'BUS:B<x>:CAN:STANDard',
            concreteHeader: `BUS:${canDecode.bus}:CAN:STANDard`,
            value: canDecode.standard,
          } satisfies ShortcutFinalizeItem]
        : []),
      {
        header: 'DISplay:WAVEView<x>:BUS:B<x>:STATE',
        concreteHeader: `DISplay:WAVEView1:BUS:${canDecode.bus}:STATE`,
        value: 'ON',
      },
    ]);
    if (!busCommands) return null;
    steps.push(buildWriteStep(nextStepId(), `Configure ${canDecode.bus} CAN decode`, busCommands));
  }

  if (rs232Decode) {
    const rs232Commands = await finalizeShortcutCommands(req, [
      {
        header: 'BUS:ADDNew',
        concreteHeader: 'BUS:ADDNew',
        value: '"RS232C"',
      },
      {
        header: 'BUS:B<x>:RS232C:SOUrce',
        concreteHeader: `BUS:${rs232Decode.bus}:RS232C:SOUrce`,
        value: rs232Decode.sourceChannel,
      },
      ...(rs232Decode.bitRate
        ? [{
            header: 'BUS:B<x>:RS232C:BITRate',
            concreteHeader: `BUS:${rs232Decode.bus}:RS232C:BITRate`,
            value: rs232Decode.bitRate,
          } satisfies ShortcutFinalizeItem]
        : []),
      ...(typeof rs232Decode.dataBits === 'number'
        ? [{
            header: 'BUS:B<x>:RS232C:DATABits',
            concreteHeader: `BUS:${rs232Decode.bus}:RS232C:DATABits`,
            value: rs232Decode.dataBits,
          } satisfies ShortcutFinalizeItem]
        : []),
      ...(rs232Decode.parity
        ? [{
            header: 'BUS:B<x>:RS232C:PARity',
            concreteHeader: `BUS:${rs232Decode.bus}:RS232C:PARity`,
            value: rs232Decode.parity,
          } satisfies ShortcutFinalizeItem]
        : []),
      {
        header: 'DISplay:WAVEView<x>:BUS:B<x>:STATE',
        concreteHeader: `DISplay:WAVEView1:BUS:${rs232Decode.bus}:STATE`,
        value: 'ON',
      },
    ]);
    if (!rs232Commands) return null;
    steps.push(buildWriteStep(nextStepId(), `Configure ${rs232Decode.bus} RS232 decode`, rs232Commands));
  }

  const trigger = extractEdgeTrigger(message);
  if (trigger.source || trigger.mode || typeof trigger.holdoffSeconds === 'number') {
    const triggerItems: ShortcutFinalizeItem[] = [];
    if (trigger.source) {
      triggerItems.push({
        header: 'TRIGger:{A|B}:EDGE:SOUrce',
        concreteHeader: 'TRIGger:A:EDGE:SOUrce',
        value: trigger.source,
      });
    }
    if (trigger.slope) {
      triggerItems.push({
        header: 'TRIGger:{A|B}:EDGE:SLOpe',
        concreteHeader: 'TRIGger:A:EDGE:SLOpe',
        value: trigger.slope,
      });
    }
    if (trigger.source && typeof trigger.levelVolts === 'number') {
      triggerItems.push({
        header: 'TRIGger:A:LEVel:CH<x>',
        concreteHeader: `TRIGger:A:LEVel:${trigger.source}`,
        value: trigger.levelVolts,
      });
    }
    if (trigger.mode) {
      triggerItems.push({
        header: 'TRIGger:A:MODe',
        concreteHeader: 'TRIGger:A:MODe',
        value: trigger.mode,
      });
    }
    const triggerCommands = await finalizeShortcutCommands(req, triggerItems);
    if (triggerItems.length && !triggerCommands) return null;
    if (triggerCommands && triggerCommands.length) {
      steps.push(buildWriteStep(nextStepId(), 'Configure trigger', triggerCommands));
    }
    if (typeof trigger.holdoffSeconds === 'number') {
      const holdoffCommands = await finalizeShortcutCommands(req, [{
        header: 'TRIGger:A:HOLDoff:TIMe',
        concreteHeader: 'TRIGger:A:HOLDoff:TIMe',
        value: trigger.holdoffSeconds,
      }]);
      if (!holdoffCommands) return null;
      steps.push(buildWriteStep(nextStepId(), 'Set trigger holdoff', holdoffCommands));
    }
  }

  if (i2cBusTrigger) {
    const triggerCommands = await finalizeShortcutCommands(req, [
      {
        header: 'TRIGger:{A|B}:TYPe',
        concreteHeader: 'TRIGger:A:TYPe',
        value: 'BUS',
      },
      {
        header: 'TRIGger:{A|B}:BUS:B<x>:I2C:CONDition',
        concreteHeader: `TRIGger:A:BUS:${i2cBusTrigger.bus}:I2C:CONDition`,
        value: 'ADDRess',
      },
      ...(i2cBusTrigger.direction
        ? [{
            header: 'TRIGger:{A|B}:BUS:B<x>:I2C:DATa:DIRection',
            concreteHeader: `TRIGger:A:BUS:${i2cBusTrigger.bus}:I2C:DATa:DIRection`,
            value: i2cBusTrigger.direction,
          } satisfies ShortcutFinalizeItem]
        : []),
      ...(i2cBusTrigger.addressMode
        ? [{
            header: 'TRIGger:{A|B}:BUS:B<x>:I2C:ADDRess:MODe',
            concreteHeader: `TRIGger:A:BUS:${i2cBusTrigger.bus}:I2C:ADDRess:MODe`,
            value: i2cBusTrigger.addressMode,
          } satisfies ShortcutFinalizeItem]
        : []),
      ...(i2cBusTrigger.addressValue
        ? [{
            header: 'TRIGger:{A|B}:BUS:B<x>:I2C:ADDRess:VALue',
            concreteHeader: `TRIGger:A:BUS:${i2cBusTrigger.bus}:I2C:ADDRess:VALue`,
            value: `"${i2cBusTrigger.addressValue}"`,
          } satisfies ShortcutFinalizeItem]
        : []),
    ]);
    if (!triggerCommands) return null;
    steps.push(buildWriteStep(nextStepId(), `Configure ${i2cBusTrigger.bus} I2C trigger`, triggerCommands));
  }

  const acquisitionItems: ShortcutFinalizeItem[] = [];
  if (/\bsingle (?:acquisition|sequence)\b/i.test(message)) {
    acquisitionItems.push({
      header: 'ACQuire:STOPAfter',
      concreteHeader: 'ACQuire:STOPAfter',
      value: 'SEQuence',
    });
    acquisitionItems.push({
      header: 'ACQuire:STATE',
      concreteHeader: 'ACQuire:STATE',
      value: 'ON',
    });
  }
  const averageMatch = message.match(/\baverage(?: acquisition)?\s+(\d+)\b/i) || message.match(/\baverage\s+(\d+)\s+waveforms?\b/i);
  if (averageMatch) {
    acquisitionItems.push({
      header: 'ACQuire:MODe',
      concreteHeader: 'ACQuire:MODe',
      value: 'AVErage',
    });
    acquisitionItems.push({
      header: 'ACQuire:NUMAVg',
      concreteHeader: 'ACQuire:NUMAVg',
      value: Number(averageMatch[1]),
    });
  }
  if (/\bcontinuous\b|\brun continuous(?:ly)?\b/i.test(message)) {
    acquisitionItems.push({
      header: 'ACQuire:STOPAfter',
      concreteHeader: 'ACQuire:STOPAfter',
      value: 'RUNSTop',
    });
    acquisitionItems.push({
      header: 'ACQuire:STATE',
      concreteHeader: 'ACQuire:STATE',
      value: 'RUN',
    });
  }
  if (horizontal.fastAcqPalette) {
    acquisitionItems.push({
      header: 'ACQuire:FASTAcq:STATE',
      concreteHeader: 'ACQuire:FASTAcq:STATE',
      value: 'ON',
    });
    acquisitionItems.push({
      header: 'ACQuire:FASTAcq:PALEtte',
      concreteHeader: 'ACQuire:FASTAcq:PALEtte',
      value: horizontal.fastAcqPalette,
    });
  }
  const saveSetupPath = detectSaveSetupPath(message);
  if (saveSetupPath) {
    acquisitionItems.push({
      header: 'SAVe:SETUp',
      concreteHeader: 'SAVe:SETUp',
      value: `"${saveSetupPath}"`,
    });
  }
  if (acquisitionItems.length) {
    const acquisitionCommands = await finalizeShortcutCommands(req, acquisitionItems);
    if (!acquisitionCommands) return null;
    steps.push(buildWriteStep(nextStepId(), 'Configure acquisition/save', acquisitionCommands));
  }

  const horizontalItems: ShortcutFinalizeItem[] = [];
  if (typeof horizontal.scaleSeconds === 'number') {
    horizontalItems.push({
      header: 'HORizontal:SCAle',
      concreteHeader: 'HORizontal:SCAle',
      value: horizontal.scaleSeconds,
    });
  }
  if (typeof horizontal.recordLength === 'number') {
    horizontalItems.push({
      header: 'HORizontal:MODe',
      concreteHeader: 'HORizontal:MODe',
      value: 'MANual',
    });
    horizontalItems.push({
      header: 'HORizontal:RECOrdlength',
      concreteHeader: 'HORizontal:RECOrdlength',
      value: horizontal.recordLength,
    });
  }
  if (typeof horizontal.fastFrameCount === 'number') {
    horizontalItems.push({
      header: 'HORizontal:FASTframe:STATE',
      concreteHeader: 'HORizontal:FASTframe:STATE',
      value: 'ON',
    });
    horizontalItems.push({
      header: 'HORizontal:FASTframe:COUNt',
      concreteHeader: 'HORizontal:FASTframe:COUNt',
      value: horizontal.fastFrameCount,
    });
  }
  if (horizontalItems.length) {
    const horizontalCommands = await finalizeShortcutCommands(req, horizontalItems);
    if (!horizontalCommands) return null;
    steps.push(buildWriteStep(nextStepId(), 'Configure horizontal', horizontalCommands));
  }

  if (canSearch && canDecode && canSearch.condition !== 'DATA') {
    const searchCommands = await finalizeShortcutCommands(req, [
      {
        header: 'SEARCH:SEARCH<x>:TRIGger:A:TYPe',
        concreteHeader: 'SEARCH:SEARCH1:TRIGger:A:TYPe',
        value: 'Bus',
      },
      {
        header: 'SEARCH:SEARCH<x>:TRIGger:A:BUS:SOUrce',
        concreteHeader: 'SEARCH:SEARCH1:TRIGger:A:BUS:SOUrce',
        value: canSearch.bus,
      },
      {
        header: 'SEARCH:SEARCH<x>:TRIGger:A:BUS:CAN:CONDition',
        concreteHeader: 'SEARCH:SEARCH1:TRIGger:A:BUS:CAN:CONDition',
        value: canSearch.condition,
      },
      ...(canSearch.frameType
        ? [{
            header: 'SEARCH:SEARCH<x>:TRIGger:A:BUS:CAN:FRAMEtype',
            concreteHeader: 'SEARCH:SEARCH1:TRIGger:A:BUS:CAN:FRAMEtype',
            value: canSearch.frameType,
          } satisfies ShortcutFinalizeItem]
        : []),
      ...(canSearch.errType
        ? [{
            header: 'SEARCH:SEARCH<x>:TRIGger:A:BUS:CAN:ERRType',
            concreteHeader: 'SEARCH:SEARCH1:TRIGger:A:BUS:CAN:ERRType',
            value: canSearch.errType,
          } satisfies ShortcutFinalizeItem]
        : []),
      ...(canSearch.brsBit
        ? [{
            header: 'SEARCH:SEARCH<x>:TRIGger:A:BUS:CAN:FD:BRSBit',
            concreteHeader: 'SEARCH:SEARCH1:TRIGger:A:BUS:CAN:FD:BRSBit',
            value: canSearch.brsBit,
          } satisfies ShortcutFinalizeItem]
        : []),
      ...(canSearch.esiBit
        ? [{
            header: 'SEARCH:SEARCH<x>:TRIGger:A:BUS:CAN:FD:ESIBit',
            concreteHeader: 'SEARCH:SEARCH1:TRIGger:A:BUS:CAN:FD:ESIBit',
            value: canSearch.esiBit,
          } satisfies ShortcutFinalizeItem]
        : []),
    ]);
    if (!searchCommands) return null;
    steps.push(buildWriteStep(nextStepId(), 'Configure CAN search', searchCommands));
  }

  const wantsQueries = shouldQueryMeasurementResults(req) || genericMeasurementWorkflow;
  let measurementSlot = 1;
  if (appendMeasurements && (normalizedScopedMeasurements.length || delayMeasurements.length || setupHoldMeasurements.length)) {
    return null;
  }
  if (normalizedScopedMeasurements.length || delayMeasurements.length || setupHoldMeasurements.length) {
    const resetCommands = await finalizeShortcutCommands(req, [{
      header: 'MEASUrement:DELETEALL',
      concreteHeader: 'MEASUrement:DELETEALL',
    }]);
    if (!resetCommands) return null;
    steps.push(buildWriteStep(nextStepId(), 'Clear existing measurements', resetCommands));
  }
  if (normalizedScopedMeasurements.length) {
    const addChildren: Array<Record<string, unknown>> = [];
    const queryChildren: Array<Record<string, unknown>> = [];
    for (const { measurement, channel } of normalizedScopedMeasurements) {
      const addCommands = await finalizeShortcutCommands(req, [
        ...(isLegacyDpoFamily
          ? ([
              {
                header: 'MEASUrement:MEAS<x>:TYPe',
                concreteHeader: `MEASUrement:MEAS${measurementSlot}:TYPe`,
                value: measurement,
              },
              {
                header: 'MEASUrement:MEAS<x>:SOURCE',
                concreteHeader: `MEASUrement:MEAS${measurementSlot}:SOURCE`,
                value: channel,
              },
            ] satisfies ShortcutFinalizeItem[])
          : ([
              {
                header: 'MEASUrement:ADDMEAS',
                concreteHeader: 'MEASUrement:ADDMEAS',
                value: measurement,
              },
              {
                header: 'MEASUrement:MEAS<x>:SOUrce<x>',
                concreteHeader: `MEASUrement:MEAS${measurementSlot}:SOUrce1`,
                value: channel,
              },
            ] satisfies ShortcutFinalizeItem[])),
      ]);
      if (!addCommands) return null;
      addChildren.push(buildWriteStep(`m${measurementSlot}`, `Add ${measurement.toLowerCase()} measurement on ${channel}`, addCommands));
      if (wantsQueries) {
        const queryCommands = await finalizeShortcutCommands(req, [{
          header: 'MEASUrement:MEAS<x>:RESUlts:CURRentacq:MEAN',
          concreteHeader: `MEASUrement:MEAS${measurementSlot}:RESUlts:CURRentacq:MEAN`,
          commandType: 'query',
        }]);
        if (!queryCommands || !queryCommands[0]) return null;
        queryChildren.push({
          id: `q${measurementSlot}`,
          type: 'query',
          label: `Query ${measurement.toLowerCase()} result for ${channel}`,
          params: {
            command: queryCommands[0],
            saveAs: normalizeMeasurementSaveAs(channel, measurement),
          },
        });
      }
      measurementSlot += 1;
    }
    steps.push({
      id: nextStepId(),
      type: 'group',
      label: 'Add measurements',
      params: {},
      collapsed: false,
      children: addChildren,
    });
    if (queryChildren.length) {
      steps.push({
        id: nextStepId(),
        type: 'group',
        label: 'Read measurement results',
        params: {},
        collapsed: false,
        children: queryChildren,
      });
    }
  }

  if (delayMeasurements.length) {
    const addChildren: Array<Record<string, unknown>> = [];
    const queryChildren: Array<Record<string, unknown>> = [];

    for (const delay of delayMeasurements) {
      const thresholdItems: ShortcutFinalizeItem[] = [];
      if (typeof delay.thresholdVolts === 'number') {
        thresholdItems.push({
          header: 'MEASUrement:MEAS<x>:REFLevels<x>:METHod',
          concreteHeader: `MEASUrement:MEAS${measurementSlot}:REFLevels2:METHod`,
          value: 'ABSolute',
        });
        const suffixes =
          delay.toEdge === 'FALL'
            ? ['FALLLow', 'FALLMid', 'FALLHigh']
            : ['RISELow', 'RISEMid', 'RISEHigh'];
        suffixes.forEach((suffix) => {
          thresholdItems.push({
            header: `MEASUrement:MEAS<x>:REFLevels<x>:ABSolute:${suffix}`,
            concreteHeader: `MEASUrement:MEAS${measurementSlot}:REFLevels2:ABSolute:${suffix}`,
            value: delay.thresholdVolts as number,
          });
        });
      }

      const addCommands = await finalizeShortcutCommands(req, [
        {
          header: 'MEASUrement:ADDMEAS',
          concreteHeader: 'MEASUrement:ADDMEAS',
          value: 'DELAY',
        },
        {
          header: 'MEASUrement:MEAS<x>:SOUrce<x>',
          concreteHeader: `MEASUrement:MEAS${measurementSlot}:SOUrce1`,
          value: delay.fromChannel,
        },
        {
          header: 'MEASUrement:MEAS<x>:SOUrce<x>',
          concreteHeader: `MEASUrement:MEAS${measurementSlot}:SOUrce2`,
          value: delay.toChannel,
        },
        {
          header: 'MEASUrement:MEAS<x>:DELay:EDGE<x>',
          concreteHeader: `MEASUrement:MEAS${measurementSlot}:DELay:EDGE1`,
          value: delay.fromEdge,
        },
        {
          header: 'MEASUrement:MEAS<x>:DELay:EDGE<x>',
          concreteHeader: `MEASUrement:MEAS${measurementSlot}:DELay:EDGE2`,
          value: delay.toEdge,
        },
        ...thresholdItems,
      ]);
      if (!addCommands) return null;

      addChildren.push(
        buildWriteStep(
          `d${measurementSlot}`,
          `Add delay measurement ${delay.fromChannel} to ${delay.toChannel}`,
          addCommands
        )
      );

      if (wantsQueries) {
        const queryCommands = await finalizeShortcutCommands(req, [{
          header: 'MEASUrement:MEAS<x>:RESUlts:CURRentacq:MEAN',
          concreteHeader: `MEASUrement:MEAS${measurementSlot}:RESUlts:CURRentacq:MEAN`,
          commandType: 'query',
        }]);
        if (!queryCommands || !queryCommands[0]) return null;
        queryChildren.push({
          id: `dq${measurementSlot}`,
          type: 'query',
          label: `Query delay ${delay.fromChannel} to ${delay.toChannel}`,
          params: {
            command: queryCommands[0],
            saveAs: `delay_${delay.fromChannel.toLowerCase()}_to_${delay.toChannel.toLowerCase()}`,
          },
        });
      }

      measurementSlot += 1;
    }

    steps.push({
      id: nextStepId(),
      type: 'group',
      label: 'Add delay measurements',
      params: {},
      collapsed: false,
      children: addChildren,
    });
    if (queryChildren.length) {
      steps.push({
        id: nextStepId(),
        type: 'group',
        label: 'Read delay results',
        params: {},
        collapsed: false,
        children: queryChildren,
      });
    }
  }

  if (setupHoldMeasurements.length) {
    const addChildren: Array<Record<string, unknown>> = [];
    const queryChildren: Array<Record<string, unknown>> = [];

    for (const measurementRequest of setupHoldMeasurements) {
      const addCommands = await finalizeShortcutCommands(req, [
        ...(isLegacyDpoFamily
          ? ([{
              header: 'MEASUrement:MEAS<x>:TYPe',
              concreteHeader: `MEASUrement:MEAS${measurementSlot}:TYPe`,
              value: measurementRequest.measurement,
            }] satisfies ShortcutFinalizeItem[])
          : ([{
              header: 'MEASUrement:ADDMEAS',
              concreteHeader: 'MEASUrement:ADDMEAS',
              value: measurementRequest.measurement,
            }] satisfies ShortcutFinalizeItem[])),
        {
          header: 'MEASUrement:MEAS<x>:SOUrce<x>',
          concreteHeader: `MEASUrement:MEAS${measurementSlot}:SOUrce1`,
          value: measurementRequest.source1,
        },
        {
          header: 'MEASUrement:MEAS<x>:SOUrce<x>',
          concreteHeader: `MEASUrement:MEAS${measurementSlot}:SOUrce2`,
          value: measurementRequest.source2,
        },
      ]);
      if (!addCommands) return null;

      addChildren.push(
        buildWriteStep(
          `sh${measurementSlot}`,
          `Add ${measurementRequest.measurement.toLowerCase()} measurement ${measurementRequest.source1} to ${measurementRequest.source2}`,
          addCommands
        )
      );

      if (wantsQueries) {
        const queryCommands = await finalizeShortcutCommands(req, [{
          header: 'MEASUrement:MEAS<x>:RESUlts:CURRentacq:MEAN',
          concreteHeader: `MEASUrement:MEAS${measurementSlot}:RESUlts:CURRentacq:MEAN`,
          commandType: 'query',
        }]);
        if (!queryCommands || !queryCommands[0]) return null;
        queryChildren.push({
          id: `shq${measurementSlot}`,
          type: 'query',
          label: `Query ${measurementRequest.measurement.toLowerCase()} result`,
          params: {
            command: queryCommands[0],
            saveAs: normalizeSetupHoldSaveAs(measurementRequest),
          },
        });
      }

      measurementSlot += 1;
    }

    steps.push({
      id: nextStepId(),
      type: 'group',
      label: 'Add setup/hold measurements',
      params: {},
      collapsed: false,
      children: addChildren,
    });
    if (queryChildren.length) {
      steps.push({
        id: nextStepId(),
        type: 'group',
        label: 'Read setup/hold results',
        params: {},
        collapsed: false,
        children: queryChildren,
      });
    }
  }

  if (/\berror queue\b|\bprint any errors\b|\bcheck.*errors?\b/i.test(message)) {
    steps.push({
      id: nextStepId(),
      type: 'query',
      label: 'Read event status for errors',
      params: { command: '*ESR?', saveAs: 'error_status' },
    });
  }

  if (wantsFastFrameTimestampQuery(message)) {
    const timestampCommands = await finalizeShortcutCommands(req, [{
      header: 'HORizontal:FASTframe:TIMEStamp:ALL',
      concreteHeader: 'HORizontal:FASTframe:TIMEStamp:ALL',
      commandType: 'query',
    }]);
    if (!timestampCommands || !timestampCommands[0]) return null;
    steps.push({
      id: nextStepId(),
      type: 'query',
      label: 'Query FastFrame timestamps',
      params: {
        command: timestampCommands[0],
        saveAs: 'fastframe_timestamps',
      },
    });
  }

  const waveformSources = detectWaveformSources(message);
  if (waveformSources.length) {
    const format = detectWaveformFormat(message);
    waveformSources.forEach((source) => {
      steps.push({
        id: nextStepId(),
        type: 'save_waveform',
        label: `Save ${source} waveform`,
        params: {
          source,
          filename: `${source.toLowerCase()}.${format}`,
          format,
        },
      });
    });
  }

  if (typeof horizontal.continuousSeconds === 'number' && horizontal.continuousSeconds > 0) {
    steps.push({
      id: nextStepId(),
      type: 'sleep',
      label: 'Run continuous acquisition',
      params: { duration: horizontal.continuousSeconds },
    });
  }

  if (/\bscreenshot\b|\bscreen shot\b|\bcapture screen\b/i.test(message)) {
    steps.push({
      id: nextStepId(),
      type: 'save_screenshot',
      label: 'Save screenshot',
      params: { filename: 'capture.png', scopeType: 'modern', method: 'pc_transfer' },
    });
  }

  if (steps.length === 0) return null;

  if (!hasExistingSteps) {
    if (steps.length <= 1) return null;
    steps.push({ id: nextStepId(), type: 'disconnect', label: 'Disconnect', params: {} });
  }

  const actions =
    hasExistingSteps && insertAfterId && !forceReplaceFlow
      ? (() => {
          const inserts: Array<Record<string, unknown>> = [];
          let currentTarget = insertAfterId;
          steps.forEach((step) => {
            inserts.push({
              type: 'insert_step_after',
              targetStepId: currentTarget,
              newStep: step,
            });
            currentTarget = String(step.id || currentTarget);
          });
          return inserts;
        })()
      : [{
          type: 'replace_flow',
          flow: {
            name: 'Generated Flow',
            description: 'Common TekAutomate scope flow built server-side.',
            backend,
            deviceType: req.flowContext.deviceType || 'SCOPE',
            steps,
          },
        }];

  if (hasExistingSteps && !Array.isArray(actions)) {
    return null;
  }

  return `ACTIONS_JSON: ${JSON.stringify({
    summary: 'Built a server-side common TekAutomate flow.',
    findings: [],
    suggestedFixes: [],
    actions,
  })}`;
}

function buildTmDevicesMeasurementShortcut(req: McpChatRequest): string | null {
  if ((req.outputMode || '') !== 'steps_json') return null;
  if ((req.flowContext.backend || '').toLowerCase() !== 'tm_devices') return null;
  if ((req.flowContext.deviceType || '').toUpperCase() !== 'SCOPE') return null;

  const measurements = detectMeasurementRequest(req);
  const channel = detectMeasurementChannel(req);
  if (!measurements.length || !channel) return null;

  const model = req.flowContext.modelFamily || 'MSO6B';
  const existingSteps = Array.isArray(req.flowContext.steps) ? req.flowContext.steps : [];
  const hasScreenshot = /\bscreenshot\b|\bscreen shot\b|\bcapture screen\b/.test(req.userMessage.toLowerCase());
  const insertAfterId =
    (req.flowContext.selectedStepId && String(req.flowContext.selectedStepId)) ||
    (existingSteps.find((step) => String(step.type || '') === 'connect')?.id as string | undefined) ||
    null;

  const measurementSteps = measurements.flatMap((measurement, index) => {
    const slot = index + 1;
    const baseId = `m${slot}`;
    const sourceField = 'source1';
    const resultVar =
      measurement === 'FREQUENCY'
        ? 'frequency_ch1'
        : measurement === 'AMPLITUDE'
          ? 'amplitude_ch1'
          : 'positive_overshoot_ch1';
    return [
      {
        id: `${baseId}a`,
        type: 'tm_device_command',
        label: `Add ${measurement} measurement`,
        params: {
          code: `scope.commands.measurement.addmeas.write("${measurement}")`,
          model,
          description: `Add ${measurement} measurement`,
        },
      },
      {
        id: `${baseId}b`,
        type: 'tm_device_command',
        label: `Set ${measurement} source to ${channel}`,
        params: {
          code: `scope.commands.measurement.meas[${slot}].${sourceField}.write("${channel}")`,
          model,
          description: `Set ${measurement} source to ${channel}`,
        },
      },
      {
        id: `${baseId}c`,
        type: 'tm_device_command',
        label: `Read ${measurement} value`,
        params: {
          code: `${resultVar} = scope.commands.measurement.meas[${slot}].results.currentacq.mean.query()`,
          model,
          description: `Read ${measurement} value`,
        },
      },
    ];
  });

  const extraSteps = hasScreenshot
    ? [
        {
          id: 'ss1',
          type: 'comment',
          label: 'Screenshot requested',
          params: {
            text: 'tm_devices backend does not support save_screenshot step directly; add a Python or platform-specific capture step if needed.',
          },
        },
      ]
    : [];

  const actions =
    existingSteps.length && insertAfterId
      ? [...measurementSteps, ...extraSteps].map((step) => ({
          type: 'insert_step_after',
          targetStepId: insertAfterId,
          newStep: step,
        }))
      : [
          {
            type: 'replace_flow',
            flow: {
              name: 'Measurement Flow',
              description: `Add ${measurements.join(', ')} measurements on ${channel}`,
              backend: 'tm_devices',
              deviceType: req.flowContext.deviceType || 'SCOPE',
              steps: [
                { id: '1', type: 'connect', label: 'Connect to Scope', params: { printIdn: true } },
                ...measurementSteps,
                ...extraSteps,
                { id: '99', type: 'disconnect', label: 'Disconnect', params: {} },
              ],
            },
          },
        ];

  const findings =
    hasScreenshot
      ? ['Added measurement steps. Screenshot on tm_devices backend may require a Python or backend-specific capture step.']
      : [];

  return `ACTIONS_JSON: {"summary":"Added ${escapeJsonString(measurements.join(', '))} measurements on ${escapeJsonString(channel)}.","findings":[${findings.map((f) => `"${escapeJsonString(f)}"`).join(',')}],"suggestedFixes":[],"actions":${JSON.stringify(actions)}}`;
}

function clipString(value: unknown, max = 280): unknown {
  if (typeof value !== 'string') return value;
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function slimScpiEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const directExample =
    entry.example && typeof entry.example === 'object'
      ? (entry.example as Record<string, unknown>)
      : null;
  const examples = Array.isArray(entry.codeExamples)
    ? (entry.codeExamples as Array<Record<string, unknown>>)
    : [];
  const firstExample = examples[0] && typeof examples[0] === 'object'
    ? (examples[0] as Record<string, unknown>)
    : null;
  const resolvedExample = directExample || firstExample;
  const argumentsList = Array.isArray(entry.arguments)
    ? (entry.arguments as unknown[])
        .filter((arg): arg is Record<string, unknown> => !!arg && typeof arg === 'object')
        .slice(0, 3)
        .map((arg) => ({
          name: arg.name,
          type: arg.type,
          description: clipString(arg.description || arg.shortDescription || arg.text, 180),
          required: arg.required,
        }))
    : [];
  const relatedCommands = Array.isArray(entry.relatedCommands)
    ? (entry.relatedCommands as unknown[])
        .filter((cmd): cmd is string => typeof cmd === 'string')
        .slice(0, 5)
    : [];
  return {
    commandId: entry.commandId,
    sourceFile: entry.sourceFile,
    header: entry.header,
    commandType: entry.commandType,
    shortDescription: clipString(entry.shortDescription, 200),
    syntax: entry.syntax,
    codeExamples: resolvedExample
      ? {
          scpi: (resolvedExample.scpi as Record<string, unknown> | undefined)?.code || resolvedExample.scpi,
          python: (resolvedExample.python as Record<string, unknown> | undefined)?.code || resolvedExample.python,
          tm_devices:
            (resolvedExample.tm_devices as Record<string, unknown> | undefined)?.code ||
            resolvedExample.tm_devices,
        }
      : undefined,
    notes: Array.isArray(entry.notes) ? (entry.notes as unknown[]).slice(0, 2).map((n) => clipString(n, 180)) : [],
    arguments: argumentsList,
    validValues: entry.validValues,
    relatedCommands,
  };
}

function logToolCall(name: string, args: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console.log(`[MCP] tool call: ${name} ${JSON.stringify(args)}`);
}

function logToolResult(name: string, result: unknown) {
  const payload = (result || {}) as Record<string, unknown>;
  const ok = payload.ok === true;
  const dataRaw = payload.data;
  const data = Array.isArray(dataRaw)
    ? dataRaw
    : dataRaw && typeof dataRaw === 'object'
      ? [dataRaw]
      : [];
  const verifiedCount = data.filter((d) => {
    if (!d || typeof d !== 'object') return false;
    return (d as Record<string, unknown>).verified === true;
  }).length;
  // eslint-disable-next-line no-console
  if (name === 'verify_scpi_commands') {
    console.log(`[MCP] tool result: ${name} ok=${ok} count=${data.length} verified=${verifiedCount}`);
  } else {
    console.log(`[MCP] tool result: ${name} ok=${ok} count=${data.length}`);
  }
}

function buildSystemPrompt(modePrompt: string, outputMode: 'steps_json' | 'blockly_xml' | 'chat'): string {
  const modeLabel =
    outputMode === 'blockly_xml'
      ? 'Blockly XML'
      : outputMode === 'chat'
        ? 'Technical chat'
        : 'Steps UI JSON';
  return [
    '# TekAutomate MCP Runtime',
    'You are the live TekAutomate assistant inside the app. Build, edit, validate, and explain the current workspace.',
    '',
    '## Runtime Contract',
    `- Current target mode: ${modeLabel}. Respect that mode exactly.`,
    '- The live workspace context is authoritative: backend, device map, editor mode, current steps, selected step, logs, and audit output outrank generic preferences.',
    '- Build directly when the request is clear. Do not stall in confirmation loops for normal edits.',
    '- Use MCP tools only when you need exact command syntax, tm_devices API paths, block schema details, runtime state, or known-failure context.',
    '- Prefer one focused tool call over serial tool chains. Zero tool calls is fine when the workspace and prompt already give enough context.',
    '- If the user asks to add, insert, update, fix, move, remove, replace, convert, apply, or "do it", return actionable changes in this response, not promises.',
    '- Never claim a change is already applied. You are proposing actions for the app to apply.',
    '- Do not output raw standalone Python text unless the user explicitly asks for Python.',
    '- A python step is allowed when repeated acquisition, iteration, aggregation, or sweep logic would otherwise require an impractical number of manual steps.',
    '- Prefer separate write/query steps over semicolon-chained multi-command strings unless the user explicitly asks for a single combined command.',
    '- Prefer grouped flow structure for readability: for multi-phase flows, organize steps into phase groups (setup/config/trigger/measure/save/cleanup) unless the user asks for flat steps.',
    '- If one required value is truly ambiguous, ask one concise blocking clarification question instead of guessing.',
    '- If part of the request is clear, return the verified/applyable part and mention the missing or unsupported remainder in findings instead of returning an empty response.',
    '',
    '## MCP Tools',
    '- tek_router: PRIMARY tool. Routes to 21,000+ internal tools. Use action:"search_exec" with query + args.',
    '  Fuzzy search: {action:"search_exec", query:"search scpi commands", args:{query:"your description"}}',
    '  Exact lookup: {action:"search_exec", query:"get command by header", args:{header:"EXACT:HEADER"}}',
    '  Verify: {action:"search_exec", query:"verify scpi commands", args:{commands:["CMD1","CMD2"]}}',
    '  Build: {action:"search_exec", query:"materialize scpi command", args:{header:"...", commandType:"set", value:"...", placeholderBindings:{...}}}',
    '  RAG: {action:"search_exec", query:"retrieve rag chunks", args:{corpus:"app_logic", query:"..."}}',
    '  Validate: {action:"search_exec", query:"validate action payload", args:{actionsJson:{steps:[...]}}}',
    '- send_scpi: send commands to live instrument (requires executor context).',
    '- capture_screenshot: capture scope display (requires executor context).',
    '- discover_scpi: probe live instrument to find undocumented commands (requires executor context).',
    '',
    '## When Search Fails',
    '- If tek_router search returns wrong commands, browse by SCPI group: {action:"search_exec", query:"browse scpi commands", args:{group:"Search"}}',
    '- Use SCPI terminology not natural language (e.g. "SEARCHTABle" not "search results panel")',
    '- Use discover_scpi to probe the live instrument when the database has no match',
    '- If the user pastes documentation text containing SCPI syntax, parse the header and execute directly via send_scpi',
    '- After discovering a command the hard way, SAVE it as a shortcut: tek_router({action:"create", toolName:"...", toolDescription:"...", toolTriggers:["natural language phrases"], toolCategory:"shortcut", toolSteps:[...]})',
    '- NEVER loop on the same failed search — try a different approach after 1 failed attempt',
    '',
    '## Validation Priority',
    '- User-visible truth comes first. If a flow already runs or logs prove success, do not invent blocker-level schema complaints.',
    '- A blocker must prevent apply, generation, or execution. Style cleanup, inferred defaults, and backend normalization are warnings at most.',
    '',
    '## Mode Builder Contract',
    modePrompt,
  ].join('\n');
}

const CHAT_MODE_SYSTEM_PROMPT = [
  '# TekAutomate AI Chat Assistant',
  'You are a senior Tektronix test automation engineer inside TekAutomate.',
  'Help the user reason about instruments, measurements, debugging, setup strategy, tm_devices usage, SCPI concepts, and practical lab decisions.',
  '',
  '## Context you receive',
  'Before each response, you receive pre-loaded context injected into the user message:',
  '- **Relevant SCPI commands** — exact command syntax from the 9,300+ command database (header, set syntax, query syntax)',
  '- **Knowledge base** — relevant docs from error guides, app logic, PyVISA/TekHSI reference, tm_devices reference',
  'Use this pre-loaded context as your primary source of truth for command syntax and Tek-specific knowledge.',
  'When the pre-loaded context covers the question, use it directly. When it does not, use tek_router to search.',
  '',
  '## MCP Tools — USE THESE for SCPI lookup',
  'ALWAYS use tek_router for SCPI command lookup. Do NOT rely solely on file_search or pre-loaded context.',
  '- **tek_router** — Gateway to 21,000+ SCPI commands. Use action:"search_exec" with query + args:',
  '  Search: {action:"search_exec", query:"search scpi commands", args:{query:"histogram plot measurement"}}',
  '  Exact:  {action:"search_exec", query:"get command by header", args:{header:"PLOT:PLOT<x>:TYPe"}}',
  '  Browse: {action:"search_exec", query:"browse scpi commands", args:{group:"Measurement"}}',
  '  Verify: {action:"search_exec", query:"verify scpi commands", args:{commands:["PLOT:ADDNew \\"PLOT1\\""]}}}',
  '- **send_scpi** — Send commands to live instrument',
  '- **capture_screenshot** — Capture scope display',
  '- **discover_scpi** — Probe live instrument for undocumented commands',
  '',
  '## IMPORTANT: Tool priority',
  '1. tek_router search_exec — FIRST for any SCPI command question',
  '2. Pre-loaded context — use if it directly answers the question',
  '3. file_search/KB — LAST, only for general Tek knowledge not covered above',
  'NEVER answer SCPI questions from file_search alone — always verify with tek_router.',
  '',
  '## How to use SCPI command data',
  '- The pre-loaded SCPI commands show exact syntax: `CH<x>:SCAle <NR3>` means the set form, `CH<x>:SCAle?` means the query form.',
  '- Placeholders: `<NR3>` = number, `CH<x>` = channel (CH1, CH2...), `{A|B}` = pick one, `<Qstring>` = quoted string.',
  '- Use canonical mnemonics: CH1, B1, MATH1, MEAS1, SEARCH1 — never aliases like CHAN1.',
  '- When referencing SCPI commands, show the exact syntax from the database, not guessed syntax.',
  '',
  '## Response style',
  '- Be conversational, concise, and practical. Answer like an engineer, not a validator.',
  '- Use **bold** for emphasis and `code` for SCPI commands.',
  '- Do NOT force ACTIONS_JSON in chat mode. Do not pretend a flow was applied.',
  '',
  '## Build requests',
  '- When the user asks to build a flow, set up a measurement, or create automation:',
  '  Give a short engineer-friendly outline of what the flow will do, then tell them to say **"build it"**.',
  '- Do NOT dump raw JSON, full Python scripts, or long SCPI blocks unless explicitly asked.',
  '- Keep build-like answers compact: what it does, one key caveat, invitation to "build it".',
  '- Only output full Python/tm_devices code when explicitly asked for code/script.',
  '',
  '## Diagnostic questions',
  '- For underspecified questions, ask 1-2 narrowing engineering questions before jumping to a build.',
  '- Examples: eye diagram → NRZ/PAM4, data rate, closure type; jitter → source, limit; bus → protocol, channels, bitrate.',
].join('\n');

function buildChatDeveloperPrompt(req: McpChatRequest): string {
  const fc = req.flowContext;
  const rc = req.runContext || { runStatus: 'idle', logTail: '', auditOutput: '', exitCode: null, duration: undefined };
  const flatSteps = flattenSteps(Array.isArray(fc.steps) ? fc.steps : []);
  const stepPreview = flatSteps.length
    ? flatSteps
        .slice(0, 12)
        .map((step) => {
          const params =
            step.params && typeof step.params === 'object' ? (step.params as Record<string, unknown>) : {};
          const command = String(params.command || params.code || '').trim();
          return `- [${step.id}] ${step.type}${step.label ? ` "${step.label}"` : ''}${command ? ` -> ${command}` : ''}`;
        })
        .join('\n')
    : '- (empty flow)';
  const instrumentMapLines = Array.isArray(fc.instrumentMap) && fc.instrumentMap.length
    ? fc.instrumentMap
        .map((device) =>
          `- ${String(device.alias || 'device')}: ${String(device.deviceType || 'SCOPE')}, ${String(device.backend || 'pyvisa')}${device.deviceDriver ? `, driver ${String(device.deviceDriver)}` : ''}${device.visaResource ? ` [${String(device.visaResource)}]` : ''}`
        )
        .join('\n')
    : `- ${fc.alias || 'scope1'}: ${fc.deviceType || 'SCOPE'}, ${fc.backend || 'pyvisa'}`;
  const parts = [
    'Grounding rules for this chat turn:',
    '- Use hosted file_search first when uploaded Tek KB is available.',
    '- Prefer KB-backed guidance for Tek-specific answers.',
    '- Treat programmer-manual syntax rules and verified command JSON as the command-language source of truth.',
    '- Use canonical constructed mnemonics such as CH1, B1, MATH1, MEAS1, SEARCH1, and WAVEView1. Never use aliases like CHAN1.',
    '- Briefly mention when advice is grounded in uploaded material.',
    '- If the KB is silent, say that briefly and then use general engineering knowledge.',
    '- If the user asks for a build-like artifact in chat mode, prefer a compact step outline over a script dump.',
    '- For direct flow/setup/build asks, do not emit long SCPI examples or fenced code blocks unless the user explicitly asked for code.',
    '- Default chat behavior for build-like asks: summarize the intended flow in a few bullets, mention one key caution if needed, and end by telling them to say build it.',
    '- If the request is still a flow/workflow but mentions a python step or loop, keep it in flow language and ask them to say build it; do not dump a standalone script.',
    '- Do not produce a standalone Python or tm_devices script unless the user explicitly asked for code/script/Python.',
    '- Interpret "tm_device" as "tm_devices".',
    '',
    'Runtime workspace context:',
    `- backend: ${fc.backend || 'pyvisa'}`,
    `- deviceType: ${fc.deviceType || 'SCOPE'}`,
    `- modelFamily: ${fc.modelFamily || '(unknown)'}`,
    `- alias: ${fc.alias || 'scope1'}`,
    '- instruments:',
    instrumentMapLines,
    '',
    `Current flow (${flatSteps.length} flattened steps):`,
    stepPreview,
  ];
  if (fc.selectedStep) {
    parts.push('', `Selected step:\n${JSON.stringify(fc.selectedStep, null, 2)}`);
  }
  if (rc.runStatus !== 'idle') {
    parts.push('', `Run status: ${rc.runStatus}`);
    if (rc.logTail) {
      parts.push(`Run log tail:\n${String(rc.logTail).slice(-1000)}`);
    }
  }
  const attachmentContext = buildAttachmentContext(req);
  if (attachmentContext) {
    parts.push('', attachmentContext);
  }
  return parts.join('\n');
}

async function runChatConversation(
  req: McpChatRequest
): Promise<{
  text: string;
  assistantThreadId?: string;
  metrics: NonNullable<ToolLoopResult['metrics']>;
  debug: NonNullable<ToolLoopResult['debug']>;
}> {
  const developerPrompt = buildChatDeveloperPrompt(req);
  const useHostedAssistant = shouldUseOpenAiAssistant(req);
  const modelStartedAt = Date.now();

  // Only pre-load SCPI + RAG context on first message or new topic (keep context lean)
  // If there's conversation history, the AI already has prior context — skip re-injection
  const hasHistory = Array.isArray(req.history) && req.history.length > 0;
  let preContext = '';
  if (!hasHistory) {
    const preContextParts: string[] = [];
    try {
      const { smartScpiLookup } = await import('./smartScpiAssistant');
      const scpiRes = await smartScpiLookup({ query: req.userMessage, modelFamily: req.flowContext?.modelFamily });
      if (scpiRes.ok && scpiRes.data.length > 0) {
        const cmdLines = scpiRes.data.slice(0, 3).map((cmd: any) =>
          `${cmd.header || ''}: Set=${cmd.syntax?.set || ''} Query=${cmd.syntax?.query || ''}`
        );
        preContextParts.push(`SCPI commands:\n${cmdLines.join('\n')}`);
      }
    } catch { /* non-fatal */ }
    try {
      const { retrieveRagChunks } = await import('../tools/retrieveRagChunks');
      const chunks: string[] = [];
      for (const corpus of ['errors', 'app_logic', 'pyvisa_tekhsi', 'tmdevices']) {
        const res = await retrieveRagChunks({ corpus: corpus as any, query: req.userMessage, topK: 1 });
        if (res.ok && Array.isArray(res.data)) {
          for (const chunk of res.data) {
            const c = chunk as { title?: string; body?: string };
            if (c.body && c.body.length > 30) chunks.push(`${c.title || corpus}: ${c.body.slice(0, 300)}`);
          }
        }
      }
      if (chunks.length > 0) preContextParts.push(`Knowledge:\n${chunks.slice(0, 3).join('\n')}`);
    } catch { /* non-fatal */ }
    if (preContextParts.length > 0) {
      preContext = '\n\n---\nContext from TekAutomate database:\n' + preContextParts.join('\n\n');
      console.log(`[MCP] Chat mode pre-loaded context (${preContext.length} chars, first message)`);
    }
  }

  const userPrompt = `${req.userMessage}${preContext}`;

  if (req.provider === 'anthropic') {
    // ── Anthropic SDK with native tool calling ─────────────────────
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: req.apiKey });

    const userContent = buildAnthropicUserContent(req, userPrompt);

    // Build slim tool surface (same as MCP: tek_router + live tools)
    const { getMcpExposedTools } = await import('../tools/index');
    const toolDefs = getMcpExposedTools().filter(t => t.name !== 'discover_scpi'); // no instrument in chat mode
    const anthropicTools = toolDefs.map((t: any) => ({
      name: t.name,
      description: t.description || t.name,
      input_schema: {
        type: 'object' as const,
        properties: (t.parameters as any)?.properties ?? {},
        ...((t.parameters as any)?.required?.length
          ? { required: (t.parameters as any).required }
          : {}),
      },
    }));

    const messages: Array<{ role: 'user' | 'assistant'; content: any }> = [
      ...(Array.isArray(req.history)
        ? req.history
            .slice(-12)
            .map((h, i, arr) => ({
              role: h.role as 'user' | 'assistant',
              content: String(h.content || '').slice(0, i < arr.length - 2 ? 3000 : 6000),
            }))
        : []),
      { role: 'user' as const, content: userContent as any },
    ];

    const systemPrompt = `${CHAT_MODE_SYSTEM_PROMPT}\n\n${developerPrompt}`;
    const toolTrace: NonNullable<ToolLoopResult['debug']>['toolTrace'] = [];
    let finalText = '';
    let iterations = 0;
    let totalToolMs = 0;
    const MAX_TOOL_ROUNDS = 6;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      iterations++;
      const response = await client.messages.create({
        model: req.model || 'claude-sonnet-4-5',
        system: systemPrompt,
        max_tokens: 4096,
        messages: messages as any,
        tools: anthropicTools as any,
      });

      // Extract text blocks
      const textParts = response.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');
      if (textParts) finalText = textParts;

      // Check for tool calls
      const toolUseBlocks = response.content.filter((c: any) => c.type === 'tool_use');
      if (toolUseBlocks.length === 0 || response.stop_reason !== 'tool_use') {
        break; // No more tool calls — done
      }

      // Add assistant response to messages
      messages.push({ role: 'assistant', content: response.content as any });

      // Execute tools and collect results
      const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
      for (const tu of toolUseBlocks) {
        const toolName = (tu as any).name;
        const toolArgs = (tu as any).input || {};
        const toolId = (tu as any).id;

        console.log(`[MCP] Anthropic tool call: ${toolName}`);
        const toolStart = Date.now();
        try {
          const result = await runTool(toolName, toolArgs);
          const resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
          // Cap tool result size
          const cappedResult = resultText.length > 30000
            ? resultText.slice(0, 30000) + '\n[Truncated]'
            : resultText;
          toolResults.push({ type: 'tool_result', tool_use_id: toolId, content: cappedResult });
          toolTrace.push({
            name: toolName,
            tool: toolName,
            args: toolArgs,
            startedAt: new Date(toolStart).toISOString(),
            durationMs: Date.now() - toolStart,
            resultSummary: { ok: true },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          toolResults.push({ type: 'tool_result', tool_use_id: toolId, content: `Error: ${msg}` });
          toolTrace.push({
            name: toolName,
            tool: toolName,
            args: toolArgs,
            startedAt: new Date(toolStart).toISOString(),
            durationMs: Date.now() - toolStart,
            resultSummary: { ok: false, warnings: [msg] },
            result: { error: msg },
          });
        }
        totalToolMs += Date.now() - toolStart;
      }

      // Add tool results as user message
      messages.push({ role: 'user', content: toolResults as any });
    }

    const normalizedText = await normalizeChatBuildLikeResponse(req, finalText);
    const modelMs = Date.now() - modelStartedAt;
    return {
      text: normalizedText,
      metrics: {
        totalMs: modelMs,
        usedShortcut: false,
        provider: 'anthropic',
        iterations,
        toolCalls: toolTrace.length,
        toolMs: totalToolMs,
        modelMs: modelMs - totalToolMs,
        promptChars: {
          system: systemPrompt.length,
          user: userPrompt.length,
        },
      },
      debug: {
        systemPrompt,
        developerPrompt,
        userPrompt,
        toolDefinitions: anthropicTools.map((t: any) => ({
          name: String(t?.name || ''),
          description: String(t?.description || ''),
        })),
        toolTrace,
        resolutionPath: 'anthropic-sdk',
      },
    };
  }

  if (useHostedAssistant) {
    const openAiBase = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
    const hostedVectorStoreId = resolveHostedVectorStoreId();
    const userContent = buildOpenAiResponsesContent(req, userPrompt);
    const chatTools: HostedToolDefinition[] = hostedVectorStoreId
      ? [
          {
            type: 'file_search',
            vector_store_ids: [hostedVectorStoreId],
            max_num_results: 6,
          },
        ]
      : [];
    // Chain via previous_response_id when available — OpenAI stores the full
    // conversation server-side so we can skip re-sending history, saving tokens.
    const previousResponseId = resolveOpenAiResponseCursor(req);
    const historyInput = previousResponseId
      ? []
      : (Array.isArray(req.history)
          ? req.history
              .slice(-8)
              .map((h) => ({ role: h.role, content: String(h.content || '').slice(0, 6000) }))
          : []);
    const requestPayload: Record<string, unknown> = {
      model: resolveHostedAssistantModel(req),
      input: [
        {
          role: 'developer',
          content: `${CHAT_MODE_SYSTEM_PROMPT}\n\n${developerPrompt}`.trim(),
        },
        ...historyInput,
        { role: 'user', content: userContent },
      ],
      store: true,
      stream: false,
      ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
      ...(chatTools.length ? { tools: chatTools } : {}),
    };
    if (hostedModelSupportsTemperature(String(requestPayload.model || ''))) {
      requestPayload.temperature = resolveHostedResponseTemperature(req);
    }
    const reasoningEffort = resolveHostedReasoningEffort(req, String(requestPayload.model || ''));
    if (reasoningEffort) {
      requestPayload.reasoning = { effort: reasoningEffort };
    }
    const res = await fetch(`${openAiBase}/v1/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${req.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestPayload),
    });
    if (!res.ok) {
      throw new Error(`OpenAI Responses error ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as Record<string, unknown>;
    const responseId = String(json.id || '').trim();
    const normalizedText = await normalizeChatBuildLikeResponse(req, extractOpenAiResponseText(json));
    const modelMs = Date.now() - modelStartedAt;
    return {
      text: normalizedText,
      assistantThreadId: responseId || undefined,
      metrics: {
        totalMs: modelMs,
        usedShortcut: false,
        provider: 'openai',
        iterations: 1,
        toolCalls: 0,
        toolMs: 0,
        modelMs,
        promptChars: {
          system: CHAT_MODE_SYSTEM_PROMPT.length + developerPrompt.length,
          user: userPrompt.length,
        },
      },
      debug: {
        systemPrompt: CHAT_MODE_SYSTEM_PROMPT,
        developerPrompt,
        userPrompt,
        toolDefinitions: chatTools.map((tool) => ({
          name: String(tool.type),
          description: tool.type === 'file_search' ? 'Hosted vector-store search over uploaded Tektronix KB files' : '',
        })),
        toolTrace: [],
        providerRequest: requestPayload,
        rawOutput: json,
        resolutionPath: chatTools.length ? 'chat:file_search_enabled' : 'chat',
      },
    };
  }

  const openAiBase = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
  const userContent = buildOpenAiUserContent(req, userPrompt);
  const requestPayload = {
    model: resolveOpenAiModel(req),
    messages: [
      { role: 'system', content: `${CHAT_MODE_SYSTEM_PROMPT}\n\n${developerPrompt}` },
      ...(Array.isArray(req.history)
        ? req.history
            .slice(-8)
            .map((h, i, arr) => ({
              role: h.role,
              content: String(h.content || '').slice(0, i < arr.length - 2 ? 3000 : 6000),
            }))
        : []),
      { role: 'user', content: userContent },
    ],
    ...buildOpenAiCompletionTokenOption(resolveOpenAiModel(req)),
  };
  const res = await fetch(`${openAiBase}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${req.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestPayload),
  });
  if (!res.ok) {
    throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  const text = extractChatCompletionText(json);
  const normalizedText = await normalizeChatBuildLikeResponse(req, text);
  const modelMs = Date.now() - modelStartedAt;
  return {
    text: normalizedText,
    metrics: {
      totalMs: modelMs,
      usedShortcut: false,
      provider: 'openai',
      iterations: 1,
      toolCalls: 0,
      toolMs: 0,
      modelMs,
      promptChars: {
        system: CHAT_MODE_SYSTEM_PROMPT.length + developerPrompt.length,
        user: userPrompt.length,
      },
    },
    debug: {
      systemPrompt: CHAT_MODE_SYSTEM_PROMPT,
      developerPrompt,
      userPrompt,
      toolDefinitions: [],
      toolTrace: [],
      providerRequest: requestPayload,
      rawOutput: json,
      resolutionPath: 'chat',
    },
  };
}

function didExplicitlyAskForCode(message: string): boolean {
  const text = String(message || '').toLowerCase();
  return /\b(python|script|code|snippet|pyvisa|raw scpi|scpi sequence|show python|show code)\b/.test(text);
}

function isConversationalEngineeringAsk(message: string): boolean {
  const text = String(message || '').trim().toLowerCase();
  if (!text) return false;
  const leadingQuestion = /^(why|how|what|which|when|should|would|could|can)\b/.test(text);
  const reasoningCue =
    /\b(best|recommend|suggest|tradeoff|explain|why|how should|compare|versus|vs\.?|difference|pros and cons|when to use|should i)\b/.test(
      text
    );
  const questionLike = /\?/.test(text);
  return leadingQuestion || reasoningCue || questionLike;
}

function isStrongBuildDirective(message: string): boolean {
  const text = String(message || '').trim().toLowerCase();
  if (!text) return false;
  return (
    /^(set|add|configure|build|create|save|recall|trigger|run|capture|enable|disable|insert|replace|remove|connect|disconnect|query|read|load|make)\b/.test(
      text
    ) ||
    /\b(build (?:a )?flow|steps json|actions_json|change my flow|update my flow|apply that change|build it|make the flow)\b/.test(
      text
    )
  );
}

function looksLikeRawBuildDump(text: string): boolean {
  const body = String(text || '');
  const fencedCode = /```[\s\S]*?```/.test(body);
  const manyScpiLines = (body.match(/^[A-Z*][A-Za-z0-9:*?._-]*(?:\s+[^`\n\r]+)?$/gm) || []).length >= 5;
  const toolLeak = /to=file_search|tool[_ ]?call|ACTIONS_JSON:/i.test(body);
  const manyInlineCommands =
    (body.match(/`(?:\*?[A-Z][A-Za-z0-9:*?._-]+(?:\s+[^`]+)?)`/g) || []).length >= 5;
  return fencedCode || manyScpiLines || toolLeak || manyInlineCommands;
}

function summarizePlannerGroups(commands: PlannerOutput['resolvedCommands']): string[] {
  const ordered = sortPlannerResolvedCommands(commands);
  const seen = new Set<string>();
  const bullets: string[] = [];
  const push = (key: string, text: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    bullets.push(text);
  };

  for (const command of ordered) {
    const header = String(command.concreteCommand || '');
    if (command.stepType === 'save_waveform') {
      push('save_waveform', 'save the requested waveform artifacts');
      continue;
    }
    if (command.stepType === 'save_screenshot') {
      push('save_screenshot', 'save a screenshot');
      continue;
    }
    if (command.stepType === 'recall') {
      push('recall', 'recall the requested file or session');
      continue;
    }
    if (command.stepType === 'python') {
      push('python', 'include the requested Python logic inside the flow');
      continue;
    }
    if (/^CH\d:|^SELect:CH\d/i.test(header)) {
      push('channels', 'set up the requested channels and vertical settings');
      continue;
    }
    if (/^BUS:|^SEARCH:/i.test(header)) {
      push('bus', 'configure the requested bus or search behavior');
      continue;
    }
    if (/^TRIGger:/i.test(header)) {
      push('trigger', 'configure the requested trigger behavior');
      continue;
    }
    if (/^ACQuire:|^HORizontal:|^\*OPC\?/i.test(header)) {
      push('acquisition', 'set the requested acquisition and timebase behavior');
      continue;
    }
    if (/^MEASUrement:|^CURSor:/i.test(header)) {
      push('measurements', 'add the requested measurements or readbacks');
      continue;
    }
    if (/^\*IDN\?|^\*OPT\?|^\*ESR\?/i.test(header)) {
      push('status', 'run the requested communication or status checks');
      continue;
    }
  }

  return bullets.slice(0, 6);
}

async function normalizeChatBuildLikeResponse(req: McpChatRequest, text: string): Promise<string> {
  if ((req.outputMode || '').toLowerCase() !== 'chat') return text;
  if (!isFlowBuildIntentMessage(req.userMessage)) return text;
  if (didExplicitlyAskForCode(req.userMessage)) return text;
  if (isConversationalEngineeringAsk(req.userMessage) && !isStrongBuildDirective(req.userMessage)) return text;
  if (!looksLikeRawBuildDump(text)) return text;

  try {
    const plannerOutput = await planIntent(req);
    const bullets = summarizePlannerGroups(plannerOutput.resolvedCommands);
    const lines: string[] = ['I can build that as a compact TekAutomate flow.'];
    lines.push('', 'Flow outline:');
    if (bullets.length) {
      for (const bullet of bullets) lines.push(`- ${bullet}`);
    } else {
      lines.push('- set up the requested configuration');
      lines.push('- run the requested acquisition or checks');
      lines.push('- save or query the requested results');
    }
    if (plannerOutput.unresolved.length > 0) {
      lines.push('', `One thing to confirm: ${plannerOutput.unresolved[0]}.`);
    }
    lines.push('', 'Say `build it` and I’ll turn that into an applyable Steps UI flow.');
    return lines.join('\n');
  } catch {
    return [
      'I can build that as a compact TekAutomate flow.',
      '',
      'Flow outline:',
      '- set up the requested configuration',
      '- run the requested acquisition or checks',
      '- save or query the requested results',
      '',
      'Say `build it` and I’ll turn that into an applyable Steps UI flow.',
    ].join('\n');
  }
}

function buildAttachmentContext(req: McpChatRequest): string {
  const attachments = Array.isArray(req.attachments) ? req.attachments : [];
  if (!attachments.length) return '';
  const lines: string[] = ['Attached files from user (treat as additional context):'];
  attachments.slice(0, 6).forEach((file, index) => {
    const name = String(file?.name || `file_${index + 1}`);
    const mimeType = String(file?.mimeType || 'application/octet-stream');
    const size = Number(file?.size || 0);
    lines.push(`${index + 1}. ${name} (${mimeType}, ${size} bytes)`);
    const excerpt = String(file?.textExcerpt || '').trim();
    if (excerpt) {
      const clipped = excerpt.length > 2000 ? `${excerpt.slice(0, 2000)}...[truncated]` : excerpt;
      lines.push(`   text excerpt:\n${clipped}`);
    } else if (mimeType.startsWith('image/')) {
      lines.push('   image attachment included.');
    } else if (mimeType === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) {
      lines.push('   pdf attachment included (no inline text extracted).');
    }
  });
  return lines.join('\n');
}

function getImageAttachments(req: McpChatRequest): Array<{ name: string; mimeType: string; dataUrl: string }> {
  const attachments = Array.isArray(req.attachments) ? req.attachments : [];
  return attachments
    .filter((file) => String(file?.mimeType || '').startsWith('image/') && typeof file?.dataUrl === 'string' && String(file.dataUrl).startsWith('data:'))
    .slice(0, 4)
    .map((file, index) => ({
      name: String(file?.name || `image_${index + 1}`),
      mimeType: String(file?.mimeType || 'image/png'),
      dataUrl: String(file?.dataUrl || ''),
    }));
}

function splitDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

function buildOpenAiUserContent(req: McpChatRequest, userPrompt: string): Array<Record<string, unknown>> | string {
  const images = getImageAttachments(req);
  if (!images.length) return userPrompt;
  // Chat Completions API format
  return [
    { type: 'text', text: userPrompt },
    ...images.map((image) => ({
      type: 'image_url',
      image_url: {
        url: image.dataUrl,
        detail: 'auto',
      },
    })),
  ];
}

/**
 * Build user content for OpenAI Responses API (hosted assistant).
 * Uses input_text/input_image types instead of text/image_url.
 */
function buildOpenAiResponsesContent(req: McpChatRequest, userPrompt: string): Array<Record<string, unknown>> | string {
  const images = getImageAttachments(req);
  if (!images.length) return userPrompt;
  // Responses API format
  return [
    { type: 'input_text', text: userPrompt },
    ...images.map((image) => ({
      type: 'input_image',
      image_url: image.dataUrl,
      detail: 'auto',
    })),
  ];
}

function buildAnthropicUserContent(req: McpChatRequest, userPrompt: string): Array<Record<string, unknown>> | string {
  const images = getImageAttachments(req);
  if (!images.length) return userPrompt;
  const blocks: Array<Record<string, unknown>> = [{ type: 'text', text: userPrompt }];
  images.forEach((image) => {
    const parsed = splitDataUrl(image.dataUrl);
    if (!parsed) return;
    blocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: parsed.mimeType,
        data: parsed.base64,
      },
    });
  });
  return blocks;
}

function buildUserPrompt(req: McpChatRequest, flowCommandIssues: string[] = []): string {
  const fc = req.flowContext;
  const rc = req.runContext;
  const validateMode = isValidationRequest(req);
  const flowValidateMode = isFlowValidationRequest(req);
  const logReviewMode = isLogReviewRequest(req);
  const executionSucceeded = runLooksSuccessful(rc);
  const flatSteps = flattenSteps(Array.isArray(fc.steps) ? fc.steps : []);
  const stepsSummary = flatSteps.length
    ? flatSteps
        .slice(0, 18)
        .map((s) =>
          `  [${s.id}] ${s.type}${s.label ? ` "${s.label}"` : ''}${typeof (s.params as Record<string, unknown> | undefined)?.command === 'string' ? ` -> ${String((s.params as Record<string, unknown>).command)}` : ''}`
        )
        .join('\n')
    : '  (empty flow)';
  const compactStepsJson = JSON.stringify(fc.steps || []);
  const stepsJsonPreview = (logReviewMode || flowValidateMode)
    ? compactStepsJson
    : compactStepsJson.length > 1600
      ? `${compactStepsJson.slice(0, 1600)}...[truncated ${compactStepsJson.length - 1600} chars]`
      : compactStepsJson;

  const instrumentLine = `  - scope1: ${fc.deviceType || 'SCOPE'}, ${fc.backend || 'pyvisa'} @ ${fc.host || 'localhost'}`;
  const instrumentMapLines = Array.isArray(fc.instrumentMap) && fc.instrumentMap.length
    ? fc.instrumentMap
        .map((device) =>
          `  - ${String(device.alias || 'device')}: ${String(device.deviceType || 'SCOPE')}, ${String(device.backend || 'pyvisa')}${device.deviceDriver ? `, driver ${String(device.deviceDriver)}` : ''}${device.visaBackend ? `, visa ${String(device.visaBackend)}` : ''}${device.host ? ` @ ${String(device.host)}` : ''}${device.visaResource ? ` [${String(device.visaResource)}]` : ''}`
        )
        .join('\n')
    : instrumentLine;
  const parts = [
    'Live workspace context:',
    `- editor: ${fc.executionSource === 'blockly' ? 'Blockly' : 'Steps'}`,
    `- backend: ${fc.backend || 'pyvisa'}`,
    `- modelFamily: ${fc.modelFamily || '(unknown)'}`,
    `- connection: ${fc.connectionType || 'tcpip'}`,
    `- deviceType: ${fc.deviceType || 'SCOPE'}`,
    `- deviceDriver: ${fc.deviceDriver || '(unknown)'}`,
    `- visaBackend: ${fc.visaBackend || '(unknown)'}`,
    `- alias: ${fc.alias || 'scope1'}`,
    '- instruments (use visaResource in brackets to target a specific instrument with send_scpi/probe_command):',
    instrumentMapLines,
    '',
    `Current flow (${flatSteps.length} flattened steps):`,
    `${stepsSummary}${flatSteps.length > 18 ? '\n  ...more steps omitted' : ''}`,
    '',
    'Current steps JSON preview:',
    stepsJsonPreview || '[]',
    '',
    'User request:',
    req.userMessage,
  ];

  if (hasBuildBrief(req)) {
    parts.push(buildStructuredBriefDeveloperSection(req.buildBrief));
  }

  const attachmentContext = buildAttachmentContext(req);
  if (attachmentContext) {
    parts.push(attachmentContext);
  }

  if (fc.selectedStep) {
    parts.push(`## Selected Step (user is focused on this)\n${JSON.stringify(fc.selectedStep, null, 2)}`);
  } else if (fc.selectedStepId) {
    parts.push(`## Selected Step ID\n${fc.selectedStepId}`);
  }

  if (fc.validationErrors && (fc.validationErrors as string[]).length > 0) {
    parts.push(`Current flow validation errors:\n${(fc.validationErrors as string[]).map((e: string) => `- ${e}`).join('\n')}`);
  }

  if (rc.runStatus !== 'idle' && !flowValidateMode) {
    parts.push(`Run status: ${rc.runStatus}${rc.exitCode !== null ? ` (exit ${rc.exitCode})` : ''}`);
    if (rc.logTail) {
      const tail = logReviewMode
        ? rc.logTail
        : rc.logTail.length > 800
          ? `...${rc.logTail.slice(-800)}`
          : rc.logTail;
      parts.push(`Run log${logReviewMode ? ' (full)' : ' tail'}:\n${tail}`);
    }
    if (rc.auditOutput) {
      const audit = logReviewMode
        ? rc.auditOutput
        : rc.auditOutput.length > 600
          ? `...${rc.auditOutput.slice(-600)}`
          : rc.auditOutput;
      parts.push(`Audit output${logReviewMode ? ' (full)' : ''}:\n${audit}`);
    }
    const decodedStatus = decodeStatusFromText(`${rc.logTail || ''}\n${rc.auditOutput || ''}`);
    if (decodedStatus.length > 0) {
      parts.push(`Decoded status/error hints:\n${decodedStatus.map((line) => `- ${line}`).join('\n')}`);
    }
  }

  if (flowValidateMode) {
    parts.push(
      'Validation scope: FLOW/STEP STRUCTURE ONLY. Ignore runtime logs, audit output, executor/network/environment failures, and host machine issues.'
    );
    parts.push(
      'Flow-review requirement: use the provided current steps JSON/IDs as authoritative context. Do not ask the user for step IDs when they are present in this request context.'
    );
    if (flowCommandIssues.length) {
      parts.push(`Precomputed flow command findings:\n${flowCommandIssues.map((x) => `- ${x}`).join('\n')}`);
    }
  }

  if (validateMode && executionSucceeded) {
    parts.push('Execution evidence indicates this flow already worked.');
  }

  if (hasLiveInstrumentAccess(req) && req.instrumentEndpoint) {
    parts.push(`Live instrument:\n- executor: ${req.instrumentEndpoint.executorUrl}\n- visa: ${req.instrumentEndpoint.visaResource}`);
  } else if (req.instrumentEndpoint) {
    parts.push('Live instrument mode is disabled for this request.');
  }

  if (req.routerBaselineText) {
    parts.push(`Router baseline:\n${req.routerBaselineText}`);
  }

  if (logReviewMode && !executionSucceeded) {
    parts.push(
      'Response style requirement: provide a detailed diagnostic explanation (around 200-400 words) grounded only in the supplied logs/audit. If no safe flow edit is possible, still return ACTIONS_JSON with actions: [] and keep the narrative detailed.'
    );
  }

  return parts.join('\n\n');
}

function shouldUseOpenAiAssistant(req: McpChatRequest): boolean {
  return req.provider === 'openai';
}

const SERVER_DEFAULT_ASSISTANT_TOKEN = '__SERVER_DEFAULT_ASSISTANT__';
const VALID_PROMPT_ID = /^pmpt_[a-zA-Z0-9_-]+$/;

function usesServerDefaultHostedPrompt(req: McpChatRequest): boolean {
  return String(req.openaiAssistantId || '').trim() === SERVER_DEFAULT_ASSISTANT_TOKEN;
}

// Default prompt ID and version — users don't need to configure this
const DEFAULT_OPENAI_PROMPT_ID = 'pmpt_69ba258ea3e8819092c7b41dbb41fd580ac4f618c91da843';
const DEFAULT_OPENAI_PROMPT_VERSION = ''; // empty = latest version

function resolveOpenAiPromptId(req: McpChatRequest): string {
  const requested = String(req.openaiAssistantId || '').trim().replace(/\s+/g, '');
  if (VALID_PROMPT_ID.test(requested)) return requested;
  const serverPromptId = String(process.env.OPENAI_PROMPT_ID || '').trim().replace(/\s+/g, '');
  if (VALID_PROMPT_ID.test(serverPromptId)) return serverPromptId;
  const legacyAssistantEnv = String(process.env.OPENAI_ASSISTANT_ID || '').trim().replace(/\s+/g, '');
  if (VALID_PROMPT_ID.test(legacyAssistantEnv)) return legacyAssistantEnv;
  return DEFAULT_OPENAI_PROMPT_ID;
}

function resolveOpenAiPromptVersion(): string {
  const raw = String(process.env.OPENAI_PROMPT_VERSION || '').trim();
  return raw ? String(raw) : DEFAULT_OPENAI_PROMPT_VERSION;
}

function resolveOpenAiResponseCursor(req: McpChatRequest): string {
  const requested = String(req.openaiThreadId || '').trim();
  if (!requested || requested.startsWith('thread_')) return '';
  return requested;
}

function isFlowBuildIntentMessage(message: string): boolean {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) return false;
  const explicitBuild =
    /\b(set up|setup|set|configure|add|measure|capture|decode|trigger|single sequence|group each test|build (?:a )?flow|steps json|actions_json|scpi|enable|disable|output on|output off|connect|disconnect|query|read|recall|save|load)\b/.test(
      text
    );
  const leadingImperative =
    /^(set|add|configure|build|create|save|recall|trigger|run|capture|enable|disable|insert|replace|remove|connect|disconnect|query|read|load)\b/.test(
      text.trim()
    );
  return explicitBuild || leadingImperative;
}

type RequestBuildBrief = NonNullable<McpChatRequest['buildBrief']>;

function hasBuildBrief(req: McpChatRequest): req is McpChatRequest & { buildBrief: RequestBuildBrief } {
  return Boolean(req.buildBrief && typeof req.buildBrief === 'object');
}

function isThinBuildBrief(req: McpChatRequest): boolean {
  if (!hasBuildBrief(req)) return true;
  const brief = req.buildBrief;
  const populatedSignals = [
    brief.channels.length > 0,
    brief.protocols.length > 0,
    Boolean(String(brief.signalType || '').trim()),
    Boolean(String(brief.dataRate || '').trim()),
    Boolean(String(brief.closureType || '').trim()),
    Boolean(String(brief.probing || '').trim()),
    brief.measurementGoals.length > 0,
    brief.artifactGoals.length > 0,
    brief.operatingModeHints.length > 0,
    brief.suggestedChecks.length > 0,
    Array.isArray(brief.secondaryEvidence) && brief.secondaryEvidence.length > 0,
  ].filter(Boolean).length;

  return populatedSignals < 3 || brief.unresolvedQuestions.length > 0;
}

function shouldEnableHostedFileSearch(
  req: McpChatRequest,
  options?: { plannerIncomplete?: boolean; preloadCandidateCount?: number }
): boolean {
  if (req.outputMode === 'chat') return true;
  if (req.outputMode !== 'steps_json') return false;
  if (options?.plannerIncomplete) return true;
  if (isThinBuildBrief(req)) return true;
  if (typeof options?.preloadCandidateCount === 'number' && options.preloadCandidateCount <= 0) return true;
  return false;
}

function clonePlannerOutput(output: PlannerOutput): PlannerOutput {
  return {
    ...output,
    intent: {
      ...output.intent,
      groups: [...output.intent.groups],
      channels: [...output.intent.channels],
      measurements: [...output.intent.measurements],
      buses: [...output.intent.buses],
      unresolved: [...output.intent.unresolved],
    },
    resolvedCommands: [...output.resolvedCommands],
    unresolved: [...output.unresolved],
    conflicts: [...output.conflicts],
    unsupportedSubrequests: output.unsupportedSubrequests
      ? [...output.unsupportedSubrequests]
      : undefined,
  };
}

function applyBuildBriefWhitelist(
  plannerOutput: PlannerOutput,
  req: McpChatRequest
): PlannerOutput {
  if (!hasBuildBrief(req)) return plannerOutput;

  const brief = req.buildBrief;
  const intent = String(brief.intent || '').toLowerCase();
  const protocolsExplicit = Array.isArray(brief.protocols) && brief.protocols.length > 0;
  const filtered = clonePlannerOutput(plannerOutput);
  if (intent === 'eye_diagram_debug') {
    filtered.resolvedCommands = filtered.resolvedCommands.filter((command) => {
      const concrete = String(command.concreteCommand || '').toUpperCase();
      const saveAs = String(command.saveAs || '').toLowerCase();

      if (!protocolsExplicit) {
        if (command.group === 'BUS_DECODE' || command.group === 'SEARCH') return false;
        if (
          concrete.startsWith('BUS:') ||
          concrete.startsWith('SEARCH:') ||
          /\bCAN\b|\bLIN\b|\bUART\b|\bSPI\b|\bI2C\b/.test(concrete)
        ) {
          return false;
        }
      }

      if (concrete.includes('MEASUREMENT:ADDMEAS SETUP') || saveAs.includes('setup')) {
        return false;
      }

      return true;
    });

    filtered.intent.groups = filtered.intent.groups.filter((group) => {
      if (!protocolsExplicit && (group === 'BUS_DECODE' || group === 'SEARCH')) return false;
      return true;
    });
    if (!protocolsExplicit) {
      filtered.intent.buses = [];
      filtered.intent.search = undefined;
    }
    filtered.intent.measurements = filtered.intent.measurements.filter((measurement) => measurement.type !== 'TIE');
    return filtered;
  }

  if (intent === 'power_integrity_debug') {
    const wantsMathRipple =
      (brief.suggestedChecks || []).some((item) => /math1|ch1\s*-\s*ch2/i.test(String(item))) ||
      (brief.measurementGoals || []).some((item) => /math1/i.test(String(item)));

    filtered.resolvedCommands = filtered.resolvedCommands.filter((command) => {
      const concrete = String(command.concreteCommand || '').toUpperCase();
      const saveAs = String(command.saveAs || '').toLowerCase();

      if (wantsMathRipple) {
        if (command.group === 'TRIGGER') return false;
        if (concrete.startsWith('TRIGGER:')) return false;
        if (/MEASUREMENT:MEAS\d+:SOURCE1 CH[1-8]/i.test(concrete)) return false;
        if (/meas\d+_(mean|rms|low|frequency)/i.test(saveAs)) return false;
        if (/MEASUREMENT:MEAS[3-9]:/i.test(concrete)) return false;
        if (/meas[3-9]_/.test(saveAs)) return false;
      }

      return true;
    });
    filtered.intent.groups = filtered.intent.groups.filter((group) => group !== 'TRIGGER');
    filtered.intent.trigger = undefined;
    if (wantsMathRipple) {
      filtered.intent.measurements = filtered.intent.measurements.filter(
        (measurement) => measurement.source1 === 'MATH1'
      );
    }
    return filtered;
  }

  return plannerOutput;
}

function buildQueryFromStructuredBrief(brief: RequestBuildBrief): string {
  const lines: string[] = [];
  const intent = String(brief.intent || 'general_debug').trim();
  lines.push(`Build a ${intent} flow.`);

  if (brief.channels.length) {
    lines.push(`Channels: ${brief.channels.join(', ')}.`);
  }
  if (brief.protocols.length) {
    lines.push(`Protocols explicitly in scope: ${brief.protocols.join(', ')}.`);
  }
  if (brief.signalType) lines.push(`Signal type: ${brief.signalType}.`);
  if (brief.dataRate) lines.push(`Data rate: ${brief.dataRate}.`);
  if (brief.closureType) lines.push(`Closure type: ${brief.closureType}.`);
  if (brief.probing) lines.push(`Probing: ${brief.probing}.`);
  if (brief.measurementGoals.length) {
    lines.push(`Measurement goals: ${brief.measurementGoals.join(', ')}.`);
  }
  if (brief.artifactGoals.length) {
    lines.push(`Artifacts: ${brief.artifactGoals.join(', ')}.`);
  }
  if (brief.operatingModeHints.length) {
    lines.push(`Operating hints: ${brief.operatingModeHints.join(', ')}.`);
  }

  const scopedChecks = (() => {
    const checks = brief.suggestedChecks || [];
    if (intent === 'eye_diagram_debug') {
      const allowed = [
        'acquisition sanity',
        'channel health',
        'differential integrity',
        'breakout-related checks',
        'eye metrics',
        'debug triggers',
      ];
      return checks.filter((item) => allowed.includes(String(item).toLowerCase()));
    }
    return checks;
  })();
  if (scopedChecks.length) {
    lines.push(`Suggested checks to cover: ${scopedChecks.join(', ')}.`);
  }

  if (intent === 'power_integrity_debug') {
    const checksLower = scopedChecks.map((item) => String(item).toLowerCase());
    const goalsLower = brief.measurementGoals.map((item) => String(item).toLowerCase());
    const evidenceLower = (brief.secondaryEvidence || []).map((item) => String(item).toLowerCase());

    if (checksLower.some((item) => item.includes('0.5 v/div') || item.includes('50 ohm termination'))) {
      lines.push('Set CH1 to 0.5 V/div, DC coupling, and 50 ohm termination.');
      lines.push('Set CH2 to 0.5 V/div, DC coupling, and 50 ohm termination.');
    }
    if (
      checksLower.some((item) => item.includes('math1 = ch1 - ch2')) ||
      evidenceLower.some((item) => item.includes('math1 = ch1 - ch2'))
    ) {
      lines.push('Create math channel MATH1 as CH1 minus CH2 and enable its display.');
    }
    if (goalsLower.some((item) => item.includes('pk2pk') || item.includes('vpp'))) {
      lines.push('Add a PK2PK ripple measurement on MATH1 and query the result.');
    }
    if (goalsLower.some((item) => item.includes('high / positive peak') || item.includes('vmax') || item.includes('vpk'))) {
      lines.push('Add a HIGH measurement on MATH1 to capture the positive peak and query the result.');
    }
    lines.push('Use ACQuire:MODe SAMple unless peak detect or averaging is explicitly requested.');
    lines.push('Use practical ripple-debug horizontal settings such as 1 ms/div and 1M samples unless the user specified otherwise.');
    if ((brief.artifactGoals || []).some((item) => /save|artifact|screenshot|capture/i.test(String(item)))) {
      lines.push('Save a screenshot of the configured ripple and math measurement view.');
    }
    lines.push('Treat this as a differential ripple-check flow on a math trace, not a generic rail-health checklist.');
    lines.push('Do not add trigger setup unless a trigger strategy is explicitly requested.');
  }

  if (intent === 'eye_diagram_debug' && (!brief.protocols || brief.protocols.length === 0)) {
    lines.push('Exclude all protocol decode, bus-trigger, and protocol-search setup unless a protocol is explicitly in scope.');
    lines.push('Prefer acquisition sanity, channel consistency, differential checks, jitter/noise checks, and evidence capture.');
  }

  if (intent === 'waveform_capture') {
    if (brief.channels.length) {
      lines.push(`Enable ${brief.channels.join(' and ')} for capture.`);
    }
    lines.push('Use a compact setup, single acquisition, artifact save, and disconnect structure.');
    lines.push('Use a single-sequence acquisition.');
    if ((brief.artifactGoals || []).some((item) => /ch1/i.test(String(item)) && /waveform/i.test(String(item)))) {
      lines.push('Save the CH1 waveform.');
    }
    if ((brief.artifactGoals || []).some((item) => /ch2/i.test(String(item)) && /waveform/i.test(String(item)))) {
      lines.push('Save the CH2 waveform.');
    }
    if ((brief.artifactGoals || []).some((item) => /screenshot/i.test(String(item)))) {
      lines.push('Save a screenshot after the acquisition.');
    }
  }

  if (brief.unresolvedQuestions.length) {
    lines.push(`Still unresolved: ${brief.unresolvedQuestions.join(', ')}.`);
  }
  if (brief.secondaryEvidence && brief.secondaryEvidence.length) {
    lines.push(`Secondary evidence: ${brief.secondaryEvidence.slice(0, 8).join(', ')}.`);
  }
  return lines.join(' ');
}

function buildStructuredBriefDeveloperSection(brief: RequestBuildBrief): string {
  return [
    '## STRUCTURED BUILD BRIEF',
    'Treat this brief as the authoritative build input for this turn.',
    'Use the original transcript only as secondary evidence.',
    `intent: ${brief.intent}`,
    `diagnosticDomain: ${(brief.diagnosticDomain || []).join(', ') || '(none)'}`,
    `channels: ${(brief.channels || []).join(', ') || '(none)'}`,
    `protocols: ${(brief.protocols || []).join(', ') || '(none)'}`,
    `signalType: ${brief.signalType || '(unspecified)'}`,
    `dataRate: ${brief.dataRate || '(unspecified)'}`,
    `closureType: ${brief.closureType || '(unspecified)'}`,
    `probing: ${brief.probing || '(unspecified)'}`,
    `measurementGoals: ${(brief.measurementGoals || []).join(', ') || '(none)'}`,
    `artifactGoals: ${(brief.artifactGoals || []).join(', ') || '(none)'}`,
    `operatingModeHints: ${(brief.operatingModeHints || []).join(', ') || '(none)'}`,
    `unresolvedQuestions: ${(brief.unresolvedQuestions || []).join(', ') || '(none)'}`,
    `suggestedChecks: ${(brief.suggestedChecks || []).join(', ') || '(none)'}`,
    `secondaryEvidence: ${(brief.secondaryEvidence || []).join(', ') || '(none)'}`,
  ].join('\n');
}

function isReasoningRequest(message: string): boolean {
  const text = String(message || '').trim();
  if (!text) return false;
  const buildIntent = isFlowBuildIntentMessage(text);
  const leadingQuestion = /^(why|how|what|which|when)\b/i.test(text);
  if (buildIntent && !leadingQuestion) return false;
  const directBuildIntent =
    /^(set|add|configure|build|create|save|recall|trigger|run|capture|enable|disable|insert|replace|remove)\b/i.test(
      text
    );
  const reasoningCue =
    /\b(best|recommend|suggest|how should|explain|why|difference|when to use|optimal|ideal|tradeoff|should i|compare|reliable|intermittent|glitch)\b/i.test(
      text
    );
  const interrogativeCue = /\?/.test(text) || /^(why|how|what|when|which)\b/i.test(text);
  return reasoningCue || (interrogativeCue && !directBuildIntent);
}

function resolveIntentRoutedModel(req: McpChatRequest): string {
  if (isReasoningRequest(req.userMessage)) {
    return String(process.env.OPENAI_REASONING_MODEL || 'gpt-5.4').trim();
  }
  return String(process.env.OPENAI_FLOW_MODEL || 'gpt-5.4-nano').trim();
}

function resolveHostedAssistantModel(req: McpChatRequest): string {
  const requested = String(req.model || '').trim();
  // Respect the UI-selected model when explicitly provided.
  if (requested) return requested;
  const envModel = String(process.env.OPENAI_ASSISTANT_MODEL || '').trim();
  if (envModel) return envModel;
  return resolveIntentRoutedModel(req);
}

function resolveOpenAiMaxOutputTokens(): number {
  const raw = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 12000);
  if (!Number.isFinite(raw)) return 12000;
  return Math.max(256, Math.floor(raw));
}

function buildOpenAiCompletionTokenOption(model: string): Record<string, number> {
  const max = resolveOpenAiMaxOutputTokens();
  return /^gpt-5/i.test(model) ? { max_completion_tokens: max } : { max_tokens: max };
}

function resolveHostedResponseTemperature(req: McpChatRequest): number {
  if (isExplainOnlyCommandAsk(req)) return 0.4;
  return req.outputMode === 'steps_json' ? 0.1 : 0.5;
}

function hostedModelSupportsTemperature(model: string): boolean {
  const normalized = String(model || '').trim().toLowerCase();
  return !/^gpt-5([.-]|$)/.test(normalized);
}

function hostedModelSupportsReasoningEffort(model: string): boolean {
  const normalized = String(model || '').trim().toLowerCase();
  return /^gpt-5([.-]|$)/.test(normalized);
}

function resolveHostedReasoningEffort(req: McpChatRequest, model: string): 'low' | 'medium' | 'high' | '' {
  if (!hostedModelSupportsReasoningEffort(model)) return '';
  return isReasoningRequest(req.userMessage) ? 'high' : 'medium';
}

function isUnsupportedReasoningEffortError(status: number, errText: string): boolean {
  if (status !== 400) return false;
  const lower = String(errText || '').toLowerCase();
  return (
    lower.includes('reasoning.effort') &&
    (lower.includes('unsupported_parameter') || lower.includes('not supported'))
  );
}

function isHostedStructuredBuildRequest(req: McpChatRequest): boolean {
  return shouldUseOpenAiAssistant(req) && req.outputMode === 'steps_json' && !isExplainOnlyCommandAsk(req);
}

function resolveHostedVectorStoreId(): string {
  return '';
}

function buildHostedToolDefinitions(toolNames?: string[]): Array<{ name: string; description: string }> {
  const allow = Array.isArray(toolNames) && toolNames.length ? new Set(toolNames) : null;
  return getAvailableToolDefinitions()
    .filter((tool) => !allow || allow.has(tool.name))
    .map((tool) => ({
    name: tool.name,
    description: tool.description,
  }));
}

function isTmDevicesHostedRequest(req: McpChatRequest): boolean {
  return (
    (req.flowContext.backend || '').toLowerCase() === 'tm_devices' ||
    /\btm[_\s-]*devices\b|\bscope\.commands\./i.test(String(req.userMessage || ''))
  );
}

function buildHostedAllowedToolChoice(
  tools: HostedToolDefinition[],
  options?: { requireToolName?: string }
): Record<string, unknown> | undefined {
  const requireToolName = String(options?.requireToolName || '').trim();
  const allowed = tools
    .filter((tool) => tool.type === 'function' && typeof tool.name === 'string')
    .map((tool) => ({
      type: 'function',
      name: String(tool.name),
    }));
  if (!allowed.length) return undefined;
  if (requireToolName) {
    const requiredTool = allowed.find((tool) => tool.name === requireToolName);
    if (requiredTool) {
      return {
        type: 'allowed_tools',
        mode: 'required',
        tools: [requiredTool],
      };
    }
  }
  return {
    type: 'allowed_tools',
    mode: 'auto',
    tools: allowed,
  };
}

export function buildHostedResponsesTools(
  req?: McpChatRequest,
  phase: HostedToolPhase = 'initial',
  options?: { restrictSearchTools?: boolean; batchMaterializeOnly?: boolean; enableFileSearch?: boolean }
): HostedToolDefinition[] {
  const hostedVectorStoreId = resolveHostedVectorStoreId();
  const wantsTmDevices = req ? isTmDevicesHostedRequest(req) : false;
  const routerOnly = isRouterOnlyHosted(req);
  const routerPreferred = isRouterPreferredHosted(req);
  const forceRouter = shouldForceHostedRouter(req);
  const routerEnabledForRequest = isRouterEnabledForRequest(req);
  let toolNames: string[];

  if (routerOnly || forceRouter) {
    toolNames = ['tek_router'];
  } else if (routerPreferred) {
    toolNames = ['get_current_flow', 'tek_router'];
  } else if (wantsTmDevices) {
    toolNames =
      phase === 'initial'
        ? ['get_current_flow', 'tek_router', 'send_scpi', 'capture_screenshot']
        : ['get_current_flow', 'tek_router', 'send_scpi', 'capture_screenshot'];
  } else if (options?.batchMaterializeOnly) {
    toolNames = phase === 'initial' ? ['finalize_scpi_commands'] : [];
  } else {
    toolNames =
      phase === 'initial' && !options?.restrictSearchTools
? ['get_current_flow', 'tek_router', 'send_scpi', 'capture_screenshot', 'discover_scpi']
: ['get_current_flow', 'tek_router', 'send_scpi', 'capture_screenshot'];
  }

  const allow = new Set(toolNames);
  const tools: HostedToolDefinition[] = [];
  getAvailableToolDefinitions(req).forEach((tool) => {
    if (!allow.has(tool.name)) return;
    tools.push({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    });
  });
  if (phase === 'initial' && hostedVectorStoreId && !options?.batchMaterializeOnly && options?.enableFileSearch !== false) {
    tools.unshift({
      type: 'file_search',
      vector_store_ids: [hostedVectorStoreId],
      max_num_results: 6,
    });
  }
  return tools;
}

function buildToolResultSummary(rawResult: unknown): {
  ok?: boolean;
  count?: number;
  warnings?: string[];
} {
  const record = rawResult && typeof rawResult === 'object'
    ? (rawResult as Record<string, unknown>)
    : {};
  const data = record.data;
  return {
    ok: typeof record.ok === 'boolean' ? Boolean(record.ok) : undefined,
    count: Array.isArray(data) ? data.length : (data && typeof data === 'object' ? 1 : 0),
    warnings: Array.isArray(record.warnings)
      ? (record.warnings as unknown[]).slice(0, 3).map((item) => String(item))
      : undefined,
  };
}

function describeScpiPlaceholders(header: string, syntax: Record<string, unknown>, args: Array<Record<string, unknown>>): string[] {
  const source = [header, String(syntax.set || ''), String(syntax.query || '')].join(' ');
  const hints: string[] = [];
  if (/CH<x>/i.test(source)) hints.push('CH<x> => concrete analog channel such as CH1, CH2, CH3, CH4');
  if (/REF<x>/i.test(source)) hints.push('REF<x> => concrete reference waveform such as REF1');
  if (/MATH<x>/i.test(source)) hints.push('MATH<x> => concrete math waveform such as MATH1');
  if (/BUS<x>/i.test(source)) hints.push('BUS<x> => concrete bus slot such as BUS1');
  if (/MEAS<x>/i.test(source)) hints.push('MEAS<x> => concrete measurement slot such as MEAS1, MEAS2, ...');
  if (/SEARCH<x>/i.test(source)) hints.push('SEARCH<x> => concrete search slot such as SEARCH1');
  if (/ZOOM<x>/i.test(source)) hints.push('ZOOM<x> => concrete zoom slot such as ZOOM1');
  if (/PLOT<x>/i.test(source)) hints.push('PLOT<x> => concrete plot slot such as PLOT1');
  if (/SOURCE\b/i.test(source) && !/SOURCE<x>|SOURCE\d/i.test(source)) {
    hints.push('SOURCE is a literal SCPI token here; do not rename it to SOURCE1/SOURCE2 unless the retrieved syntax explicitly does so');
  }
  if (/EDGE\b/i.test(source) && !/EDGE<x>|EDGE\d/i.test(source)) {
    hints.push('EDGE is a literal SCPI token here; do not rename it to EDGE1/EDGE2 unless the retrieved syntax explicitly does so');
  }
  args.forEach((arg) => {
    const validValues = arg.validValues && typeof arg.validValues === 'object'
      ? (arg.validValues as Record<string, unknown>)
      : {};
    if (typeof validValues.pattern === 'string' && validValues.pattern.trim()) {
      hints.push(`${String(arg.name || 'arg')}: pattern ${String(validValues.pattern).trim()}`);
    }
  });
  return Array.from(new Set(hints)).slice(0, 4);
}

function summarizeScpiArguments(argsRaw: unknown): string[] {
  if (!Array.isArray(argsRaw)) return [];
  return (argsRaw as Array<Record<string, unknown>>)
    .slice(0, 4)
    .map((arg) => {
      const name = typeof arg.name === 'string' ? arg.name.trim() : 'arg';
      const type = typeof arg.type === 'string' ? arg.type.trim() : 'value';
      const validValues = arg.validValues && typeof arg.validValues === 'object'
        ? (arg.validValues as Record<string, unknown>)
        : {};
      if (typeof validValues.pattern === 'string' && validValues.pattern.trim()) {
        return `${name}: ${type}, pattern ${validValues.pattern.trim()}`;
      }
      if (Array.isArray(validValues.values) && validValues.values.length) {
        const preview = (validValues.values as unknown[])
          .filter((value): value is string => typeof value === 'string')
          .slice(0, 4)
          .join(', ');
        if (preview) return `${name}: ${type}, values ${preview}`;
      }
      if (Array.isArray(validValues.examples) && validValues.examples.length) {
        const preview = (validValues.examples as unknown[])
          .slice(0, 4)
          .map((value) => String(value))
          .join(', ');
        if (preview) return `${name}: ${type}, examples ${preview}`;
      }
      if (typeof arg.defaultValue !== 'undefined') {
        return `${name}: ${type}, default ${String(arg.defaultValue)}`;
      }
      return `${name}: ${type}`;
    });
}

function formatPreloadedScpiContext(rawResult: unknown): string {
  const rows = rawResult && typeof rawResult === 'object' && Array.isArray((rawResult as Record<string, unknown>).data)
    ? ((rawResult as Record<string, unknown>).data as Array<Record<string, unknown>>)
    : [];
  if (!rows.length) {
    return [
      'Source-of-truth preload:',
      '- No SCPI command matches were preloaded for this request.',
      '- Before proposing any write/query steps, call search_scpi for the missing commands and use only exact verified syntax.',
    ].join('\n');
  }

  const lines = [
    'Source-of-truth preload (verified SCPI candidates from MCP search_scpi):',
  ];
  rows.slice(0, 6).forEach((row, index) => {
    const syntax = row.syntax && typeof row.syntax === 'object'
      ? (row.syntax as Record<string, unknown>)
      : {};
    const example = row.example && typeof row.example === 'object'
      ? (row.example as Record<string, unknown>)
      : {};
    const args = Array.isArray(row.arguments)
      ? (row.arguments as Array<Record<string, unknown>>)
      : [];
    lines.push(`${index + 1}. ${String(row.header || '').trim()}`);
    if (typeof syntax.set === 'string' && syntax.set.trim()) {
      lines.push(`   set: ${String(syntax.set).trim()}`);
    }
    if (typeof syntax.query === 'string' && syntax.query.trim()) {
      lines.push(`   query: ${String(syntax.query).trim()}`);
    }
    if (typeof example.scpi === 'string' && example.scpi.trim()) {
      lines.push(`   example: ${String(example.scpi).trim()}`);
    }
    summarizeScpiArguments(args).forEach((summary) => {
      lines.push(`   arg: ${summary}`);
    });
    describeScpiPlaceholders(String(row.header || ''), syntax, args).forEach((hint) => {
      lines.push(`   placeholder: ${hint}`);
    });
  });
  lines.push('Use only these verified forms or additional MCP tool results for SCPI-bearing steps.');
  return lines.join('\n');
}

function formatPreloadedCommandGroupsContext(rawResults: unknown[]): string {
  const groups = rawResults
    .map((rawResult) => {
      const data =
        rawResult && typeof rawResult === 'object'
          ? ((rawResult as Record<string, unknown>).data as Record<string, unknown> | undefined)
          : undefined;
      return data && typeof data === 'object' ? data : null;
    })
    .filter((value): value is Record<string, unknown> => Boolean(value));
  if (!groups.length) return '';
  const lines = ['Relevant TekAutomate command-browser groups narrowed by MCP:'];
  groups.slice(0, 4).forEach((group, index) => {
    const groupName = String(group.groupName || '').trim();
    const description = String(group.description || '').trim();
    const headers = Array.isArray(group.commandHeaders)
      ? (group.commandHeaders as unknown[]).map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    lines.push(`${index + 1}. ${groupName}`);
    if (description) lines.push(`   ${clipString(description, 180)}`);
    if (headers.length) {
      lines.push(`   sample headers: ${headers.slice(0, 6).join(', ')}`);
    }
  });
  lines.push('Use these group hints to pick likely headers before asking MCP for exact command details.');
  return lines.join('\n');
}

function detectRelevantScpiGroups(userMessage: string): string[] {
  const text = userMessage.toLowerCase();
  const groups: string[] = [];
  const push = (value: string) => {
    if (!groups.includes(value)) groups.push(value);
  };

  if (/\bch[1-8]\b|\bchannel\b|\b50\s*ohm\b|\b1mohm\b|\bac\b|\bdc\b|\bbandwidth\b|\bdeskew\b|\bscale\b|\boffset\b|\blabel\b/i.test(text)) {
    push('Vertical');
  }
  if (/\btrigger\b|\brising\b|\bfalling\b|\bnormal mode\b|\bauto mode\b|\blevel\b|\bholdoff\b/i.test(text)) {
    push('Trigger');
  }
  if (/\bsingle\b|\bsequence\b|\bacquisition\b|\baverage\b|\bnumavg\b|\bfast acquisition\b|\bcontinuous\b/i.test(text)) {
    push('Acquisition');
  }
  if (/\brecord length\b|\bhorizontal\b|\bfastframe\b|\bfast frame\b|\bps per div\b|\bper div\b|\bscale per div\b/i.test(text)) {
    push('Horizontal');
  }
  if (/\bmeasure|\bmeasurement|\bpk2pk\b|\bmean\b|\brms\b|\bfrequency\b|\bamplitude\b|\bovershoot\b|\bundershoot\b|\bdelay\b|\bsetup time\b|\bhold time\b|\bquery all results\b/i.test(text)) {
    push('Measurement');
  }
  if (/\bbus\b|\bdecode\b|\bi2c\b|\bcan\b|\buart\b|\bspi\b|\blin\b/i.test(text)) {
    push('Bus');
  }
  if (/\bsearch\b|\bmark\b|\berror frames?\b|\berrtype\b|\bfind\b/i.test(text)) {
    push('Search and Mark');
  }
  if (/\bsave\b|\bscreenshot\b|\bwaveform\b|\brecall\b|\bsession\b|\bsetup\b|\bimage\b/i.test(text)) {
    push('Save and Recall');
  }

  suggestCommandGroups(userMessage, 8).forEach(push);
  return groups.slice(0, 10);
}

function isCommonPreverifiedScpiRequest(userMessage: string, groups: string[]): boolean {
  if (!groups.length) return false;
  const text = userMessage.toLowerCase();
  if (/\bcan\b|\bi2c\b|\buart\b|\bspi\b|\bsearch\b|\bmark\b|\bdelay\b|\bsetup time\b|\bhold time\b|\beye\b|\bjitter\b|\bmask\b|\bglitch\b|\bpulse\s*width\b|\bpulsewidth\b|\brunt\b|\btimeout\b|\btransition\b|\bwindow\b|\blogic\b/i.test(text)) {
    return false;
  }
  return groups.every((group) => ['Vertical', 'Trigger', 'Acquisition', 'Horizontal', 'Measurement', 'Save and Recall'].includes(group));
}

function buildScpiBm25Queries(
  userMessage: string,
  relevantGroups: string[]
): Array<{ query: string; commandType?: 'set' | 'query' | 'both' }> {
  const queries: Array<{ query: string; commandType?: 'set' | 'query' | 'both' }> = [];
  const seen = new Set<string>();
  const push = (query: string, commandType: 'set' | 'query' | 'both' = 'both') => {
    const value = String(query || '').trim();
    if (!value) return;
    const key = `${commandType}:${value.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    queries.push({ query: value, commandType });
  };

  push(userMessage, 'both');
  if (relevantGroups.includes('Vertical')) push('channel scale coupling termination label bandwidth deskew', 'set');
  if (relevantGroups.includes('Trigger')) {
    push('trigger edge source slope level mode holdoff', 'set');
    push('trigger pulsewidth source when lowlimit highlimit polarity width glitch runt timeout transition window logic', 'set');
  }
  if (relevantGroups.includes('Acquisition')) push('acquire stopafter state mode numavg sequence', 'set');
  if (relevantGroups.includes('Horizontal')) push('horizontal recordlength fastframe scale position', 'set');
  if (relevantGroups.includes('Measurement')) push('measurement add source results currentacq mean', 'both');
  if (relevantGroups.includes('Bus')) push('bus decode source threshold standard bitrate can i2c uart', 'set');
  if (relevantGroups.includes('Search and Mark')) push('search and mark bus error frame errtype', 'set');
  if (relevantGroups.includes('Save and Recall')) push('save recall waveform image screenshot session setup', 'both');

  relevantGroups
    .filter((group) => !['Vertical', 'Trigger', 'Acquisition', 'Horizontal', 'Measurement', 'Bus', 'Search and Mark', 'Save and Recall'].includes(group))
    .forEach((group) => {
    const seed = buildCommandGroupSeedQuery(group);
    if (!seed) return;
    const commandType =
      group === 'Measurement' || group === 'Save and Recall' || group === 'Waveform Transfer' || group === 'Status and Error'
        ? 'both'
        : 'set';
    push(seed, commandType);
    });
  return queries.slice(0, 6);
}

function buildScpiPreloadQueries(userMessage: string): Array<{
  query?: string;
  header?: string;
  commandType?: 'set' | 'query' | 'both';
}> {
  const queries: Array<{ query?: string; header?: string; commandType?: 'set' | 'query' | 'both' }> = [];
  const seen = new Set<string>();
  const push = (entry: { query?: string; header?: string; commandType?: 'set' | 'query' | 'both' }) => {
    if (!entry.query && !entry.header) return;
    const key = JSON.stringify(entry);
    if (seen.has(key)) return;
    seen.add(key);
    queries.push(entry);
  };

  if (/\bch[1-8]\b|\bchannel\b|\b50\s*ohm\b|\b1mohm\b|\bac\b|\bdc\b|\bvdd_|pgood/i.test(userMessage)) {
    push({ header: 'CH<x>:SCAle' });
    push({ header: 'CH<x>:COUPling' });
    push({ header: 'CH<x>:TERmination' });
    push({ header: 'CH<x>:LABel:NAMe' });
  }
  if (/\btrigger\b|\brising\b|\bfalling\b|\bnormal mode\b|\bauto mode\b|\blevel\b/i.test(userMessage)) {
    push({ header: 'TRIGger:{A|B}:EDGE:SOUrce' });
    push({ header: 'TRIGger:{A|B}:EDGE:SLOpe' });
    push({ header: 'TRIGger:A:MODe' });
    push({ header: 'TRIGger:{A|B}:TYPe' });
    if (/\bglitch\b|\bpulse\s*width\b|\bpulsewidth\b|\bintermittent\b|\b50\s*ns\b|\bns\b/i.test(userMessage)) {
      push({ header: 'TRIGger:{A|B}:PULSEWidth:SOUrce' });
      push({ header: 'TRIGger:{A|B}:PULSEWidth:WHEn' });
      push({ header: 'TRIGger:{A|B}:PULSEWidth:LOWLimit' });
      push({ header: 'TRIGger:{A|B}:PULSEWidth:HIGHLimit' });
      push({ header: 'TRIGger:{A|B}:PULSEWidth:POLarity' });
    }
    if (/\blevel\b/i.test(userMessage)) {
      push({ query: 'trigger edge level', commandType: 'set' });
    }
  }
  if (/\bsingle\b|\bsequence\b|\brecord length\b|\bacquisition\b/i.test(userMessage)) {
    push({ header: 'ACQuire:STOPAfter' });
    push({ header: 'HORizontal:RECOrdlength' });
  }
  if (/\bmeasure|\bmeasurement|\bpk2pk\b|\bmean\b|\bdelay\b|\bquery all results\b/i.test(userMessage)) {
    push({ header: 'MEASUrement:ADDMEAS' });
    push({ header: 'MEASUrement:MEAS<x>:SOUrce1' });
    push({ header: 'MEASUrement:MEAS<x>:RESUlts:CURRentacq:MEAN' });
    if (/\bdelay\b/i.test(userMessage)) {
      push({ query: 'measurement delay source threshold crossing', commandType: 'set' });
    }
  }
  if (/\bwaveform\b|\bscreenshot\b|\bsave\b/i.test(userMessage)) {
    push({ header: 'SAVe:WAVEform' });
    push({ header: 'SAVe:IMAGe' });
  }
  if (!queries.length) {
    push({ query: userMessage, commandType: 'both' });
  }
  return queries.slice(0, 8);
}

function buildTmDevicesPreloadQueries(userMessage: string): string[] {
  const queries: string[] = [];
  const seen = new Set<string>();
  const push = (query: string) => {
    const value = String(query || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    queries.push(value);
  };

  if (/\btermination\b|\b50\s*ohm\b|\b1mohm\b/i.test(userMessage)) {
    push('ch[x].termination.write');
    push('channel termination write');
  }
  if (/\btrigger\b.*\bsource\b|\bsource\b.*\btrigger\b/i.test(userMessage)) {
    push('trigger.a.edge.source.write');
    push('trigger edge source write');
  }
  if (/\btrigger\b.*\brising\b|\btrigger\b.*\bfalling\b|\bslope\b/i.test(userMessage)) {
    push('trigger.a.edge.slope.write');
    push('trigger edge slope write');
  }
  if (/\bstate\b|\brun\b|\bstop\b|\bsingle\b|\bsequence\b|\bacquisition\b/i.test(userMessage)) {
    push('acquire.stopafter.write');
    push('acquire.state.write');
  }
  if (!queries.length) {
    push(userMessage);
  }
  return queries.slice(0, 8);
}

function formatPreloadedTmDevicesContext(rawResult: unknown): string {
  const rows = rawResult && typeof rawResult === 'object' && Array.isArray((rawResult as Record<string, unknown>).data)
    ? ((rawResult as Record<string, unknown>).data as Array<Record<string, unknown>>)
    : [];
  if (!rows.length) {
    return [
      'Source-of-truth preload:',
      '- No tm_devices paths were preloaded for this request.',
      '- Before proposing tm_device_command steps, call search_tm_devices for the missing method path and use only verified methods.',
    ].join('\n');
  }

  const lines = [
    'Source-of-truth preload (verified tm_devices candidates from MCP search_tm_devices):',
  ];
  rows.slice(0, 6).forEach((row, index) => {
    lines.push(`${index + 1}. ${String(row.methodPath || '').trim()}`);
    if (typeof row.signature === 'string' && row.signature.trim()) {
      lines.push(`   signature: ${String(row.signature).trim()}`);
    }
    if (typeof row.usageExample === 'string' && row.usageExample.trim()) {
      lines.push(`   example: ${String(row.usageExample).trim()}`);
    }
  });
  lines.push('Use only these verified tm_devices methods or additional MCP tool results for tm_device_command steps.');
  return lines.join('\n');
}

function extractHostedFunctionCalls(json: Record<string, unknown>): HostedFunctionCall[] {
  // Debug: Log the raw response to see what OpenAI is sending
  console.log('[DEBUG] extractHostedFunctionCalls - json.output:', JSON.stringify(json.output, null, 2));
  
  if (!Array.isArray(json.output)) return [];
  return (json.output as Array<Record<string, unknown>>)
    .filter((item) => item.type === 'function_call' && typeof item.name === 'string' && typeof item.call_id === 'string')
    .map((item) => ({
      name: String(item.name),
      callId: String(item.call_id),
      argumentsText:
        typeof item.arguments === 'string'
          ? item.arguments
          : JSON.stringify(item.arguments || {}),
    }));
}

async function executeHostedToolCall(
  req: McpChatRequest,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  if (name === 'get_current_flow') {
    return {
      ok: true,
      data: {
        flowContext: req.flowContext,
        runContext: req.runContext,
        selectedStepId: req.flowContext.selectedStepId,
      },
      sourceMeta: [],
      warnings: [],
    };
  }

  if (name === 'validate_flow') {
    const issues = await detectFlowCommandIssues(req);
    return {
      ok: true,
      data: {
        valid: issues.length === 0,
        issues,
      },
      sourceMeta: [],
      warnings: [],
    };
  }

  if (name === 'apply_actions') {
    return {
      ok: true,
      data: {
        applied: false,
        message: 'Do not call apply_actions inside assistant chat. Return ACTIONS_JSON and let TekAutomate apply it client-side.',
      },
      sourceMeta: [],
      warnings: ['apply_actions is not executed server-side in assistant chat'],
    };
  }

  if (
      ['get_instrument_state', 'probe_command', 'send_scpi', 'capture_screenshot', 'get_visa_resources', 'get_environment'].includes(name) &&
    req.instrumentEndpoint
  ) {
    args = {
      executorUrl: req.instrumentEndpoint.executorUrl,
      visaResource: req.instrumentEndpoint.visaResource,
      backend: req.instrumentEndpoint.backend,
      liveMode: req.instrumentEndpoint.liveMode === true,
      outputMode: req.instrumentEndpoint.outputMode || 'verbose',
      modelFamily: req.flowContext.modelFamily,
      deviceDriver: req.flowContext.deviceDriver,
      __mcpBaseUrl: (req as unknown as Record<string, unknown>).__mcpBaseUrl,
      ...args,
    };
  }

  if (isRouterEnabledForRequest(undefined)) {
    // Inject modelFamily into tek_router calls so results are filtered to the user's scope
    if (name === 'tek_router' && req.flowContext?.modelFamily) {
      args = { ...args, modelFamily: req.flowContext.modelFamily };
    }
    const routerResult = await dispatchRouterTool(name, args);
    if (routerResult) return routerResult;
  }

  return runTool(name, args);
}

async function preloadSourceOfTruthContext(
  req: McpChatRequest,
  toolTrace: NonNullable<ToolLoopResult['debug']>['toolTrace']
): Promise<HostedPreloadContext> {
  if (!isHostedStructuredBuildRequest(req)) {
    return {
      contextText: '',
      restrictSearchTools: false,
      batchMaterializeOnly: false,
      candidateCount: 0,
      groupCount: 0,
      usedBm25: false,
    };
  }

  const wantsTmDevices =
    (req.flowContext.backend || '').toLowerCase() === 'tm_devices' ||
    /\btm[_\s-]*devices\b|\bscope\.commands\./i.test(req.userMessage);
  if (wantsTmDevices) {
    const mergedRows: Array<Record<string, unknown>> = [];
    const mergedKeys = new Set<string>();
    for (const query of buildTmDevicesPreloadQueries(req.userMessage)) {
      const args = {
        query,
        model: req.flowContext.deviceDriver || req.flowContext.modelFamily,
        limit: 6,
      };
      const startedAt = new Date().toISOString();
      const t0 = Date.now();
      const rawResult = await executeHostedToolCall(req, 'search_tm_devices', args);
      toolTrace?.push({
        name: 'search_tm_devices',
        args,
        startedAt,
        durationMs: Date.now() - t0,
        resultSummary: buildToolResultSummary(rawResult),
        rawResult,
      });
      const data =
        rawResult && typeof rawResult === 'object'
          ? (rawResult as Record<string, unknown>).data
          : undefined;
      const rows = Array.isArray(data)
        ? (data as Array<Record<string, unknown>>)
        : (data && typeof data === 'object' ? [data as Record<string, unknown>] : []);
      rows.forEach((row) => {
        const key = `${String(row.modelRoot || '')}:${String(row.methodPath || '')}`;
        if (!key.trim() || mergedKeys.has(key)) return;
        mergedKeys.add(key);
        mergedRows.push(row);
      });
    }
    return {
      contextText: formatPreloadedTmDevicesContext({ data: mergedRows }),
      restrictSearchTools: false,
      batchMaterializeOnly: false,
      candidateCount: mergedRows.length,
      groupCount: 0,
      usedBm25: true,
    };
  }

  const relevantGroups = detectRelevantScpiGroups(req.userMessage);
  const groupRawResults: unknown[] = [];
  for (const groupName of relevantGroups) {
    const args = { groupName };
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    const rawResult = await executeHostedToolCall(req, 'get_command_group', args);
    toolTrace?.push({
      name: 'get_command_group',
      args,
      startedAt,
      durationMs: Date.now() - t0,
      resultSummary: buildToolResultSummary(rawResult),
      rawResult,
    });
    groupRawResults.push(rawResult);
  }

  const mergedRows: Array<Record<string, unknown>> = [];
  const mergedKeys = new Set<string>();
  const candidateHeaders: string[] = [];
  const seenHeaders = new Set<string>();
  const rememberHeader = (value: string) => {
    const header = String(value || '').trim();
    if (!header || seenHeaders.has(header)) return;
    seenHeaders.add(header);
    candidateHeaders.push(header);
  };

  for (const preload of buildScpiBm25Queries(req.userMessage, relevantGroups)) {
    const toolName = 'search_scpi';
    const args = {
      query: preload.query,
      modelFamily: req.flowContext.modelFamily,
      limit: 10,
      commandType: preload.commandType || 'both',
    };
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    const rawResult = await executeHostedToolCall(req, toolName, args);
    toolTrace?.push({
      name: toolName,
      args,
      startedAt,
      durationMs: Date.now() - t0,
      resultSummary: buildToolResultSummary(rawResult),
      rawResult,
    });
    const data =
      rawResult && typeof rawResult === 'object'
        ? (rawResult as Record<string, unknown>).data
        : undefined;
    const rows = Array.isArray(data)
      ? (data as Array<Record<string, unknown>>)
      : (data && typeof data === 'object' ? [data as Record<string, unknown>] : []);
    rows.forEach((row) => {
      const key = `${String(row.sourceFile || '')}:${String(row.commandId || row.header || '')}`;
      if (!key.trim() || mergedKeys.has(key)) return;
      mergedKeys.add(key);
      mergedRows.push(row);
      rememberHeader(String(row.header || row.matchedHeader || ''));
    });
  }

  if (candidateHeaders.length < 4) {
    buildScpiPreloadQueries(req.userMessage)
      .filter((preload) => Boolean(preload.header))
      .forEach((preload) => rememberHeader(String(preload.header || '')));
  }

  const hydratedRows: Array<Record<string, unknown>> = [];
  if (candidateHeaders.length) {
    const batchArgs = {
      headers: candidateHeaders.slice(0, 8),
      family: req.flowContext.modelFamily,
    };
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    const rawResult = await executeHostedToolCall(req, 'get_commands_by_header_batch', batchArgs);
    toolTrace?.push({
      name: 'get_commands_by_header_batch',
      args: batchArgs,
      startedAt,
      durationMs: Date.now() - t0,
      resultSummary: buildToolResultSummary(rawResult),
      rawResult,
    });
    const batchData =
      rawResult && typeof rawResult === 'object'
        ? ((rawResult as Record<string, unknown>).data as Record<string, unknown> | undefined)
        : undefined;
    const batchResults = Array.isArray(batchData?.results)
      ? (batchData?.results as Array<Record<string, unknown>>)
      : [];
    batchResults.forEach((row) => {
      if (row.deduped === true) return;
      const key = `${String(row.sourceFile || '')}:${String(row.commandId || row.header || row.matchedHeader || '')}`;
      if (!key.trim() || mergedKeys.has(`hydrated:${key}`)) return;
      mergedKeys.add(`hydrated:${key}`);
      hydratedRows.push(row);
    });
  }

  const groupContext = formatPreloadedCommandGroupsContext(groupRawResults);
  const scpiContext = formatPreloadedScpiContext({ data: hydratedRows.length ? hydratedRows : mergedRows });
  const commonRequest = isCommonPreverifiedScpiRequest(req.userMessage, relevantGroups);
  const candidateCount = hydratedRows.length || mergedRows.length;
  const batchMaterializeOnly = commonRequest && candidateCount >= 1;
  return {
    contextText: [groupContext, scpiContext, batchMaterializeOnly
      ? [
          'MCP already completed BM25 top-match retrieval and command-group narrowing for this common request.',
          'Common SCPI fast path is active for this turn.',
          'Do not call search_scpi, get_command_group, get_command_by_header, get_commands_by_header_batch, or file_search unless the preloaded candidates are clearly insufficient.',
          'Choose the needed verified headers from the preloaded candidates, call finalize_scpi_commands once with every concrete command you need, then answer immediately.',
        ].join(' ')
      : '',
    ].filter(Boolean).join('\n\n'),
    restrictSearchTools: batchMaterializeOnly,
    batchMaterializeOnly,
    candidateCount,
    groupCount: relevantGroups.length,
    usedBm25: true,
  };
}

export function buildAssistantUserPrompt(
  req: McpChatRequest,
  flowCommandIssues: string[] = [],
  options?: { hostedPromptConfigured?: boolean }
): string {
  const isExplainOnly = isExplainOnlyCommandAsk(req);
  const fc = req.flowContext;
  const flatSteps = flattenSteps(Array.isArray(fc.steps) ? fc.steps : []);
  const topStepTypes = flatSteps.slice(0, 12).map((s) => String(s.type || 'unknown'));
  const userText = String(req.userMessage || '');
  const hostedPromptConfigured = options?.hostedPromptConfigured === true;
  const isOfflineTekScope =
    /\boffline\b/i.test(userText) &&
    /\btekscope\s*pc\b|\btekscopepc\b/i.test(userText);
  const wantsTmDevices =
    (fc.backend || '').toLowerCase() === 'tm_devices' ||
    /\btm[_\s-]*devices\b|\bscope\.commands\./i.test(userText);
  const lines = [
    `TekAutomate request mode: ${req.outputMode}.`,
    `Backend: ${fc.backend || 'pyvisa'}, DeviceType: ${fc.deviceType || 'SCOPE'}, ModelFamily: ${fc.modelFamily || 'unknown'}.`,
    `Flow size: ${flatSteps.length} steps. Types: ${topStepTypes.join(', ') || '(empty)'}.`,
  ];
  const flowValidateMode = isFlowValidationRequest(req);
  const schemaLines = [
    'TekAutomate schema rules:',
    '- Your true job is to build or edit directly applyable TekAutomate Steps UI flows or valid Blockly XML, not generic workflow descriptions.',
    '- Use only real TekAutomate step types: connect, disconnect, write, query, set_and_query, sleep, comment, python, save_waveform, save_screenshot, error_check, group, tm_device_command, recall.',
    '- Never invent pseudo-step types such as set_channel, set_acquisition_mode, repeat, acquire_waveform, measure_parameter, log_to_csv, or similar abstractions.',
    '- Copy TekAutomate param keys exactly from these schemas:',
    '  connect -> params { instrumentIds: [], printIdn: true }',
    '  disconnect -> params { instrumentIds: [] }',
    '  write -> params { command: "..." }',
    '  query -> params { command: "...", saveAs: "..." }',
    '  sleep -> params { duration: 0.5 }',
    '  save_screenshot -> params { filename: "capture.png", scopeType: "modern|legacy", method: "pc_transfer" }',
    '  save_waveform -> params { source: "CH1", filename: "ch1.bin", format: "bin|csv|wfm|mat" }',
    '  group -> include params:{} and children:[]',
    '- Use label for step display text. Do not use name or title as a step field.',
    '- For query steps, use params.command, never params.query, and always include params.saveAs.',
    '- Query steps should be query-only. Do not prepend setup writes or semicolon-chained non-query commands before the final ? command.',
    '- For status/error checks, prefer *ESR? as the default command. Use ALLEV? only when the user explicitly asks for event-queue detail.',
    '- Do not add *OPC? by default. Use *OPC? only after OPC-capable operations and when completion sync is explicitly requested.',
    '- Treat uploaded programmer-manual command syntax and verified command JSON records as the SCPI source of truth.',
    '- Use canonical constructed mnemonic families exactly as documented: CH<x>, B<x>, MATH<x>, MEAS<x>, REF<x>, SEARCH<x>, and WAVEView<x>.',
    '- Never emit alias forms like CHAN1, CHANNEL1, BUS1, or MEASURE1.',
    '- Canonical headers returned by search_scpi/get_command_by_header are authoritative templates. If the retrieved header uses placeholders like CH<x>, MEAS<x>, REF<x>, BUS<x>, SEARCH<x>, or PLOT<x>, instantiate only those placeholders (for example CH1, MEAS1) and keep the rest of the header unchanged.',
    '- After retrieving a canonical SCPI record for any write/query step, prefer finalize_scpi_commands for the whole set of commands you need in this turn. If you only need one command, materialize_scpi_command is acceptable. Pass the verified header plus placeholder bindings and argument values. If the user already specified a concrete instance like CH1, MEAS1, B1, or SEARCH1, pass that as concreteHeader so MCP can infer bindings deterministically. Copy the returned command verbatim into params.command instead of typing the final SCPI yourself.',
    '- Do not mutate literal tokens such as SOURCE, EDGE, RESULTS, MODE, or LEVEL into indexed variants unless the retrieved syntax itself contains that indexed form.',
    '- For any SCPI-bearing build/edit request, use source-of-truth retrieval first. Call search_scpi and/or file_search before proposing write/query steps unless MCP already preloaded verified command candidates for this turn.',
    '- Never ask the user to paste SCPI command strings when MCP lookup/materialization tools can retrieve the verified syntax.',
    '- For tm_devices build/edit requests, use source-of-truth retrieval first. Call search_tm_devices before proposing tm_device_command steps unless MCP already preloaded verified method candidates for this turn.',
    '- After retrieving a verified tm_devices methodPath, call materialize_tm_devices_call and copy the returned code verbatim into tm_device_command params.code instead of composing Python from memory.',
    '- Prefer retrieved source-backed syntax before composing applyable write/query/tm_device_command steps.',
    '- Do not treat prompt files, golden examples, templates, or general knowledge-base prose as proof of exact SCPI syntax. For exact SCPI verification, rely on MCP command-library tool results and their command JSON records.',
    '- When MCP returns command records, use their detailed description, argument descriptions, validValues, relatedCommands, manualReference, and example text to choose the right verified command instead of relying on a stripped header match alone.',
    '- Use exact long-form SCPI syntax when known. Avoid guessing ambiguous short mnemonics like SCA, COUP, or IMP.',
    '- Combine related same-subsystem setup commands into one write step using semicolons when it keeps the flow compact.',
    '- Keep compact combined setup writes to 3 commands or fewer per step.',
    '- For sleep steps, use duration, never seconds.',
    '- For screenshot steps, use filename, never file_path, and default to scopeType:"modern" plus method:"pc_transfer" when not otherwise specified.',
    '- For waveform steps, prefer save_waveform over raw save SCPI and include source, filename, and format.',
    '- Modern MSO screenshot capture should use save_screenshot, not HARDCopy.',
    '- Prefer save_screenshot and save_waveform even for legacy DPO/70k-family save requests when the built-in TekAutomate step types fit the ask; do not expand them into raw EXPORT, FILESystem, HARDCopy, SAVE:IMAGe, DATa:SOUrce, or CURVe? sequences unless the user explicitly asks for raw SCPI.',
    '- If the current workspace is empty and you build a full flow, include connect first and disconnect last.',
    '- If the request cannot be represented with those real step types or valid Blockly blocks, explain the limitation briefly instead of emitting fake applyable JSON.',
    '- For Blockly/XML requests, return XML only and use supported blocks only: connect_scope, disconnect, set_device_context, scpi_write, scpi_query, recall, save, save_screenshot, save_waveform, wait_seconds, wait_for_opc, tm_devices_write, tm_devices_query, tm_devices_save_screenshot, tm_devices_recall_session, controls_for, controls_if, variables_set, variables_get, math_number, math_arithmetic, python_code.',
  ];
  if (hostedPromptConfigured) {
    lines.push(
      'Hosted Responses prompt is configured.',
      'Treat the stored prompt as the authority for TekAutomate schema, apply rules, Blockly rules, and tool-usage policy.',
      'Use this runtime message only for dynamic workspace context, current request details, and any preloaded verification findings for this turn.',
      resolveHostedVectorStoreId()
        ? 'Hosted file_search is available for this turn. Use file_search first for source discovery when the preloaded MCP results are incomplete or too narrow.'
        : 'Hosted file_search is not configured for this turn, so rely on MCP retrieval for source discovery.',
      'Treat file_search results as source discovery only. Prefer MCP lookup/materialization for final applyable SCPI or tm_devices output.',
      'When MCP returns command records, use their detailed description, argument descriptions, validValues, relatedCommands, manualReference, and example text to disambiguate the right verified command before building steps.',
      'Emit structured flow JSON for all verified portions even when some requested commands remain unverified.',
      'If SCPI syntax is available in the planner context (PLANNER RESOLVED section), use it immediately.',
      'If preloaded MCP verification is insufficient, proactively continue with tool calls (search_scpi, get_command_by_header, get_commands_by_header_batch, file_search as needed) before failing.',
      'Build what you can verify; only fail closed for specific commands not in planner context AND not findable via tool call.',
      'When verification is partial, include applyable actions for verified commands and add comment-step placeholders for manual completion of unverified parts.',
      'Never ask the user for SCPI strings when search_scpi/get_command_by_header can resolve them.',
      'When multiple related SCPI headers or concrete commands are needed, prefer get_commands_by_header_batch and finalize_scpi_commands to reduce tool chatter.',
      'If the stored prompt allows structured output, prefer a single parseable ```json``` block unless multiple smaller blocks are genuinely clearer.',
      'When you successfully complete a reusable multi-step workflow with 3 or more verified sequential tool-backed actions, save it as a reusable router shortcut.',
      'Create reusable shortcuts with tek_router action "create" using toolId "shortcut:<descriptive_snake_case_name>", a clear toolName, concise toolDescription, 3-5 natural-language toolTriggers, helpful toolTags, toolCategory "shortcut", and toolSteps containing the exact validated steps in order.',
      'After creating a shortcut, briefly tell the user it was saved and mention one trigger phrase they can reuse next time.',
      'Common scope workflow patterns: measurement = ADDMEAS -> set source -> enable results; channel setup = scale -> offset -> bandwidth/termination; trigger = type/source -> slope -> level -> mode/holdoff; acquisition = mode -> stopAfter -> run; save = screenshot/waveform should prefer TekAutomate save steps over raw file-system SCPI when possible.'
    );
  } else {
      lines.push(
        '',
        'Chat response contract:',
        '- For flow/create/edit requests, prefer one or more parseable ```json``` blocks rather than raw JSON text.',
        '- A JSON block may contain either full Steps UI flow JSON with "steps", or ACTIONS_JSON with "actions".',
        '- Short chat prose before or after the JSON is okay when it helps the user.',
        '- If the request is representable as TekAutomate steps, do not output a standalone Python or tm_devices script.',
        '- For tm_devices flow requests, prefer `tm_device_command` steps or full Steps flow JSON over a `DeviceManager` script.',
        '- For explain-only requests, reply in concise plain text instead of JSON.',
        '- No citations, footnotes, or reference markers like [1] or [2].',
        '- Keep any non-JSON narrative short when structured output is included.',
        ...schemaLines,
        '- Never invent commands. If uncertain, prefer safe common commands and clearly state assumptions.',
      '- If you return actions, `newStep` and `flow` must be real JSON objects, not JSON-encoded strings.',
      '- Never use `param: "params"`; set one concrete field per `set_step_param`, or use `replace_step`.'
    );
  }
  if (wantsTmDevices) {
    lines.push(
      'tm_devices mode policy:',
      '- Prefer tm_devices paths/functions from source of truth.',
      '- The tm_devices API path from tm_devices_full_tree.json is authoritative for generation. Treat raw SCPI only as explanatory context when it is also available.',
      '- Avoid SCPI write/query steps unless user explicitly asks for SCPI.',
      '- If returning flow JSON, prefer "tm_device_command" steps for command execution.'
    );
  }
  if (isOfflineTekScope) {
    lines.push(
      'Offline TekScopePC policy (strict):',
      '- Do NOT include acquisition/trigger/channel hardware setup commands.',
      '- Prefer recall/session or waveform-load + measurement + query + save results.',
      '- If needed, include a finding that offline TekScopePC cannot execute live hardware acquisition.'
    );
  }
  // History is sent as native messages in hosted Responses mode;
  // avoid duplicating it in this prompt body.
  if (req.flowContext.selectedStep) {
    lines.push('Selected step:', JSON.stringify(req.flowContext.selectedStep));
  }
  if (flowValidateMode) {
    const flowCommandSnapshot = flatSteps.length
      ? flatSteps
          .slice(0, 80)
          .map((step) => {
            const id = String(step.id || '?');
            const type = String(step.type || 'unknown');
            const label = String(step.label || '').trim();
            const params = (step.params && typeof step.params === 'object')
              ? (step.params as Record<string, unknown>)
              : {};
            const command = typeof params.command === 'string' ? params.command : '';
            const commands = Array.isArray(params.commands)
              ? (params.commands as unknown[]).map((v) => String(v)).filter(Boolean)
              : [];
            const saveAs = typeof params.saveAs === 'string' ? params.saveAs : '';
            const descriptor = command
              ? ` command=${command}`
              : commands.length
                ? ` commands=${commands.join(' ; ')}`
                : '';
            const querySave = saveAs ? ` saveAs=${saveAs}` : '';
            return `- [${id}] ${type}${label ? ` "${label}"` : ''}${descriptor}${querySave}`;
          })
          .join('\n')
      : '- (empty flow)';
    lines.push('Flow command snapshot (for strict verification):', flowCommandSnapshot);
    lines.push(
      'Flow review output policy:',
      '- Treat current flowContext.steps as the editable source of truth (IDs and structure are already available).',
      '- If you find real blockers/risky design issues, return concrete incremental ACTIONS_JSON edits (insert_step_after, set_step_param, replace_step, remove_step).',
      '- Do not ask for step IDs or full flow JSON when they are already present in context.',
      '- Use actions:[] only when the flow is structurally sound and no concrete fix is required.',
      '- Keep findings specific and tied to concrete step defects (missing queries/saveAs, missing error_check, wrong ordering, invalid write/query mixing).'
    );
  }
  if (flowCommandIssues.length) {
    lines.push(`Precomputed flow command findings:\n${flowCommandIssues.map((x) => `- ${x}`).join('\n')}`);
  }
  const attachmentContext = buildAttachmentContext(req);
  if (attachmentContext) {
    lines.push(attachmentContext);
  }
  if (isExplainOnly) {
    lines.push(
      hostedPromptConfigured
        ? 'Intent: explain the selected command or step only.'
        : 'Intent: explain only. Do not include flow-edit JSON unless the user asks for changes.'
    );
  } else {
    lines.push(
      hostedPromptConfigured
        ? 'Intent: build or modify the flow for the current request.'
        : 'Intent: chat naturally, and when proposing flow changes include parseable JSON payloads when helpful. One block is preferred, but multiple smaller JSON blocks are okay.'
    );
  }
  lines.push('User request:', req.userMessage);
  return lines.join('\n\n');
}

/** Extract assistant text from Responses API output (output_text or output[].message.content[].text). */
function extractOpenAiResponseText(json: Record<string, unknown>): string {
  if (typeof json.output_text === 'string' && json.output_text.trim().length > 0) {
    return json.output_text;
  }
  if (!Array.isArray(json.output)) return '';
  return (json.output as Array<Record<string, unknown>>)
    .map((item) => {
      if (item.type === 'message' && Array.isArray(item.content)) {
        return (item.content as Array<Record<string, unknown>>)
          .map((c) => (typeof c?.text === 'string' ? c.text : ''))
          .join('');
      }
      if (typeof item.text === 'string') return item.text;
      return '';
    })
    .join('');
}

/** Extract text from Chat Completions API response (one-shot direct LLM). */
function extractChatCompletionText(json: Record<string, unknown>): string {
  const choices = json.choices as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const msg = choices[0]?.message as Record<string, unknown> | undefined;
  if (!msg || typeof msg.content !== 'string') return '';
  return msg.content;
}

export function buildHostedOpenAiResponsesRequest(
  req: McpChatRequest,
  assistantPrompt: string,
  options: HostedResponsesRequestOptions = {}
): Record<string, unknown> {
  const hostedModel = resolveHostedAssistantModel(req);
  const promptId = resolveOpenAiPromptId(req);
  const canAttachHostedPrompt = hostedModelSupportsReasoningEffort(hostedModel);
  const effectivePromptId = canAttachHostedPrompt ? promptId : '';
  const promptVersion = resolveOpenAiPromptVersion();
  const previousResponseId =
    typeof options.previousResponseId === 'undefined'
      ? resolveOpenAiResponseCursor(req)
      : options.previousResponseId || '';
  const historyInput =
    previousResponseId || !Array.isArray(req.history)
      ? []
      : req.history
          .slice(-8)
          .map((h) => ({
            role: h.role,
            content: String(h.content || '').slice(0, 6000),
          }))
          .filter((h) => h.content.trim().length > 0);
  const developerMessage = String(options.developerMessage || '').trim();
  const userContent = buildOpenAiResponsesContent(req, assistantPrompt);
  const initialInput = options.inputOverride || [
    ...(developerMessage
      ? [{ role: 'developer', content: developerMessage }]
      : []),
    ...historyInput.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: userContent },
  ];
  const requestPayload: Record<string, unknown> = {
    model: hostedModel,
    input: initialInput,
    store: true,
    stream: false,
  };
  if (hostedModelSupportsTemperature(hostedModel)) {
    requestPayload.temperature = resolveHostedResponseTemperature(req);
  }
  const reasoningEffort = resolveHostedReasoningEffort(req, hostedModel);
  if (reasoningEffort) {
    requestPayload.reasoning = { effort: reasoningEffort };
  }
  if (Array.isArray(options.tools) && options.tools.length > 0) {
    requestPayload.tools = options.tools;
  }
  if (options.toolChoice) {
    requestPayload.tool_choice = options.toolChoice;
  }
  if (effectivePromptId) {
    requestPayload.prompt = promptVersion
      ? { id: effectivePromptId, version: promptVersion }
      : { id: effectivePromptId };
  }
  if (previousResponseId) {
    requestPayload.previous_response_id = previousResponseId;
  }
  return requestPayload;
}

async function runOpenAiHostedResponse(
  req: McpChatRequest,
  assistantPrompt: string,
  options: HostedResponsesRequestOptions = {}
): Promise<{
  text: string;
  raw: Record<string, unknown>;
  requestPayload: Record<string, unknown>;
  responseId: string;
}> {
  const openAiBase = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
  const requestPayload = buildHostedOpenAiResponsesRequest(req, assistantPrompt, options);
  const hostedModel = resolveHostedAssistantModel(req);
  const canAttachHostedPrompt = hostedModelSupportsReasoningEffort(hostedModel);
  const promptConfig = requestPayload.prompt as Record<string, unknown> | undefined;
  const reasoningCfg = requestPayload.reasoning as Record<string, unknown> | undefined;
  console.log(
    `[MCP] OpenAI hosted responses: model ${hostedModel}${reasoningCfg?.effort ? ` reasoning=${String(reasoningCfg.effort)}` : ''}`
  );
  if (usesServerDefaultHostedPrompt(req) && canAttachHostedPrompt && !promptConfig?.id) {
    throw new Error('OPENAI_PROMPT_ID could not be resolved. Using default but hosted prompt attachment failed.');
  }
  if (usesServerDefaultHostedPrompt(req) && !canAttachHostedPrompt) {
    console.log(
      `[MCP] OpenAI hosted responses: skipping prompt attachment for model ${hostedModel} (reasoning-effort incompatible); using inline context`
    );
  }
  if (promptConfig?.id) {
    console.log(
      `[MCP] OpenAI hosted responses: using prompt ${String(promptConfig.id)}${promptConfig.version ? ` v${String(promptConfig.version)}` : ''}`
    );
  } else if (String(req.openaiAssistantId || '').trim().length > 0) {
    console.log('[MCP] OpenAI hosted responses: no prompt ID configured; using inline request prompt only');
  }
  const sendHostedRequest = async (
    payload: Record<string, unknown>
  ): Promise<{
    text: string;
    raw: Record<string, unknown>;
    requestPayload: Record<string, unknown>;
    responseId: string;
  }> => {
    let res = await fetch(`${openAiBase}/v1/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${req.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      let errText = await res.text();
      if (isUnsupportedReasoningEffortError(res.status, errText) && payload.prompt) {
        console.log(
          `[MCP] OpenAI hosted responses: retrying without prompt for model ${hostedModel} after reasoning.effort incompatibility`
        );
        const fallbackPayload: Record<string, unknown> = { ...payload };
        delete fallbackPayload.prompt;
        res = await fetch(`${openAiBase}/v1/responses`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${req.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(fallbackPayload),
        });
        if (res.ok) {
          const json = (await res.json()) as Record<string, unknown>;
          const responseId = String(json.id || '').trim();
          if (!responseId) {
            throw new Error('OpenAI Responses response missing id.');
          }
          return {
            text: extractOpenAiResponseText(json),
            raw: json,
            requestPayload: fallbackPayload,
            responseId,
          };
        }
        errText = await res.text();
      }
      throw new Error(`OpenAI Responses error ${res.status}: ${errText}`);
    }
    const json = (await res.json()) as Record<string, unknown>;
    const responseId = String(json.id || '').trim();
    if (!responseId) {
      throw new Error('OpenAI Responses response missing id.');
    }
    return {
      text: extractOpenAiResponseText(json),
      raw: json,
      requestPayload: payload,
      responseId,
    };
  };

  try {
    return await sendHostedRequest(requestPayload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const shouldRetryWithoutCursor =
      /No tool output found for function call/i.test(message) &&
      String(requestPayload.previous_response_id || '').trim().length > 0;
    if (!shouldRetryWithoutCursor) {
      throw error;
    }
    console.warn(
      '[MCP] Hosted Responses cursor recovery: unresolved tool call on previous_response_id; retrying without cursor.'
    );
    const retryPayload = buildHostedOpenAiResponsesRequest(req, assistantPrompt, {
      ...options,
      previousResponseId: null,
    });
    return await sendHostedRequest(retryPayload);
  }
}

async function runOpenAiResponses(
  req: McpChatRequest,
  flowCommandIssues: string[] = [],
  options: { routerBaselineText?: string; routerBaselineMode?: string } = {}
): Promise<ToolLoopResult> {
  const instructions = getModePrompt(req);
  const userPrompt = buildUserPrompt(req, flowCommandIssues);
    const useHostedAssistant = shouldUseOpenAiAssistant(req);
  const assistantPrompt = buildAssistantUserPrompt(req, flowCommandIssues, {
    hostedPromptConfigured: useHostedAssistant && Boolean(resolveOpenAiPromptId(req)),
  });
  const compactDeveloperContext = shouldUseCompactDeveloperContext(req);
  const baseDeveloperPrompt = isExplainOnlyCommandAsk(req)
    ? 'Command explanation mode. Return plain text guidance only.'
    : await buildContext(req, { compact: compactDeveloperContext });
  const providerSupplementPrompt = await buildProviderSupplementDeveloperSection(req);
  const developerPrompt = [
    baseDeveloperPrompt,
    providerSupplementPrompt,
    buildRouterBaselineDeveloperSection(options.routerBaselineText || '', options.routerBaselineMode || ''),
  ]
    .filter(Boolean)
    .join('\n\n');
  console.log('[DEBUG] developer message:', String(developerPrompt || '').slice(0, 2000));
  if (useHostedAssistant) {
    console.log(
      '[HOSTED] developer message length:',
      developerPrompt.length,
      'compact:',
      compactDeveloperContext,
      'hasPlannerSection:',
      developerPrompt.includes('PLANNER RESOLVED')
    );
  }
  const toolDefinitions: Array<{ name: string; description: string }> = [];
  const toolTrace: NonNullable<ToolLoopResult['debug']>['toolTrace'] = [];

  const modelStartedAt = Date.now();
  let json: Record<string, unknown>;
  let content = '';
  let providerRequest: Record<string, unknown>;
  let assistantThreadId: string | undefined;
  try {
    if (useHostedAssistant) {
      console.log('[MCP] OpenAI route: assistant (Responses)');
      const hosted = await runOpenAiHostedResponse(req, assistantPrompt, {
        developerMessage: developerPrompt,
      });
      providerRequest = hosted.requestPayload;
      json = hosted.raw;
      content = hosted.text;
      assistantThreadId = hosted.responseId;
      if (!String(content || '').trim()) {
        console.log('[MCP] OpenAI hosted responses returned empty text; falling back to chat completions.');
        console.log('[MCP] Hosted raw response (truncated):', JSON.stringify(json).slice(0, 4000));
        const openAiBase = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
        const model = resolveOpenAiModel(req);
        providerRequest = {
          model,
          messages: [
            { role: 'system', content: `${instructions}\n\n${developerPrompt}` },
            { role: 'user', content: req.userMessage },
          ],
          ...buildOpenAiCompletionTokenOption(model),
        };
        const fallbackRes = await fetch(`${openAiBase}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${req.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(providerRequest),
        });
        if (!fallbackRes.ok) {
          throw new Error(`OpenAI fallback error ${fallbackRes.status}: ${await fallbackRes.text()}`);
        }
        json = (await fallbackRes.json()) as Record<string, unknown>;
        content = extractChatCompletionText(json);
        assistantThreadId = undefined;
      }
    } else {
      console.log('[MCP] OpenAI route: direct (Chat Completions one-shot)');
      const openAiBase = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
      const model = resolveOpenAiModel(req);
      providerRequest = {
        model,
        messages: [
          { role: 'system', content: `${instructions}\n\n${developerPrompt}` },
          { role: 'user', content: req.userMessage },
        ],
        ...buildOpenAiCompletionTokenOption(model),
      };
      const res = await fetch(`${openAiBase}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${req.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(providerRequest),
      });
      if (!res.ok) {
        throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
      }
      json = (await res.json()) as Record<string, unknown>;
      content = extractChatCompletionText(json);
    }
  } catch (err) {
    console.log('[MCP] responses.create error:', JSON.stringify(err));
    throw err;
  }
  console.log('[MCP] raw output:', JSON.stringify(json.output || json));
  console.log('[DEBUG] raw response:', String(content || '').slice(0, 1000));
  const modelMs = Date.now() - modelStartedAt;

  return {
    text: content,
    assistantThreadId,
    errors: [],
    warnings: [],
    metrics: {
      totalMs: 0,
      usedShortcut: false,
      provider: 'openai',
      iterations: 1,
      toolCalls: 0,
      toolMs: 0,
      modelMs,
      promptChars: {
        system: instructions.length,
        user: useHostedAssistant ? assistantPrompt.length : userPrompt.length,
      },
    },
    debug: {
      systemPrompt: instructions,
      developerPrompt,
      userPrompt: useHostedAssistant ? assistantPrompt : userPrompt,
      rawOutput: json,
      providerRequest,
      toolDefinitions,
      toolTrace,
    },
  };
}

function shouldUseTools(req: McpChatRequest): boolean {
  if (isHostedStructuredBuildRequest(req)) return true;
  const msg = req.userMessage.toLowerCase();
  return (
    msg.includes('verify') ||
    msg.includes('search scpi') ||
    msg.includes('look up') ||
    msg.includes('lookup') ||
    msg.includes('check docs') ||
    msg.includes('exact syntax')
  );
}

function isModelFirstPriority(req: McpChatRequest): boolean {
  const msg = req.userMessage.toLowerCase();
  return (
    msg.includes('build a complete tekautomate flow') ||
    msg.includes('command lookup request') ||
    /\b(command|syntax|params?|examples?|what is|how do i|lookup|look up)\b/.test(msg) ||
    msg.includes('validate tm_devices command usage') ||
    msg.includes('sync / wait review') ||
    msg.includes('find missing synchronization') ||
    msg.includes('return actions_json')
  );
}

function shouldAttemptShortcutFirst(req: McpChatRequest): boolean {
  const msg = req.userMessage.toLowerCase();
  if (isHostedStructuredBuildRequest(req)) return false;
  if (isModelFirstPriority(req)) return false;
  const lookupIntent = /\b(command|syntax|params?|examples?|what is|how do i|lookup|look up)\b/.test(msg);
  const editIntent = /\b(add|insert|set|configure|build|create|make|update|fix|change|apply)\b/.test(msg);
  // Keep deterministic shortcuts for concise direct asks only.
  return (
    msg.length <= 180 &&
    editIntent &&
    !lookupIntent &&
    (
      /\bfast\s*frame\b|\bfastframes?\b/.test(msg) ||
      /\bmeas(?:urement)?s?\b/.test(msg)
    )
  );
}

function isExactScpiLookupRequest(req: McpChatRequest): boolean {
  const msg = String(req.userMessage || '').toLowerCase().trim();
  if (!msg) return false;
  const lookupIntent =
    /^(what(?:'s| is)|which|lookup|look up|show|list|find)\b/.test(msg) &&
    /\b(command|scpi|syntax|header|query)\b/.test(msg);
  const explicitLookup =
    /\b(what(?:'s| is)?\s+the\s+(?:scpi\s+)?command\s+for|scpi\s+for|command\s+for)\b/.test(msg) ||
    /\b(show|list)\b.*\b(related commands?|all commands?)\b/.test(msg);
  const flowEditIntent = /\b(add|insert|set|configure|build|create|make|update|fix|change|apply|run)\b/.test(msg);
  const followUpNegationIntent = /\b(don['’]?t|do not|skip|these|that one|this one|use this|not this)\b/.test(msg);
  const reasoningIntent = isReasoningRequest(msg) || /\b(troubleshoot|diagnose|why|recommend|best|optimal)\b/.test(msg);
  return (lookupIntent || explicitLookup) && !flowEditIntent && !followUpNegationIntent && !reasoningIntent;
}

function shouldAllowPlannerOnlyShortcut(req: McpChatRequest): boolean {
  // Planner-only shortcut should be very narrow: exact SCPI lookup asks.
  // All recommendation, diagnostic, and composition asks should go through AI.
  return isExactScpiLookupRequest(req);
}

function canShortcut(plannerOutput: PlannerOutput, req: McpChatRequest): boolean {
  const resolvedCount = plannerOutput?.resolvedCommands?.length || 0;
  const unresolvedCount = plannerOutput?.unresolved?.length || 0;
  if (resolvedCount === 0 || unresolvedCount > 0) return false;
  if (isExplainOnlyCommandAsk(req)) return false;
  if (isFollowUpCorrectionRequest(req)) return false;

  const backend = String(req.flowContext.backend || '').toLowerCase();
  if (backend === 'tm_devices') {
    return isFlowBuildIntentMessage(req.userMessage) || shouldAttemptShortcutFirst(req);
  }

  const resolvedHeaders = plannerOutput.resolvedCommands.map((command) => String(command.header || ''));
  const hasAfgPlannerFlow = resolvedHeaders.some((header) => /^SOURce\{?ch\}?:/i.test(header)) ||
    resolvedHeaders.some((header) => /^OUTPut\{?ch\}?:STATe/i.test(header));
  const hasFastFramePlannerFlow = resolvedHeaders.some((header) => /FASTframe/i.test(header));
  const hasRecallOrIeeeFlow = resolvedHeaders.some((header) => /^RECAll:|^STEP:recall|^\*IDN\?|^\*OPT\?|^\*ESR\?/i.test(header));

  // Allow planner shortcut for deterministic build/edit flows across device families.
  return (
    isFlowBuildIntentMessage(req.userMessage) ||
    hasAfgPlannerFlow ||
    hasFastFramePlannerFlow ||
    hasRecallOrIeeeFlow ||
    shouldAttemptShortcutFirst(req) ||
    isExactScpiLookupRequest(req)
  );
}

function shouldUseCompactDeveloperContext(req: McpChatRequest): boolean {
  if (isFlowValidationRequest(req)) return false;
  const hasThread = Boolean(String(req.openaiThreadId || '').trim());
  const hasHistory = Array.isArray(req.history) && req.history.length > 0;
  if (!hasThread && !hasHistory) return false;
  const msg = String(req.userMessage || '').trim();
  if (!msg) return false;
  const likelyBigRebuild = /\b(build|create|replace|from scratch|new flow|full flow)\b/i.test(msg);
  if (likelyBigRebuild) return false;
  return msg.length <= 260;
}

function isFollowUpCorrectionRequest(req: McpChatRequest): boolean {
  const msg = String(req.userMessage || '').toLowerCase().trim();
  if (!msg) return false;
  const hasHistory = Array.isArray(req.history) && req.history.length > 0;
  if (!hasHistory) return false;

  const correctionWords =
    /\b(don['’]?t|do not|stop|skip|no|wrong|not this|use this|keep|append|add to existing|extend|continue|why did|wiped|removed)\b/.test(
      msg
    );
  const referentialWords = /\b(this|that|these|those|previous|last|above|again|same)\b/.test(msg);
  const shortFollowUp = msg.length <= 180;
  return shortFollowUp && (correctionWords || referentialWords);
}

function shouldAvoidHostedOneShot(req: McpChatRequest): boolean {
  // Use clean router for consistent decision making
  const decision = cleanRouter.makeRouteDecision(req);
  
  // Always avoid one-shot for routes that need tool calls
  if (decision.forceToolCall) {
    return true;
  }
  
  // Legacy logic for edge cases
  if (isFollowUpCorrectionRequest(req)) return true;
  if (String(req.flowContext.backend || '').toLowerCase() === 'tm_devices') return true;

  const clarificationLikely =
    /\b(what should|which should|safe value|match my probe|set the trigger level|measure this|same thing|actually do that|actually make that|not ch\d|not channel \d)\b/.test(
      req.userMessage
    ) ||
    /\b(if possible|about|roughly|around|sensible|best|optimal)\b/.test(req.userMessage);

  const iterativeOrAnalytic =
    /\b(over the next|over \d+ acquisitions|minimum and maximum|min and max|statistics|summarize|sweep|log each|for each|all frames|timestamps?|jitter|skew|eye diagram)\b/.test(
      req.userMessage
    );

  const crossDomainOrConversion =
    /\b(tm_devices|convert|translate|afg|smu)\b/.test(req.userMessage);

  return clarificationLikely || iterativeOrAnalytic || crossDomainOrConversion;
}

function hasActionsJsonPayload(text: string): boolean {
  return /ACTIONS_JSON\s*:\s*\{[\s\S]*"actions"\s*:/i.test(text);
}

function hasEmptyActionsJson(text: string): boolean {
  return /ACTIONS_JSON\s*:\s*\{[\s\S]*"actions"\s*:\s*\[\s*\]/i.test(text);
}

function looksLikeUnverifiedGapResponse(text: string): boolean {
  return /\b(not verified|could not verify|verification is insufficient|unverified)\b/i.test(String(text || ''));
}

function isNonActionableModelResponse(text: string, errors: string[]): boolean {
  const body = String(text || '');
  const missingActions = !hasActionsJsonPayload(body);
  const emptyActions = hasEmptyActionsJson(body);
  const parseFailed = (errors || []).some((error) => /ACTIONS_JSON parse failed/i.test(String(error || '')));
  // In MCP+AI mode, keep AI as primary. Only fallback when output is truly non-actionable.
  return missingActions || emptyActions || parseFailed;
}

function isExplainOnlyCommandAsk(req: McpChatRequest): boolean {
  if (req.intent === 'command_explain') return true;
  const msg = req.userMessage.toLowerCase();
  const commandLookupQuestion =
    /^(what|which|how)\b[\s\S]*\b(command|scpi|header|syntax)\b[\s\S]*\?/i.test(msg) ||
    /\bwhat(?:'s| is)\s+the\s+(?:scpi\s+)?command\b/i.test(msg) ||
    /\bset(?:s|ting)?\s+or\s+quer(?:y|ies)\b/i.test(msg);
  const flowEditIntent = /\b(add|insert|set|configure|build|create|make|update|fix|change|apply|replace|delete|remove)\b/.test(
    msg
  );
  const explanationIntent =
    /\b(explain|explanation|reasoning|rationale|why|walk me through|walkthrough|how does|how do|how can)\b/.test(
      msg
    ) || isReasoningRequest(msg);
  if (commandLookupQuestion && !flowEditIntent) return true;
  if (explanationIntent && !flowEditIntent) return true;
  return (
    msg.includes('command lookup request') &&
    msg.includes('focused command explanation') &&
    msg.includes('do not rewrite the full flow')
  );
}

function getModePrompt(req: McpChatRequest): string {
  if (isExplainOnlyCommandAsk(req)) {
    return [
      '# TekAutomate Command Explainer',
      '- This request is explanation-only for a selected command/step.',
      '- Return plain explanatory text only.',
      '- Never output ACTIONS_JSON for this mode.',
      '- Do not propose flow apply actions unless explicitly requested.',
      '- Cover command purpose, parameters, valid values/ranges, set/query usage, and common mistakes.',
      '- Preferred format:',
      '  Command: `<HEADER>`',
      '  Set: `<set form>`',
      '  Query: `<query form>`',
      '  Notes: one concise line when needed.',
    ].join('\n');
  }
  if (isFlowValidationRequest(req)) {
    return [
      loadPromptFile(req.outputMode),
      '',
      '# Flow Review Mode',
      '- Review only flow/step structure from current workspace context.',
      '- Ignore runtime/log/environment issues unless explicitly requested.',
      '- Use current step IDs from context for concrete incremental edits when blockers exist.',
      '- Prefer targeted fixes over full replace_flow for review requests.',
      '- Return actions:[] only when no concrete blocker/risk requires edits.',
    ].join('\n');
  }
  return loadPromptFile(req.outputMode);
}

function resolveOpenAiModel(req: McpChatRequest): string {
  const requested = String(req.model || '').trim();
  if (requested) return requested;
  const envDefault = String(process.env.OPENAI_DEFAULT_MODEL || '').trim();
  return envDefault || 'gpt-5.4-nano';
}

async function runOpenAiToolLoop(
  req: McpChatRequest,
  flowCommandIssues: string[] = [],
  _maxCalls = 8
): Promise<ToolLoopResult> {
  const isLiveMode = req.interactionMode === 'live';
  const modePrompt = getModePrompt(req);
  const systemPrompt = isLiveMode
    ? buildLiveSystemPrompt(req)
    : buildSystemPrompt(modePrompt, req.outputMode);
  const userPrompt = isLiveMode
    ? req.userMessage
    : buildUserPrompt(req, flowCommandIssues);
  const useHostedAssistant = isLiveMode ? false : shouldUseOpenAiAssistant(req);
  const compactDeveloperContext = shouldUseCompactDeveloperContext(req);
  const baseDeveloperPrompt = isLiveMode
    ? ''
    : isExplainOnlyCommandAsk(req)
      ? 'Command explanation mode. Return plain text guidance only.'
      : await buildContext(req, { compact: compactDeveloperContext });
  const providerSupplementPrompt = isLiveMode ? '' : await buildProviderSupplementDeveloperSection(req);
  const developerPrompt = [
    baseDeveloperPrompt,
    providerSupplementPrompt,
  ].filter(Boolean).join('\n\n');
  let assistantPrompt = isLiveMode
    ? userPrompt
    : buildAssistantUserPrompt(req, flowCommandIssues, {
        hostedPromptConfigured: useHostedAssistant && Boolean(resolveOpenAiPromptId(req)),
      });
  const toolTrace: NonNullable<ToolLoopResult['debug']>['toolTrace'] = [];
  if (useHostedAssistant) {
    console.log(
      '[HOSTED] developer message length:',
      developerPrompt.length,
      'compact:',
      compactDeveloperContext,
      'hasPlannerSection:',
      developerPrompt.includes('PLANNER RESOLVED')
    );
    console.log('[MCP] OpenAI route: assistant (Responses + tools)');
    const preferHostedOneShot =
      req.mode === 'mcp_ai' &&
      isHostedStructuredBuildRequest(req) &&
      !isFlowValidationRequest(req) &&
      !isExplainOnlyCommandAsk(req) &&
      !shouldAvoidHostedOneShot(req);
    if (preferHostedOneShot) {
      console.log('[MCP] OpenAI fast-path: one-shot hosted response (no tool loop)');
      const oneShotStartedAt = Date.now();
      const oneShot = await runOpenAiHostedResponse(req, assistantPrompt, {
        tools: [],
        developerMessage: developerPrompt,
      });
      const oneShotHasStructuredOutput =
        hasActionsJsonPayload(oneShot.text) ||
        /```json\s*[\s\S]*```/i.test(String(oneShot.text || ''));
      if (oneShotHasStructuredOutput) {
        return {
          text: oneShot.text,
          assistantThreadId: oneShot.responseId,
          errors: [],
          warnings: [],
          metrics: {
            totalMs: 0,
            usedShortcut: false,
            provider: 'openai',
            iterations: 1,
            toolCalls: 0,
            toolMs: 0,
            modelMs: Date.now() - oneShotStartedAt,
            promptChars: {
              system: systemPrompt.length,
              user: assistantPrompt.length,
            },
          },
          debug: {
            promptFileText: modePrompt,
            systemPrompt,
            developerPrompt,
            userPrompt: assistantPrompt,
            rawOutput: oneShot.raw,
            providerRequest: oneShot.requestPayload,
            toolDefinitions: [],
            toolTrace: [],
          },
        };
      }
      console.log('[MCP] OpenAI fast-path fallback: response lacked structured output, running tool loop.');
    }
    const preloadedContext = await preloadSourceOfTruthContext(req, toolTrace);
    if (preloadedContext.contextText) {
      assistantPrompt = `${assistantPrompt}\n\n${preloadedContext.contextText}`;
    }

    const initialPhase: HostedToolPhase = 'initial';
    const toolDefinitions: Array<{ name: string; description: string }> = buildHostedToolDefinitions(
      buildHostedResponsesTools(req, initialPhase, {
        restrictSearchTools: preloadedContext.restrictSearchTools,
        batchMaterializeOnly: preloadedContext.batchMaterializeOnly,
        enableFileSearch: shouldEnableHostedFileSearch(req, {
          plannerIncomplete: Boolean(req.routerBaselineText),
          preloadCandidateCount: preloadedContext.candidateCount,
        }),
      })
        .filter((tool) => tool.type === 'function' && typeof tool.name === 'string')
        .map((tool) => String(tool.name))
    );
    const providerRequests: Record<string, unknown>[] = [];
    let latestJson: Record<string, unknown> = {};
    let assistantThreadId: string | undefined;
    let finalText = '';
    let currentInput: HostedResponseInputItem[] | undefined;
    let previousResponseId: string | undefined;
    const toolCache = new Map<string, unknown>();
    let totalModelMs = 0;
    let totalToolMs = 0;
    let totalToolCalls = toolTrace.length;
    let iterations = 0;
    let pendingToolOutputs: HostedResponseInputItem[] | undefined;
    let currentPhase: HostedToolPhase = initialPhase;
    const forceHostedRouter = shouldForceHostedRouter(req);
    const hostedDeveloperPrompt = forceHostedRouter
      ? [
          developerPrompt,
          '',
          'Router-first requirement for this turn:',
          '- Call tek_router before answering directly.',
          '- Prefer action "build" for build/edit/convert/setup requests.',
          '- Use action "search_exec" only when a high-confidence single routed tool is sufficient.',
          '- Use action "search" only if you truly need discovery before build/exec.',
          '- Do not skip tek_router on this turn unless the request is plainly out of scope.',
        ].join('\n')
      : developerPrompt;

    for (let i = 0; i < Math.max(1, _maxCalls); i += 1) {
      iterations = i + 1;
      const hostedTools = buildHostedResponsesTools(req, currentPhase, {
        restrictSearchTools: currentPhase === 'initial' && preloadedContext.restrictSearchTools,
        batchMaterializeOnly: preloadedContext.batchMaterializeOnly,
        enableFileSearch:
          currentPhase === 'initial' &&
          shouldEnableHostedFileSearch(req, {
            plannerIncomplete: Boolean(req.routerBaselineText),
            preloadCandidateCount: preloadedContext.candidateCount,
          }),
      });
      const toolChoice = buildHostedAllowedToolChoice(hostedTools, {
        requireToolName:
          forceHostedRouter || (currentPhase === 'initial' && isRouterPreferredHosted(req))
            ? 'tek_router'
            : '',
      });
      const modelStartedAt = Date.now();
      const hosted = await runOpenAiHostedResponse(req, assistantPrompt, {
        inputOverride: currentInput,
        previousResponseId,
        tools: hostedTools,
        toolChoice: toolChoice || 'auto',
        developerMessage: hostedDeveloperPrompt,
      });
      totalModelMs += Date.now() - modelStartedAt;
      providerRequests.push(hosted.requestPayload);
      latestJson = hosted.raw;
      assistantThreadId = hosted.responseId;
      previousResponseId = hosted.responseId;

      const functionCalls = extractHostedFunctionCalls(hosted.raw);
      if (!functionCalls.length) {
        finalText = hosted.text;
        pendingToolOutputs = undefined;
        break;
      }

      const toolOutputs: HostedResponseInputItem[] = [];
      let allCallsCached = functionCalls.length > 0;
      let shouldForceFinalAnswer = false;
      let directRouterText: string | null = null;
      for (const call of functionCalls) {
        let parsedArgs: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(call.argumentsText);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            parsedArgs = parsed as Record<string, unknown>;
          }
        } catch {
          parsedArgs = {};
        }

        const cacheKey = `${call.name}:${stableStringify(parsedArgs)}`;
        const startedAt = new Date().toISOString();
        const cachedResult = toolCache.get(cacheKey);
        const t0 = Date.now();
        const rawResult = typeof cachedResult === 'undefined'
          ? await executeHostedToolCall(req, call.name, parsedArgs)
          : cachedResult;
        const durationMs = typeof cachedResult === 'undefined' ? Date.now() - t0 : 0;
        if (typeof cachedResult === 'undefined') {
          toolCache.set(cacheKey, rawResult);
          totalToolMs += durationMs;
          totalToolCalls += 1;
          allCallsCached = false;
        }
        toolTrace?.push({
          name: call.name,
          args: parsedArgs,
          startedAt,
          durationMs,
          resultSummary: buildToolResultSummary(rawResult),
          rawResult,
        });
        toolOutputs.push({
          type: 'function_call_output',
          call_id: call.callId,
          output: JSON.stringify(rawResult),
        });
        if (
          call.name === 'verify_scpi_commands' ||
          call.name === 'finalize_scpi_commands' ||
          call.name === 'validate_action_payload'
        ) {
          shouldForceFinalAnswer = true;
        }
        if (call.name === 'tek_router') {
          const routerAction = String(parsedArgs.action || '').toLowerCase();
          if (routerAction === 'build' || routerAction === 'exec' || routerAction === 'search_exec') {
            shouldForceFinalAnswer = true;
            const rawRecord =
              rawResult && typeof rawResult === 'object' ? (rawResult as Record<string, unknown>) : {};
            const routerText = String(rawRecord.text || '').trim();
            if (routerText && /^ACTIONS_JSON\s*:/i.test(routerText)) {
              directRouterText = routerText;
            }
          }
        }
      }

      if (directRouterText && functionCalls.length === 1) {
        finalText = directRouterText;
        pendingToolOutputs = undefined;
        break;
      }

      if ((allCallsCached || shouldForceFinalAnswer) && toolOutputs.length) {
        const reason = shouldForceFinalAnswer
          ? 'Hosted Responses verification pass completed; forcing final answer without more tools'
          : 'Hosted Responses repeated cached tool calls; forcing final answer without more tools';
        console.log(`[MCP] ${reason}`);
        const modelStartedAt = Date.now();
        const hostedFinal = await runOpenAiHostedResponse(req, assistantPrompt, {
          inputOverride: buildHostedFinalAnswerInput(toolOutputs),
          previousResponseId,
          developerMessage: hostedDeveloperPrompt,
        });
        totalModelMs += Date.now() - modelStartedAt;
        providerRequests.push(hostedFinal.requestPayload);
        latestJson = hostedFinal.raw;
        assistantThreadId = hostedFinal.responseId;
        previousResponseId = hostedFinal.responseId;
        finalText = hostedFinal.text;
        iterations = providerRequests.length;
        pendingToolOutputs = undefined;
        break;
      }

      currentInput = toolOutputs;
      pendingToolOutputs = toolOutputs;
      currentPhase = 'finalize';
    }

    if (!finalText && pendingToolOutputs?.length) {
      console.log('[MCP] Hosted Responses loop reached tool-call cap; forcing final answer pass without tools');
      const modelStartedAt = Date.now();
      const hosted = await runOpenAiHostedResponse(req, assistantPrompt, {
        inputOverride: buildHostedFinalAnswerInput(pendingToolOutputs),
        previousResponseId,
        developerMessage: hostedDeveloperPrompt,
      });
      totalModelMs += Date.now() - modelStartedAt;
      providerRequests.push(hosted.requestPayload);
      latestJson = hosted.raw;
      assistantThreadId = hosted.responseId;
      previousResponseId = hosted.responseId;
      finalText = hosted.text;
      iterations = providerRequests.length;
    }

    return {
      text: finalText || extractOpenAiResponseText(latestJson),
      assistantThreadId,
      errors: [],
      warnings: [],
      metrics: {
        totalMs: 0,
        usedShortcut: false,
        provider: 'openai',
        iterations,
        toolCalls: totalToolCalls,
        toolMs: totalToolMs,
        modelMs: totalModelMs,
        promptChars: {
          system: 0,
          user: assistantPrompt.length,
        },
      },
      debug: {
        promptFileText: modePrompt,
        systemPrompt: 'Hosted assistant mode (system prompt handled by assistant).',
        developerPrompt,
        userPrompt: assistantPrompt,
        rawOutput: latestJson,
        providerRequest:
          providerRequests.length <= 1
            ? providerRequests[0]
            : { requests: providerRequests },
        toolDefinitions,
        toolTrace,
      },
    };
  }

  let json: Record<string, unknown>;
  let content = '';
  let providerRequest: Record<string, unknown>;

  // Live mode: use OpenAI function calling with tool loop
  if (isLiveMode) {
    console.log('[MCP] OpenAI route: live mode (Chat Completions with tools)');
    const openAiBase = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
    const model = resolveOpenAiModel(req);
    const liveToolDefs = getToolDefinitions();
    const liveToolNames = new Set([
      // Execution — direct scope actions
      'send_scpi', 'capture_screenshot', 'get_instrument_state', 'get_visa_resources',
      // Router — ALL discovery + knowledge (search auto-includes RAG)
      'tek_router',
    ]);
    // Strip infra params from tool schemas (same as Anthropic path)
    const infraParams = new Set(['executorUrl', 'visaResource', 'backend', 'liveMode', 'outputMode', 'modelFamily', 'deviceDriver', 'scopeType']);
    const openAiTools = liveToolDefs
      .filter((t) => liveToolNames.has(t.name))
      .map((t) => {
        const props = (t.parameters as any)?.properties;
        if (!props) return { type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.parameters } };
        const cleanedProps: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(props)) {
          if (!infraParams.has(k)) cleanedProps[k] = v;
        }
        return {
          type: 'function' as const,
          function: { name: t.name, description: t.description, parameters: { ...t.parameters, properties: cleanedProps } },
        };
      });

    // Live mode: NO pre-resolution. AI has tools to explore (smart_scpi_lookup,
    // get_command_group, search_scpi, retrieve_rag_chunks). Let AI drive its own searches.
    // Pre-resolution adds latency, wrong context from intent misclassification, and
    // unnecessary SCPI noise for conversational messages.

    const liveSystemWithContext = systemPrompt;
    const liveMessages: Array<Record<string, unknown>> = [
      { role: 'system', content: liveSystemWithContext },
      ...(req.history || [])
        .slice(-6)
        .map((h) => ({ role: h.role, content: String(h.content || '').slice(0, 1500) })),
      { role: 'user', content: buildOpenAiUserContent(req, userPrompt) },
    ];

    let totalLiveModelMs = 0;
    let totalLiveToolMs = 0;
    let totalLiveToolCalls = 0;
    let liveIterations = 0;
    let liveFinalText = '';
    const liveScreenshots: Array<{ base64: string; mimeType: string; capturedAt: string }> = [];

    for (let i = 0; i < _maxCalls; i += 1) {
      liveIterations = i + 1;
      const modelStart = Date.now();
      const liveRequest = {
        model,
        messages: liveMessages,
        tools: openAiTools,
        ...buildOpenAiCompletionTokenOption(model),
      };
      const liveRes = await fetch(`${openAiBase}/v1/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${req.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(liveRequest),
      });
      if (!liveRes.ok) throw new Error(`OpenAI error ${liveRes.status}: ${await liveRes.text()}`);
      const liveJson = (await liveRes.json()) as Record<string, unknown>;
      totalLiveModelMs += Date.now() - modelStart;
      const choice = Array.isArray(liveJson.choices) ? (liveJson.choices as Array<Record<string, unknown>>)[0] : null;
      const message = choice?.message as Record<string, unknown> | undefined;
      if (!message) break;

      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls as Array<Record<string, unknown>> : [];
      if (typeof message.content === 'string' && message.content) liveFinalText = message.content;

      if (toolCalls.length === 0) {
        console.log(`[MCP] OpenAI live loop done after ${liveIterations} iteration(s)`);
        break;
      }

      liveMessages.push(message);

      for (const tc of toolCalls) {
        const fn = tc.function as Record<string, unknown> | undefined;
        const toolName = String(fn?.name || '');
        const toolArgs = typeof fn?.arguments === 'string' ? JSON.parse(fn.arguments) : {};
        const toolId = String(tc.id || '');
        console.log(`[MCP] OpenAI live tool call: ${toolName}`);
        const toolStart = Date.now();
        try {
          const result = await executeHostedToolCall(req, toolName, toolArgs);
          totalLiveToolMs += Date.now() - toolStart;
          totalLiveToolCalls += 1;

          // Handle screenshot results: extract image for UI, only send to AI if analyze=true
          const imageData = extractImageFromToolResult(result, 'ui');
          const imageUrl = extractImageUrlFromToolResult(result);
          if (imageData || imageUrl) {
            const wantsAnalysis = toolArgs.analyze === true;
            console.log(`[MCP] OpenAI live screenshot: ${imageData ? imageData.base64.length : 0} b64 chars, imageUrl=${imageUrl ? 'yes' : 'no'}, analyze=${wantsAnalysis}`);
            // Always collect for UI update
            if (imageData) {
              liveScreenshots.push({ base64: imageData.base64, mimeType: imageData.mimeType, capturedAt: new Date().toISOString() });
            }
            if (wantsAnalysis) {
              const analysisImageData = extractImageFromToolResult(result, 'analysis') || imageData;
              const analysisTransportRaw = String((toolArgs as Record<string, unknown>).analysisTransport || 'auto').toLowerCase() as ScreenshotAnalysisTransport;
              const analysisTransport = analysisTransportRaw === 'claude_image'
                ? 'mcp_image'
                : analysisTransportRaw;
              const wantsUrlTransport = analysisTransport === 'auto' || analysisTransport === 'url';
              const wantsOpenAiImage = analysisTransport === 'openai_image';
              const analysisImageUrl = imageUrl || (wantsUrlTransport && analysisImageData
                ? buildVisionImageUrlForHostedLoop(
                    req,
                    analysisImageData.base64,
                    analysisImageData.mimeType,
                    new Date().toISOString(),
                  )
                : null);
              const analysisFileId = wantsOpenAiImage && analysisImageData
                ? await uploadVisionImageToOpenAiFileHosted(
                    req.apiKey,
                    analysisImageData.base64,
                    analysisImageData.mimeType,
                    new Date().toISOString(),
                  )
                : null;
              // AI wants to see the image — inject it
              if (wantsOpenAiImage && !analysisFileId) {
                liveMessages.push({
                  role: 'tool',
                  tool_call_id: toolId,
                  content: `Error: capture_screenshot requested analysisTransport=${analysisTransport}, but uploading the screenshot to OpenAI Files failed.`,
                });
                continue;
              }
              if (analysisTransport === 'url' && !analysisImageUrl) {
                liveMessages.push({
                  role: 'tool',
                  tool_call_id: toolId,
                  content: `Error: capture_screenshot requested analysisTransport=${analysisTransport}, but MCP could not create a temporary image URL.`,
                });
                continue;
              }
              if (analysisTransport === 'openai_image' && !analysisImageData) {
                liveMessages.push({
                  role: 'tool',
                  tool_call_id: toolId,
                  content: 'Error: capture_screenshot requested analysisTransport=openai_image, but no screenshot image payload was available.',
                });
                continue;
              }
              const textSummary = buildImageToolResultSummary(result);
              const resolvedTransport = wantsOpenAiImage ? 'openai_image' : analysisImageUrl ? 'url' : 'base64';
              liveMessages.push({ role: 'tool', tool_call_id: toolId, content: `${textSummary} Vision transport: ${resolvedTransport}.` });
              liveMessages.push({
                role: 'user',
                content: [
                  { type: 'text', text: 'Here is the screenshot you just captured. Describe what you see on the scope display.' },
                  ...(wantsOpenAiImage && analysisFileId
                    ? [{ type: 'image_url', image_url: { file_id: analysisFileId, detail: 'auto' } }]
                    : analysisImageUrl
                    ? [{ type: 'image_url', image_url: { url: analysisImageUrl, detail: 'auto' } }]
                    : [{ type: 'image_url', image_url: { url: `data:${analysisImageData.mimeType};base64,${analysisImageData.base64}`, detail: 'auto' } }]),
                ],
              });
            } else {
              // Capture-only — don't waste tokens sending image back
              liveMessages.push({ role: 'tool', tool_call_id: toolId, content: 'Screenshot captured and displayed to user.' });
            }
          } else {
            const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
            const truncated = resultStr.length > 8000 ? resultStr.slice(0, 8000) + '\n...(truncated)' : resultStr;
            console.log(`[MCP] OpenAI live tool result for ${toolName}: ${resultStr.slice(0, 500)}`);
            liveMessages.push({ role: 'tool', tool_call_id: toolId, content: truncated });
          }
          toolTrace.push({
            name: toolName, args: toolArgs, startedAt: new Date(toolStart).toISOString(),
            durationMs: Date.now() - toolStart, resultSummary: { ok: true, hasImage: Boolean(imageData) },
          });
        } catch (err) {
          totalLiveToolMs += Date.now() - toolStart;
          totalLiveToolCalls += 1;
          toolTrace.push({
            name: toolName, args: toolArgs, startedAt: new Date(toolStart).toISOString(),
            durationMs: Date.now() - toolStart, resultSummary: { ok: false },
          });
          liveMessages.push({ role: 'tool', tool_call_id: toolId, content: `Error: ${err instanceof Error ? err.message : String(err)}` });
        }
      }
    }

    return {
      text: liveFinalText,
      screenshots: liveScreenshots.length > 0 ? liveScreenshots : undefined,
      errors: [],
      warnings: [],
      metrics: {
        totalMs: 0, usedShortcut: false, provider: 'openai',
        iterations: liveIterations, toolCalls: totalLiveToolCalls,
        toolMs: totalLiveToolMs, modelMs: totalLiveModelMs,
        promptChars: { system: systemPrompt.length, user: userPrompt.length },
      },
      debug: {
        promptFileText: modePrompt, systemPrompt, userPrompt,
        toolDefinitions: openAiTools.map((t) => ({ name: t.function.name, description: t.function.description })),
        toolTrace, resolutionPath: 'openai:live_tool_loop',
      },
    };
  }

  console.log('[MCP] OpenAI route: direct (Chat Completions one-shot)');
  const openAiBase = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
  const model = resolveOpenAiModel(req);
  providerRequest = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildOpenAiUserContent(req, userPrompt) },
    ],
    ...buildOpenAiCompletionTokenOption(model),
  };
  const res = await fetch(`${openAiBase}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${req.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(providerRequest),
  });
  if (!res.ok) {
    throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  }
  json = (await res.json()) as Record<string, unknown>;
  content = extractChatCompletionText(json);

  return {
    text: content,
    errors: [],
    warnings: [],
    metrics: {
      totalMs: 0,
      usedShortcut: false,
      provider: 'openai',
      iterations: 1,
      toolCalls: 0,
      toolMs: 0,
      modelMs: 0,
      promptChars: {
        system: useHostedAssistant ? 0 : systemPrompt.length,
        user: useHostedAssistant ? assistantPrompt.length : userPrompt.length,
      },
    },
    debug: {
      promptFileText: modePrompt,
      systemPrompt: useHostedAssistant ? 'Hosted assistant mode (system prompt handled by assistant).' : systemPrompt,
      userPrompt: useHostedAssistant ? assistantPrompt : userPrompt,
      rawOutput: json,
      providerRequest,
      toolDefinitions: getToolDefinitions(),
      toolTrace: toolTrace || [],
    },
  };
}

/**
 * Convert OpenAI-format tool definitions to Anthropic tool_use format.
 * OpenAI uses `parameters`, Anthropic uses `input_schema`.
 */
function toAnthropicTools(
  openAiTools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>
): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
  return openAiTools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

/**
 * Select which tools to expose to Anthropic based on request context.
 * Live mode gets instrument tools; build mode gets the full catalog.
 */
function selectAnthropicTools(req: McpChatRequest): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
  const allTools = getToolDefinitions();
  const isLive = req.interactionMode === 'live';
  if (isLive) {
    // Live mode: instrument tools + search/lookup tools only (keep it lean)
    const liveToolNames = new Set([
      // Execution — direct scope actions
      'send_scpi', 'capture_screenshot', 'get_instrument_state', 'get_visa_resources',
      // Router — ALL discovery + knowledge (search auto-includes RAG)
      'tek_router',
    ]);
    const filtered = allTools.filter((t) => liveToolNames.has(t.name));
    // Strip server-injected infra params from schemas so AI only sees user-facing params
    const infraParams = new Set(['executorUrl', 'visaResource', 'backend', 'liveMode', 'outputMode', 'modelFamily', 'deviceDriver', 'scopeType']);
    const cleaned = filtered.map((t) => {
      const props = (t.parameters as any)?.properties;
      if (!props) return t;
      const cleanedProps: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) {
        if (!infraParams.has(k)) cleanedProps[k] = v;
      }
      return {
        ...t,
        parameters: {
          ...t.parameters,
          properties: cleanedProps,
        },
      };
    });
    return toAnthropicTools(cleaned);
  }
  return toAnthropicTools(allTools);
}

/**
 * Extract text content from an Anthropic Messages API response.
 */
function extractAnthropicText(content: Array<Record<string, unknown>>): string {
  return content
    .filter((c) => c.type === 'text')
    .map((c) => String(c.text || ''))
    .join('\n');
}

/**
 * Extract base64 image data from a tool result, if present.
 * Handles ToolResult shapes where data contains base64/mimeType (e.g. capture_screenshot).
 */
function extractImageFromToolResult(
  result: unknown,
  mode: 'ui' | 'analysis' = 'ui',
): { base64: string; mimeType: string } | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;

  // Check in result.data (ToolResult shape from captureScreenshotProxy)
  const data = r.data && typeof r.data === 'object' ? r.data as Record<string, unknown> : null;
  if (mode === 'analysis') {
    if (data && typeof data.analysisBase64 === 'string' && typeof data.analysisMimeType === 'string' && data.analysisBase64.length > 100) {
      return { base64: data.analysisBase64 as string, mimeType: data.analysisMimeType as string };
    }
    if (typeof r.analysisBase64 === 'string' && typeof r.analysisMimeType === 'string' && (r.analysisBase64 as string).length > 100) {
      return { base64: r.analysisBase64 as string, mimeType: r.analysisMimeType as string };
    }
  }
  if (data && typeof data.base64 === 'string' && typeof data.mimeType === 'string' && data.base64.length > 100) {
    return { base64: data.base64 as string, mimeType: data.mimeType as string };
  }

  // Check at top level (in case result itself has base64/mimeType)
  if (typeof r.base64 === 'string' && typeof r.mimeType === 'string' && (r.base64 as string).length > 100) {
    return { base64: r.base64 as string, mimeType: r.mimeType as string };
  }

  // Check for dataUrl at result.data level
  if (data && typeof data.dataUrl === 'string') {
    const parsed = splitDataUrl(data.dataUrl as string);
    if (parsed && parsed.base64.length > 100) return parsed;
  }

  return null;
}

function extractImageUrlFromToolResult(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  const data = r.data && typeof r.data === 'object' ? (r.data as Record<string, unknown>) : null;
  const candidate = typeof data?.imageUrl === 'string'
    ? data.imageUrl
    : typeof r.imageUrl === 'string'
      ? r.imageUrl
      : '';
  const trimmed = candidate.trim();
  return trimmed || null;
}

function guessImageExtensionFromMimeType(mimeType: string): string {
  const lower = String(mimeType || '').toLowerCase();
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('webp')) return 'webp';
  if (lower.includes('gif')) return 'gif';
  return 'png';
}

async function uploadVisionImageToOpenAiFileHosted(
  apiKey: string,
  base64: string,
  mimeType: string,
  capturedAt?: string,
): Promise<string | null> {
  if (!apiKey || !base64 || !String(mimeType || '').startsWith('image/')) return null;

  try {
    const fileName = `scope-${String(capturedAt || new Date().toISOString()).replace(/[:.]/g, '-')}.${guessImageExtensionFromMimeType(mimeType)}`;
    const dataUri = `data:${mimeType};base64,${base64}`;
    const res = await fetch('https://api.openai.com/v1/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: (() => {
        const form = new FormData();
        form.append('purpose', 'vision');
        form.append('file', new File([Buffer.from(base64, 'base64')], fileName, { type: mimeType }));
        return form;
      })(),
    });
    if (!res.ok) {
      console.log(`[MCP] Files upload failed (${res.status}) for screenshot vision handoff`);
      return null;
    }
    const json = await res.json() as { id?: string };
    const fileId = typeof json.id === 'string' ? json.id.trim() : '';
    if (fileId) return fileId;
    console.log(`[MCP] Files upload returned no file id; falling back to data URL (${dataUri.length} chars prepared)`);
    return null;
  } catch (err) {
    console.log(`[MCP] Files upload error for screenshot vision handoff: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

type ScreenshotAnalysisTransport = 'auto' | 'url' | 'base64' | 'mcp_image' | 'openai_image' | 'claude_image';

function buildVisionImageUrlForHostedLoop(
  req: McpChatRequest,
  base64: string,
  mimeType: string,
  capturedAt?: string,
): string | null {
  const baseUrl = String((req as unknown as Record<string, unknown>).__mcpBaseUrl || '').trim();
  if (!baseUrl || !base64 || !mimeType) return null;
  try {
    const stored = storeTempVisionImage({
      buffer: Buffer.from(base64, 'base64'),
      mimeType,
      createdAt: capturedAt,
    });
    return `${baseUrl}${stored.path}`;
  } catch (err) {
    console.log(`[MCP] Failed to create temp screenshot URL: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Build a concise text summary for an image tool result, excluding the base64 blob.
 */
function buildImageToolResultSummary(result: unknown): string {
  if (!result || typeof result !== 'object') return 'Screenshot captured.';
  const r = result as Record<string, unknown>;
  const data = r.data && typeof r.data === 'object' ? r.data as Record<string, unknown> : null;
  const parts: string[] = ['Screenshot captured successfully.'];
  const src = data || r;
  if (typeof src.scopeType === 'string') parts.push(`Scope type: ${src.scopeType}`);
  if (typeof src.sizeBytes === 'number') parts.push(`Size: ${src.sizeBytes} bytes`);
  if (typeof src.capturedAt === 'string') parts.push(`Captured at: ${src.capturedAt}`);
  if (r.ok === false) parts[0] = 'Screenshot capture had issues.';
  const warnings = Array.isArray(r.warnings) ? r.warnings.filter(Boolean) : [];
  if (warnings.length) parts.push(`Warnings: ${warnings.join(', ')}`);
  return parts.join(' ');
}

/**
 * Full Anthropic tool-calling loop with iterative tool_use / tool_result handling.
 * Matches the same contract as runOpenAiToolLoop so it can be swapped in via provider dispatch.
 */
async function runAnthropicToolLoop(
  req: McpChatRequest,
  flowCommandIssues: string[] = [],
  maxCalls = 6
): Promise<ToolLoopResult> {
  const modePrompt = getModePrompt(req);
  const isLive = req.interactionMode === 'live';

  // Live session state management
  const liveSession = isLive
    ? getOrCreateSession(
        `live-${req.provider}-${req.instrumentEndpoint?.visaResource || 'default'}`,
        req.provider,
        req.model,
        req.instrumentEndpoint ? {
          executorUrl: req.instrumentEndpoint.executorUrl,
          visaResource: req.instrumentEndpoint.visaResource,
          backend: req.instrumentEndpoint.backend,
        } : undefined
      )
    : null;

  if (liveSession) {
    incrementTurn(liveSession);
    // Periodic cleanup of stale sessions
    if (liveSession.turnCount % 20 === 0) cleanupStaleSessions();
  }

  const sessionContext = liveSession ? buildSessionContext(liveSession) : '';
  const systemPrompt = isLive
    ? buildLiveSystemPrompt(req, sessionContext)
    : buildSystemPrompt(modePrompt, req.outputMode);
  const developerContext = isLive ? '' : await buildContext(req, { compact: true });

  // Live mode: NO pre-resolution. AI has exploration tools (smart_scpi_lookup,
  // get_command_group, search_scpi, retrieve_rag_chunks). Let AI drive its own searches.
  // Pre-resolution adds latency and wrong context from intent misclassification.
  const fullSystemPrompt = developerContext
    ? `${systemPrompt}\n\n${developerContext}`
    : systemPrompt;
  const userPrompt = isLive
    ? req.userMessage
    : buildUserPrompt(req, flowCommandIssues);
  const userContent = buildAnthropicUserContent(req, userPrompt);
  const tools = selectAnthropicTools(req);
  const toolTrace: NonNullable<ToolLoopResult['debug']>['toolTrace'] = [];

  // Build conversation messages from history
  const messages: Array<Record<string, unknown>> = [
    ...(req.history || [])
      .slice(isLive ? -6 : -6)
      .map((h) => ({
        role: h.role as 'user' | 'assistant',
        content: String(h.content || '').slice(0, isLive ? 1500 : 800),
      })),
    { role: 'user', content: userContent },
  ];

  let totalModelMs = 0;
  let totalToolMs = 0;
  let totalToolCalls = 0;
  let iterations = 0;
  let finalText = '';
  const providerRequests: Record<string, unknown>[] = [];
  const anthScreenshots: Array<{ base64: string; mimeType: string; capturedAt: string }> = [];

  for (let i = 0; i < Math.max(1, maxCalls); i += 1) {
    iterations = i + 1;
    const modelStartedAt = Date.now();

    const requestPayload: Record<string, unknown> = {
      model: req.model,
      system: fullSystemPrompt,
      max_tokens: isLive ? 4096 : 4096,
      messages,
      ...(tools.length ? { tools } : {}),
      // In live mode, encourage tool use so the AI acts instead of chatting
      ...(isLive && tools.length ? { tool_choice: { type: 'auto' } } : {}),
    };
    providerRequests.push(requestPayload);

    console.log(`[MCP] Anthropic route: tool loop iteration ${iterations}/${maxCalls}, tools=${tools.length}, live=${isLive}`);
    let res: Response;
    try {
      const anthropicBase = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
      res = await fetch(`${anthropicBase}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': req.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(requestPayload),
      });
    } catch (fetchErr) {
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      console.error(`[MCP] Anthropic fetch FAILED: ${msg}`);
      throw new Error(`Anthropic API unreachable: ${msg}`);
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic error ${res.status}: ${errText}`);
    }

    const json = (await res.json()) as {
      content: Array<Record<string, unknown>>;
      stop_reason: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    totalModelMs += Date.now() - modelStartedAt;

    const content = Array.isArray(json.content) ? json.content : [];
    const textParts = extractAnthropicText(content);
    if (textParts) finalText = textParts;

    // Check for tool_use blocks
    const toolUseBlocks = content.filter((c) => c.type === 'tool_use');

    // If no tool calls or stop_reason is end_turn, we're done
    if (toolUseBlocks.length === 0 || json.stop_reason !== 'tool_use') {
      console.log(`[MCP] Anthropic loop done after ${iterations} iteration(s), ${totalToolCalls} tool call(s), stop_reason=${json.stop_reason}, text=${(finalText || '').slice(0, 80)}`);
      break;
    }
    console.log(`[MCP] Anthropic tool calls: ${toolUseBlocks.map((t) => t.name).join(', ')}`);

    // Append the assistant's full response (including tool_use blocks) to messages
    messages.push({ role: 'assistant', content });

    // Execute each tool call and build tool_result blocks
    const toolResultBlocks: Array<Record<string, unknown>> = [];
    for (const toolUse of toolUseBlocks) {
      const toolName = String(toolUse.name || '');
      const toolId = String(toolUse.id || '');
      const toolArgs = (toolUse.input && typeof toolUse.input === 'object')
        ? toolUse.input as Record<string, unknown>
        : {};

      console.log(`[MCP] Anthropic tool call: ${toolName}(${JSON.stringify(toolArgs).slice(0, 200)})`);
      const toolStartedAt = Date.now();

      try {
        const result = await executeHostedToolCall(req, toolName, toolArgs);
        const toolMs = Date.now() - toolStartedAt;
        totalToolMs += toolMs;
        totalToolCalls += 1;

        // Check if the tool result contains base64 image data (e.g. capture_screenshot)
        const imageData = extractImageFromToolResult(result);

        toolTrace.push({
          name: toolName,
          args: toolArgs,
          startedAt: new Date(toolStartedAt).toISOString(),
          durationMs: toolMs,
          resultSummary: {
            ok: typeof result === 'object' && result !== null && (result as Record<string, unknown>).ok === true,
            count: typeof result === 'object' && result !== null && Array.isArray((result as Record<string, unknown>).data)
              ? ((result as Record<string, unknown>).data as unknown[]).length
              : undefined,
            hasImage: Boolean(imageData),
          },
        });

        if (imageData) {
          const wantsAnalysis = toolArgs.analyze === true;
          console.log(`[MCP] Anthropic screenshot: ${imageData.base64.length} b64 chars, analyze=${wantsAnalysis}`);
          // Always collect for UI update
          anthScreenshots.push({ base64: imageData.base64, mimeType: imageData.mimeType, capturedAt: new Date().toISOString() });
          if (wantsAnalysis) {
            // AI wants to analyze — send image block
            const textSummary = buildImageToolResultSummary(result);
            toolResultBlocks.push({
              type: 'tool_result',
              tool_use_id: toolId,
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: imageData.mimeType,
                    data: imageData.base64,
                  },
                },
                { type: 'text', text: textSummary },
              ],
            });
          } else {
            // Capture-only — don't waste tokens sending image back
            toolResultBlocks.push({
              type: 'tool_result',
              tool_use_id: toolId,
              content: 'Screenshot captured and displayed to user.',
            });
          }
        } else {
          // Only stringify non-image results (avoids serializing large base64 blobs)
          const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
          // Truncate large results to keep context manageable
          const truncatedResult = resultStr.length > 8000 ? resultStr.slice(0, 8000) + '\n... (truncated)' : resultStr;
          // Log what the AI will see so we can debug blind tool calls
          console.log(`[MCP] Anthropic tool result for ${toolName}: ${resultStr.slice(0, 500)}`);
          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: toolId,
            content: truncatedResult,
          });
        }

        // Record in live session for context persistence
        if (liveSession) {
          const sessionSummary = imageData
            ? 'Screenshot captured (image attached)'
            : (typeof result === 'string' ? result : JSON.stringify(result)).slice(0, 300);
          recordToolResult(liveSession, toolName, toolArgs, sessionSummary);
        }
      } catch (err) {
        const toolMs = Date.now() - toolStartedAt;
        totalToolMs += toolMs;
        totalToolCalls += 1;
        const errorMsg = err instanceof Error ? err.message : String(err);

        toolTrace.push({
          name: toolName,
          args: toolArgs,
          startedAt: new Date(toolStartedAt).toISOString(),
          durationMs: toolMs,
          resultSummary: { ok: false },
        });

        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: toolId,
          is_error: true,
          content: `Tool error: ${errorMsg}`,
        });
      }
    }

    // Append tool results as a user message (Anthropic's tool_result format)
    messages.push({ role: 'user', content: toolResultBlocks });
  }

  // Update live session diagnostics
  if (liveSession) {
    const historyChars = messages.reduce((sum, m) => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return sum + content.length;
    }, 0);
    const toolResultChars = toolTrace.reduce((sum, t) => {
      return sum + (t.resultSummary ? JSON.stringify(t.resultSummary).length : 0);
    }, 0);
    updateContextDiagnostics(liveSession, {
      systemPromptChars: fullSystemPrompt.length,
      historyChars,
      toolResultChars,
    });
  }

  if (!finalText) {
    finalText = 'No response was generated. The model may have only made tool calls without producing a final answer. Please try again.';
  }

  return {
    text: finalText,
    screenshots: anthScreenshots.length > 0 ? anthScreenshots : undefined,
    errors: [],
    warnings: [],
    metrics: {
      totalMs: 0,
      usedShortcut: false,
      provider: 'anthropic',
      iterations,
      toolCalls: totalToolCalls,
      toolMs: totalToolMs,
      modelMs: totalModelMs,
      promptChars: {
        system: fullSystemPrompt.length,
        user: userPrompt.length,
      },
    },
    debug: {
      promptFileText: modePrompt,
      systemPrompt: fullSystemPrompt,
      userPrompt,
      providerRequest: providerRequests.length <= 1 ? providerRequests[0] : { requests: providerRequests },
      toolDefinitions: tools.map((t) => ({ name: t.name, description: t.description })),
      toolTrace,
      resolutionPath: isLive ? 'anthropic:live_tool_loop' : 'anthropic:tool_loop',
    },
  };
}

/**
 * Build a lightweight system prompt for Live copilot mode.
 * Keeps context minimal — AI pulls what it needs via tools.
 */
function buildLiveSystemPrompt(req: McpChatRequest, sessionContext?: string): string {
  const instrumentLines: string[] = [];
  if (req.instrumentEndpoint) {
    instrumentLines.push(`- Endpoint: ${req.instrumentEndpoint.executorUrl}`);
    instrumentLines.push(`- VISA: ${req.instrumentEndpoint.visaResource}`);
    instrumentLines.push(`- Backend: ${req.instrumentEndpoint.backend}`);
  }
  if (req.flowContext.modelFamily) {
    instrumentLines.push(`- Model family: ${req.flowContext.modelFamily}`);
  }
  if (req.flowContext.deviceDriver) {
    instrumentLines.push(`- Device driver: ${req.flowContext.deviceDriver}`);
  }
  if (sessionContext) {
    instrumentLines.push('', sessionContext);
  }

  return [
    '# TekAutomate Live Copilot — System Prompt',
    '',
    'You are a senior Tektronix oscilloscope engineer with direct MCP access',
    'to a live instrument. You think like an engineer, act like an automation',
    'system, and communicate like a colleague.',
    '',
    '---',
    '',
    '## 1. Your Job',
    '',
    'The user tells you what they want to achieve with the scope. You figure',
    'out the full sequence of actions needed, execute them, verify each one',
    'worked, and report the outcome. You are not a chatbot that explains',
    'commands — you are a hands-on engineer who does the work.',
    '',
    'Execute commands silently. When reporting results or answering questions',
    'about the display, think like an engineer: interpret what the data means,',
    'not just what labels you see. Explain significance briefly. Never just',
    'list raw values like a parser.',
    '',
    '---',
    '',
    '## 2. How You Think',
    '',
    'Before acting, silently decompose the objective:',
    '',
    '```',
    'OBJECTIVE: [what the user wants]',
    'STEPS:',
    '  1. [first thing to configure/query]',
    '  2. [next thing]',
    '  ...',
    '  N. [verify + screenshot]',
    '```',
    '',
    'Then execute the full plan. Do not stop between steps to ask permission',
    'unless a required value is genuinely ambiguous and has no safe default.',
    '',
    '---',
    '',
    '## 3. SCPI Command Landscape',
    '',
    'You have access to ~3000 SCPI commands organized into the groups below.',
    'This map is your TABLE OF CONTENTS — it tells you what command groups',
    'exist and what capabilities are available. It does NOT contain exact',
    'syntax — always use MCP lookup tools for exact headers, arguments, and',
    'valid values.',
    '',
    '**WORKFLOW — aim for 2 calls max:**',
    'Fast path: `search_scpi`/browse → `send_scpi` → query-back verify',
    'Full path: `search_scpi` → `get_command_by_header` → `send_scpi`',
    'Build path: `tek_router build` → `send_scpi`',
    'Skip `get_command_by_header` when enriched search already shows valid values.',
    '',
    '**TOKEN AWARENESS:**',
    '- Search results are compact and cheap',
    '- Use short queries and `offset` for paging',
    '- Prefer `analyze:false` for confirmation screenshots',
    '',
    '### Command Groups (use `tek_router` to browse/search any group)',
    'Acquisition, Bus, Callout, Cursor, Digital, Display, DVM, Histogram,',
    'Horizontal, Mask, Math, Measurement, Miscellaneous, Plot, Power,',
    'Save and Recall, Save on, Search and Mark, Spectrum view, Trigger,',
    'Vertical, Waveform Transfer, Zoom, Act On Event, AFG, Calibration,',
    'Ethernet, File System, History, Self Test',
    '',
    '### Gotchas — things the model gets wrong without hints',
    '- Trigger level is NOT under EDGE',
    '- Tables vs Objects — closing a table is not deleting the object',
    '- Object lifecycle follows ADDNew/DELete/LIST patterns',
    '- Display visibility uses global per-object state commands',
    '- Measurements have quick-add vs full-add paths',
    '- Waveform transfer requires source/start-stop/encoding/preamble',
    '- System commands include `*IDN?`, `*RST`, `*CLS`, `*ESR?`, `ALLEV?`, `LICense:LIST?`',
    '',
    '### IMPORTANT: Always use MCP lookup for exact syntax',
    'For exact headers, arguments, valid values, and command type',
    '(set/query/both), always use MCP lookup before execution.',
    '',
    '---',
    '',
    '## 3b. SCPI Command Types & Synchronization',
    '- Set only → write then verify indirectly',
    '- Query only → read with `?`',
    '- Set and Query → write then query back',
    '- Use OPC only for long-running commands that actually generate it',
    '- If a command times out, diagnose before retrying',
    '',
    '---',
    '',
    '## 4. How You Act',
    'LOOKUP → EXECUTE → VERIFY → ASSESS',
    'Chain multiple actions in a single turn.',
    'After any display-affecting write, query back when possible and confirm.',
    '',
    '### Final Screenshot',
    '- Default: `capture_screenshot` with `analyze:false` to update the user UI',
    '- Use `analyze:true` only when you need to inspect the screen yourself',
    '- When you receive a screenshot with `analyze:true`, use native vision directly',
    '- Do NOT use Code Interpreter or Python to decode screenshots',
    '',
    '---',
    '',
    '## 5. Tool Selection (in order of preference)',
    '- Know exact SCPI header → `get_command_by_header`',
    '- Feature/keyword lookup → `search_scpi`',
    '- Browse a command group → `browse_scpi_commands`',
    '- Validate before execution → `verify_scpi_commands`',
    '- Execute on live scope → `send_scpi`',
    '- See the screen → `capture_screenshot`',
    '- Scope identity / connection → `get_instrument_info`',
    '- Broad discovery (last resort) → `discover_scpi`',
    '',
    '## 5b. Code Interpreter Use Policy',
    'Do not use Code Interpreter for ordinary instrument control, SCPI lookup,',
    'readbacks, screenshots, or simple text answers.',
    'Use native vision for screenshots. Only use Python for true computation,',
    'plotting, transforms, or numerical analysis.',
    '',
    '---',
    '',
    '## 6. Session Start',
    'At session start or when asked to check the instrument:',
    '1. Call `get_instrument_info`',
    '2. Use that result directly — do not send a separate `*IDN?` just to identify the scope',
    '',
    '## 7. Diagnostic Mode',
    'Observe, measure, diagnose, fix, and verify. Do not theorize first.',
    '',
    '## 8. Self-Verification',
    'If you can query or measure it yourself, do that instead of asking the user.',
    '',
    '## 9. Decision Speed',
    'Pick the simplest approach that gives actionable data. Three fast tries beats one perfect plan.',
    '',
    '## 10. Reading the Scope',
    'Interpret screenshots like an engineer and explain what the observations imply.',
    '',
    '## 11. Autonomy Rules',
    'Act autonomously for readbacks, setup, measurements, trigger config, decode config, screenshots, swaps, and measurements.',
    'Ask first only for destructive actions or truly ambiguous required inputs.',
    '',
    '## 12. Failure Handling',
    'Try one alternate approach before asking the user for help. Do not loop on the same failing pattern.',
    '',
    '## 13. Multi-Step Objective Examples',
    'Execute and verify end-to-end for setup, fix, diagnose, continue, and cleanup requests.',
    '',
    '## 14. Response Style',
    '- Lead with what you DID',
    '- Summarize tool results, never dump raw output',
    '- Keep it brief unless the user wants depth',
    '- Do not narrate internal tool selection',
    '- Do not say "done" unless verification confirms it',
    '',
    instrumentLines.length > 0 ? '## Runtime Context' : '',
    ...instrumentLines,
  ].filter(Boolean).join('\n');
}

export async function runToolLoop(req: McpChatRequest): Promise<ToolLoopResult> {
  const startedAt = Date.now();
  console.log(
    `[MCP] runToolLoop: mode=${req.mode} interactionMode=${req.interactionMode} outputMode=${req.outputMode} provider=${req.provider} hasKey=${String((req as { apiKey?: string }).apiKey || '').trim().length > 0} msgLen=${String(req.userMessage || '').length}`
  );
  if (typeof req.userMessage === 'string' && /\btm_device\b/i.test(req.userMessage)) {
    req.userMessage = req.userMessage.replace(/\btm_device\b/gi, 'tm_devices');
  }
  if (
    req.outputMode === 'steps_json' &&
    /\b(?:use|using|with|convert(?:ed)? to|switch to|do .* with)\s+tm_devices\b/i.test(String(req.userMessage || ''))
  ) {
    req.flowContext.backend = 'tm_devices';
  }
  if (req.outputMode === 'steps_json' && hasBuildBrief(req)) {
    const briefQuery = buildQueryFromStructuredBrief(req.buildBrief);
    const originalMessage = String(req.userMessage || '').trim();
    // When the request comes from a chat→build handoff, the original userMessage
    // contains rich context from buildPromptFromRecentChat (chat transcript,
    // focus hints, secondary evidence). Preserve it and append the structured
    // brief query so the planner/router has both the conversational context AND
    // the structured brief to work with.
    const hasHandoffContext = originalMessage.length > briefQuery.length + 50 &&
      /chat transcript|secondary evidence|structured.*brief/i.test(originalMessage);
    if (hasHandoffContext) {
      req.userMessage = originalMessage + '\n\nStructured brief summary:\n' + briefQuery;
    } else {
      req.userMessage = briefQuery;
    }
    if (req.mode === 'mcp_ai') {
      req.routerOnly = true;
      req.routerPreferred = true;
    }
  }
  if (
    String(req.flowContext?.backend || '').toLowerCase() === 'tm_devices' &&
    isBackendConversionRequest(req.userMessage) &&
    Array.isArray(req.flowContext?.steps) &&
    req.flowContext.steps.length > 0
  ) {
    const convertedSteps = await convertStepsToTmDevices(
      req.flowContext.steps as Array<Record<string, unknown>>,
      req.flowContext?.deviceDriver || req.flowContext?.modelFamily || 'MSO6B'
    );
    return buildShortcutResponse({
      summary: `Converted ${convertedSteps.length} steps to tm_devices without a model call.`,
      steps: convertedSteps,
      req,
      startedAt,
    });
  }
  const rawApiKey = String((req as { apiKey?: string }).apiKey || '').trim();
  const mcpOnlyMode =
    req.mode === 'mcp_only' ||
    rawApiKey.length === 0 ||
    rawApiKey === '__mcp_only__' ||
    rawApiKey.toLowerCase() === 'undefined';
  if (req.outputMode === 'chat' && req.interactionMode !== 'live') {
    if (mcpOnlyMode) {
      const text = 'Chat mode needs MCP+AI with a provider model and API key. Switch to MCP+AI, or use Build mode for deterministic planner output.';
      return {
        text,
        displayText: text,
        assistantThreadId: undefined,
        errors: [],
        warnings: [],
        metrics: {
          totalMs: Date.now() - startedAt,
          usedShortcut: true,
          provider: req.provider,
          iterations: 0,
          toolCalls: 0,
          toolMs: 0,
          modelMs: 0,
          promptChars: { system: 0, user: 0 },
        },
        debug: {
          toolTrace: [],
          resolutionPath: 'chat:requires_ai',
        },
      };
    }
    const chatResult = await runChatConversation(req);
    return {
      text: chatResult.text,
      displayText: chatResult.text,
      assistantThreadId: chatResult.assistantThreadId,
      errors: [],
      warnings: [],
      metrics: {
        ...chatResult.metrics,
        totalMs: Date.now() - startedAt,
      },
      debug: chatResult.debug,
    };
  }

  // Live mode: pure conversation + MCP tools, no planner/intent coercion
  if (req.interactionMode === 'live') {
    if (mcpOnlyMode) {
      const text = 'Live mode needs MCP+AI with a provider model and API key.';
      return {
        text,
        displayText: text,
        assistantThreadId: undefined,
        errors: [],
        warnings: [],
        metrics: {
          totalMs: Date.now() - startedAt,
          usedShortcut: true,
          provider: req.provider,
          iterations: 0,
          toolCalls: 0,
          toolMs: 0,
          modelMs: 0,
          promptChars: { system: 0, user: 0 },
        },
        debug: {
          toolTrace: [],
          resolutionPath: 'live:requires_ai',
        },
      };
    }
    console.log(`[MCP] Live mode: routing to ${req.provider} tool loop`);
    const liveMaxRounds = 15; // Live = learn mode: explore, try, observe, adjust, succeed
    const liveResult = req.provider === 'anthropic'
      ? await runAnthropicToolLoop(req, [], liveMaxRounds)
      : await runOpenAiToolLoop(req, [], liveMaxRounds);
    return {
      text: liveResult.text,
      displayText: liveResult.displayText || liveResult.text,
      assistantThreadId: liveResult.assistantThreadId,
      screenshots: (liveResult as any).screenshots,
      errors: [],
      warnings: [],
      metrics: {
        ...liveResult.metrics,
        totalMs: Date.now() - startedAt,
      },
      debug: liveResult.debug,
    };
  }

  const explainOnlyMode = isExplainOnlyCommandAsk(req);
  const forceToolCallMode = cleanRouter.getToolCallMode(req);
  const routeSummary = cleanRouter.getRouteSummary(req);
  console.log(routeSummary);
  const buildHeavyMode = isFlowBuildIntentMessage(req.userMessage);
  const normalizedModelFamily = normalizeScopeModelFamily(req);
  if (normalizedModelFamily && normalizedModelFamily !== req.flowContext.modelFamily) {
    req.flowContext.modelFamily = normalizedModelFamily;
  }
  console.log('[DEBUG] deviceType:', req.flowContext.deviceType || 'SCOPE');
  console.log('[DEBUG] toolCallMode:', forceToolCallMode);
  const directExec = forceToolCallMode ? null : detectDirectExecution(req);
  if (directExec) {
    if (hasLiveInstrumentAccess(req) && req.instrumentEndpoint) {
      const result = await probeCommandProxy(req.instrumentEndpoint, directExec.command);
      const responseText =
        result.ok && result.data && typeof result.data === 'object' && typeof result.data.response === 'string'
          ? result.data.response
          : '';
      const resultData =
        result.data && typeof result.data === 'object' ? (result.data as Record<string, unknown>) : {};
      const outputMode = req.instrumentEndpoint.outputMode === 'clean' ? 'clean' : 'verbose';
      const finalText = formatVerboseProbeResult(directExec.command, {
        ...resultData,
        response: responseText,
        decodedStatus: Array.isArray(resultData.decodedStatus)
          ? resultData.decodedStatus
          : decodeCommandStatus(directExec.command, responseText),
      }, outputMode);
      return {
        text: finalText,
        displayText: finalText,
        assistantThreadId: resolveOpenAiResponseCursor(req) || undefined,
        errors: result.ok ? [] : ['Live instrument execution failed'],
        warnings: result.warnings || [],
        metrics: {
          totalMs: Date.now() - startedAt,
          usedShortcut: true,
          provider: req.provider,
          iterations: 0,
          toolCalls: 1,
          toolMs: Date.now() - startedAt,
          modelMs: 0,
          promptChars: { system: 0, user: 0 },
        },
        debug: {
          shortcutResponse: finalText,
          toolTrace: [],
        },
      };
    }

    const step =
      directExec.type === 'query' || directExec.type === 'error_check'
        ? {
            id: '2',
            type: 'query',
            label: directExec.command,
            params: { command: directExec.command, saveAs: 'result' },
          }
        : {
            id: '2',
            type: 'write',
            label: directExec.command,
            params: { command: directExec.command },
          };

    return buildShortcutResponse({
      summary: `Execute ${directExec.command}`,
      steps: [
        { id: '1', type: 'connect', label: 'Connect', params: { printIdn: true } },
        step,
        { id: '3', type: 'disconnect', label: 'Disconnect', params: {} },
      ],
      req,
      startedAt,
    });
  }

  if (!forceToolCallMode && shouldAskScopePlatform(req)) {
    const text =
      'Need your scope platform to choose the right command family. Are you on DPO 5k/7k/70k, or newer MSO series (2/4/5/6/7)?';
    return {
      text,
      displayText: text,
      assistantThreadId: resolveOpenAiResponseCursor(req) || undefined,
      errors: [],
      warnings: [],
      metrics: {
        totalMs: Date.now() - startedAt,
        usedShortcut: true,
        provider: req.provider,
        iterations: 0,
        toolCalls: 0,
        toolMs: 0,
        modelMs: 0,
        promptChars: { system: 0, user: 0 },
      },
      debug: {
        shortcutResponse: text,
        toolTrace: [],
      },
    };
  }
  const allowMissingActionsJson = explainOnlyMode;
  const flowValidateMode = isFlowValidationRequest(req);
  const flowCommandIssues = flowValidateMode
    ? await detectFlowCommandIssues(req)
    : [];
  if (flowValidateMode && req.mode === 'mcp_only' && flowCommandIssues.length > 0) {
    const text =
      `Found ${flowCommandIssues.length} flow command issue(s).\n` +
      `ACTIONS_JSON: ${JSON.stringify({
        summary: 'Flow has command verification issues.',
        findings: flowCommandIssues,
        suggestedFixes: [
          'Fix unverified command headers and invalid argument values, then run Validate Flow again.',
        ],
        actions: [],
      })}`;
    return {
      text,
      displayText: text,
      assistantThreadId: resolveOpenAiResponseCursor(req) || undefined,
      errors: [],
      warnings: [],
      metrics: {
        totalMs: Date.now() - startedAt,
        usedShortcut: false,
        provider: req.provider,
        iterations: 0,
        toolCalls: 1,
        toolMs: 0,
        modelMs: 0,
        promptChars: { system: 0, user: 0 },
      },
      debug: {
        toolDefinitions: [],
        toolTrace: [{
          name: 'detectFlowCommandIssues',
          args: {},
          startedAt: new Date().toISOString(),
          resultSummary: { count: flowCommandIssues.length, ok: true }
        }],
      },
    };
  }
  const reasoningMode = isReasoningRequest(req.userMessage);
  const followUpCorrectionMode = isFollowUpCorrectionRequest(req);
  const routeDecision = cleanRouter.makeRouteDecision(req);
  // Don't allow shortcuts when router determines tool calls are needed
  const allowDeterministicShortcut = false;
  const allowPlannerShortcut = !mcpOnlyMode && !explainOnlyMode && !followUpCorrectionMode;
  const allowLegacyDeterministicShortcuts = false;
  const commonServerShortcut =
    !allowLegacyDeterministicShortcuts ||
    !allowDeterministicShortcut ||
    explainOnlyMode ||
    (reasoningMode && !buildHeavyMode) ||
    followUpCorrectionMode ||
    forceToolCallMode
      ? null
      : await buildPyvisaCommonServerShortcut(req);
  const fastFrameShortcut =
    !allowLegacyDeterministicShortcuts ||
    !allowDeterministicShortcut ||
    explainOnlyMode ||
    (reasoningMode && !buildHeavyMode) ||
    followUpCorrectionMode ||
    forceToolCallMode
      ? null
      : buildPyvisaFastFrameShortcut(req);
  const measurementShortcut =
    !allowLegacyDeterministicShortcuts ||
    !allowDeterministicShortcut ||
    explainOnlyMode ||
    (reasoningMode && !buildHeavyMode) ||
    followUpCorrectionMode ||
    forceToolCallMode
      ? null
      : await buildPyvisaMeasurementShortcut(req);
  const shortcut = explainOnlyMode
    ? null
    : (
        commonServerShortcut ||
        fastFrameShortcut ||
        measurementShortcut ||
        (
          !allowLegacyDeterministicShortcuts ||
          !allowDeterministicShortcut ||
          (reasoningMode && !buildHeavyMode) ||
          followUpCorrectionMode ||
          forceToolCallMode
            ? null
            : buildTmDevicesMeasurementShortcut(req)
        )
      );
  const shouldUseShortcut = explainOnlyMode
    ? false
    : (
        allowDeterministicShortcut &&
        (!reasoningMode || buildHeavyMode) &&
        !followUpCorrectionMode &&
        !forceToolCallMode &&
        (
          Boolean(commonServerShortcut) ||
          Boolean(fastFrameShortcut) ||
          shouldAttemptShortcutFirst(req) ||
          (Boolean(shortcut) && isHostedStructuredBuildRequest(req))
        )
      );
  if (!explainOnlyMode && shortcut && shouldUseShortcut) {
    const checked = await postCheckResponse(shortcut, {
      backend: req.flowContext.backend,
      modelFamily: req.flowContext.modelFamily,
      originalSteps: req.flowContext.steps,
      scpiContext: req.scpiContext as Array<Record<string, unknown>>,
      alias: req.flowContext.alias,
      instrumentMap: req.flowContext.instrumentMap as Array<Record<string, unknown>> | undefined,
    }, { allowMissingActionsJson });
    return {
      text: checked.text,
      displayText: shortcut,
      assistantThreadId: resolveOpenAiResponseCursor(req) || undefined,
      errors: checked.errors,
      warnings: checked.warnings,
      metrics: {
        totalMs: Date.now() - startedAt,
        usedShortcut: true,
        provider: req.provider,
        iterations: 0,
        toolCalls: 0,
        toolMs: 0,
        modelMs: 0,
        promptChars: {
          system: 0,
          user: 0,
        },
      },
      debug: {
        shortcutResponse: shortcut,
        toolTrace: [],
      },
    };
  }

  let plannerShortcut: string | null = null;
  let plannerOutputCache: PlannerOutput | null = null;
  if (!mcpOnlyMode && !explainOnlyMode) {
    // Use clean planner instead of flawed planner
    const cleanPlan = await cleanPlanner.createPlan(req);
    
    console.log(
      '[CLEAN_PLANNER] intent:',
      cleanPlan.intent,
      'confidence:',
      cleanPlan.confidence,
      'commands:',
      cleanPlan.commands.length,
      'additions:',
      cleanPlan.additions.length,
      'changes:',
      cleanPlan.changes.length
    );
    
    // If clean planner delegated to Smart SCPI Assistant, don't create shortcut
    if (cleanPlan.intent === 'scpi_command' && cleanPlan.reasoning.includes('Delegated to Smart SCPI Assistant')) {
      console.log('[CLEAN_PLANNER] Delegated to Smart SCPI Assistant - no shortcut');
    } else if (cleanPlan.confidence > 0.5 && (cleanPlan.commands.length > 0 || cleanPlan.additions.length > 0)) {
      // Create shortcut from clean plan
      plannerShortcut = buildShortcutFromCleanPlan(cleanPlan, req);
    }
  }
  if (allowPlannerShortcut && plannerShortcut) {
    const checked = await postCheckResponse(plannerShortcut, {
      backend: req.flowContext.backend,
      modelFamily: req.flowContext.modelFamily,
      originalSteps: req.flowContext.steps,
      scpiContext: req.scpiContext as Array<Record<string, unknown>>,
      alias: req.flowContext.alias,
      instrumentMap: req.flowContext.instrumentMap as Array<Record<string, unknown>> | undefined,
    }, { allowMissingActionsJson });
    return {
      text: checked.text,
      displayText: plannerShortcut,
      assistantThreadId: resolveOpenAiResponseCursor(req) || undefined,
      errors: checked.errors,
      warnings: checked.warnings,
      metrics: {
        totalMs: Date.now() - startedAt,
        usedShortcut: true,
        provider: req.provider,
        iterations: 0,
        toolCalls: 0,
        toolMs: 0,
        modelMs: 0,
        promptChars: {
          system: 0,
          user: 0,
        },
      },
        debug: {
          shortcutResponse: plannerShortcut,
          toolTrace: [],
          resolutionPath: 'shortcut:planner',
        },
      };
  }

  // MCP-only mode is deterministic/local by design:
  // never call external model providers from here.
  if (mcpOnlyMode) {
    const mcpMsg = req.userMessage.toLowerCase().trim();

    // Check for image-only messages in MCP mode — can't process images without AI
    const hasImages = Array.isArray(req.attachments) && req.attachments.some(
      (f: any) => String(f?.mimeType || '').startsWith('image/')
    );
    const hasTextAttachments = Array.isArray(req.attachments) && req.attachments.some(
      (f: any) => String(f?.textExcerpt || '').trim().length > 0
    );
    if (hasImages && !hasTextAttachments && (!mcpMsg || mcpMsg === 'use attached files as context.')) {
      return {
        text: 'MCP mode cannot analyze images — it uses deterministic SCPI lookup without AI vision. Switch to **AI mode** to have the AI analyze your screenshot or image.\n\nIf your image contains SCPI commands or text, paste the text directly instead.',
        assistantThreadId: undefined,
        errors: [],
        warnings: ['Image attachments require AI mode'],
        metrics: { totalMs: Date.now() - startedAt, usedShortcut: false, iterations: 0, toolCalls: 0, toolMs: 0, modelMs: 0, promptChars: { system: 0, user: 0 } },
        debug: { toolTrace: [], resolutionPath: 'deterministic:image_not_supported' }
      };
    }

    // Priority intents — check BEFORE smart_scpi delegation
    if (cleanRouter.isValidationIntent(mcpMsg)) {
      console.log('[MCP_ONLY] Validation intent detected');
      return await runFlowValidation(req);
    }
    if (cleanRouter.isQuestionIntent(mcpMsg)) {
      console.log('[MCP_ONLY] Question intent detected');
      return await runQuestionLookup(req);
    }
    const browseIntent = cleanRouter.isBrowseIntent(mcpMsg);
    if (browseIntent.isBrowse) {
      console.log('[MCP_ONLY] Browse intent detected');
      return await runBrowseCommands(req, browseIntent.group, browseIntent.filter);
    }
    if (cleanRouter.isKnowledgeSearchIntent(mcpMsg)) {
      console.log('[MCP_ONLY] Knowledge search intent detected');
      return await runSearchKnowledge(req);
    }

    // Check if clean router wants to use Smart SCPI Assistant
    if (routeDecision.route === 'smart_scpi') {
      console.log('[MCP_ONLY] Router wants Smart SCPI Assistant - delegating to Smart SCPI');
      const scpiResult = await runSmartScpiAssistant(req);
      // Enrich with RAG context (non-fatal)
      return await enrichWithRag(scpiResult, req.userMessage, req.flowContext?.modelFamily);
    } else if (routeDecision.forceToolCall) {
      console.log('[MCP_ONLY] Router wants tool calls - going to tool loop');
      // Continue to tool loop below
    } else {
      if (explainOnlyMode) {
        const explainApply = await buildMcpOnlyExplainApplyResponse(req);
        if (explainApply) {
          const checked = await postCheckResponse(explainApply, {
            backend: req.flowContext.backend,
            modelFamily: req.flowContext.modelFamily,
            originalSteps: req.flowContext.steps,
            scpiContext: req.scpiContext as Array<Record<string, unknown>>,
            alias: req.flowContext.alias,
            instrumentMap: req.flowContext.instrumentMap as Array<Record<string, unknown>> | undefined,
          }, { allowMissingActionsJson: false });
          return {
            text: checked.text,
            displayText: checked.text,
            assistantThreadId: resolveOpenAiResponseCursor(req) || undefined,
            errors: checked.errors,
            warnings: checked.warnings,
            metrics: {
              totalMs: Date.now() - startedAt,
              usedShortcut: true,
              provider: req.provider,
              iterations: 0,
              toolCalls: 0,
              toolMs: 0,
              modelMs: 0,
              promptChars: {
                system: 0,
                user: 0,
              },
            },
          debug: {
            shortcutResponse: checked.text,
            toolTrace: [],
            resolutionPath: 'shortcut:explain_apply',
          },
          };
        }
      }

      const buildResult = await executeBuild({
        query: req.userMessage,
        context: {
          backend: req.flowContext.backend,
          deviceType: req.flowContext.deviceType,
          modelFamily: req.flowContext.modelFamily,
          steps: req.flowContext.steps,
          selectedStepId: req.flowContext.selectedStepId || undefined,
          alias: req.flowContext.alias,
          instrumentMap: req.flowContext.instrumentMap as Array<Record<string, unknown>> | undefined,
        },
        buildNew:
          typeof req.buildNew === 'boolean'
            ? req.buildNew
            : Array.isArray(req.flowContext.steps)
              ? req.flowContext.steps.length === 0
              : true,
        instrumentId: req.flowContext.alias || undefined,
      });
    const buildData =
      buildResult.data && typeof buildResult.data === 'object'
        ? (buildResult.data as Record<string, unknown>)
        : {};
    const buildMode = String(buildData.mode || 'action');
    const providerMatch =
      buildData.providerMatch && typeof buildData.providerMatch === 'object'
        ? (buildData.providerMatch as Record<string, unknown>)
        : null;
    const providerApplied = providerMatch?.applied === true;
    const buildWarnings = Array.isArray(buildResult.warnings) ? buildResult.warnings : [];
    const buildErrors =
      buildResult.ok === false && buildResult.error
        ? [String(buildResult.error)]
        : [];

    return {
      text: buildResult.text || '',
      displayText: buildResult.text || '',
      assistantThreadId: resolveOpenAiResponseCursor(req) || undefined,
      errors: buildErrors,
      warnings: buildWarnings,
      metrics: {
        totalMs: Date.now() - startedAt,
        usedShortcut: buildMode === 'action',
        provider: req.provider,
        iterations: 0,
        toolCalls: 0,
        toolMs: 0,
        modelMs: 0,
        promptChars: {
          system: 0,
          user: 0,
        },
      },
      debug: {
        toolTrace: [],
        resolutionPath:
          providerApplied
            ? 'build:provider_supplement'
            : buildMode === 'action'
              ? 'build:action'
              : buildMode === 'info_fallback'
                ? 'build:info_fallback'
                : 'build:info',
        ...(providerMatch ? { providerMatch } : {}),
      },
    };
    }
  }
  if (flowValidateMode && req.mode === 'mcp_only' && flowCommandIssues.length === 0) {
    const flatSteps = flattenSteps(Array.isArray(req.flowContext.steps) ? req.flowContext.steps : []);
    const firstType = flatSteps.length ? String(flatSteps[0].type || '').toLowerCase() : '';
    const lastType = flatSteps.length ? String(flatSteps[flatSteps.length - 1].type || '').toLowerCase() : '';
    const findings: string[] = [];
    if (flatSteps.length && firstType !== 'connect') {
      findings.push('Flow does not start with connect.');
    }
    if (flatSteps.length && lastType !== 'disconnect') {
      findings.push('Flow does not end with disconnect.');
    }
    const text =
      `Flow verification passed: ${flatSteps.length} step(s) checked, 0 SCPI/header issues found.\n` +
      `ACTIONS_JSON: ${JSON.stringify({
        summary: 'Flow commands verified against command index.',
        findings,
        suggestedFixes: findings.length
          ? ['Keep connect as first step and disconnect as last step for full-run flows.']
          : [],
        actions: [],
      })}`;
    return {
      text,
      displayText: text,
      assistantThreadId: resolveOpenAiResponseCursor(req) || undefined,
      errors: [],
      warnings: [],
      metrics: {
        totalMs: Date.now() - startedAt,
        usedShortcut: true,
        provider: req.provider,
        iterations: 0,
        toolCalls: 1,
        toolMs: 0,
        modelMs: 0,
        promptChars: { system: 0, user: 0 },
      },
      debug: {
        shortcutResponse: text,
        toolTrace: [
          {
            name: 'detectFlowCommandIssues',
            tool: 'detectFlowCommandIssues',
            args: {},
            startedAt: new Date().toISOString(),
            result: { count: 0, issues: [] },
          },
        ],
        resolutionPath: 'flow_validate',
      },
    };
  }

  // Check if router wants Smart SCPI Assistant (MCP-only mode only)
  // In MCP+AI mode, let the AI tool loop handle it to avoid breaking tool call chain
  if (routeDecision.route === 'smart_scpi' && mcpOnlyMode && !explainOnlyMode && !flowValidateMode) {
    console.log('[ROUTER] Smart SCPI Assistant requested (MCP-only) - delegating');
    return await runSmartScpiAssistant(req);
  }

  const routerFirstAiMode =
    !mcpOnlyMode &&
    !explainOnlyMode &&
    !flowValidateMode &&
    req.mode === 'mcp_ai';
  const hostedBuildResult = routerFirstAiMode
    ? await executeBuild({
        query: req.userMessage,
        context: {
          backend: req.flowContext.backend,
          deviceType: req.flowContext.deviceType,
          modelFamily: req.flowContext.modelFamily,
          steps: req.flowContext.steps,
          selectedStepId: req.flowContext.selectedStepId || undefined,
          alias: req.flowContext.alias,
          instrumentMap: req.flowContext.instrumentMap as Array<Record<string, unknown>> | undefined,
        },
        buildNew:
          typeof req.buildNew === 'boolean'
            ? req.buildNew
            : Array.isArray(req.flowContext.steps)
              ? req.flowContext.steps.length === 0
              : true,
        instrumentId: req.flowContext.alias || undefined,
      })
    : null;
  const hostedBuildData =
    hostedBuildResult?.data && typeof hostedBuildResult.data === 'object'
      ? (hostedBuildResult.data as Record<string, unknown>)
      : {};
  const hostedBuildMode = String(hostedBuildData.mode || 'action');
  const hostedBuildIsDirectEdit =
    routerFirstAiMode &&
    hostedBuildMode === 'action' &&
    Boolean(hostedBuildResult?.text) &&
    (Boolean(hostedBuildData.edited) ||
      Boolean(hostedBuildData.insertedComment) ||
      Boolean(hostedBuildData.convertedBackend));
  const plannerComplete =
    routerFirstAiMode &&
    Boolean(plannerOutputCache) &&
    (plannerOutputCache?.resolvedCommands?.length || 0) > 0 &&
    (plannerOutputCache?.unresolved?.length || 0) === 0 &&
    (plannerOutputCache?.conflicts?.length || 0) === 0 &&
    hostedBuildMode === 'action';
  if (
    routerFirstAiMode &&
    (hostedBuildMode === 'out_of_scope' ||
      plannerOutputCache?.rejection === 'out_of_scope')
  ) {
    return {
      text: hostedBuildResult?.text || '',
      displayText: hostedBuildResult?.text || '',
      assistantThreadId: resolveOpenAiResponseCursor(req) || undefined,
      errors: hostedBuildResult?.ok === false && hostedBuildResult.error ? [String(hostedBuildResult.error)] : [],
      warnings: Array.isArray(hostedBuildResult?.warnings) ? hostedBuildResult.warnings : [],
      metrics: {
        totalMs: Date.now() - startedAt,
        usedShortcut: true,
        provider: req.provider,
        iterations: 0,
        toolCalls: 0,
        toolMs: 0,
        modelMs: 0,
        promptChars: { system: 0, user: 0 },
      },
      debug: {
        toolTrace: [],
        resolutionPath: 'build:out_of_scope',
      },
    };
  }

  if (hostedBuildIsDirectEdit && hostedBuildResult?.text) {
    const baselineChecked = await postCheckResponse(
      hostedBuildResult.text,
      {
        backend: req.flowContext.backend,
        modelFamily: req.flowContext.modelFamily,
        originalSteps: req.flowContext.steps,
        scpiContext: req.scpiContext as Array<Record<string, unknown>>,
        alias: req.flowContext.alias,
        instrumentMap: req.flowContext.instrumentMap as Array<Record<string, unknown>> | undefined,
      },
      { allowMissingActionsJson }
    );
    return {
      text: baselineChecked.text,
      displayText: hostedBuildResult.text,
      assistantThreadId: resolveOpenAiResponseCursor(req) || undefined,
      errors: baselineChecked.errors,
      warnings: baselineChecked.warnings || [],
      metrics: {
        totalMs: Date.now() - startedAt,
        usedShortcut: true,
        provider: req.provider,
        iterations: 0,
        toolCalls: 0,
        toolMs: 0,
        modelMs: 0,
        promptChars: { system: 0, user: 0 },
      },
      debug: {
        toolTrace: [],
        shortcutResponse: hostedBuildResult.text,
        resolutionPath: 'router:direct_edit',
      },
    };
  }

  if (plannerComplete && hostedBuildResult?.text) {
    const baselineChecked = await postCheckResponse(
      hostedBuildResult.text,
      {
        backend: req.flowContext.backend,
        modelFamily: req.flowContext.modelFamily,
        originalSteps: req.flowContext.steps,
        scpiContext: req.scpiContext as Array<Record<string, unknown>>,
        alias: req.flowContext.alias,
        instrumentMap: req.flowContext.instrumentMap as Array<Record<string, unknown>> | undefined,
      },
      { allowMissingActionsJson }
    );
    return {
      text: baselineChecked.text,
      displayText: hostedBuildResult.text,
      assistantThreadId: resolveOpenAiResponseCursor(req) || undefined,
      errors: baselineChecked.errors,
      warnings: baselineChecked.warnings || [],
      metrics: {
        totalMs: Date.now() - startedAt,
        usedShortcut: true,
        provider: req.provider,
        iterations: 0,
        toolCalls: 0,
        toolMs: 0,
        modelMs: 0,
        promptChars: { system: 0, user: 0 },
      },
      debug: {
        toolTrace: [],
        shortcutResponse: hostedBuildResult.text,
        resolutionPath: 'router',
      },
    };
  }

  const maxToolRounds = forceToolCallMode ? 12 : (isHostedStructuredBuildRequest(req) ? 8 : 6);
  const isAnthropicProvider = req.provider === 'anthropic';

  // Provider dispatch — readable if/else instead of deep ternary
  let loopResult: Awaited<ReturnType<typeof runOpenAiToolLoop>>;
  if (mcpOnlyMode) {
    loopResult = await runDeterministicToolLoop(req, flowCommandIssues, maxToolRounds);
  } else if (isAnthropicProvider) {
    // Anthropic always uses its tool loop for AI calls
    loopResult = await runAnthropicToolLoop(req, flowCommandIssues, maxToolRounds);
  } else if (routerFirstAiMode) {
    // OpenAI router-first path
    if (plannerComplete) {
      loopResult = await runOpenAiResponses(req, flowCommandIssues, {
        routerBaselineText: hostedBuildResult?.text || '',
        routerBaselineMode: hostedBuildMode,
      });
    } else {
      loopResult = await runOpenAiToolLoop(
        {
          ...req,
          routerOnly: true,
          routerPreferred: true,
          routerBaselineText: hostedBuildResult?.text || '',
        },
        flowCommandIssues,
        2
      );
    }
  } else if (forceToolCallMode || shouldUseTools(req)) {
    loopResult = await runOpenAiToolLoop(req, flowCommandIssues, maxToolRounds);
  } else {
    loopResult = await runOpenAiResponses(req, flowCommandIssues);
  }

  // In MCP-only mode, return immediately without any post-processing
  if (mcpOnlyMode) {
    return loopResult as ToolLoopResult;
  }

  const assistantMode = Boolean(loopResult.assistantThreadId);
  const checkedPass1 = await postCheckResponse(loopResult.text, {
    backend: req.flowContext.backend,
    modelFamily: req.flowContext.modelFamily,
    originalSteps: req.flowContext.steps,
    scpiContext: req.scpiContext as Array<Record<string, unknown>>,
    alias: req.flowContext.alias,
    instrumentMap: req.flowContext.instrumentMap as Array<Record<string, unknown>> | undefined,
  }, { allowMissingActionsJson, assistantMode, toolTrace: loopResult.debug?.toolTrace as Array<Record<string, unknown>> | undefined });
  // Second pass only for direct LLM; assistant mode uses single lenient pass.
  const checkedPass2 = assistantMode
    ? checkedPass1
    : await postCheckResponse(checkedPass1.text, {
        backend: req.flowContext.backend,
        modelFamily: req.flowContext.modelFamily,
        originalSteps: req.flowContext.steps,
        scpiContext: req.scpiContext as Array<Record<string, unknown>>,
        alias: req.flowContext.alias,
        instrumentMap: req.flowContext.instrumentMap as Array<Record<string, unknown>> | undefined,
      }, { allowMissingActionsJson });
  const checked = {
    text: checkedPass2.text,
    errors: Array.from(new Set([...(checkedPass1.errors || []), ...(checkedPass2.errors || [])])),
    warnings: Array.from(new Set([...(checkedPass1.warnings || []), ...(checkedPass2.warnings || [])])),
  };

  if (routerFirstAiMode && hostedBuildResult?.text) {
    const baselineText = hostedBuildResult.text;
    const baselineActionCount = countMeaningfulActionSteps(baselineText);
    const aiActionCount = countMeaningfulActionSteps(checked.text);
    const baselineCorpus = collectActionCommandCorpus(baselineText);
    const aiCorpus = collectActionCommandCorpus(checked.text);
    const droppedBaselineCommands = missingFromBaseline(baselineCorpus, aiCorpus);
    const droppedPythonStep = droppedBaselineCommands.some((item) => item.toLowerCase().startsWith('python:'));
    const aiExplicitlyEmpty = hasEmptyActionsJson(checked.text);
    const baselineAuthoritative =
      hostedBuildMode === 'action' &&
      baselineActionCount > 0 &&
      (
        aiExplicitlyEmpty ||
        aiActionCount === 0 ||
        aiActionCount < baselineActionCount ||
        droppedPythonStep ||
        droppedBaselineCommands.length > 0
      );

    if (baselineAuthoritative) {
      const baselineChecked = await postCheckResponse(baselineText, {
        backend: req.flowContext.backend,
        modelFamily: req.flowContext.modelFamily,
        originalSteps: req.flowContext.steps,
        scpiContext: req.scpiContext as Array<Record<string, unknown>>,
        alias: req.flowContext.alias,
        instrumentMap: req.flowContext.instrumentMap as Array<Record<string, unknown>> | undefined,
      }, { allowMissingActionsJson });
      return {
        text: baselineChecked.text,
        displayText: baselineText,
        assistantThreadId: loopResult.assistantThreadId,
        errors: baselineChecked.errors,
        warnings: Array.from(
          new Set([
            ...(baselineChecked.warnings || []),
            'Kept router baseline because AI refinement removed or weakened applyable output.',
            ...(droppedBaselineCommands.length
              ? [`Dropped baseline commands: ${droppedBaselineCommands.slice(0, 6).join(' | ')}`]
              : []),
          ])
        ),
        metrics: {
          ...loopResult.metrics,
          totalMs: Date.now() - startedAt,
        },
        debug: {
          ...loopResult.debug,
          shortcutResponse: baselineText,
          resolutionPath: 'router_then_ai:baseline_kept',
        },
      };
    }
  }

  // Hybrid gap-fill: when hosted/model output fail-closes or returns no actions,
  // try deterministic planner synthesis for resolvable commands.
  const shouldTryPlannerGapFill =
    !routerFirstAiMode &&
    !allowMissingActionsJson &&
    !explainOnlyMode &&
    !followUpCorrectionMode &&
    isNonActionableModelResponse(checked.text, checked.errors);
  if (shouldTryPlannerGapFill) {
    const plannerOutput = await planIntent(req);
    if (plannerOutput.resolvedCommands.length > 0) {
      const plannerFill = buildActionsFromPlanner(plannerOutput, req);
      if (plannerFill) {
        const plannerChecked = await postCheckResponse(
          plannerFill,
          {
            backend: req.flowContext.backend,
            modelFamily: req.flowContext.modelFamily,
            originalSteps: req.flowContext.steps,
            scpiContext: req.scpiContext as Array<Record<string, unknown>>,
            alias: req.flowContext.alias,
            instrumentMap: req.flowContext.instrumentMap as Array<Record<string, unknown>> | undefined,
          },
          { allowMissingActionsJson }
        );
        if (!plannerChecked.errors.length) {
          return {
            text: plannerChecked.text,
            displayText: plannerFill,
            assistantThreadId: loopResult.assistantThreadId,
            errors: [],
            warnings: Array.from(new Set([...(checked.warnings || []), 'Hybrid planner gap-fill applied.'])),
            metrics: {
              ...loopResult.metrics,
              totalMs: Date.now() - startedAt,
              usedShortcut: true,
            },
            debug: {
              ...loopResult.debug,
              shortcutResponse: plannerFill,
              resolutionPath: 'model:planner_gap_fill',
            },
          };
        }
      }
    }
  }

  // If the model returned truncated/invalid ACTIONS_JSON, retry once with
  // a strict JSON-only instruction to recover actionable output.
  if (!allowMissingActionsJson && checked.errors.includes('ACTIONS_JSON parse failed')) {
    const retryReq: McpChatRequest = {
      ...req,
      userMessage:
        `${req.userMessage}\n\n` +
        'Return ONLY valid ACTIONS_JSON as one compact JSON object. No prose, no markdown, no code fences.',
    };
    const retryLoop = isAnthropicProvider
      ? await runAnthropicToolLoop(retryReq, flowCommandIssues, 2)
      : (shouldUseTools(retryReq)
        ? await runOpenAiToolLoop(retryReq, flowCommandIssues, 2)
        : await runOpenAiResponses(retryReq, flowCommandIssues));
    const retryChecked = await postCheckResponse(
      retryLoop.text,
      {
        backend: req.flowContext.backend,
        modelFamily: req.flowContext.modelFamily,
        originalSteps: req.flowContext.steps,
        scpiContext: req.scpiContext as Array<Record<string, unknown>>,
        alias: req.flowContext.alias,
        instrumentMap: req.flowContext.instrumentMap as Array<Record<string, unknown>> | undefined,
      },
      {
        allowMissingActionsJson,
        assistantMode: Boolean(retryLoop.assistantThreadId),
        toolTrace: retryLoop.debug?.toolTrace as Array<Record<string, unknown>> | undefined,
      }
    );
    if (!retryChecked.errors.length) {
      return {
        text: retryChecked.text,
        displayText: retryLoop.displayText || retryLoop.text,
        assistantThreadId: retryLoop.assistantThreadId || loopResult.assistantThreadId,
        errors: [],
        warnings: Array.from(new Set([...(checked.warnings || []), ...(retryChecked.warnings || []), 'Recovered from truncated model output via JSON-only retry.'])),
        metrics: {
          totalMs: Date.now() - startedAt,
          usedShortcut: false,
          provider: req.provider,
          iterations: (loopResult.metrics?.iterations || 1) + 1,
          toolCalls: (loopResult.metrics?.toolCalls || 0),
          toolMs: (loopResult.metrics?.toolMs || 0),
          modelMs: (loopResult.metrics?.modelMs || 0),
          promptChars: loopResult.metrics?.promptChars,
        },
        debug: {
          ...loopResult.debug,
          resolutionPath: 'model:json_retry',
        },
      };
    }
  }

  if (
    checked.errors.length &&
    shortcut &&
    !commonServerShortcut &&
    !shouldAttemptShortcutFirst(req) &&
    !isHostedStructuredBuildRequest(req)
  ) {
    const fallback = await postCheckResponse(shortcut, {
      backend: req.flowContext.backend,
      modelFamily: req.flowContext.modelFamily,
      originalSteps: req.flowContext.steps,
      scpiContext: req.scpiContext as Array<Record<string, unknown>>,
      alias: req.flowContext.alias,
      instrumentMap: req.flowContext.instrumentMap as Array<Record<string, unknown>> | undefined,
    }, { allowMissingActionsJson });
    const modelLooksWeak = !hasActionsJsonPayload(checked.text) && /return actions_json|add|insert|build|fix|update/i.test(req.userMessage);
    if (!fallback.errors.length && modelLooksWeak) {
      return {
        text: fallback.text,
        displayText: shortcut,
        assistantThreadId: loopResult.assistantThreadId,
        errors: [],
        warnings: fallback.warnings,
        metrics: {
          ...loopResult.metrics,
          totalMs: Date.now() - startedAt,
          usedShortcut: true,
        },
        debug: {
          ...loopResult.debug,
          shortcutResponse: shortcut,
          resolutionPath: 'model:shortcut_fallback',
        },
      };
    }
  }

  if (checked.errors.length) {
    console.log('[MCP] postCheck errors:', checked.errors);
  }
  if (checked.warnings.length) {
    console.log('[MCP] postCheck warnings:', checked.warnings);
  }
  return {
      text: checked.text,
      displayText: loopResult.displayText || loopResult.text,
      assistantThreadId: loopResult.assistantThreadId,
      errors: checked.errors,
      warnings: checked.warnings,
      metrics: {
        ...loopResult.metrics,
        totalMs: Date.now() - startedAt,
    },
    debug: {
      ...loopResult.debug,
      resolutionPath: (loopResult.debug as Record<string, unknown> | undefined)?.resolutionPath as string | undefined || 'model',
    },
  };

  if (routerFirstAiMode && hostedBuildResult?.text) {
    const baselineActionCount = countMeaningfulActionSteps(hostedBuildResult.text);
    const aiActionCount = countMeaningfulActionSteps(checked.text);
    const baselineHasActions = hostedBuildMode === 'action' || baselineActionCount > 0;
    const aiHasActions = aiActionCount > 0;
    const aiExplicitlyEmpty = hasEmptyActionsJson(checked.text);
    if (
      baselineHasActions &&
      (aiExplicitlyEmpty || !aiHasActions || aiActionCount < baselineActionCount)
    ) {
      const baselineChecked = await postCheckResponse(hostedBuildResult.text, {
        backend: req.flowContext.backend,
        modelFamily: req.flowContext.modelFamily,
        originalSteps: req.flowContext.steps,
        scpiContext: req.scpiContext as Array<Record<string, unknown>>,
        alias: req.flowContext.alias,
        instrumentMap: req.flowContext.instrumentMap as Array<Record<string, unknown>> | undefined,
      }, { allowMissingActionsJson });
      return {
        text: baselineChecked.text,
        displayText: hostedBuildResult.text,
        assistantThreadId: loopResult.assistantThreadId,
        errors: baselineChecked.errors,
        warnings: Array.from(new Set([...(baselineChecked.warnings || []), 'AI refinement was weaker than router baseline; kept router output.'])),
        metrics: {
          ...loopResult.metrics,
          totalMs: Date.now() - startedAt,
        },
        debug: {
          ...loopResult.debug,
          shortcutResponse: hostedBuildResult.text,
          resolutionPath: 'router_then_ai:baseline_kept',
        },
      };
    }
  }
}
function hasLiveInstrumentAccess(req: McpChatRequest): boolean {
  return Boolean(req.instrumentEndpoint && req.instrumentEndpoint.liveMode === true);
}
