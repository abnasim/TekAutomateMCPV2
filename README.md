# TekAutomate MCP Server


This server is the AI orchestration layer for TekAutomate. It accepts full workspace context from the app, runs tool-assisted reasoning (or deterministic shortcuts), validates output, and returns applyable `ACTIONS_JSON`.

## What it does

- Hosts AI chat endpoint used by TekAutomate (`/ai/chat`).
- Proxies OpenAI Responses API with a server-owned key and vector store (`/ai/responses-proxy`).
- Loads and indexes local project knowledge.
- `public/commands/*.json` (SCPI command truth source).
- `public/rag/*.json` (retrieval chunks).
- `public/templates/*.json` (workflow examples).
- `mcp-server/policies/*.md` (behavior and output constraints).
- Exposes a tool catalog for retrieval, validation, and optional live instrument probing.
- Applies post-check and repair logic before returning final text.
- Stores request/debug artifacts for diagnostics.

## High-level flow

1. TekAutomate sends `POST /ai/chat` with:
- `userMessage`
- provider/model/key
- full `flowContext` (steps, backend, model family, selected step, validation state)
- full `runContext` (logs/audit/exit code)
- optional `instrumentEndpoint` (code executor + VISA resource)
2. MCP server runs `runToolLoop(...)`:
- deterministic shortcut path when eligible
- or provider path (OpenAI hosted Responses/tool loop, OpenAI chat-completions fallback, Anthropic)
3. Post-check validates and normalizes response:
- `ACTIONS_JSON` structure
- step schema and IDs
- `saveAs` presence/deduplication
- SCPI verification pipeline
- prose truncation guard
4. Server returns JSON payload:
- `text`
- `displayText`
- `openaiThreadId`
- `errors`
- `warnings`
- `metrics`

## Endpoints

- `GET /health`
- returns `{ ok: true, status: "ready" }` when indexes are loaded.
- `GET /ai/debug/last`
- returns last debug bundle (prompts, timings, tool trace metadata).
- `POST /ai/chat`
- main orchestration endpoint for TekAutomate assistant.
- `POST /ai/responses-proxy`
- streaming Responses proxy using `OPENAI_SERVER_API_KEY` and optional `COMMAND_VECTOR_STORE_ID`.
- `POST /ai/key-test`
- validates provider/key/model reachability (`openai` or `anthropic`).
- `POST /ai/models`
- lists available models for given provider/key.

## Tooling surface

Server tools are grouped into retrieval, materialization, validation, and live-instrument calls.

- Retrieval tools:
- `search_scpi`
- `get_command_group`
- `get_command_by_header`
- `get_commands_by_header_batch`
- `search_tm_devices`
- `retrieve_rag_chunks`
- `search_known_failures`
- `get_template_examples`
- `get_policy`
- `list_valid_step_types`
- `get_block_schema`
- Materialization tools:
- `materialize_scpi_command`
- `materialize_scpi_commands`
- `finalize_scpi_commands`
- `materialize_tm_devices_call`
- Validation tools:
- `validate_action_payload`
- `validate_device_context`
- `verify_scpi_commands`
- Live instrument tools (via code executor):
- `get_instrument_state`
- `probe_command`
- `get_visa_resources`
- `get_environment`

## Deterministic shortcut features

The server includes shortcut builders for common requests to produce fast, consistent actions without full model/tool loops when conditions match.

- Measurement shortcut (including scoped channel handling and standard measurement sets).
- FastFrame shortcut for pyvisa flows.
- Common pyvisa server shortcut for frequent setup/build patterns.
- `tm_devices` measurement shortcut.
- Planner-driven deterministic shortcut from parsed intent + command index.

These shortcuts still pass through post-check before response.

## Safety and output enforcement

