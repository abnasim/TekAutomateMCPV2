import type { McpChatRequest } from './schemas';
import { planIntent } from './intentPlanner';

const OUTPUT_RULE = [
  'OUTPUT FORMAT:',
  '1) 1-3 short sentences when needed.',
  '2) ACTIONS_JSON: {"summary":"...","findings":[],"suggestedFixes":[],"actions":[...]}',
  'No code fences. No prose after ACTIONS_JSON.',
  'If one required detail is truly ambiguous, ask one concise blocking clarification question and use actions:[].',
  'If part of the request is clear, still return the applyable part and list the missing or unsupported part in findings.',
  'Use actions:[] only for genuine no-op, clarification, or out-of-scope cases.',
  'For pyvisa/vxi11 use write/query/save_* only; tm_device_command only for tm_devices.',
  'Every query step must include saveAs.',
].join('\n');

const OUTPUT_RULE_COMPACT = [
  'Follow-up mode: keep output concise.',
  'Return one short sentence + ACTIONS_JSON only.',
  'One blocking clarification question is allowed when one required value is missing.',
  'Prefer useful partial output over empty actions when some of the request is clear.',
  'Do not repeat long explanations unless asked.',
].join('\n');

function formatPlannerArgs(
  args: Array<{
    name: string;
    type: string;
    validValues?: string[];
  }>
): string {
  return args
    .map((arg) => `${arg.name}(${arg.validValues?.join('|') || arg.type})`)
    .join(', ');
}

function summarizeStepsForCompact(steps: Array<Record<string, unknown>>): string {
  if (!Array.isArray(steps) || steps.length === 0) return '0 steps';
  const types = steps.slice(0, 12).map((s) => String(s.type || 'unknown'));
  return `${steps.length} steps [${types.join(', ')}${steps.length > 12 ? ', ...' : ''}]`;
}

function workspaceSection(req: McpChatRequest, compact = false): string {
  if (compact) {
    const parts: string[] = [
      `Backend: ${req.flowContext.backend}`,
      `Device: ${req.flowContext.deviceType || 'UNKNOWN'} / ${req.flowContext.modelFamily || 'UNKNOWN'}`,
      `Selected Step: ${req.flowContext.selectedStepId || 'none'}`,
      `Flow: ${summarizeStepsForCompact(req.flowContext.steps || [])}`,
      `RunStatus: ${req.runContext.runStatus || 'idle'}`,
    ];
    if (req.flowContext.validationErrors?.length) {
      parts.push(`ValidationErrors: ${req.flowContext.validationErrors.length}`);
    }
    return `## WORKSPACE\n\n${parts.join('\n')}`;
  }

  const sections: string[] = [
    `Backend: ${req.flowContext.backend}`,
    `Device: ${req.flowContext.deviceType || 'UNKNOWN'} / ${req.flowContext.modelFamily || 'UNKNOWN'}`,
    `Selected Step: ${req.flowContext.selectedStepId || 'none'}`,
    `Steps: ${JSON.stringify(req.flowContext.steps, null, 2)}`,
  ];

  if (req.flowContext.validationErrors?.length) {
    sections.push(
      'Validation Errors:\n' + req.flowContext.validationErrors.map((error) => `- ${error}`).join('\n')
    );
  }

  if (req.runContext.logTail) {
    sections.push(`Last run log:\n${req.runContext.logTail}`);
  }

  return `## WORKSPACE\n\n${sections.join('\n')}`;
}

