# Provider Knowledge / Overlay Manifest Guide

## Overview

This guide is for **knowledge-style provider manifests**:

- video transcripts
- engineer notes
- troubleshooting writeups
- internal lab procedures
- app usage notes
- heuristics and best practices
- partial workflows that give direction but are not exact golden flows

Use this guide when the source material is **useful context**, but should **not** be forced into `ACTIONS_JSON` steps.

If the source is an exact, verified, repeatable SCPI procedure, use [PROVIDER_MANIFEST_GUIDE_SCPI.md](C:/Users/u650455/Desktop/Tek_Automator/Tek_Automator/mcp-server/PROVIDER_MANIFEST_GUIDE_SCPI.md) instead.

---

## What This Does

Knowledge / overlay manifests help the system in three ways:

1. Router discovery
- The router can search and execute provider entries directly.
- This is useful for named playbooks, checklists, or lab-specific helpers.

2. Build-time supplements
- During build generation, matched provider overlays can show up as curated findings/context.
- They do **not** need to replace the flow to be useful.

3. AI-time context
- When AI is used, matched provider overlays are injected into the prompt as curated guidance.
- This helps steer tool calls, workflow shape, troubleshooting direction, and follow-up verification.

Important:
- These manifests are **context and direction**, not proof of exact SCPI syntax.
- If exact commands are needed, the system should still verify them with MCP command tools.

---

## When To Use This Guide

Use a knowledge / overlay manifest when the source material is:

- directional
- explanatory
- tactical
- heuristic
- diagnostic
- incomplete from an execution standpoint
- useful even without exact commands

Examples:

- "How to think about AFG burst setup"
- "Common reasons waveform capture fails"
- "What to verify before enabling output"
- "Troubleshooting notes from a lab video"
- "App workflow notes for protocol decode"

Do **not** use this format for:

- exact verified SCPI recipes
- exact approved golden flows
- deterministic procedures already safe to apply directly

Those should remain `template` / SCPI workflow manifests.

---

## Runtime Model Today

Today, the runtime effectively supports two broad provider shapes:

1. `template`
- `handlerRef: "flow_template"`
- has real `steps`
- can act as a deterministic golden template

2. `overlay`
- usually `handlerRef: "static_result"` or `handlerRef: "echo_args"`
- no executable `steps` required
- contributes context for router search, build findings, and AI prompt guidance

In other words:

- exact flow = `template`
- contextual skill / knowledge = `overlay`

You do **not** need a separate `kind` field today.
The runtime already treats no-step, non-template provider entries as overlay-style supplements.

---

## File Structure

Keep files organized by topic area:

```text
providers/
  afg-knowledge.json
  scope-troubleshooting.json
  protocol-decode-notes.json
  waveform-capture-overlays.json
  power-analysis-guidance.json
  lab-checklists.json
```

One file per topic or skill family is usually easier to maintain than one giant mixed file.

---

## Recommended Entry Schema

This schema is compatible with the current runtime and broad enough for transcripts, notes, and overlays.

```json
{
  "id": "afg-burst-setup-knowledge",
  "name": "AFG Burst Setup Knowledge",
  "description": "Curated guidance for configuring burst mode on an AFG, including what to verify first, common failure points, and what still needs exact command verification.",
  "triggers": [
    "afg burst",
    "burst setup",
    "function generator burst",
    "set up burst mode on the generator"
  ],
  "tags": [
    "afg",
    "burst",
    "generator",
    "overlay",
    "troubleshooting",
    "workflow",
    "timing"
  ],
  "author": "Abdul / Lab Team",
  "version": "1.0",
  "tested": true,
  "category": "instrument",
  "handlerRef": "static_result",
  "handlerConfig": {
    "text": "Use this overlay as guidance for burst-mode setup. Verify mode, trigger source, cycle count, and output state before generating exact commands.",
    "data": {
      "summary": "Burst setup usually depends on burst mode, cycle count, trigger source, and safe output enable sequencing.",
      "keyPoints": [
        "Choose triggered vs gated burst behavior first.",
        "Verify cycle count before enabling output.",
        "Check trigger source and timing assumptions early."
      ],
      "pitfalls": [
        "Output enabled before settings are validated.",
        "Wrong trigger source causing no burst event.",
        "Assuming model-specific options without verification."
      ],
      "diagnosticClues": [
        "No burst output may indicate wrong trigger source or disabled burst state.",
        "Unexpected repetition may indicate wrong cycle count or gating mode."
      ],
      "recommendedApproach": [
        "Identify intended burst behavior.",
        "Verify source and trigger path.",
        "Resolve exact model-supported commands before generating final steps."
      ],
      "toolHints": [
        "tek_router search",
        "search_scpi",
        "get_command_by_header"
      ],
      "verificationNeeded": [
        "Exact burst mode command syntax",
        "Model-specific enum values",
        "Output enable sequence"
      ],
      "references": [
        "AFG burst setup transcript, March lab walkthrough"
      ]
    }
  },
  "match": {
    "keywords": [
      "afg burst",
      "burst setup",
      "burst mode setup",
      "function generator burst"
    ],
    "operations": [
      "burst mode",
      "trigger source",
      "cycle count"
    ],
    "deviceTypes": ["AFG"],
    "backends": ["pyvisa"],
    "priority": 4,
    "minScore": 0.75
  }
}
```