- Strict action schema validation (`validate_action_payload`).
- Replace-flow hardening.
- ensures step IDs are present and unique
- can auto-group long flat flows into logical groups
- enforces/repairs query `saveAs`
- deduplicates save names
- SCPI verification and source-backed command handling.
- Python substitution guard in non-python flows.
- Response prose truncation guard (`MCP_POSTCHECK_MAX_PROSE_CHARS`, default 1200).
- Prompt/policy driven constraints loaded from:
- `mcp-server/prompts/*.md`
- `mcp-server/policies/*.md`

## Data and indexes

At startup, the server initializes:

- Command index (`public/commands/*.json`)
- tm_devices index
- RAG indexes (`public/rag/*.json`)
- Template index (`public/templates/*.json`)

Command sources include modern and legacy scope families plus AFG, AWG, SMU, DPOJET, TekExpress, and RSA datasets.

## Frontend integration

Current app integration resolves MCP host from:

- `localStorage["tekautomate.mcp.host"]`
- or `REACT_APP_MCP_HOST`
- fallback: `http://localhost:8787` only on localhost app hosts

Example:

```js
localStorage.setItem('tekautomate.mcp.host', 'http://localhost:8787');
```

## Run locally

```bash
cd mcp-server
npm install
npm run start
```

Default port is `8787` unless `MCP_PORT` is set.

## Environment variables

Copy `.env.example` to `.env` and set what you need.

- Required for `/ai/responses-proxy`:
- `OPENAI_SERVER_API_KEY`
- Optional retrieval augmentation:
- `COMMAND_VECTOR_STORE_ID`
- OpenAI routing/model controls:
- `OPENAI_BASE_URL`
- `OPENAI_DEFAULT_MODEL`
- `OPENAI_FLOW_MODEL`
- `OPENAI_REASONING_MODEL`
- `OPENAI_ASSISTANT_MODEL`
- `OPENAI_MAX_OUTPUT_TOKENS`
- Hosted prompt controls:
- `OPENAI_PROMPT_ID`
- `OPENAI_PROMPT_VERSION`
- legacy fallback accepted: `OPENAI_ASSISTANT_ID`
- Prompt file overrides:
- `TEKAUTOMATE_STEPS_INSTRUCTIONS_FILE`
- `TEKAUTOMATE_BLOCKLY_INSTRUCTIONS_FILE`
- Post-check tuning:
- `MCP_POSTCHECK_MAX_PROSE_CHARS`
- Server:
- `MCP_PORT`

## Scripts and verification

- `npm run start` / `npm run dev`
- `npm run eval:comprehensive`
- `npm run eval:levels`
- `npm run verify:command-groups`

Reference benchmark:

- `mcp-server/reports/level-benchmark-2026-03-18.md` shows 40/40 PASS in that run.

## Logs and debug artifacts

- Last debug state: `GET /ai/debug/last`
- Request logs are written under `mcp-server/src/logs/requests` (rotated, max 500 files).
- Additional logs and reports are under `mcp-server/logs` and `mcp-server/reports`.

## Internals: Planner, Materializers, and AI Routing

### Intent planner (`src/core/intentPlanner.ts`)

The planner is a deterministic parser + resolver layer used before (and sometimes instead of) LLM output.

Main responsibilities:

- Parse user text into structured intent fields (channels, trigger, measurements, bus decode, acquisition, save/recall, status, AFG/AWG/SMU/RSA).
- Detect device type and map request to relevant command families.
- Resolve concrete SCPI candidates against the command index.
- Return unresolved intents when command mapping is ambiguous.
- Run conflict checks (resource collisions / inconsistent intent combinations).

Core exported functions:

- `parseIntent(...)`: builds `PlannerIntent` from natural language.
- `planIntent(...)`: parse + resolve + conflict check, returning `PlannerOutput`.
- `resolve*Commands(...)`: domain resolvers such as `resolveTriggerCommands`, `resolveMeasurementCommands`, `resolveBusCommands`, `resolveSaveCommands`, etc.
- `parse*Intent(...)`: focused parsers such as `parseChannelIntent`, `parseTriggerIntent`, `parseMeasurementIntent`, `parseBusIntent`, etc.

