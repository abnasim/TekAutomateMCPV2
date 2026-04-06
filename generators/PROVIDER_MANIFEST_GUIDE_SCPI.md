# Provider Manifest Authoring Guide

## Overview

Provider manifests are JSON files in `providers/` that teach the router new workflows, skills, and tool patterns. No TypeScript required. Drop a JSON file, reload, and the AI can find and use it immediately.

Each manifest entry is a **recipe** — the AI reads the steps, understands the pattern, and adapts parameters (channel, measurement type, record length, etc.) to match what the user actually asked for.

---

## File Structure

```
providers/
  acquisition-workflows.json       ← single-seq, fastframe, average, envelope
  measurement-workflows.json       ← amplitude, timing, eye diagram, power
  bus-decode-workflows.json        ← I2C, SPI, CAN, CANFD, LIN, RS232
  trigger-workflows.json           ← edge, pulse width, runt, window, logic
  save-recall-workflows.json       ← screenshot, waveform, setup, session
  afg-workflows.json               ← AFG burst, sweep, modulation
  smu-workflows.json               ← SMU source, measure, IV curve
  sync-patterns.json               ← OPC, WAI, BUSY synchronization patterns
  compliance-workflows.json        ← USB, PCIe, HDMI, ethernet presets
  power-analysis-workflows.json    ← power rail, ripple, switching loss
```

One file per topic area. Each file contains an array of tool entries.

---

## Entry Schema

```json
{
  "id": "workflow:<descriptive-kebab-case-name>",
  "name": "<Human Readable Name>",
  "description": "<What this workflow does and when to use it>",
  "triggers": ["<natural language phrases a user would say>"],
  "tags": ["<keywords for BM25 search>"],
  "category": "template",
  "schema": {
    "type": "object",
    "properties": {
      "<param>": {
        "type": "string",
        "description": "<what this parameter controls>",
        "enum": ["<valid values if known>"]
      }
    }
  },
  "steps": [
    {
      "id": "<unique step id>",
      "type": "write | query | save_screenshot | save_waveform | error_check",
      "label": "<short human-readable description>",
      "params": {
        "command": "<exact SCPI command>",
        "saveAs": "<variable name, required for query type>"
      }
    }
  ]
}
```

### Required Fields

| Field | Purpose |
|-------|---------|
| `id` | Unique identifier. Use `workflow:<kebab-case>` format |
| `name` | Human-readable name shown in search results |
| `description` | What the workflow does. Used for BM25 ranking — be descriptive |
| `triggers` | 3-6 natural language phrases for Stage 1 exact matching |
| `tags` | Keywords for Stage 2 BM25 search. Include SCPI keywords, instrument types, use cases |
| `category` | Use `template` for step-based workflows, `shortcut` for metadata-only |
| `schema` | Parameters the user can customize. Include `enum` for known valid values |
| `steps` | The actual SCPI command sequence. Omit for metadata-only tools |

### Step Types

| Type | Usage | Required Params |
|------|-------|-----------------|
| `write` | Send SCPI set command | `command` |
| `query` | Send SCPI query, store result | `command`, `saveAs` |
| `save_screenshot` | Capture scope screen | `filename`, `scopeType`, `method` |
| `save_waveform` | Save waveform data | `source`, `format`, `filename` |
| `error_check` | Query and check error status | (none) |
| `connect` | Connect to instrument | `instrumentIds`, `printIdn` |
| `disconnect` | Disconnect from instrument | (none) |

---

## Writing Good Triggers

Triggers are exact-match keywords for instant lookup (Stage 1). Write them as **natural language phrases a user would type**, not SCPI headers.

```json
// GOOD triggers
"triggers": ["single sequence", "single shot", "acquire and measure", "one shot acquisition"]

// BAD triggers (too technical, users won't type these)
"triggers": ["ACQuire:STOPAfter SEQuence", "ACQUIRE:STATE"]
```

Aim for 3-6 triggers per entry. Cover:
- The official term ("single sequence acquisition")
- Common shorthand ("single shot")
- What the user wants to do ("acquire and measure one waveform")

