/**
 * Clean Router Architecture - v3.0
 * Handles all routing logic cleanly without edge case issues
 */

import type { McpChatRequest } from './schemas';

export interface RouteDecision {
  route: 'smart_scpi' | 'provider_supplements' | 'tm_devices' | 'planner' | 'chat_ai';
  confidence: number;
  reasoning: string;
  forceToolCall: boolean;
}

export class CleanRouter {
  private static instance: CleanRouter;
  
  static getInstance(): CleanRouter {
    if (!CleanRouter.instance) {
      CleanRouter.instance = new CleanRouter();
    }
    return CleanRouter.instance;
  }

  /**
   * Detect if user is asking a question (what is, explain, describe)
   */
  isQuestionIntent(msg: string): boolean {
    return /^\s*(what\s+is|what\s+are|what\s+does|explain|describe|tell\s+me\s+about|how\s+does|how\s+do\s+i|how\s+to)\b/i.test(msg);
  }

  /**
   * Detect if user wants flow validation (check/validate/review flow)
   */
  isValidationIntent(msg: string): boolean {
    return /\b(validate|verify|check|review)\s+(my\s+)?(flow|commands?|steps?|sequence)\b/i.test(msg);
  }

  /**
   * Detect if user wants to search the knowledge base / RAG
   * e.g. "search knowledge base", "search docs", "search rag for X"
   */
  isKnowledgeSearchIntent(msg: string): boolean {
    return /\b(search|find|look\s*up)\s+(knowledge|docs|documentation|rag|manual|help)\b/i.test(msg)
      || /\b(knowledge|docs|rag)\s+(search|lookup|find)\b/i.test(msg);
  }

  /**
   * Detect if user wants to browse/explore commands interactively
   * e.g. "browse commands", "browse_scpi_commands", "browse trigger", "list groups", "explore measurement commands"
   */
  isBrowseIntent(msg: string): { isBrowse: boolean; group?: string; filter?: string } {
    // Normalize underscores to spaces for matching
    const normalized = msg.replace(/_/g, ' ');

    // Exact tool name match (user typed "browse_scpi_commands" or "browse scpi commands")
    if (/^\s*browse\s+scpi\s+commands?\s*$/i.test(normalized)) {
      return { isBrowse: true };
    }

    // Explicit browse/explore/list
    const browseMatch = normalized.match(/\b(browse|explore|list|show)\s+(all\s+)?(commands?|groups?|categories)/i);
    if (browseMatch) {
      return { isBrowse: true };
    }

    // Extract everything after "browse " / "explore "
    const afterBrowse = normalized.match(/\b(?:browse|explore)\s+(.+)$/i);
    if (afterBrowse) {
      const rest = afterBrowse[1].replace(/\s*(commands?|group)\s*$/i, '').trim();
      if (!rest || /^(all|commands?|groups?|categories|scpi)$/i.test(rest)) {
        return { isBrowse: true };
      }
      // Return full phrase as group — browseScpiCommands will resolve it via fuzzy match
      // and the tool handles filter separation if group doesn't match
      return { isBrowse: true, group: rest };
    }

    return { isBrowse: false };
  }

  /**
   * Make clean routing decision without edge cases
   */
  makeRouteDecision(req: McpChatRequest): RouteDecision {
    const msg = req.userMessage.toLowerCase().trim();
    const outputMode = req.outputMode;
    const isMcpOnly = this.isMcpOnlyMode(req);
    const interactionMode = req.interactionMode;

    console.log(`[CLEAN_ROUTER] Routing decision for: "${msg}"`);
    console.log(`[CLEAN_ROUTER] Mode: ${outputMode}, MCP-only: ${isMcpOnly}`);

    if (interactionMode === 'live') {
      return {
        route: 'smart_scpi',
        confidence: 0.98,
        reasoning: 'Live mode keeps conversational responses while routing through MCP tools',
        forceToolCall: true
      };
    }

    // 0a. Validation intent (check/validate flow) → route to smart_scpi with validation flag
    if (this.isValidationIntent(msg)) {
      return {
        route: 'smart_scpi',
        confidence: 0.95,
        reasoning: 'Validation intent detected — routing to SCPI validation',
        forceToolCall: true
      };
    }

    // 1. Chat mode always uses AI + provider supplements
    if (outputMode === 'chat') {
      return {
        route: 'chat_ai',
        confidence: 0.9,
        reasoning: 'Chat mode uses AI + provider supplements for conversational assistance',
        forceToolCall: false
      };
    }

    // 2. Explicit tm_devices requests
    if (msg.includes('tm_devices') || req.flowContext.backend === 'tm_devices') {
      return {
        route: 'tm_devices',
        confidence: 0.95,
        reasoning: 'Explicit tm_devices request',
        forceToolCall: true
      };
    }

    // 3. SCPI command queries - use Smart SCPI Assistant
    if (this.isScpiCommandQuery(msg)) {
      return {
        route: 'smart_scpi',
        confidence: 0.9,
        reasoning: 'SCPI command query - using Smart SCPI Assistant',
        forceToolCall: true // Always force tool calls for SCPI queries
      };
    }

    // 4. Build mode fallback - try provider supplements if available
    if (!isMcpOnly && this.isBuildMode(outputMode) && this.shouldUseProviderSupplements(req)) {
      return {
        route: 'provider_supplements',
        confidence: 0.7,
        reasoning: 'Build mode with provider supplements enabled',
        forceToolCall: true
      };
    }

    // 5. Default fallback - ALWAYS use Smart SCPI Assistant for anything instrument-related
    return {
      route: 'smart_scpi',
      confidence: 0.8,
      reasoning: 'Default to Smart SCPI Assistant for all instrument queries',
      forceToolCall: true
    };
  }