### SCPI source of truth (`src/core/commandIndex.ts`)

- Loads command JSON files from `public/commands` once at startup.
- Normalizes heterogeneous command shapes (manual-entry rich format and flat format).
- Builds fast lookup structures for:
- exact header lookup (`getByHeader`)
- prefix lookup (`getByHeaderPrefix`)
- ranked query search (`searchByQuery`)
- Supports placeholder-aware header normalization (`CH<x>`, `MEAS<x>`, `BUS<x>`, `{A|B}`, etc.).

Current local index size (measured):

- ~`9307` normalized command records.

### SCPI retrieval functions

- `search_scpi` (`src/tools/searchScpi.ts`): query search + header-like direct matching merge.
- `get_command_by_header`: exact deterministic match for known headers.
- `get_commands_by_header_batch`: batch exact lookup for multiple headers.
- `get_command_group`: feature-area retrieval (group-level).
- `verify_scpi_commands` (`src/tools/verifyScpiCommands.ts`): validates commands (including exact syntax mode).

### Materializers

Materializers convert canonical records into concrete, applyable commands/calls.

- `materialize_scpi_command`:
- selects set/query syntax
- infers placeholder bindings from `concreteHeader`
- applies explicit bindings + argument values
- checks unresolved placeholders
- runs exact verification before returning success
- `materialize_scpi_commands`: batch wrapper around single materializer.
- `finalize_scpi_commands`: batch materialize + verified output packaging, used as endgame tool in hosted flows.
- `materialize_tm_devices_call`: builds exact Python call from verified `methodPath` and arguments.

### Tool loop and when server goes to AI for more info

Routing is centralized in `src/core/toolLoop.ts`.

Deterministic path first (no external model):

- In `mcp_only` mode, server tries deterministic shortcuts and planner synthesis first.
- If planner fully resolves commands, it can return applyable `ACTIONS_JSON` directly.
- If unresolved in `mcp_only`, server returns findings/suggested fixes instead of calling external AI.

AI path (`mcp_ai` and normal hosted usage):

- If deterministic path is not enough, server calls provider path:
- OpenAI hosted Responses (preferred for structured build/edit)
- OpenAI chat-completions fallback
- Anthropic messages path
- For hosted structured build, server preloads source-of-truth context via tools (`search_scpi`, `get_command_group`, `get_commands_by_header_batch`, or `search_tm_devices`) before/within the loop.
- Tool rounds are capped (`4` for hosted structured build, `3` default, `8` when forced tool mode).

Reliability fallbacks after AI response:

- Post-check pass validates and normalizes output.
- If model returns non-actionable output, server attempts hybrid planner gap-fill.
- If `ACTIONS_JSON` is malformed, server retries once with strict JSON-only instruction.
- If model output is weak in specific cases, server can fallback to deterministic shortcut output.

### Performance snapshot

From checked-in benchmark report:

- `mcp-server/reports/level-benchmark-2026-03-18.md`: 40/40 PASS.
- In that run, per-case `totalMs` ranged from about `1ms` to `254ms`.

Local micro-benchmark (quick developer run on this workspace; indicative, not production SLA):

- `searchByQuery` average: ~`0.54 ms` per lookup.
- `getByHeader` average: ~`0.009 ms` per lookup (hot path).
- `materializeScpiCommand` average (single-command path with verification): ~`25.4 ms`.
- `finalizeScpiCommands` average for 3-command batch: ~`1.8 ms`.

Use these as practical engineering baselines; real end-to-end latency depends more on provider/model calls than local index lookup.

### When to use MCP-only vs MCP+AI

Use `mcp_only` when:

- You want deterministic/local command resolution.
- You prefer speed and strictness over open-ended reasoning.
- The request is explicit enough for planner/materializers.

Use `mcp_ai` when:

- Request is complex, ambiguous, or cross-domain.
- You need richer reasoning, explanation, or conflict tradeoffs.
- Deterministic planner reports unresolved intent and you want model help.
