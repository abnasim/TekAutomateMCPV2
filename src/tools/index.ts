import { getCommandByHeader } from './getCommandByHeader';
import { getCommandsByHeaderBatch } from './getCommandsByHeaderBatch';
import { getCommandGroup } from './getCommandGroup';
import { getEnvironment } from './getEnvironment';
import { getInstrumentState } from './getInstrumentState';
import { getPolicy } from './getPolicy';
import { getTemplateExamples } from './getTemplateExamples';
import { getVisaResources } from './getVisaResources';
import { getBlockSchema } from './getBlockSchema';
import { listValidStepTypes } from './listValidStepTypes';
import { materializeScpiCommand } from './materializeScpiCommand';
import { materializeScpiCommands } from './materializeScpiCommands';
import { finalizeScpiCommands } from './finalizeScpiCommands';
import { materializeTmDevicesCall } from './materializeTmDevicesCall';
import { probeCommand } from './probeCommand';
import { captureScreenshot } from './captureScreenshot';
import { fetchWaveform } from './fetchWaveform';
import { sendScpi } from './sendScpi';
import { retrieveRagChunks } from './retrieveRagChunks';
import { searchKnownFailures } from './searchKnownFailures';
import { searchScpi } from './searchScpi';
import { searchTmDevices } from './searchTmDevices';
import { smartScpiLookup } from '../core/smartScpiAssistant';
import { validateActionPayload } from './validateActionPayload';
import { validateDeviceContext } from './validateDeviceContext';
import { verifyScpiCommands } from './verifyScpiCommands';
import { browseScpiCommands } from './browseScpiCommands';
import { discoverScpi } from './discoverScpi';
import { buildOrEditWorkflow } from './buildOrEditWorkflow';
import { analyzeScopeScreenshot } from './analyzeScopeScreenshot';
import { prepareFlowActions } from './prepareFlowActions';
import { reviewRunLog } from './reviewRunLog';
import { stageWorkflowProposal } from './stageWorkflowProposal';
import { getCurrentWorkflow } from './getCurrentWorkflow';
import { getInstrumentInfo } from './getInstrumentInfo';
import { getRunLog } from './getRunLog';
import { instrumentLive } from './instrumentLive';
import { knowledge } from './knowledge';
import { tekRouterPublic } from './tekRouterPublic';
import { workflowUi } from './workflowUi';
import { GROUP_NAMES, COMMAND_GROUPS } from '../core/commandGroups';
import { TEK_ROUTER_TOOL_DEFINITION } from '../core/toolRouter';