  /**
   * Clean detection of SCPI command queries - SIMPLE APPROACH
   * Route to Smart SCPI for any technical/instrument query
   */
  private isScpiCommandQuery(msg: string): boolean {
    // If it's a clear SCPI command, route to Smart SCPI
    const scpiPattern = /^[A-Za-z]+:[A-Za-z]+/;
    const hasScpiPattern = scpiPattern.test(msg.trim());
    
    // Simple heuristic: if it contains technical terms, route to Smart SCPI
    // Let the intent classification handle the actual filtering
    const technicalTerms = /\b(query|result|results|read|power|harmonics|jitter|td\s*\(?on\)?|record|length|delay|position|duration|divisions|math|expression|source|spectrum|graticule|intensity|persistence|image|export|recall|add|delete|save|load|display|cursor|trigger|measurement|channel|scale|voltage|timebase|waveform|data|signal|frequency|period|amplitude|screen|file|clear|on|off)\b/i.test(msg);
    
    // Route to Smart SCPI if it's clearly technical or a SCPI command
    return hasScpiPattern || technicalTerms;
  }

  /**
   * Clean detection of build modes
   */
  private isBuildMode(outputMode: string): boolean {
    return outputMode === 'steps_json' || outputMode === 'blockly_xml';
  }

  /**
   * Clean MCP-only mode detection
   */
  private isMcpOnlyMode(req: McpChatRequest): boolean {
    const rawApiKey = String((req as { apiKey?: string }).apiKey || '').trim();
    return req.mode === 'mcp_only' ||
           rawApiKey.length === 0 ||
           rawApiKey === '__mcp_only__' ||
           rawApiKey.toLowerCase() === 'undefined';
  }

  /**
   * Clean provider supplements decision
   */
  private shouldUseProviderSupplements(req: McpChatRequest): boolean {
    // In build mode, check global setting
    if (this.isBuildMode(req.outputMode)) {
      const flag = String(process.env.MCP_PROVIDER_SUPPLEMENTS || '').trim().toLowerCase();
      return !['false', '0', 'off', 'no'].includes(flag);
    }
    
    // In chat mode, always allow
    return req.outputMode === 'chat';
  }

  /**
   * Get tool call mode - clean logic without edge cases
   */
  getToolCallMode(req: McpChatRequest): boolean {
    if (req.interactionMode === 'live') {
      return true;
    }
    const decision = this.makeRouteDecision(req);
    
    // Always force tool calls for SCPI and tm_devices queries
    if (decision.route === 'smart_scpi' || decision.route === 'tm_devices') {
      return true;
    }
    
    // Force tool calls for provider supplements in build mode
    if (decision.route === 'provider_supplements' && this.isBuildMode(req.outputMode)) {
      return true;
    }
    
    // Use decision
    return decision.forceToolCall;
  }

  /**
   * Get route summary for logging
   */
  getRouteSummary(req: McpChatRequest): string {
    const decision = this.makeRouteDecision(req);
    return `[ROUTE] ${decision.route.toUpperCase()} (confidence: ${decision.confidence}) - ${decision.reasoning}`;
  }
}

// Export singleton instance
export const cleanRouter = CleanRouter.getInstance();