---

## Writing Good Tags

Tags feed the BM25 keyword search (Stage 2). Include:
- SCPI command keywords (`acquire`, `stopafter`, `sequence`)
- Instrument type (`scope`, `afg`, `smu`)
- Use case keywords (`synchronization`, `opc`, `timing`)
- Related concepts (`waveform`, `measurement`, `capture`)

```json
"tags": ["acquire", "single", "sequence", "stopafter", "opc", "synchronization", 
         "waveform", "measurement", "scope"]
```

---

## Writing Good Descriptions

The description is the most important field for search ranking. Write it as a complete sentence that covers:
- What the workflow does
- When to use it
- Key technical details

```json
// GOOD — descriptive, searchable
"description": "Acquire a single-sequence waveform with OPC synchronization, then take a measurement on the acquired data. Handles acquisition setup, stop-after-sequence mode, OPC sync to prevent premature measurement, and result readback."

// BAD — too short, poor search ranking
"description": "Single shot acquire"
```

---

## Writing Steps

### Use exact SCPI syntax from the manual

Copy command syntax directly from the Tektronix programmer manual. Do not invent or abbreviate commands.

```json
// GOOD — exact manual syntax
{ "command": "ACQuire:STOPAfter SEQuence" }

// BAD — invented abbreviation
{ "command": "ACQ:STOP SEQ" }
```

### Add OPC synchronization where the manual shows it

If the manual says to use `*OPC`, `*WAI`, or `BUSY` for synchronization, include the sync step:

```json
{ "id": "7", "type": "query", "label": "Wait for acquisition complete", "params": { "command": "*OPC?", "saveAs": "opc_sync" } }
```

### Every query must have saveAs

```json
// GOOD
{ "type": "query", "params": { "command": "MEASUrement:MEAS1:RESUlts:CURRentacq:MEAN?", "saveAs": "amplitude_result" } }

// BAD — missing saveAs
{ "type": "query", "params": { "command": "MEASUrement:MEAS1:RESUlts:CURRentacq:MEAN?" } }
```

### Group steps logically

Use comments in labels to show logical sections:

```json
{ "id": "1", "label": "Stop acquisition",           "type": "write", "params": { "command": "ACQuire:STATE OFF" } },
{ "id": "2", "label": "Enable CH1 display",          "type": "write", "params": { "command": "DISPlay:WAVEView1:CH1:STATE 1" } },
{ "id": "3", "label": "Set record length",           "type": "write", "params": { "command": "HORizontal:RECOrdlength 1000" } },
{ "id": "4", "label": "Set sample mode",             "type": "write", "params": { "command": "ACQuire:MODe SAMple" } },
{ "id": "5", "label": "Set single sequence",         "type": "write", "params": { "command": "ACQuire:STOPAfter SEQuence" } },
{ "id": "6", "label": "Start acquisition",           "type": "write", "params": { "command": "ACQuire:STATE ON" } },
{ "id": "7", "label": "Wait for OPC sync",           "type": "query", "params": { "command": "*OPC?", "saveAs": "opc_sync" } },
{ "id": "8", "label": "Set measurement type",        "type": "write", "params": { "command": "MEASUrement:MEAS1:TYPe AMPLITUDE" } },
{ "id": "9", "label": "Set measurement source",      "type": "write", "params": { "command": "MEASUrement:MEAS1:SOUrce CH1" } },
{ "id": "10", "label": "Read measurement result",    "type": "query", "params": { "command": "MEASUrement:MEAS1:RESUlts:CURRentacq:MEAN?", "saveAs": "amplitude_result" } }
```

### Use substitutable defaults

Use `CH1`, `MEAS1`, `1000`, etc. as defaults that the AI can swap based on user request:

```json
{ "command": "DISPlay:WAVEView1:CH1:STATE 1" }
// AI adapts to: DISPlay:WAVEView1:CH3:STATE 1
```

---

## Using AI to Generate Manifests

### System Prompt