// Live instrument is enabled by default (local use). Set LIVE_INSTRUMENT_ENABLED=false to disable (hosted/public mode).
export function isLiveInstrumentEnabled(): boolean {
  return String(process.env.LIVE_INSTRUMENT_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
}

// workflow_ui is enabled by default (the TekAutomate web app UI exists to
// receive proposals). Set WORKFLOW_UI_ENABLED=false on deployments where
// no UI exists — the tool will be removed from the external surface, the
// auto-stage behavior in server.ts is skipped, and the proposals/latest
// resource is hidden. Keeps the bare MCP clean for scope-only workflows.
export function isWorkflowUiEnabled(): boolean {
  return String(process.env.WORKFLOW_UI_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
}

export const TOOL_HANDLERS = {
  tek_router: async (args: Record<string, unknown>) => {
    const directResult = await tekRouterPublic(args as any);
    if (directResult) return directResult;
    const { tekRouter } = await import('../core/toolRouter');
    return tekRouter(args as any);
  },
  ...(isLiveInstrumentEnabled() ? { instrument_live: instrumentLive } : {}),
  analyze_scope_screenshot: analyzeScopeScreenshot,
  workflow_ui: workflowUi,
  knowledge,
  smart_scpi_lookup: smartScpiLookup,
  search_scpi: searchScpi,
  save_learned_workflow: async (input: {
    name: string;
    description: string;
    triggers: string[];
    steps: Array<{ tool: string; args: Record<string, unknown>; description?: string }>;
  }) => {
    try {
      const { tekRouter } = await import('../core/toolRouter');
      const id = `shortcut:learned_${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}_${Date.now()}`;
      const result = await tekRouter({
        action: 'create',
        toolId: id,
        toolName: input.name,
        toolDescription: input.description,
        toolTriggers: input.triggers,
        toolTags: ['learned', 'live_mode', 'shortcut'],
        toolCategory: 'shortcut',
        toolSteps: input.steps,
      });
      if (result.ok) {
        // Persist immediately
        const { persistRuntimeShortcuts } = await import('../core/routerIntegration');
        await persistRuntimeShortcuts();
      }
      return result;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
  list_command_groups: async () => ({
    ok: true,
    data: GROUP_NAMES.map((name) => ({
      name,
      description: COMMAND_GROUPS[name]?.description || '',
      commandCount: COMMAND_GROUPS[name]?.commands?.length || 0,
    })),
    sourceMeta: [],
    warnings: [],
  }),
  get_command_group: getCommandGroup,
  get_command_by_header: getCommandByHeader,
  get_commands_by_header_batch: getCommandsByHeaderBatch,
  verify_scpi_commands: verifyScpiCommands,
  browse_scpi_commands: browseScpiCommands,
  search_tm_devices: searchTmDevices,
  build_or_edit_workflow: buildOrEditWorkflow,
  prepare_flow_actions: prepareFlowActions,
  review_run_log: reviewRunLog,
  stage_workflow_proposal: stageWorkflowProposal,
  get_current_workflow: getCurrentWorkflow,
  get_instrument_info: getInstrumentInfo,
  get_run_log: getRunLog,
  retrieve_rag_chunks: retrieveRagChunks,
  search_known_failures: searchKnownFailures,
  get_template_examples: getTemplateExamples,
  get_policy: getPolicy,
  list_valid_step_types: listValidStepTypes,
  get_block_schema: getBlockSchema,
  materialize_scpi_command: materializeScpiCommand,
  materialize_scpi_commands: materializeScpiCommands,
  finalize_scpi_commands: finalizeScpiCommands,
  materialize_tm_devices_call: materializeTmDevicesCall,
  validate_action_payload: validateActionPayload,
  validate_device_context: validateDeviceContext,
  get_instrument_state: getInstrumentState,
  probe_command: probeCommand,
  send_scpi: sendScpi,
  discover_scpi: discoverScpi,
  capture_screenshot: captureScreenshot,
  fetch_waveform: fetchWaveform,
  get_visa_resources: getVisaResources,
  get_environment: getEnvironment,
} as const;

export type ToolName = keyof typeof TOOL_HANDLERS;

export function getToolDefinitions() {
  return [
    TEK_ROUTER_TOOL_DEFINITION,
    ...(isLiveInstrumentEnabled() ? [{
      name: 'instrument_live',
      description:
        'Live instrument gateway for TekAutomate. Use `context` for connection info, `send` for SCPI commands, `screenshot` for capture, `snapshot`/`diff`/`inspect` for *LRN?-based state discovery, `resources` for VISA discovery, and `waveform` for signal health check + data fetch.\n\n' +
        'For screenshots: call with action:"screenshot" and analyze:true — the response returns an MCP {type:"image"} content block containing the screenshot, rendered as vision by your client. Use as a verification tool after any action that changes the display (channel enable/disable, scale, decode, trigger), when measurements are unexpected, or as final task sign-off.\n\n' +
        'For waveform: action:"waveform" fetches ADC samples and computes stats (min/max/mean/std/Vpp).\n' +
        'Clipping check — use a SCREENSHOT, not math. The scope draws clipped regions in red at the top/bottom rails; that is faster and more reliable than anything derived from stats. Do NOT try to infer clipping from min/max alone.\n' +
        'SIGNAL CONDITIONING FIRST — before any capture/analysis, get the waveform fitting the display:\n' +
        '  1. Look at the current display (screenshot) — is the waveform off-screen high/low or flatlined at a rail?\n' +
        '  2. If clipped or off-screen: adjust CH<x>:OFFSet to center the signal on screen BEFORE changing the vertical scale. Scope offset shifts the ADC window; without centering, cranking the scale just changes gain around a bad center.\n' +
        '  3. Then set CH<x>:SCAle so the waveform fills ~60-80% of the screen vertically. Re-screenshot to confirm.\n' +
        '  4. Set HORizontal:SCAle to capture the time window you actually need.\n' +
        '  5. Only then run action:"waveform" — the stats are only meaningful once the signal is on-screen and unclipped.\n' +
        'Skipping this causes stats on saturated/off-screen data, which the AI then misreads as "real" numbers. The scope does not prevent you from capturing garbage.\n\n' +
        'Pick the mode that matches your task — do not use more data than you need:\n' +
        '  • Quick stats only (min/max/mean/Vpp):           default — no format or saveLocal. ~300 B response.\n' +
        '  • Show signal shape, voltage ranges:              format:"csv" + downsample:1000-5000. LTTB-downsampled CSV inline (~6-30K tokens). Shape-preserving; do NOT use for edge timing.\n' +
        '  • Edge timing, jitter, FM/PM, modulation:         saveLocal:true + allowLargeDownload:true. Returns localPath + downloadUrl to a full-res raw CSV (can be 10s–100s of MB) — ONLY opt in if you have code-execution/curl to process the bytes on disk. Do NOT WebFetch the URL into chat context; it will overflow.\n' +
        'POINT COUNT — controlled via the tool "stop" arg, NOT via a separate DATa:STOP SCPI call. Every waveform call resets DATa:STOP internally; anything you set via instrument_live{send} before calling waveform gets clobbered. Rules:\n' +
        '  • No "stop" passed → auto mode. Server queries HORizontal:MODE:RECOrdlength? and captures min(recordLength, 100000). Plenty for most analysis; ASCII transfer fits the default 30s timeout.\n' +
        '  • "stop":<N> passed → honors exactly N points (1 ≤ N ≤ record length). Scope silently clamps above record length.\n' +
        '  • For large captures (>100K) bump timeoutMs too — ASCII CURVe? over VXI-11 at 500K+ points can approach 30s. timeoutMs caps at 120s.\n' +
        '  • verifiedDATaSTOP in the response is what the scope actually accepted — check it matches your ask.\n' +
        'Two-step handshake for raw data: saveLocal:true alone returns localPath (useful if your client shares a filesystem with the server, i.e. stdio MCP on the same machine). Add allowLargeDownload:true to also receive a downloadUrl for remote HTTP clients — required before the URL is emitted.\n\n' +
        'ERROR CHECKING after action:"send" — mandatory after any write batch:\n' +
        'SCPI write commands do not confirm success. Always append "*ESR?" and "ALLEV?" to the commands array after writes (or call send immediately after). Rules:\n' +
        '• *ESR? = 0 → all commands accepted. Non-zero → something failed:\n' +
        '    32 = Command Error (bad syntax / unknown command)\n' +
        '    16 = Execution Error (rejected — wrong mode, value out of range)\n' +
        '     8 = Device-Dependent Error\n' +
        '     4 = Query Error\n' +
        '• If *ESR? is non-zero: read ALLEV? for the exact error string, report it, and do NOT continue configuring on top of a bad state.\n\n' +
        'SCPI GOTCHAS — know these before sending:\n' +
        '• OPC polling — *RST, DEFaultsetup, AUTOset, SAVe:*, RECAll:*, CALibrate:INTERNal, FACtory, TEKSecure are long-running. Poll *OPC? in a LOOP until it returns 1 — not once. Ordinary commands complete immediately; do NOT add *OPC? after every command.\n' +
        '• Burst size — keep write bursts to 5-6 commands max. Use *WAI between groups if sending many. Larger bursts overflow the instrument queue.\n' +
        '• 9.9E37 in a measurement result means "no valid measurement" (channel off, no signal, no trigger) — not a real reading.\n' +
        '• Trigger level is per-channel: TRIGger:{A|B}:LEVel:CH<x>. There is NO TRIGger:A:EDGE:LEVel.\n' +
        '• Set-only commands have no query form — verify via screenshot or a related query, not by querying the command itself.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['context', 'send', 'screenshot', 'snapshot', 'diff', 'inspect', 'resources', 'waveform'],
            description: 'Live instrument operation to run.',
          },
          args: {
            type: 'object',
            description: 'Optional nested arguments for the selected action. You may also pass action arguments at the top level.',
          },
          commands: {
            type: 'array',
            items: { type: 'string' },
            description: 'For action:"send" — SCPI commands to send in order.',
          },
          analyze: {
            type: 'boolean',
            description: 'For action:"screenshot" — REQUIRED to receive the image. Pass true and the response includes an MCP {type:"image"} content block containing the scope screenshot. Without analyze:true, no image data is returned — only a confirmation that the UI display was updated.',
          },
          analysisTransport: {
            type: 'string',
            enum: ['claude_image', 'mcp_image', 'openai_image', 'url'],
            description: 'Optional internal transport hint — leave unset. The server automatically selects the correct image format for your client.',
          },
          timeoutMs: {
            type: 'number',
            description: 'Optional timeout in milliseconds for send, screenshot, or discovery actions.',
          },
          visaResource: {
            type: 'string',
            description: 'Optional VISA resource string to target a specific instrument instead of the active one (e.g. TCPIP::127.0.0.1::4000::SOCKET). Call action:"resources" first to list available targets.',
          },
          channel: {
            type: 'string',
            description: 'For action:"waveform" — source channel. Accepts CH1-CH4, MATH1-MATH4, REF1-REF8. Case-insensitive. NOT "source" — that\'s the SCPI name; this tool uses "channel". Default: CH1.',
          },
          format: {
            type: 'string',
            enum: ['stats', 'csv', 'both'],
            description: 'For action:"waveform" — output shape. "stats" (default) ≈ 300 B JSON. "csv" adds an LTTB-downsampled CSV inline (shape-only, not timing-preserving). "both" combines. For edge-timing / jitter / FM / modulation analysis, use saveLocal:true + allowLargeDownload:true instead (see downloadUrl path).',
          },
          downsample: {
            type: 'number',
            description: 'For action:"waveform" with format:"csv"/"both" — target point count after LTTB downsampling. Clamped 10..50000. Default 1000.',
          },
          stop: {
            type: 'number',
            description: 'For action:"waveform" — last sample index to fetch (DATa:STOP). If omitted, server queries record length and caps at 100000. Pass a larger explicit value (with bumped timeoutMs) for full-record captures. Setting DATa:STOP via a separate send call does NOT persist — every waveform call resets it.',
          },
          start: {
            type: 'number',
            description: 'For action:"waveform" — first sample index (DATa:STARt). Default 1.',
          },
          width: {
            type: 'number',
            enum: [1, 2],
            description: 'For action:"waveform" — ADC sample width in bytes (1 = 8-bit, 2 = 16-bit). Default 2.',
          },
          saveLocal: {
            type: 'boolean',
            description: 'For action:"waveform" — save the full-resolution CSV to the MCP server filesystem and return localPath. Safe for stdio MCP clients on the same machine (Read tool can open localPath). For remote HTTP clients add allowLargeDownload:true to also receive downloadUrl.',
          },
          allowLargeDownload: {
            type: 'boolean',
            description: 'For action:"waveform" — opt-in gate for the HTTP downloadUrl. Only pass true if your client can process multi-MB CSV via code-execution (curl → disk → numpy/pandas). Do NOT fetch downloadUrl directly into chat context — it will overflow. Ignored unless saveLocal:true is also set.',
          },
        },
        required: ['action'],
        additionalProperties: true,
      },
    }] : []),
    {
      name: 'analyze_scope_screenshot',
      description:
        'Capture a live scope screenshot and analyze it with vision. Use this when you need to describe what is currently displayed on the scope screen. The tool returns a text analysis of the image — read and use that analysis text directly to answer the user. If the response also includes an image URL, load it as image content (not plain text) for additional visual inspection.',
      parameters: {
        type: 'object',
        properties: {
          executorUrl: { type: 'string' },
          visaResource: { type: 'string' },
          backend: { type: 'string' },
          liveMode: { type: 'boolean' },
          outputMode: { type: 'string', enum: ['clean', 'verbose'] },
          scopeType: { type: 'string', enum: ['modern', 'legacy'] },
          modelFamily: { type: 'string' },
          deviceDriver: { type: 'string' },
          timeoutMs: { type: 'number', description: 'Optional screenshot timeout in milliseconds.' },
          prompt: { type: 'string', description: 'Optional visual-analysis instruction for the screenshot.' },
          question: { type: 'string', description: 'Alias for prompt.' },
          model: { type: 'string', description: 'Optional OpenAI model override. Defaults to OPENAI_SCREENSHOT_MODEL or gpt-4.1-mini.' },
          detail: { type: 'string', enum: ['low', 'high', 'auto', 'original'], description: 'Optional OpenAI image detail level. Defaults to original.' },
          apiKey: { type: 'string', description: 'Optional OpenAI API key override. Defaults to OPENAI_API_KEY.' },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: 'workflow_ui',
      description:
        'TekAutomate workflow gateway. Actions: current — read the live workflow steps (call first before any edit); stage — push a proposal to the UI (call immediately after building steps, no confirmation needed); logs — read the latest run log.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['current', 'stage', 'logs'],
            description: 'Workflow/UI operation to run.',
          },
          args: {
            type: 'object',
            description: 'Optional nested arguments for the selected action. You may also pass action arguments at the top level.',
          },
          summary: {
            type: 'string',
            description: 'For action:"stage" — short human-readable proposal summary.',
          },
          findings: {
            type: 'array',
            items: { type: 'string' },
            description: 'For action:"stage" — optional findings list.',
          },
          suggestedFixes: {
            type: 'array',
            items: { type: 'string' },
            description: 'For action:"stage" — optional suggested fixes list.',
          },
          actions: {
            type: 'array',
            items: { type: 'object' },
            description: 'For action:"stage" — non-empty TekAutomate workflow actions array.',
          },
        },
        required: ['action'],
        additionalProperties: true,
      },
    },
    {
      name: 'knowledge',
      description:
        'Use for HOW-to questions, protocol setup, supporting material, and prompt overlays — not for SCPI syntax (use tek_router for commands).\n' +
        '• retrieve — RAG search by corpus. Use tek_docs for protocol decode how-tos (I2C/CAN/SPI/USB/Ethernet/LIN/RS232/MIL-1553), trigger concepts, and product how-tos; results include tek.com source URLs — web-fetch the URL when the chunk preview is incomplete, then extract SCPI via tek_router before staging. Also supports corpus:"lessons" which returns saved Lessons Learned (reference notes, not executable; filter by tags or modelFamily).\n' +
        '• examples — find matching workflow templates.\n' +
        '• failures — diagnose runtime errors and unexpected behavior.\n' +
        '• personality — list or load prompt overlays (personas: setup / debug / scpi_discovery / validation / learning / data_analysis) and base prompts. op:"list" returns name + one-line bias; op:"load" returns the full markdown. After loading, follow the overlay\'s guidance for the rest of the session — do NOT load another in the same turn (overlay conflicts muddy priorities).',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['retrieve', 'examples', 'failures', 'personality'],
            description: 'Knowledge operation to run.',
          },
          args: {
            type: 'object',
            description: 'Optional nested arguments. You may also pass action arguments at the top level.',
          },
          corpus: {
            type: 'string',
            description:
              'WARNING: do NOT use corpus:"scpi" for SCPI commands — that corpus is a raw manual dump and will be noisier than tek_router. Use tek_router{search} or tek_router{lookup} for any SCPI work.\n\n' +
              'Corpus for action:"retrieve":\n' +
              '• tek_docs — Tektronix product docs, app notes, FAQs, protocol decode how-tos (I2C/CAN/SPI/USB/Ethernet/LIN/RS232/MIL-1553); results include tek.com source URLs.\n' +
              '• scope_logic — oscilloscope measurement and acquisition concepts.\n' +
              '• tmdevices — tm_devices Python driver API.\n' +
              '• app_logic — TekAutomate architecture and AiAction schemas.\n' +
              '• pyvisa_tekhsi — PyVISA and TekHSI connection examples.\n' +
              '• lessons — Lessons Learned saved via tek_router{action:"save", kind:"lesson"}. Structured {lesson, observation, implication, tags}. Query is a fuzzy token match across all fields; tags filter is lenient (lowercase, plural/hyphen/case-insensitive: "masks" matches "mask", "arg-names" matches "argnames"); modelFamily narrows to a specific scope family or neutral. Accepts either limit or topK for max results (default 10, cap 50). REFERENCE NOTES, NOT EXECUTABLE — do not try to dispatch them.',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'For corpus:"lessons" only — filter to lessons that carry ALL of these tags (AND semantics).',
          },
          query: {
            type: 'string',
            description: 'Search phrase for retrieve, examples, or failures.',
          },
          topK: {
            type: 'number',
            description: 'Max chunks to return (action:"retrieve").',
          },
          limit: {
            type: 'number',
            description: 'Max results (action:"examples" or "failures").',
          },
          modelFamily: {
            type: 'string',
            description: 'Filter tek_docs to a specific instrument family (e.g. MSO6, MSO5, DPO7000). General protocol/measurement content always passes through.',
          },
          op: {
            type: 'string',
            enum: ['list', 'load'],
            description: 'For action:"personality" — "list" returns available overlay names + one-line bias; "load" returns the full markdown of one overlay. Defaults to "list".',
          },
          category: {
            type: 'string',
            enum: ['persona', 'base'],
            description: 'For action:"personality" — which directory to read. "persona" (default) = task-specific overlays; "base" = base prompts. A bare op:"list" with no category returns both.',
          },
          name: {
            type: 'string',
            description: 'For action:"personality" op:"load" — the overlay name (without .md extension), e.g. "debug_copilot". Get valid names via op:"list".',
          },
        },
        required: ['action'],
        additionalProperties: true,
      },
    },
    {
      name: 'smart_scpi_lookup',
      description:
        'Natural-language SCPI command finder for Tektronix oscilloscopes. ' +
        'Use when you do not know the command/header yet and want MCP to map plain English to likely SCPI commands. ' +
        'This is a command finder, not generic RAG retrieval.\n\n' +
        'Best for:\n' +
        '- finding a likely command family from user intent\n' +
        '- measurement, trigger, bus decode, horizontal, save/recall, and display questions\n' +
        '- follow-up before get_command_by_header or verify_scpi_commands\n\n' +
        'Avoid for:\n' +
        '- exact known headers (use get_command_by_header)\n' +
        '- cheap keyword discovery (use search_scpi)\n' +
        '- exact bug/procedure retrieval (use retrieve_rag_chunks)\n\n' +
        'Examples of good queries:\n' +
        '- "how do I measure voltage on channel 1"\n' +
        '- "add eye diagram measurement"\n' +
        '- "configure I2C bus decode on bus 1"\n' +
        '- "set trigger to falling edge at 1.5V"\n' +
        '- "save screenshot to USB"\n' +
        '- "what is the sampling rate"\n' +
        '- "add jitter measurement with detailed results"\n\n' +
        'Returns: matching SCPI commands with full syntax, valid argument values, ' +
        'and Python/SCPI code examples. For broad queries, returns a conversational ' +
        'menu to narrow down options.\n\n' +
        'If this tool returns no results or the wrong commands, use browse_scpi_commands ' +
        'to iteratively explore the command database by group and keyword.',
      parameters: {
        type: 'object',
        properties: {
          query: { 
            type: 'string', 
            description: 'What you want to do with the oscilloscope, in plain English. ' +
              'Include the measurement type, channel, or feature you want to control.'
          },
          modelFamily: { type: 'string', description: 'Optional model family filter: MSO2, MSO4, MSO5, MSO6, MSO7, DPO5000, AFG, AWG, etc.' },
          context: { type: 'string', description: 'Additional context about the use case or instrument setup.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      name: 'search_scpi',
      description:
        'Cheap keyword/header search over the SCPI command database. ' +
        'Use for fast discovery when you want likely headers or command families from short targeted phrases such as "edge trigger", "measurement frequency", or "I2C bus".\n\n' +
        'Best for:\n' +
        '- cheap first-pass command discovery\n' +
        '- short noun-heavy queries\n' +
        '- finding likely headers before get_command_by_header\n\n' +
        'Avoid for:\n' +
        '- long conversational prompts\n' +
        '- exact known headers (use get_command_by_header)\n' +
        '- procedure or bug retrieval (use retrieve_rag_chunks)\n\n' +
        'Returns compact discovery results by default: header, type, description, and group. Use verbosity:"full" only when you explicitly need richer command blobs.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Feature or command to search, e.g. FastFrame.' },
          modelFamily: { type: 'string', description: 'Instrument model family filter, e.g. mso_5_series.' },
          limit: { type: 'number', description: 'Max results to return (default 10).' },
          offset: { type: 'number', description: 'Result offset for pagination (default 0).' },
          commandType: { type: 'string', enum: ['set', 'query', 'both'], description: 'Optional command type filter.' },
          verbosity: { type: 'string', enum: ['summary', 'full'], description: 'Response detail level (default summary).' },
          sourceMetaMode: { type: 'string', enum: ['compact', 'full'], description: 'Source metadata detail level (default compact).' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      name: 'save_learned_workflow',
      description: 'Save a successful sequence of SCPI commands as a reusable workflow. Call this AFTER you have achieved the user\'s goal through exploration. The saved workflow will be available for instant recall next time.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Short name for the workflow (e.g. "Eye Diagram Jitter Setup")' },
          description: { type: 'string', description: 'What this workflow achieves' },
          triggers: {
            type: 'array', items: { type: 'string' },
            description: 'Natural language phrases that should trigger this workflow (e.g. ["setup eye diagram", "jitter measurement", "eye jitter"])'
          },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                tool: { type: 'string', description: 'Tool name that was called (e.g. "send_scpi")' },
                args: { type: 'object', description: 'Arguments that were passed to the tool' },
                description: { type: 'string', description: 'What this step does' },
              },
            },
            description: 'The sequence of tool calls that achieved the goal (only the successful ones)'
          },
        },
        required: ['name', 'description', 'triggers', 'steps'],
        additionalProperties: false,
      },
    },
    {
      name: 'list_command_groups',
      description: `List all SCPI command groups with descriptions and command counts. Use this first to discover what feature areas are available, then use get_command_group to browse commands in a specific group. Known groups: ${GROUP_NAMES.join(', ')}.`,
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: 'get_command_group',
      description:
        'Get all commands in a named group with full details (header, syntax, arguments, examples). Use to browse all commands for a feature area. Returns the complete command entries, not just headers.',
      parameters: {
        type: 'object',
        properties: {
          groupName: {
            type: 'string',
            description: 'Exact group name from the known groups list.',
          },
          modelFamily: { type: 'string', description: 'Instrument model family filter, e.g. mso_5_series.' },
        },
        required: ['groupName'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_command_by_header',
      description: 'Exact lookup by known SCPI header (e.g. "HORizontal:FASTframe:STATE"). Prefer over search_scpi when you already know the header — faster and more precise.',
      parameters: {
        type: 'object',
        properties: {
          header: { type: 'string', description: 'Exact SCPI header, e.g. ACQuire:MODE?' },
          family: { type: 'string', description: 'Optional family filter.' },
        },
        required: ['header'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_commands_by_header_batch',
      description:
        'Batch exact lookup for multiple known SCPI headers in one call. Prefer over repeated get_command_by_header when the request needs several related headers.',
      parameters: {
        type: 'object',
        properties: {
          headers: {
            type: 'array',
            items: { type: 'string' },
            description: 'Exact canonical SCPI headers to resolve in one call.',
          },
          family: { type: 'string', description: 'Optional family filter.' },
        },
        required: ['headers'],
        additionalProperties: false,
      },
    },
    {
      name: 'verify_scpi_commands',
      description:
        'Validate one or more fully formed SCPI command strings against the command database. ' +
        'Use after generating candidate commands and before executing them or returning workflow actions.',
      parameters: {
        type: 'object',
        properties: {
          commands: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of SCPI command strings to verify.',
          },
          modelFamily: { type: 'string', description: 'Optional family filter.' },
        },
        required: ['commands'],
        additionalProperties: false,
      },
    },
    {
      name: 'browse_scpi_commands',
      description:
        'Interactive 3-level drill-down for exploring SCPI commands. ' +
        'Use when you want to browse by command group, or when search_scpi / smart_scpi_lookup did not narrow things down enough.\n\n' +
        'Level 1 (no args): List all command groups (Horizontal, Trigger, Measurement, Bus, etc.)\n' +
        'Level 2 (group): List commands in a group, optionally filtered by keyword\n' +
        'Level 3 (header): Full command details — syntax, arguments, valid values, examples\n\n' +
        'Call sequence example:\n' +
        '1. browse_scpi_commands() → see all groups\n' +
        '2. browse_scpi_commands({group: "Trigger"}) → see trigger commands\n' +
        '3. browse_scpi_commands({group: "Trigger", filter: "edge"}) → narrow to edge trigger\n' +
        '4. browse_scpi_commands({header: "TRIGger:A:EDGE:SOUrce"}) → full details',
      parameters: {
        type: 'object',
        properties: {
          group: {
            type: 'string',
            description: 'Command group to browse (e.g. "Trigger", "Measurement", "Horizontal"). Omit to list all groups.',
          },
          header: {
            type: 'string',
            description: 'Specific SCPI command header to get full details for (e.g. "TRIGger:A:EDGE:SOUrce").',
          },
          modelFamily: {
            type: 'string',
            description: 'Optional model family filter: MSO2, MSO4, MSO5, MSO6, MSO7, etc.',
          },
          filter: {
            type: 'string',
            description: 'Keyword to filter commands within a group (e.g. "edge" within Trigger group).',
          },
          limit: {
            type: 'number',
            description: 'Max commands to return (default 30, max 100).',
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: 'search_tm_devices',
      description: 'Search tm_devices Python library method tree and docstrings. ONLY use when backend is tm_devices or when the user explicitly asks to convert SCPI to tm_devices. Do not use for normal scope SCPI tasks like screenshot, FastFrame, trigger, or basic measurements.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Method or feature query.' },
          model: { type: 'string', description: 'Optional model filter, e.g. MSO56.' },
          limit: { type: 'number', description: 'Max results to return (default 10).' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      name: 'build_or_edit_workflow',
      description:
        'Build or edit a TekAutomate workflow in one smart call. ' +
        'Use this for straightforward build/change/fix requests instead of chaining search, lookup, and verify tools manually. ' +
        'Pass currentWorkflow and selectedStepId when editing an existing flow so MCP can target the right step(s). ' +
        'Read the returned data.actions field and pass it through unchanged to stage_workflow_proposal when you want TekAutomate to show Apply to Flow.',
      parameters: {
        type: 'object',
        properties: {
          request: { type: 'string', description: 'User request in plain English.' },
          currentWorkflow: {
            type: 'array',
            items: { type: 'object', additionalProperties: true },
            description: 'Optional current workflow steps when editing an existing flow.',
          },
          selectedStepId: {
            type: ['string', 'null'],
            description: 'Optional selected step ID to bias targeted edits.',
          },
          buildNew: {
            type: 'boolean',
            description: 'Optional explicit build mode. True for fresh flow, false for incremental edits.',
          },
          instrumentInfo: {
            type: 'object',
            description: 'Optional instrument/backend context.',
            properties: {
              backend: { type: 'string' },
              modelFamily: { type: 'string' },
              deviceType: { type: 'string' },
              deviceDriver: { type: 'string' },
              alias: { type: 'string' },
              instrumentMap: {
                type: 'array',
                items: { type: 'object', additionalProperties: true },
              },
            },
            additionalProperties: true,
          },
        },
        required: ['request'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_current_workflow',
      description:
        'Return the latest current TekAutomate workflow state mirrored from the browser. ' +
        'Use before editing a workflow when current steps, selected step, validation errors, backend, or model family matter.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: 'get_instrument_info',
      description:
        'Return the latest TekAutomate instrument connection context mirrored from the browser. ' +
        'Use when connected instrument details, backend, model family, executor context, selected live target, or VISA resource matter.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: 'get_run_log',
      description:
        'Return the latest TekAutomate execution log tail mirrored from the browser. ' +
        'Use for failed runs, timeout debugging, screenshot-transfer issues, and runtime diagnosis.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: 'prepare_flow_actions',
      description:
        'Validate, normalize, and target ACTIONS_JSON before the frontend applies it. ' +
        'Use this right before Apply to Flow or auto-apply.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Optional short human summary for the proposal.' },
          findings: { type: 'array', items: { type: 'string' }, description: 'Optional findings list.' },
          suggestedFixes: { type: 'array', items: { type: 'string' }, description: 'Optional suggestions list.' },
          actions: {
            type: 'array',
            items: { type: 'object', additionalProperties: true },
            description: 'Proposed actions from ACTIONS_JSON.',
          },
          currentWorkflow: {
            type: 'array',
            items: { type: 'object', additionalProperties: true },
            description: 'Current workflow steps for validation and targeting.',
          },
          selectedStepId: {
            type: ['string', 'null'],
            description: 'Currently selected step ID, used as a fallback target for incremental inserts.',
          },
          backend: { type: 'string', description: 'Optional backend hint.' },
          modelFamily: { type: 'string', description: 'Optional model family hint.' },
        },
        required: ['actions'],
        additionalProperties: false,
      },
    },
    {
      name: 'review_run_log',
      description:
        'Review the latest execution log and return a compact runtime diagnosis with evidence and remediation guidance. ' +
        'Use this for failed runs, timeouts, screenshot-transfer issues, and runtime debugging before proposing workflow changes.',
      parameters: {
        type: 'object',
        properties: {
          runLog: {
            type: 'string',
            description: 'Latest execution log text from TekAutomate.',
          },
          auditOutput: {
            type: 'string',
            description: 'Optional execution audit summary or report excerpt.',
          },
          currentWorkflow: {
            type: 'array',
            items: { type: 'object', additionalProperties: true },
            description: 'Optional current workflow steps for context.',
          },
          selectedStepId: {
            type: ['string', 'null'],
            description: 'Optional selected step hint.',
          },
          backend: { type: 'string', description: 'Optional backend hint.' },
          modelFamily: { type: 'string', description: 'Optional model family hint.' },
          request: { type: 'string', description: 'Optional user request or debugging goal.' },
        },
        required: ['runLog'],
        additionalProperties: false,
      },
    },
    {
      name: 'stage_workflow_proposal',
      description:
        'Stage a structured workflow proposal for TekAutomate UI. ' +
        'Use this after build_or_edit_workflow or runtime diagnosis when you want TekAutomate to show Apply to Flow outside ChatKit. ' +
        'Copy build_or_edit_workflow.data.summary/findings/suggestedFixes/actions directly into this tool call. ' +
        'Do not summarize or omit the actions array. This tool rejects empty actions.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Short human-readable proposal summary.' },
          findings: { type: 'array', items: { type: 'string' }, description: 'Optional findings list.' },
          suggestedFixes: { type: 'array', items: { type: 'string' }, description: 'Optional suggestions list.' },
          actions: {
            type: 'array',
            items: { type: 'object', additionalProperties: true },
            description:
              'Workflow actions for TekAutomate to apply later. ' +
              'Must be the non-empty actions array returned by build_or_edit_workflow.data.actions.',
          },
        },
        required: ['actions'],
        additionalProperties: false,
      },
    },
    {
      name: 'retrieve_rag_chunks',
      description:
        'Retrieve exact chunks from the local MCP knowledge base. ' +
        'Use this for procedures, known bugs, app behavior, workflow examples, connection guidance, and scope troubleshooting playbooks.\n\n' +
        'Corpora:\n' +
        '- scpi: reference material and command-related docs\n' +
        '- tmdevices: tm_devices usage/help\n' +
        '- templates: workflow/template examples\n' +
        '- pyvisa_tekhsi: transport and Python I/O guidance\n' +
        '- app_logic: TekAutomate app behavior and implementation rules\n' +
        '- errors: known failures, causes, and fixes\n' +
        '- scope_logic: step-by-step scope procedures like clipping, probe compensation, decode bring-up, autoset-first\n' +
        '- tek_docs: Tektronix product docs (1,187 chunks) — specs, app notes, primers, technical briefs, FAQs (protocol decode how-tos: I2C, CAN, USB, LIN, RS232, Ethernet, MIL-1553), blogs, datasheets. Results include source URLs; web-fetch the URL for full content. How-to queries automatically boost FAQ chunks.\n\n' +
        'Use short, exact, noun-heavy queries such as "OPC Query Return Type", "clipping 9.91E+37", "probe compensation", or "autoset first".',
      parameters: {
        type: 'object',
        properties: {
          corpus: {
            type: 'string',
            enum: ['scpi', 'tmdevices', 'app_logic', 'errors', 'templates', 'pyvisa_tekhsi', 'scope_logic', 'tek_docs'],
            description: 'Which knowledge corpus to search. Use tek_docs for Tektronix product docs (MSO/DPO/MDO specs, app notes, FAQs, blogs, primers, datasheets) — results include source URLs you can web-fetch for full articles/PDFs. Product-alias detection is automatic — queries mentioning model names (e.g. "mso64b", "6 series b", "4 series mso") boost matching-family chunks without needing modelFamily.',
          },
          query: { type: 'string', description: 'Short targeted search phrase. Prefer exact bug names, procedure names, symptoms, or keywords. For user how-to questions, search tek_docs first for conceptual guidance, then scpi for exact command syntax.' },
          topK: { type: 'number', description: 'Max chunks to return (default 5).' },
          modelFamily: { type: 'string', description: 'Optional instrument model family for tek_docs corpus (e.g. MSO6, MSO5, MSO4, DPO7000). Hard-filters out chunks tagged for other families. Note: even without this, if the query contains a product alias (e.g. "mso64b bandwidth", "6 series b trigger"), the search automatically boosts matching-family chunks and demotes wrong-family ones. General content with no model-specific tags always passes through.' },
        },
        required: ['corpus', 'query'],
        additionalProperties: false,
      },
    },
    {
      name: 'search_known_failures',
      description:
        'Search the curated known-failures corpus for symptoms, root causes, and fixes. ' +
        'Use when the user reports an error, timeout, unexpected behavior, or a known bad pattern.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Symptom/error text to search.' },
          limit: { type: 'number', description: 'Max results (default 5).' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_template_examples',
      description:
        'Retrieve matching workflow/template examples. ' +
        'Use when the user wants an example flow, a starting template, or prior patterns for a task such as jitter, decode, screenshot, or measurement setup.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Template search query.' },
          limit: { type: 'number', description: 'Max results (default 5).' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_policy',
      description: 'Load policy pack by mode.',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['steps_json', 'blockly_xml', 'scpi_verification', 'response_format', 'backend_taxonomy'],
          },
        },
        required: ['mode'],
        additionalProperties: false,
      },
    },
    {
      name: 'list_valid_step_types',
      description: 'List valid step/block types by mode and backend.',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['steps_json', 'blockly_xml'] },
          backend: { type: 'string', description: 'Optional backend filter.' },
        },
        required: ['mode'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_block_schema',
      description: 'Get required fields and valid values for a block type.',
      parameters: {
        type: 'object',
        properties: {
          blockType: { type: 'string', description: 'Blockly block type name.' },
        },
        required: ['blockType'],
        additionalProperties: false,
      },
    },
    {
      name: 'materialize_scpi_command',
      description: 'Build an exact concrete SCPI command string from a verified canonical command record. Use after search_scpi or get_command_by_header. Pass placeholderBindings such as {"CH<x>":"CH1","MEAS<x>":"MEAS1","{A|B}":"A"} and arguments or value for set syntax. If the user already specified a concrete instance like CH1 or B1, also pass concreteHeader so MCP can infer placeholder bindings deterministically. Copy the returned command verbatim into params.command.',
      parameters: {
        type: 'object',
        properties: {
          header: { type: 'string', description: 'Canonical SCPI header from source of truth, e.g. CH<x>:TERmination.' },
          concreteHeader: { type: 'string', description: 'Optional concrete header from the user intent, e.g. CH1:TERmination or BUS:B1:CAN:SOUrce, used to infer placeholder bindings.' },
          family: { type: 'string', description: 'Optional family filter.' },
          commandType: { type: 'string', enum: ['set', 'query'], description: 'Whether to materialize the set or query syntax.' },
          placeholderBindings: {
            type: 'object',
            description: 'Exact placeholder replacements, e.g. {"CH<x>":"CH1","MEAS<x>":"MEAS1","{A|B}":"A","<x>":"1"}',
            additionalProperties: { type: ['string', 'number', 'boolean'] },
          },
          argumentBindings: {
            type: 'object',
            description: 'Optional exact replacements for argument placeholders, e.g. {"<NR3>":"50"}',
            additionalProperties: { type: ['string', 'number', 'boolean'] },
          },
          arguments: {
            type: 'array',
            description: 'Optional positional values to substitute into remaining argument placeholders in syntax order.',
            items: { type: ['string', 'number', 'boolean'] },
          },
          value: {
            type: ['string', 'number', 'boolean'],
            description: 'Shorthand single positional value for simple set commands.',
          },
        },
        required: ['header'],
        additionalProperties: false,
      },
    },
    {
      name: 'materialize_scpi_commands',
      description:
        'Batch-build exact concrete SCPI command strings from verified canonical command records. Prefer over repeated materialize_scpi_command when several related commands must be instantiated in one turn.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: 'Array of batch SCPI materialization requests.',
            items: {
              type: 'object',
              properties: {
                header: { type: 'string' },
                concreteHeader: { type: 'string' },
                family: { type: 'string' },
                commandType: { type: 'string', enum: ['set', 'query'] },
                placeholderBindings: {
                  type: 'object',
                  additionalProperties: { type: ['string', 'number', 'boolean'] },
                },
                argumentBindings: {
                  type: 'object',
                  additionalProperties: { type: ['string', 'number', 'boolean'] },
                },
                arguments: {
                  type: 'array',
                  items: { type: ['string', 'number', 'boolean'] },
                },
                value: { type: ['string', 'number', 'boolean'] },
              },
              required: ['header'],
              additionalProperties: false,
            },
          },
        },
        required: ['items'],
        additionalProperties: false,
      },
    },
    {
      name: 'finalize_scpi_commands',
      description:
        'One-call SCPI endgame for hosted chat: batch-build exact concrete SCPI command strings from verified canonical headers and confirm they passed MCP exact verification. Prefer this over separate materialize_scpi_commands plus verify_scpi_commands for common requests.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: 'Array of SCPI commands to finalize in one call.',
            items: {
              type: 'object',
              properties: {
                header: { type: 'string' },
                concreteHeader: { type: 'string' },
                family: { type: 'string' },
                commandType: { type: 'string', enum: ['set', 'query'] },
                placeholderBindings: {
                  type: 'object',
                  additionalProperties: { type: ['string', 'number', 'boolean'] },
                },
                argumentBindings: {
                  type: 'object',
                  additionalProperties: { type: ['string', 'number', 'boolean'] },
                },
                arguments: {
                  type: 'array',
                  items: { type: ['string', 'number', 'boolean'] },
                },
                value: { type: ['string', 'number', 'boolean'] },
              },
              required: ['header'],
              additionalProperties: false,
            },
          },
        },
        required: ['items'],
        additionalProperties: false,
      },
    },
    {
      name: 'materialize_tm_devices_call',
      description: 'Build an exact tm_devices Python call from a verified methodPath returned by search_tm_devices. Pass placeholderBindings such as {"channel":"1"} for paths like ch[x].termination.write, plus positional or keyword arguments, then copy the returned code verbatim into tm_device_command params.code.',
      parameters: {
        type: 'object',
        properties: {
          methodPath: { type: 'string', description: 'Verified tm_devices methodPath, e.g. ch[x].termination.write.' },
          model: { type: 'string', description: 'Optional model filter.' },
          objectName: { type: 'string', description: 'Optional root object name, default "scope".' },
          placeholderBindings: {
            type: 'object',
            description: 'Placeholder replacements for methodPath, e.g. {"channel":"1"}',
            additionalProperties: { type: ['string', 'number', 'boolean'] },
          },
          arguments: {
            type: 'array',
            description: 'Positional Python arguments for the call.',
            items: {},
          },
          keywordArguments: {
            type: 'object',
            description: 'Keyword Python arguments for the call.',
            additionalProperties: true,
          },
        },
        required: ['methodPath'],
        additionalProperties: false,
      },
    },
    {
      name: 'validate_action_payload',
      description: 'Validate the ACTIONS_JSON payload structure. Call this as the LAST step before outputting ACTIONS_JSON — catches missing saveAs, invalid step types, and schema errors.',
      parameters: {
        type: 'object',
        properties: {
          actionsJson: { type: 'object', description: 'Parsed ACTIONS_JSON object.' },
          originalSteps: { type: 'array', items: { type: 'object' }, description: 'Optional original steps for substitution checks.' },
        },
        required: ['actionsJson'],
        additionalProperties: false,
      },
    },
    {
      name: 'validate_device_context',
      description: 'Validate device context alignment for SCPI commands.',
      parameters: {
        type: 'object',
        properties: {
          steps: { type: 'array', items: { type: 'object' }, description: 'Steps to validate.' },
        },
        required: ['steps'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_instrument_state',
      description: 'Probe instrument identity/state via the local executor. In TekAutomate this is usually auto-targeted from the active live instrument. When multiple instruments are connected, call get_visa_resources first and pass visaResource explicitly (for example "TCPIP::192.168.1.100::INSTR"). Use outputMode="verbose" for full Python stdout/stderr/transcript.',
      parameters: {
        type: 'object',
        properties: {
          executorUrl: { type: 'string' },
          visaResource: { type: 'string' },
          backend: { type: 'string' },
          liveMode: { type: 'boolean' },
          outputMode: { type: 'string', enum: ['clean', 'verbose'] },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: 'probe_command',
      description: 'Probe a single SCPI command on the selected VISA instrument via the local executor. In TekAutomate this usually uses the active live instrument automatically. When multiple instruments are connected, call get_visa_resources first and pass visaResource explicitly. Use outputMode="verbose" to return full runtime output instead of only the query result.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'SCPI command to probe.' },
          executorUrl: { type: 'string' },
          visaResource: { type: 'string' },
          backend: { type: 'string' },
          liveMode: { type: 'boolean' },
          outputMode: { type: 'string', enum: ['clean', 'verbose'] },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
    {
      name: 'send_scpi',
      description:
        'Send one or more SCPI commands to the selected VISA instrument via the local executor. Queries return responses; writes return OK or error status. In TekAutomate this usually uses the active live instrument automatically. When multiple instruments are connected, call get_visa_resources first and pass visaResource explicitly.\n\n' +
        'ERROR CHECKING — mandatory after any write batch:\n' +
        'SCPI write commands do not confirm success on their own. After sending a group of write commands, always append ["*ESR?", "ALLEV?"] to the same commands array (or send them immediately after). Rules:\n' +
        '• *ESR? returns a bitmask integer — 0 means no errors. Non-zero means something failed:\n' +
        '    bit 5 (32) = Command Error (bad syntax / unknown command)\n' +
        '    bit 4 (16) = Execution Error (command rejected — wrong mode, out of range)\n' +
        '    bit 3  (8) = Device-Dependent Error\n' +
        '    bit 2  (4) = Query Error (interrupted or unterminated)\n' +
        '• ALLEV? returns the full human-readable error queue — read this whenever *ESR? is non-zero to understand exactly what failed.\n' +
        '• If *ESR? is non-zero: stop, report the ALLEV? errors, do NOT continue configuring the instrument on top of a bad state.',
      parameters: {
        type: 'object',
        properties: {
          commands: { type: 'array', items: { type: 'string' }, description: 'SCPI commands to send in order.' },
          executorUrl: { type: 'string' },
          visaResource: { type: 'string' },
          backend: { type: 'string' },
          liveMode: { type: 'boolean' },
          outputMode: { type: 'string', enum: ['clean', 'verbose'] },
          timeoutMs: { type: 'number', description: 'Optional per-command timeout in milliseconds.' },
        },
        required: ['commands'],
        additionalProperties: false,
      },
    },
    {
      name: 'capture_screenshot',
      description: 'Capture a screenshot from the live instrument. This is a verification tool — use it after actions that change what is visible on screen (channel enable/disable, scale/offset, decode setup, trigger config), when a measurement returns an unexpected value or 9.9E37, or when the user explicitly asks to see or check something visual. Also use as the final sign-off on any configuration task. IMPORTANT: pass analyze:true to receive the scope image — the response returns an MCP {type:"image"} content block containing the screenshot, rendered as vision by your client. Without analyze:true, the screenshot only refreshes the TekAutomate UI display and NO image data is returned. ANALYSIS RULE: treat screenshots as authoritative for visible instrument state. If a screenshot shows clipping, off-screen traces, disabled channels, or missing decode/table visibility, fix that first — do not trust or report measurements from a visibly clipping channel. After enabling a channel, verify it is visible, framed, and not clipping before analyzing it.',
      parameters: {
        type: 'object',
        properties: {
          executorUrl: { type: 'string' },
          visaResource: { type: 'string' },
          backend: { type: 'string' },
          liveMode: { type: 'boolean' },
          outputMode: { type: 'string', enum: ['clean', 'verbose'] },
          scopeType: { type: 'string', enum: ['modern', 'legacy'] },
          modelFamily: { type: 'string' },
          deviceDriver: { type: 'string' },
          analyze: { type: 'boolean', description: 'REQUIRED to receive the image. Pass true and the response includes an MCP {type:"image"} content block containing the scope screenshot. Without analyze:true, no image data is returned — only a confirmation that the UI display was updated.' },
          analysisTransport: { type: 'string', enum: ['auto', 'url', 'mcp_image', 'openai_image', 'claude_image'], description: 'Optional internal transport hint — leave unset. The server automatically selects the correct image format for your client.' },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: 'get_visa_resources',
      description: 'List available VISA resources from the local executor. Use this first when more than one instrument may be connected, then pass the chosen visaResource into send_scpi, probe_command, capture_screenshot, or other live tools. Prefer this over guessing instrument selection.',
      parameters: {
        type: 'object',
        properties: {
          executorUrl: { type: 'string' },
          visaResource: { type: 'string' },
          backend: { type: 'string' },
          liveMode: { type: 'boolean' },
          outputMode: { type: 'string', enum: ['clean', 'verbose'] },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: 'get_environment',
      description: 'Inspect the local executor runtime environment. Use when pyvisa, tm_devices, Python version, or backend/runtime setup matters. Use outputMode="verbose" for full runtime output.',
      parameters: {
        type: 'object',
        properties: {
          executorUrl: { type: 'string' },
          visaResource: { type: 'string' },
          backend: { type: 'string' },
          liveMode: { type: 'boolean' },
          outputMode: { type: 'string', enum: ['clean', 'verbose'] },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: 'discover_scpi',
      description:
        'Instrument State Discovery — captures and diffs scope settings using *LRN? command.\n\n' +
        'Three actions:\n' +
        '- action:"snapshot" — Captures full instrument state via *LRN? and stores it as baseline.\n' +
        '- action:"diff" — Captures current state and diffs against baseline. Returns exact SCPI commands that changed.\n' +
        '- action:"inspect" — Returns stored commands from last snapshot. Use filter to narrow (e.g. filter:"TRIGGER"). Use with get_command_by_header for full details on specific commands.\n\n' +
        'Use cases:\n' +
        '- Take a snapshot on connect to establish baseline instrument state\n' +
        '- After AI sends commands, diff to verify what changed and detect side effects\n' +
        '- User configures scope manually, then diff to capture the exact SCPI recipe\n\n' +
        'The diff returns:\n' +
        '- Changed commands (before → after values)\n' +
        '- Added commands (new settings)\n' +
        '- Removed commands\n' +
        '- scpiCommands array with exact set commands to reproduce all changes\n\n' +
        'Optional filter parameter narrows diff to a specific SCPI root (e.g. "TRIGGER", "BUS", "MEASUREMENT").\n\n' +
        'Safe: only sends *LRN? and *IDN? queries. Never sends set commands. No risk to instrument.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['snapshot', 'diff', 'inspect'],
            description: 'snapshot = capture baseline, diff = compare against baseline, inspect = browse stored commands.',
          },
          limit: {
            type: 'number',
            description: 'For inspect: max commands to return (default 50, max 200).',
          },
          filter: {
            type: 'string',
            description: 'Optional SCPI root filter for diff results. e.g. "TRIGGER", "BUS", "MEASUREMENT", "CH1".',
          },
          timeoutMs: {
            type: 'number',
            description: 'Timeout for *LRN? query in ms (default 10000, max 30000). Large scopes may need more time.',
          },
        },
        required: ['action'],
        additionalProperties: true,
      },
    },
  ];
}

// ── Slim MCP surface (for stdio / Streamable HTTP transports) ────────
// Only expose the gateway + live passthrough tools to the AI client.
// smart_scpi_lookup stays internal — used by MCP-only deterministic planner.
// Everything else is routed internally via tek_router's search_exec action.
const MCP_EXPOSED_TOOLS = new Set([
  // Gateway — advanced routing, build, save/learn, materialize, batch ops
  'tek_router',
  'stage_workflow_proposal',
  'get_current_workflow',
  'get_instrument_info',
  'get_run_log',
  // Direct knowledge tools — simple flat schemas, easy for AI
  'search_scpi',             // { query: "edge trigger", limit?: 10 }
  'smart_scpi_lookup',       // { query: "how do I measure voltage on CH1" }
  'verify_scpi_commands',    // { commands: ["CH1:SCAle 1.0"] }
  'browse_scpi_commands',    // { group?: "Trigger", filter?: "edge" }
  'get_command_by_header',   // { header: "TRIGger:A:EDGE:SOUrce" }
  'retrieve_rag_chunks',     // { corpus: "errors", query: "OPC Query Return Type" }
  'get_template_examples',   // { query: "jitter measurement" }
  // Live instrument tools
  'get_visa_resources',
  'send_scpi',
  'capture_screenshot',
  'discover_scpi',
]);

// Slim tek_router schema for MCP — only the params external AI needs.
// Full schema (with CRUD params) stays available for TekAutomate's internal calls.
const TEK_ROUTER_SLIM_PARAMS = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['search_exec', 'build', 'search', 'exec', 'info', 'list', 'create'],
      description: 'Operation. Use "search_exec" for most tasks.',
    },
    query: {
      type: 'string',
      description: 'Trigger phrase (e.g. "search scpi commands") or build description.',
    },
    args: {
      type: 'object',
      description: 'Inner tool parameters. Shape auto-selects the tool: args.header→exact lookup, args.query→fuzzy search, args.commands→verify, args.group→browse.',
    },
    toolId: {
      type: 'string',
      description: 'Tool ID for exec/info actions.',
    },
    limit: {
      type: 'number',
      description: 'Max results to return.',
    },
    modelFamily: {
      type: 'string',
      description: 'Instrument model filter: MSO2, MSO4, MSO5, MSO6, DPO7, AFG, AWG.',
    },
    debug: {
      type: 'boolean',
      description: 'Include match trace details.',
    },
  },
  required: ['action'],
  additionalProperties: true,  // Accept full params silently — just don't advertise them
};

export function getMcpExposedTools() {
  return getToolDefinitions()
    .filter(def => MCP_EXPOSED_TOOLS.has(def.name))
    .map(def => {
      if (def.name === 'tek_router') {
        return { ...def, parameters: TEK_ROUTER_SLIM_PARAMS };
      }
      return def;
    });
}

export async function runTool(name: string, args: Record<string, unknown>) {
  const fn = (TOOL_HANDLERS as unknown as Record<string, (a: Record<string, unknown>) => Promise<unknown>>)[name];
  if (!fn) {
    return { ok: false, data: null, sourceMeta: [], warnings: [`Unknown tool: ${name}`] };
  }
  return fn(args);
}

const PUBLIC_MCP_EXPOSED_TOOLS = new Set([
  'tek_router',
  ...(isLiveInstrumentEnabled() ? ['instrument_live'] : []),
  ...(isWorkflowUiEnabled() ? ['workflow_ui'] : []),
  'knowledge',
]);

const PUBLIC_TEK_ROUTER_PARAMS = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['search', 'lookup', 'browse', 'verify', 'build', 'save'],
      description: 'SCPI/build/save operation to run.',
    },
    query: {
      type: 'string',
      description: 'For action:"search" or action:"build" - targeted search phrase or build request.',
    },
    args: {
      type: 'object',
      description: 'Optional nested arguments for the selected action. You may also pass action arguments at the top level.',
    },
    header: {
      type: 'string',
      description: 'For action:"lookup" - exact SCPI header such as TRIGger:A:EDGE:SOUrce.',
    },
    group: {
      type: 'string',
      description: 'For action:"browse" - command group such as Trigger, Measurement, or Bus.',
    },
    filter: {
      type: 'string',
      description: 'For action:"browse" - optional keyword filter within the chosen group.',
    },
    commands: {
      type: 'array',
      items: { type: 'string' },
      description: 'For action:"verify" - fully formed SCPI commands to validate.',
    },
    limit: {
      type: 'number',
      description: 'Optional max results for search or browse.',
    },
    modelFamily: {
      type: 'string',
      description: 'Optional instrument family filter.',
    },
    kind: {
      type: 'string',
      enum: ['lesson'],
      description: 'For action:"save" — what kind of artifact to save. Only "lesson" is supported on the public surface (Lessons Learned — reference notes, NOT executable shortcuts). Default: "lesson".',
    },
    lesson: {
      type: 'string',
      description: 'For action:"save" — the one-line takeaway (max 300 chars). Required.',
    },
    observation: {
      type: 'string',
      description: 'For action:"save" — what was observed that led to the lesson (max 1200 chars). Required.',
    },
    implication: {
      type: 'string',
      description: 'For action:"save" — how automation should change going forward (max 1200 chars). Required.',
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'For action:"save" — searchable tags (max 12, each up to 48 chars). Used for later retrieval via knowledge{retrieve, corpus:"lessons"} and for the lessons side-channel in tek_router{search} results.',
    },
    scpiContext: {
      type: 'array',
      items: { type: 'string' },
      description: 'For action:"save" — optional list of SCPI commands this lesson is about (max 20). Helps future lookups tie lessons to specific headers.',
    },
  },
  required: ['action'],
  additionalProperties: true,
};

export function getSlimToolDefinitions() {
  return getToolDefinitions()
    .filter((def) => PUBLIC_MCP_EXPOSED_TOOLS.has(def.name))
    .map((def) => {
      if (def.name === 'tek_router') {
        return { ...def, parameters: PUBLIC_TEK_ROUTER_PARAMS };
      }
      return def;
    });
}
