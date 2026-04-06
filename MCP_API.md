# TekAutomate Hosted AI API

This file documents the current HTTP API exposed by the TekAutomate MCP server.

## Important note

This server is MCP-powered internally, but today it exposes a custom HTTP API.

That means:
- TekAutomate uses an internal tool loop and tool registry.
- External apps can call the HTTP endpoints documented here.
- Generic MCP clients such as VS Code MCP integrations cannot connect directly yet unless a standard MCP transport is added.

## Base URL

Examples:
- `http://localhost:8787`
- `https://your-hosted-domain.example.com`

## Authentication

Current behavior:
- `/ai/chat` expects provider credentials in the JSON body for `mcp_ai` mode.
- `/ai/responses-proxy` uses the server-side `OPENAI_SERVER_API_KEY`.
- `/ai/key-test` validates a provider API key supplied in the JSON body.

The server does not currently expose a separate bearer-token auth layer for TekAutomate API consumers.

## Endpoints

### `GET /health`

Returns:

```json
{
  "ok": true,
  "status": "ready"
}
```

### `GET /ai/debug/last`

Returns the latest captured debug bundle, including prompts, tool trace, and timing metadata.

### `POST /ai/chat`

Main orchestration endpoint.

Used for:
- conversational AI
- build flows
- live tool access

Minimal request shape:

```json
{
  "userMessage": "What do you see on the scope?",
  "outputMode": "chat",
  "interactionMode": "live",
  "mode": "mcp_ai",
  "provider": "openai",
  "apiKey": "sk-...",
  "model": "gpt-5.4-nano",
  "flowContext": {
    "backend": "pyvisa",
    "host": "127.0.0.1",
    "connectionType": "tcpip",
    "modelFamily": "MSO6B",
    "steps": [],
    "selectedStepId": null,
    "executionSource": "live"
  },
  "runContext": {
    "runStatus": "done",
    "logTail": "",
    "auditOutput": "",
    "exitCode": 0
  }
}
```

Typical response:

```json
{
  "ok": true,
  "text": "Assistant response",
  "displayText": "Assistant response",
  "openaiThreadId": "resp_...",
  "errors": [],
  "warnings": [],
  "metrics": {
    "totalMs": 1234,
    "provider": "openai",
    "iterations": 1,
    "toolCalls": 0,
    "toolMs": 0,
    "modelMs": 1200
  }
}
```

### `POST /ai/responses-proxy`

Streaming proxy to OpenAI Responses API using a server-side key.

### `POST /ai/key-test`

Validates a provider key and model combination.

### Router endpoints

Available only when `MCP_ROUTER_ENABLED=true`:
- `GET /ai/router/health`
- `POST /ai/router`
- `POST /ai/router/reload-providers`

## Tool catalog

Tools are registered in `src/tools/index.ts`.

### Retrieval and lookup

- `smart_scpi_lookup`
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

### Materialization and validation

- `materialize_scpi_command`
- `materialize_scpi_commands`
- `finalize_scpi_commands`
- `materialize_tm_devices_call`
- `validate_action_payload`
- `validate_device_context`
- `verify_scpi_commands`

### Live instrument tools

- `get_instrument_state`
- `probe_command`
- `send_scpi`
- `capture_screenshot`
- `get_visa_resources`
- `get_environment`

## Live instrument context

Live tools depend on `instrumentEndpoint` context like:

```json
{
  "executorUrl": "http://127.0.0.1:8765",
  "visaResource": "TCPIP::127.0.0.1::INSTR",
  "backend": "pyvisa",
  "liveMode": true,
  "outputMode": "clean"
}
```

## External usage

Today, external users can integrate through the HTTP API.

Good fits:
- internal apps
- scripts
- custom agents
- web apps

Not supported yet as a standard MCP integration target:
- generic VS Code MCP clients
- generic MCP desktop clients expecting stdio or MCP JSON-RPC transport

To support those directly, add a standard MCP transport layer later.