Paste this into Claude or GPT, then feed it manual pages:

```
You are a TekAutomate provider manifest generator. Given a page from a Tektronix 
programmer manual, extract it into a JSON array entry with this exact schema:

{
  "id": "workflow:<descriptive-kebab-case-name>",
  "name": "<human readable name>",
  "description": "<what this workflow does, when and why to use it, key technical details>",
  "triggers": ["<3-6 natural language phrases a user would type to invoke this>"],
  "tags": ["<relevant keywords for BM25 search, include SCPI keywords and use cases>"],
  "category": "template",
  "schema": {
    "type": "object",
    "properties": {
      // parameters the user can customize
      // include enum arrays for known valid values from the manual
    }
  },
  "steps": [
    // actual SCPI step sequence from the manual
    // type: "write" for set commands
    // type: "query" for ? commands — MUST include saveAs
    // add *OPC? query steps where the manual shows synchronization
    // use labels that describe what each step does
  ]
}

Rules:
- Use EXACT SCPI syntax from the manual. Do not invent or abbreviate commands.
- Add *OPC? sync where the manual shows synchronization is needed.
- Every query step MUST have a saveAs field.
- Use default values (CH1, 1000, AMPLITUDE) that the AI can substitute later.
- Triggers must be natural language phrases, not SCPI headers.
- Description should be a full sentence explaining what, when, and why.
- Tags should include both SCPI keywords and natural-language use case terms.
- Step IDs should be sequential strings ("1", "2", "3", ...).
```

### Batch Workflow

1. Open a chapter from the programmer manual (e.g. "Acquisition Commands")
2. Screenshot or copy 3-5 example workflows from that chapter
3. Paste them with the system prompt above
4. AI generates the JSON entries
5. Review: check SCPI syntax matches the manual exactly
6. Save as `providers/<topic>-workflows.json`
7. Reload: `POST /ai/router/reload-providers`
8. Test: `tek_router({ action: "search", query: "<your trigger phrase>" })`

### What to Extract From the Manual

| Manual Section | Manifest Topic | Priority |
|----------------|---------------|----------|
| Acquisition examples | `acquisition-workflows.json` | High |
| Measurement examples | `measurement-workflows.json` | High |
| Trigger setup examples | `trigger-workflows.json` | High |
| Bus decode setup guides | `bus-decode-workflows.json` | High |
| Save/export examples | `save-recall-workflows.json` | Medium |
| Synchronization patterns | `sync-patterns.json` | High |
| AFG/AWG programming guide | `afg-workflows.json` | Medium |
| SMU programming guide | `smu-workflows.json` | Medium |
| Compliance test procedures | `compliance-workflows.json` | Low |
| Power analysis setup | `power-analysis-workflows.json` | Low |

### Quality Checklist

After AI generates an entry, verify:

- [ ] SCPI commands match the manual exactly (case, colons, spacing)
- [ ] `*OPC?` sync is present where the manual shows synchronization
- [ ] Every query step has `saveAs`
- [ ] Triggers are natural language, not SCPI
- [ ] Description is a full sentence
- [ ] Schema properties cover the customizable parameters
- [ ] Step IDs are unique within the entry
- [ ] Valid value enums match the manual's documented values

---

## Complete Example

From the programmer manual page showing "Acquiring and Measuring a Single-Sequence Waveform":