---

## Required High-Value Fields

These are the most important fields for knowledge / overlay manifests:

| Field | Why it matters |
|-------|----------------|
| `id` | Stable unique identifier |
| `name` | What the router and debug output show |
| `description` | High-value search text and context |
| `triggers` | Natural language retrieval phrases |
| `tags` | BM25 keyword support |
| `handlerRef` | Controls whether this is overlay-like or template-like |
| `handlerConfig.text` | Short provider guidance shown as context |
| `handlerConfig.data` | Structured knowledge payload |
| `author` / `version` / `tested` | Curation and trust metadata |
| `match.*` | Stronger routing and better precision |

---

## Recommended Handler Types

### `static_result`

Best for:

- knowledge snippets
- notes
- heuristics
- checklists
- troubleshooting overlays
- references that should return stable content

Use when the provider mainly exists to supply context.

### `echo_args`

Best for:

- overlays that should preserve user arguments
- lightweight router-side helpers
- provider tools where argument visibility is useful

Use when the provider is still contextual, but you want the executed tool result to show the incoming args.

### `flow_template`

Best for:

- true golden flows
- deterministic reusable procedures
- exact action templates

Do not use `flow_template` just because the source mentions actions.
Only use it when the source is safe and exact enough to become a real flow.

---

## How To Convert Paragraphs or Transcripts

Do **not** paste a paragraph and try to translate every sentence into a step.

Instead, extract structured knowledge:

1. `summary`
- What is this source about?
- When is it relevant?

2. `keyPoints`
- What does the source teach?
- What should the model remember?

3. `pitfalls`
- What commonly goes wrong?

4. `diagnosticClues`
- What symptoms suggest what causes?

5. `recommendedApproach`
- What order should the user or AI think through the problem?

6. `toolHints`
- Which MCP tools should likely be called next?

7. `verificationNeeded`
- What still must be verified before emitting exact syntax or executable steps?

This is the core mindset:

- transcript -> distilled guidance
- notes -> structured heuristics
- partial procedure -> overlay
- exact procedure -> template

---

## Writing Good Triggers

Triggers should be phrases a user might actually type.

Good:

```json
"triggers": [
  "afg burst",
  "burst setup",
  "generator burst timing",
  "set up burst mode on the generator"
]
```

Bad:

```json
"triggers": [
  "SOURce:BURSt:MODE",
  "SOURce:BURSt:NCYCles"
]
```

The user asks for intent, not manual headers.

---

## Writing Good Tags

Tags should include:

- instrument family
- domain keywords
- workflow terms
- troubleshooting terms
- use-case terms

Good:

```json
"tags": [
  "afg",
  "burst",
  "generator",
  "timing",
  "trigger",
  "cycle count",
  "overlay",
  "troubleshooting"
]
```

---

## Writing Good Descriptions

Descriptions should explain:

- what the knowledge helps with
- when to use it
- why it matters

Good:

```json
"description": "Curated guidance for configuring burst mode on an AFG, including what to verify first, common failure points, and what still needs exact command verification."
```

Bad:

```json
"description": "AFG burst info"
```

---

## Writing Good `handlerConfig.data`

Keep the data structured and high-signal.

Good keys:

- `summary`
- `keyPoints`
- `pitfalls`
- `diagnosticClues`
- `recommendedApproach`
- `toolHints`
- `verificationNeeded`
- `checks`
- `references`

This structure is easier for the system to surface than one giant blob of prose.

### Good