export async function buildContext(
  req: McpChatRequest,
  options?: { compact?: boolean }
): Promise<string> {
  const compact = Boolean(options?.compact);
  const plannerOutput = await planIntent(req);
  const sections: string[] = [];

  sections.push(compact ? OUTPUT_RULE_COMPACT : OUTPUT_RULE);

  if (plannerOutput.resolvedCommands.length > 0) {
    const scpiCommands = plannerOutput.resolvedCommands.filter(
      (resolved) => !resolved.header.startsWith('STEP:')
    );
    const stepMarkers = plannerOutput.resolvedCommands.filter((resolved) =>
      resolved.header.startsWith('STEP:')
    );

    if (scpiCommands.length > 0) {
      const backend = String(req.flowContext.backend || '').toLowerCase();
      const tmDevicesMode = backend === 'tm_devices';
      if (compact) {
        sections.push(
          `${tmDevicesMode ? '## PLANNER RESOLVED — CONVERT TO tm_devices' : '## PLANNER RESOLVED'}\n\n` +
            scpiCommands
              .map((resolved) => {
                const saveAs = resolved.saveAs ? `\n  saveAs: ${resolved.saveAs}` : '';
                return `${resolved.concreteCommand}${saveAs}`;
              })
              .join('\n')
        );
      } else {
        sections.push(
          (tmDevicesMode
            ? '## PLANNER RESOLVED — CONVERT THESE TO tm_devices STEPS\n\n' +
              'These SCPI commands are verified against the command index.\n' +
              'Since backend is tm_devices, convert each verified SCPI command into a tm_device_command step.\n' +
              'Use this pattern when a matching tm_devices path is obvious from the SCPI header:\n' +
              "SCPI: BUS:B1:TYPe I2C\n→ scope.commands.bus.b[1].type.write('I2C')\n" +
              "SCPI: BUS:B1:I2C:CLOCk:SOUrce CH1\n→ scope.commands.bus.b[1].i2c.clock.source.write('CH1')\n" +
              "General rule: SCPI header tokens become a lowercase dot-path under scope.commands.\n" +
              "If the exact tm_devices path is still uncertain, use scope.visa_write('SCPI_COMMAND') as a fallback instead of returning empty actions.\n\n"
            : '## PLANNER RESOLVED - USE THESE EXACT COMMANDS\n\n' +
              'These commands are verified against the command index.\n' +
              'Use them exactly as shown for pyvisa/vxi11. Do not invent different SCPI alternatives.\n\n') +
            scpiCommands
              .map((resolved) => {
                const lines = [
                  resolved.concreteCommand,
                  `  syntax: ${resolved.syntax?.set || resolved.syntax?.query || 'N/A'}`,
                ];

                if (resolved.arguments?.length) {
                  lines.push(`  args: ${formatPlannerArgs(resolved.arguments)}`);
                }

                if (resolved.examples?.[0]?.scpi) {
                  lines.push(`  example: ${resolved.examples[0].scpi}`);
                }

                if (resolved.saveAs) {
                  lines.push(`  saveAs: ${resolved.saveAs}`);
                }

                return lines.join('\n');
              })
              .join('\n\n')
        );
      }
    }

    if (stepMarkers.length > 0) {
      sections.push(
        '## BUILT-IN STEP TYPES - USE THESE FOR SAVE/RECALL\n\n' +
          stepMarkers
            .map((resolved) => `${resolved.stepType}: ${JSON.stringify(resolved.stepParams || {})}`)
            .join('\n')
      );
    }
  }

  if (plannerOutput.unresolved.length > 0) {
    sections.push(
      '## UNRESOLVED - USE YOUR KNOWLEDGE FOR THESE\n\n' + plannerOutput.unresolved.join('\n')
    );
  }

  if (plannerOutput.conflicts.length > 0) {
    const errors = plannerOutput.conflicts.filter((conflict) => conflict.severity === 'ERROR');
    const warnings = plannerOutput.conflicts.filter((conflict) => conflict.severity === 'WARNING');

    if (errors.length > 0) {
      sections.push(
        '## RESOURCE CONFLICTS - MUST FIX\n\n' +
          errors
            .map(
              (conflict) =>
                `ERROR: ${conflict.message}\nSuggestion: ${conflict.suggestion || 'Adjust resource assignments.'}`
            )
            .join('\n\n')
      );
    }

    if (warnings.length > 0) {
      sections.push(
        '## RESOURCE WARNINGS\n\n' +
          warnings
            .map(
              (conflict) =>
                `WARNING: ${conflict.message}\nSuggestion: ${conflict.suggestion || 'Review resource usage.'}`
            )
            .join('\n\n')
      );
    }
  }

  sections.push(workspaceSection(req, compact));

  return sections.join('\n\n---\n\n');
}