```json
[
  {
    "id": "workflow:single-seq-acquire-measure",
    "name": "Single-Sequence Acquire and Measure",
    "description": "Acquire a single-sequence waveform with OPC synchronization, then take a measurement on the acquired data. Sets up conditional acquisition with stop-after-sequence mode, starts acquisition, waits for OPC completion to prevent premature measurement, then configures and reads the measurement. Essential for accurate single-shot measurements where acquisition timing matters.",
    "triggers": [
      "single sequence",
      "single shot acquire",
      "acquire and measure",
      "one shot acquisition",
      "single sequence measurement",
      "stopafter sequence"
    ],
    "tags": [
      "acquire", "single", "sequence", "stopafter", "opc", "synchronization",
      "waveform", "measurement", "conditional", "sample", "scope"
    ],
    "category": "template",
    "schema": {
      "type": "object",
      "properties": {
        "channel": {
          "type": "string",
          "description": "Channel to acquire and measure",
          "enum": ["CH1", "CH2", "CH3", "CH4", "CH5", "CH6", "CH7", "CH8"]
        },
        "recordLength": {
          "type": "string",
          "description": "Horizontal record length (default 1000)"
        },
        "measurementType": {
          "type": "string",
          "description": "Type of measurement to take after acquisition",
          "enum": [
            "AMPLITUDE", "FREQUENCY", "PERIOD", "PK2PK", "MEAN", "RMS",
            "RISETIME", "FALLTIME", "HIGH", "LOW", "MAXIMUM", "MINIMUM",
            "POVERSHOOT", "NOVERSHOOT", "PWIDTH", "NWIDTH"
          ]
        },
        "acquireMode": {
          "type": "string",
          "description": "Acquisition mode",
          "enum": ["SAMple", "HIRes", "AVErage", "ENVelope"]
        }
      }
    },
    "steps": [
      {
        "id": "1",
        "type": "write",
        "label": "Stop acquisition",
        "params": { "command": "ACQuire:STATE OFF" }
      },
      {
        "id": "2",
        "type": "write",
        "label": "Enable CH1 display",
        "params": { "command": "DISPlay:WAVEView1:CH1:STATE 1" }
      },
      {
        "id": "3",
        "type": "write",
        "label": "Set record length to 1000",
        "params": { "command": "HORizontal:RECOrdlength 1000" }
      },
      {
        "id": "4",
        "type": "write",
        "label": "Set sample acquisition mode",
        "params": { "command": "ACQuire:MODe SAMple" }
      },
      {
        "id": "5",
        "type": "write",
        "label": "Set stop after single sequence",
        "params": { "command": "ACQuire:STOPAfter SEQuence" }
      },
      {
        "id": "6",
        "type": "write",
        "label": "Start acquisition",
        "params": { "command": "ACQuire:STATE ON" }
      },
      {
        "id": "7",
        "type": "query",
        "label": "Wait for acquisition complete (OPC sync)",
        "params": { "command": "*OPC?", "saveAs": "opc_sync" }
      },
      {
        "id": "8",
        "type": "write",
        "label": "Set measurement type to AMPLITUDE",
        "params": { "command": "MEASUrement:MEAS1:TYPe AMPLITUDE" }
      },
      {
        "id": "9",
        "type": "write",
        "label": "Set measurement source to CH1",
        "params": { "command": "MEASUrement:MEAS1:SOUrce CH1" }
      },
      {
        "id": "10",
        "type": "query",
        "label": "Read amplitude measurement result",
        "params": {
          "command": "MEASUrement:MEAS1:RESUlts:CURRentacq:MEAN?",
          "saveAs": "amplitude_result"
        }
      }
    ]
  }
]
```

---

## Testing After Adding

```bash
# Reload providers
curl -X POST http://localhost:8787/ai/router/reload-providers

# Verify it loaded
curl http://localhost:8787/ai/router/health

# Search for it
curl -X POST http://localhost:8787/ai/router \
  -H "Content-Type: application/json" \
  -d '{"action":"search","query":"single sequence acquire"}'

# Execute it
curl -X POST http://localhost:8787/ai/router \
  -H "Content-Type: application/json" \
  -d '{"action":"exec","toolId":"workflow:single-seq-acquire-measure","args":{"channel":"CH3","measurementType":"FREQUENCY","recordLength":"10000"}}'
```

---

## Summary

| Approach | When | Time | Code? |
|----------|------|------|-------|
| Metadata-only entry | AI just needs to know the tool exists | 30 sec | No |
| Entry with full steps | AI needs a recipe to adapt | 2 min | No |
| Code handler | Workflow has dynamic branching logic | 5 min | Yes |
| AI-generated batch | Extracting a whole manual chapter | 10 min for 10-20 entries | No |
