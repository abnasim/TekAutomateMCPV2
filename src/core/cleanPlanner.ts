/**
 * Clean Planner Architecture - v1.0
 * Handles intent planning without flawed logic
 */

import type { McpChatRequest } from './schemas';
import { cleanRouter } from './cleanRouter';

export interface CleanPlan {
  intent: 'scpi_command' | 'measurement' | 'trigger' | 'bus' | 'acquisition' | 'analysis' | 'unknown';
  confidence: number;
  commands: PlannedCommand[];
  additions: PlannedAddition[];
  changes: PlannedChange[];
  reasoning: string;
}

export interface PlannedCommand {
  command: string;
  type: 'query' | 'set' | 'action';
  description: string;
  parameters?: Record<string, unknown>;
  confidence: number;
}

export interface PlannedAddition {
  type: 'step' | 'measurement' | 'trigger' | 'acquisition';
  description: string;
  position: 'beginning' | 'end' | 'after_step';
  stepId?: string;
}

export interface PlannedChange {
  type: 'parameter' | 'setting' | 'mode';
  target: string;
  from: unknown;
  to: unknown;
  description: string;
}

export class CleanPlanner {
  private static instance: CleanPlanner;
  
  static getInstance(): CleanPlanner {
    if (!CleanPlanner.instance) {
      CleanPlanner.instance = new CleanPlanner();
    }
    return CleanPlanner.instance;
  }

  /**
   * Create clean plan without flawed logic
   */
  async createPlan(req: McpChatRequest): Promise<CleanPlan> {
    console.log(`[CLEAN_PLANNER] Planning for: "${req.userMessage}"`);
    
    const routeDecision = cleanRouter.makeRouteDecision(req);
    
    // If router wants Smart SCPI Assistant, let it handle the planning
    if (routeDecision.route === 'smart_scpi') {
      console.log('[CLEAN_PLANNER] Delegating to Smart SCPI Assistant');
      return this.createScpiPlan(req);
    }
    
    // Handle other intents with clean logic
    const intent = this.detectIntent(req.userMessage);
    const commands = await this.planCommands(req, intent);
    const additions = this.planAdditions(req, intent);
    const changes = this.planChanges(req, intent);
    
    const plan: CleanPlan = {
      intent,
      confidence: this.calculateConfidence(commands, additions, changes),
      commands,
      additions,
      changes,
      reasoning: this.generateReasoning(intent, commands, additions, changes)
    };
    
    console.log(`[CLEAN_PLANNER] Created plan: ${intent} (${plan.confidence} confidence)`);
    return plan;
  }

  /**
   * Delegate to Smart SCPI Assistant for SCPI commands
   */
  private async createScpiPlan(req: McpChatRequest): Promise<CleanPlan> {
    // This would call the Smart SCPI Assistant
    // For now, return a placeholder that indicates delegation
    return {
      intent: 'scpi_command',
      confidence: 0.9,
      commands: [],
      additions: [],
      changes: [],
      reasoning: 'Delegated to Smart SCPI Assistant for accurate command resolution'
    };
  }

  /**
   * Clean intent detection without regex overload
   */
  private detectIntent(message: string): CleanPlan['intent'] {
    const msg = message.toLowerCase();
    
    // SCPI command patterns
    if (msg.includes('command') || msg.includes('scpi') || 
        msg.includes('setup') || msg.includes('configure')) {
      return 'scpi_command';
    }
    
    // Measurement patterns
    if (msg.includes('measure') || msg.includes('measurement') || 
        msg.includes('harmonics') || msg.includes('power') || msg.includes('frequency')) {
      return 'measurement';
    }
    
    // Trigger patterns
    if (msg.includes('trigger') || msg.includes('edge') || msg.includes('bus')) {
      return 'trigger';
    }
    
    // Bus patterns
    if (msg.includes('i2c') || msg.includes('spi') || msg.includes('can') || 
        msg.includes('lin') || msg.includes('rs232')) {
      return 'bus';
    }
    
    // Acquisition patterns
    if (msg.includes('acquire') || msg.includes('capture') || msg.includes('waveform')) {
      return 'acquisition';
    }
    
    // Analysis patterns
    if (msg.includes('analyze') || msg.includes('fft') || msg.includes('statistics')) {
      return 'analysis';
    }
    
    return 'unknown';
  }