```json
"data": {
  "summary": "Burst setup depends on mode, trigger source, cycle count, and output state.",
  "keyPoints": [
    "Choose triggered vs gated first.",
    "Validate cycle count before output enable."
  ],
  "pitfalls": [
    "Wrong trigger source",
    "Output enabled too early"
  ],
  "toolHints": [
    "search_scpi",
    "get_command_by_header"
  ],
  "verificationNeeded": [
    "Exact model-specific syntax"
  ]
}
```

### Bad

```json
"data": {
  "text": "Here is a long unstructured paragraph copied from the transcript..."
}
```

---

## Match Fields

Use `match` to keep the provider library sharp and avoid noisy false positives.

Supported high-value fields:

- `keywords`
- `operations`
- `deviceTypes`
- `modelFamilies`
- `backends`
- `priority`
- `minScore`

Example:

```json
"match": {
  "keywords": [
    "burst setup",
    "generator burst",
    "afg burst"
  ],
  "operations": [
    "burst mode",
    "cycle count",
    "trigger source"
  ],
  "deviceTypes": ["AFG"],
  "backends": ["pyvisa"],
  "priority": 4,
  "minScore": 0.75
}
```

Guidance:

- `keywords` should capture the likely user phrasing
- `operations` should capture the actual task concepts
- `deviceTypes` should be as specific as the source allows
- `priority` should stay modest unless this is genuinely high-value curation

---

## Good Knowledge / Overlay Examples

### Transcript-Derived Knowledge

Use when:

- a transcript explains a workflow
- it contains heuristics and pitfalls
- it is useful context, not a safe exact procedure

Recommended handler:

- `static_result`

### Checklist Overlay

Use when:

- you have a preflight checklist
- you want the model to remember what to verify
- the checklist should influence generation, not replace it

Recommended handler:

- `static_result`

### Tactical Router Helper

Use when:

- you want a provider to return contextual info plus user args
- the provider is useful as a tool in the router lane

Recommended handler:

- `echo_args`

---

## What Not To Do

Do not:

- convert vague prose into fake `write` and `query` steps
- invent SCPI commands from summary text
- treat a transcript as exact syntax authority
- overload one manifest with five unrelated topics
- use very broad triggers like `"setup"` or `"configure instrument"`
- dump raw paragraphs into the manifest without structuring them

If the source mentions commands but they are not exact and verified:

- put them in `verificationNeeded`
- do not turn them into executable steps

---

## Suggested AI Prompt For Generating Knowledge Manifests

Use this when converting transcripts, notes, or internal docs:

```text
You are a TekAutomate provider manifest generator for knowledge and overlay manifests.

Convert the source material into a provider entry that helps with retrieval, contextual guidance, troubleshooting direction, and tool-selection support.

Do NOT force the source into executable SCPI steps unless it is clearly a verified exact procedure.

Return JSON only using this shape:
- id
- name
- description
- triggers
- tags
- author
- version
- tested
- category
- handlerRef
- handlerConfig.text
- handlerConfig.data.summary
- handlerConfig.data.keyPoints
- handlerConfig.data.pitfalls
- handlerConfig.data.diagnosticClues
- handlerConfig.data.recommendedApproach
- handlerConfig.data.toolHints
- handlerConfig.data.verificationNeeded
- match.keywords
- match.operations
- match.deviceTypes
- match.modelFamilies
- match.backends
- match.priority
- match.minScore

Rules:
- Use natural language triggers, not SCPI headers.
- Keep descriptions retrieval-friendly and specific.
- Preserve heuristics, warnings, symptoms, and sequencing logic.
- Do not invent commands.
- Put uncertainties under verificationNeeded.
- Use static_result or echo_args unless the source is truly a verified exact flow.
- Output JSON only.
```

---

## Quality Checklist

Before saving a knowledge / overlay manifest, verify:

- [ ] The source is not being forced into fake steps
- [ ] The entry is useful even without exact commands
- [ ] Triggers sound like real user phrasing
- [ ] Tags include domain and use-case terms
- [ ] Description explains what, when, and why
- [ ] `handlerConfig.text` is short and helpful
- [ ] `handlerConfig.data` is structured, not a prose dump
- [ ] `verificationNeeded` clearly marks unresolved exact syntax
- [ ] `author`, `version`, and `tested` are present when possible
- [ ] `match` fields are specific enough to avoid noisy false positives

---

## Summary

Use this guide when the provider should act like a **skill**, **playbook**, or **knowledge overlay**.

Think:

- "help the model reason better"
- "steer tool choice"
- "surface curated lab knowledge"
- "add direction without pretending to be exact syntax"

Do not think:

- "everything must become steps"

That distinction is the whole point of knowledge / overlay manifests.