  /**
   * Plan commands based on intent
   */
  private async planCommands(req: McpChatRequest, intent: CleanPlan['intent']): Promise<PlannedCommand[]> {
    const commands: PlannedCommand[] = [];
    
    switch (intent) {
      case 'scpi_command':
        // Let Smart SCPI Assistant handle this
        break;
        
      case 'measurement':
        commands.push(...await this.planMeasurementCommands(req));
        break;
        
      case 'trigger':
        commands.push(...await this.planTriggerCommands(req));
        break;
        
      case 'bus':
        commands.push(...await this.planBusCommands(req));
        break;
        
      case 'acquisition':
        commands.push(...await this.planAcquisitionCommands(req));
        break;
        
      case 'analysis':
        commands.push(...await this.planAnalysisCommands(req));
        break;
    }
    
    return commands;
  }

  /**
   * Plan additions (new steps/measurements)
   */
  private planAdditions(req: McpChatRequest, intent: CleanPlan['intent']): PlannedAddition[] {
    const additions: PlannedAddition[] = [];
    const plan: CleanPlan = {
      intent,
      confidence: 0,
      commands: [],
      additions: [],
      changes: [],
      reasoning: ''
    };
    const actions: any[] = [];

    // Add measurement steps
    if (intent === 'measurement') {
      additions.push({
        type: 'measurement',
        description: 'Add measurement step',
        position: 'end'
      });
    }
    
    // Add trigger setup
    if (intent === 'trigger') {
      additions.push({
        type: 'trigger',
        description: 'Add trigger configuration',
        position: 'beginning'
      });
    }

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

    return additions;
  }

  /**
   * Plan changes (modifications to existing steps)
   */
  private planChanges(req: McpChatRequest, intent: CleanPlan['intent']): PlannedChange[] {
    const changes: PlannedChange[] = [];
    
    // Example: Change measurement settings
    if (intent === 'measurement') {
      changes.push({
        type: 'parameter',
        target: 'measurement_type',
        from: 'unknown',
        to: 'harmonics',
        description: 'Set measurement type to harmonics'
      });
    }
    
    return changes;
  }

  /**
   * Calculate confidence based on what we found
   */
  private calculateConfidence(commands: PlannedCommand[], additions: PlannedAddition[], changes: PlannedChange[]): number {
    if (commands.length === 0 && additions.length === 0 && changes.length === 0) {
      return 0.1; // Very low confidence if we found nothing
    }
    
    if (commands.length > 0) {
      return 0.8; // High confidence if we found commands
    }
    
    if (additions.length > 0 || changes.length > 0) {
      return 0.6; // Medium confidence for additions/changes
    }
    
    return 0.3; // Low confidence
  }

  /**
   * Generate reasoning for the plan
   */
  private generateReasoning(intent: CleanPlan['intent'], commands: PlannedCommand[], additions: PlannedAddition[], changes: PlannedChange[]): string {
    const parts = [`Detected ${intent} intent`];
    
    if (commands.length > 0) {
      parts.push(`Found ${commands.length} relevant commands`);
    }
    
    if (additions.length > 0) {
      parts.push(`Planned ${additions.length} additions`);
    }
    
    if (changes.length > 0) {
      parts.push(`Planned ${changes.length} changes`);
    }
    
    return parts.join(', ');
  }

  // Helper methods for specific command planning
  private async planMeasurementCommands(req: McpChatRequest): Promise<PlannedCommand[]> {
    // Implementation for measurement command planning
    return [];
  }

  private async planTriggerCommands(req: McpChatRequest): Promise<PlannedCommand[]> {
    // Implementation for trigger command planning
    return [];
  }

  private async planBusCommands(req: McpChatRequest): Promise<PlannedCommand[]> {
    // Implementation for bus command planning
    return [];
  }

  private async planAcquisitionCommands(req: McpChatRequest): Promise<PlannedCommand[]> {
    // Implementation for acquisition command planning
    return [];
  }

  private async planAnalysisCommands(req: McpChatRequest): Promise<PlannedCommand[]> {
    // Implementation for analysis command planning
    return [];
  }
}

// Export singleton instance
export const cleanPlanner = CleanPlanner.getInstance();
