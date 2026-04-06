# Provider Manifest Guide

This is the **canonical provider JSON contract**.

Use this guide for both:

- exact reusable flow providers
- contextual overlay providers

Do **not** split your mental model into "SCPI JSON" vs "general info JSON".
The runtime accepts one provider manifest contract, and the entry shape determines whether the provider behaves like a **template** or an **overlay**.

---

## What The Runtime Actually Accepts

Provider files are loaded from top-level `providers/*.json`.

Each file must be:

- valid JSON
- a top-level array
- containing one or more provider entries

The loader and supplement catalog both read this same contract.

Hard requirements for each entry:

- `id`
- `name`
- `description`
- `handlerRef`

Hard validation rules:

- `id` must be non-empty
- `id` must not contain whitespace
- `name` must be non-empty
- `description` must be at least 10 characters
- `handlerRef` must resolve to a known provider handler

Known built-in handlers:

- `flow_template`
- `static_result`
- `echo_args`

Recommended fields for strong matching:

- `triggers`
- `tags`
- `author`
- `version`
- `tested`
- `match.keywords`
- `match.operations`
- `match.backends`
- `match.deviceTypes`
- `match.modelFamilies`
- `match.priority`
- `match.minScore`

---

## One Contract, Two Behaviors

The runtime effectively turns provider entries into two useful behaviors:

### Template

Use a template when the source is exact enough to become a deterministic reusable flow.

Template behavior is recognized by:

- `handlerRef: "flow_template"`
- real `steps` or `handlerConfig.steps`

Templates can act as golden flows and may override build generation when they match strongly.

### Overlay

Use an overlay when the source is better as guidance, context, troubleshooting, workflow direction, or a lightweight helper.

Overlay behavior is typically:

- `handlerRef: "static_result"` or `handlerRef: "echo_args"`
- no executable `steps` required

Overlays are used for:

- router discovery
- build-time findings and context
- AI-time guidance

---

## Source Type Decision Matrix

Use the source itself to decide what to emit.

### Emit a template

Choose a template when the source is mostly:

- an exact repeatable procedure
- a programmer manual example with clear execution order
- an approved golden workflow
- a Python example whose core value is the executable command sequence

Good signals:

- exact commands matter more than commentary
- the order of operations is clear
- the flow is reasonably reusable
- there are not many unresolved assumptions
- the core happy-path procedure can be expressed without dragging in optional branches or surrounding chapter content

### Emit an overlay

Choose an overlay when the source is mostly:

- guidance
- notes
- heuristics
- troubleshooting
- measurement interpretation
- workflow hints
- example code mixed with caveats and assumptions

Good signals:

- the source teaches "how to think about it"
- the source contains useful commands, but also warnings, caveats, or signal-dependent tuning
- the source is helpful even if no one runs it exactly as written

### Emit both

Choose both when the source clearly supports two different reusable assets:

- one exact enough to become a flow
- one contextual enough to guide future reasoning

Good examples:

- an example script with a reusable command sequence plus strong caveats and interpretation notes
- a lab-approved workflow that is also worth preserving as a playbook

### Emit nothing

Return no provider when the source is:

- too vague
- too incomplete
- too one-off
- mostly boilerplate
- not useful for retrieval or reuse

For programmer manual pages, the goal is not "convert the whole page."
The goal is "extract the smallest exact reusable procedure from the page."

---

## Canonical Entry Shape

```json
[
  {
    "id": "<stable-kebab-case-id>",
    "name": "<human readable title>",
    "description": "<clear searchable description>",
    "triggers": ["<natural language phrases>"],
    "tags": ["<retrieval keywords>"],
    "author": "<author or team if known>",
    "version": "<version if known>",
    "tested": false,
    "category": "<template | instrument | composite | shortcut | ...>",
    "handlerRef": "<flow_template | static_result | echo_args>",
    "handlerConfig": {},
    "schema": {
      "type": "object",
      "properties": {},
      "required": []
    },
    "match": {
      "keywords": ["<high-signal phrases>"],
      "operations": ["<task concepts>"],
      "backends": ["<pyvisa | tm_devices | workflow>"],
      "deviceTypes": ["<SCOPE | AFG | SMU | AWG | RSA | workflow>"],
      "modelFamilies": ["<only if clearly supported>"],
      "priority": 4,
      "minScore": 0.75
    },
    "steps": []
  }
]
```

Not every field is required in every entry, but this is the full contract you should author toward.

---

## Matching Rules That Matter

Provider matching is **not** based on raw JSON shape alone.

There are two ranking paths:

### Router matching

This uses:

- exact trigger match first
- then search over `name + description + tags + triggers + category`

So the most important router fields are:

- `name`
- `description`
- `triggers`
- `tags`

### Provider supplement matching

This uses deterministic scoring over:

- `match.keywords`
- `match.operations`
- backend compatibility
- device type compatibility
- model family compatibility
- a small name boost
- a small priority boost

Important thresholds:

- score `< 0.5` -> ignored
- score `>= 0.5` -> hint or context
- score `>= 0.75` -> template override eligible

Because of that, a provider with good `match.*` metadata will beat a provider that only has a big wall of description text.

---

## Text-Heavy Source Rules

For text-heavy sources such as:

- manuals
- application notes
- lab notes
- transcripts
- troubleshooting writeups
- internal guides

do **not** copy paragraphs into the manifest and call it done.

Instead, extract and reorganize the source into retrieval-friendly fields.

### What to extract

From the source, pull out:

- the main workflow or concept
- when it applies
- what the user is likely trying to do
- exact commands worth preserving
- setup order clues
- caveats
- troubleshooting clues
- verification gaps
- synonyms and alternate phrasing

### Where it should go

Map the extracted information into:

- `description` for a clean searchable summary
- `triggers` for realistic user asks
- `tags` for broad retrieval vocabulary
- `match.keywords` for strong phrase matching
- `match.operations` for task concepts
- `handlerConfig.data.commandsOfInterest` for exact SCPI worth preserving
- `handlerConfig.data.sequenceHighlights` for ordering logic
- `handlerConfig.data.keyPoints` for distilled ideas
- `handlerConfig.data.pitfalls` for failure modes
- `handlerConfig.data.performanceNotes` for throughput or tuning notes
- `handlerConfig.data.verificationNeeded` for unresolved specifics

### What not to do

Avoid:

- copying long paragraphs into `description`
- stuffing every noun from the document into `tags`
- using manual headers as `triggers`
- turning explanatory prose into fake steps
- emitting one giant provider that mixes several unrelated procedures

### Keyword quality matters

For text-heavy docs, good retrieval depends on having:

- user phrasing in `triggers`
- high-signal phrases in `match.keywords`
- broad concept vocabulary in `tags`

Think of them this way:

- `triggers` = what the user types
- `match.keywords` = what should match strongly
- `tags` = what helps discovery more broadly

---

## Authoring Rules

### `id`

- use stable kebab-case
- no whitespace
- keep it descriptive

Good:

- `workflow:fast-hw-averaging-math-export`
- `scope-fast-hw-averaging-guidance`

Bad:

- `Fast HW Averaging`
- `workflow:fast hw averaging`

### `name`

Use clear human-readable titles. This is part of search.

### `description`

Make it long enough to explain:

- what it does
- when it is relevant
- why it matters

Short descriptions hurt matching.

### `triggers`

Use natural language that a real engineer would type.

Good:

- `fast hardware averaging`
- `average waveform using math trace`
- `set up burst mode on generator`

Bad:

- `ACQuire:FASTAverage:STATe`
- `MATH:MATH1:AVG:WEIGHT`

For text-heavy sources, write triggers from the user's point of view, not the document's point of view.

Good:

- `why is my eye diagram closed`
- `set up spectrumview peak marker`
- `export measurement table from scope`

### `tags`

Use high-value retrieval terms:

- instrument
- domain
- workflow
- command families
- troubleshooting concepts

For text-heavy sources, tags should cover:

- instrument family
- measurement or workflow type
- troubleshooting concepts
- relevant command families
- important domain terms and synonyms

### `match.*`

This is the important supplement metadata.

Use:

- `keywords` for phrases that should strongly match user wording
- `operations` for task concepts
- `backends` for compatibility
- `deviceTypes` for compatibility
- `modelFamilies` only when truly supported
- `priority` as a small tie-breaker
- `minScore` to require stronger confidence

For text-heavy sources:

- keep `match.keywords` tighter and more specific than `tags`
- prefer phrases over isolated nouns
- use `operations` to express intent like `export waveform`, `configure marker`, `diagnose trigger miss`, `decode i2c`

### `author` / `version` / `tested`

These are not required for loading, but they are strongly recommended because they tell the user whether the provider is curated and trustworthy.

Use `tested: true` only when the source actually supports that claim.
For most generated manifests from example scripts, `tested: false` is the safer default.

### `schema`

Only add schema properties when the source clearly supports reusable user-facing parameters.

If the source just hardcodes a few example values and does not define a clean reusable parameter interface, an empty schema is better than invented parameters.

---

## Template Rules

Choose `flow_template` only when the source is genuinely reusable as a deterministic flow.

Template entries should usually have:

- `category: "template"`
- `handlerRef: "flow_template"`
- `handlerConfig.summary`
- `handlerConfig.backend`
- `handlerConfig.deviceType`
- real `steps`

For template steps:

- use only real TekAutomate step types
- every `query` needs `saveAs`
- use exact commands from the source
- keep Python only when it is part of the real reusable workflow
- inside Python, use `scpi` and normal Python locals
- do not use fake helper APIs like `context[...]`, `results[...]`, `session.write(...)`, or `args.get(...)`

If the source is mostly contextual or mixed, do **not** force it into a template just because it contains commands.

If the source is a Python script:

- drop plotting, CLI wrappers, local file browsing, benchmarking prints, and one-off setup noise
- keep only the reusable workflow core
- prefer one coherent `python` step when the script depends on shared locals, parsed values, or branching
- avoid fragmenting one stateful script into fake disconnected steps

---

## Overlay Rules

Choose an overlay when the source is most valuable as guidance rather than an exact flow.

Overlay entries should usually have:

- `category: "instrument"` for instrument-specific guidance
- `handlerRef: "static_result"` for stable contextual skills
- `handlerConfig.text`
- `handlerConfig.data`

Good overlay payloads usually contain:

- `summary`
- `commandsOfInterest`
- `sequenceHighlights`
- `keyPoints`
- `pitfalls`
- `performanceNotes`
- `recommendedApproach`
- `toolHints`
- `verificationNeeded`
- `references`

Overlays can still preserve exact commands.
They just preserve them as context, not as strict step execution.

For mixed Python scripts, overlays are often the safer default when the script contains:

- signal-dependent thresholds
- interpretation notes
- caveats about impedance or detector assumptions
- performance observations
- validation warnings

---

## Common Mistakes

Avoid these:

- forcing every SCPI-rich script into a `flow_template`
- inventing schema parameters that the source does not really expose
- marking generated content as `tested: true` without evidence
- using SCPI headers as `triggers`
- using huge vague `description` text without strong `match.*`
- creating a template and overlay that say the exact same thing with no distinct value
- copying text-heavy source material into provider JSON without reorganizing it into searchable fields

The goal is:

- template for execution
- overlay for guidance

If both entries do not clearly serve different purposes, do not emit both.

---

## Text-Heavy Extraction Checklist

Before you finalize a provider from a text-heavy source, check:

- Did you compress the source into a clean summary instead of copying it?
- Did you create user-facing `triggers` instead of document headings?
- Did you create specific `match.keywords` rather than a noisy word dump?
- Did you separate broad `tags` from strong-match phrases?
- Did you preserve exact commands only where they are useful?
- Did you capture caveats and verification needs?
- Did you avoid turning prose into fake steps?

---

## Golden Example From One Source

Source:

- [fast_HW_averaging 1.py](C:/Users/u650455/Downloads/fast_HW_averaging%201.py)

That same source can legitimately produce:

- one **template** manifest
- one **overlay** manifest

### Golden Template Example

```json
[
  {
    "id": "workflow:fast-hw-averaging-math-export",
    "name": "Fast HW Averaging with Math Export",
    "description": "Configure FastAcq hardware averaging into MATH1 on a 4/5/6 Series scope, wait for the averaging run to finish, and export the averaged math waveform. Use this when you want a reusable exact flow for high-speed hardware averaging backed by a math trace.",
    "triggers": [
      "fast hardware averaging",
      "fast averaging with math trace",
      "fastacq averaging export",
      "export fast averaged waveform"
    ],
    "tags": [
      "scope",
      "fastacq",
      "fastaverage",
      "math",
      "math1",
      "average",
      "curve",
      "fpbinary",
      "pyvisa"
    ],
    "author": "Tektronix example script",
    "version": "Python 3.10 / firmware 1.38+",
    "tested": false,
    "category": "template",
    "handlerRef": "flow_template",
    "handlerConfig": {
      "summary": "Configure FastAcq averaging into MATH1 and export the averaged waveform.",
      "backend": "pyvisa",
      "deviceType": "SCOPE"
    },
    "schema": {
      "type": "object",
      "properties": {}
    },
    "match": {
      "keywords": [
        "fast hardware averaging",
        "fastacq averaging",
        "math averaging export"
      ],
      "operations": [
        "configure averaging",
        "wait for acquisition complete",
        "export waveform"
      ],
      "backends": ["pyvisa"],
      "deviceTypes": ["SCOPE"],
      "modelFamilies": ["4/5/6 Series MSO"],
      "priority": 4,
      "minScore": 0.75
    },
    "steps": [
      { "id": "1", "type": "connect", "label": "Connect", "params": { "printIdn": true } },
      { "id": "2", "type": "write", "label": "Stop acquisition", "params": { "command": "acquire:state 0" } },
      { "id": "3", "type": "query", "label": "Wait for stop", "params": { "command": "*opc?", "saveAs": "opc_stop" } },
      { "id": "4", "type": "write", "label": "Define MATH1 from CH1", "params": { "command": "math:math1:define \"CH1\"" } },
      { "id": "5", "type": "write", "label": "Enable MATH1 averaging", "params": { "command": "math:math1:avg:mode ON" } },
      { "id": "6", "type": "write", "label": "Set MATH1 average weight", "params": { "command": "math:math1:avg:weight 32000" } },
      { "id": "7", "type": "write", "label": "Enable FastAverage", "params": { "command": "acquire:fastaverage:state ON" } },
      { "id": "8", "type": "write", "label": "Set FastAverage limit", "params": { "command": "acquire:fastaverage:limit 256" } },
      { "id": "9", "type": "write", "label": "Set FastAverage stopafter", "params": { "command": "acquire:fastaverage:stopafter 32000" } },
      { "id": "10", "type": "write", "label": "Set waveform source", "params": { "command": "data:source MATH1" } },
      { "id": "11", "type": "write", "label": "Set waveform encoding", "params": { "command": "data:encdg FPBinary" } },
      { "id": "12", "type": "python", "label": "Wait for completion and export math trace", "params": { "code": "import time\nimport numpy as np\nscpi.write('wfmoutpre:byt_n 4')\nscpi.write('acquire:numavg 256')\nscpi.write('acquire:mode average')\nscpi.write('acquire:fastacq:state ON')\nscpi.write('acquire:state ON')\nscpi.query('*opc?')\nacq_record = int(scpi.query('horizontal:recordlength?'))\nscpi.write('data:start 1')\nscpi.write(f'data:stop {acq_record}')\nwhile int(scpi.query('acquire:state?')) != 0:\n    time.sleep(0.05)\nmath_wave = scpi.query_binary_values('curve?', datatype='d', container=np.array, is_big_endian=True)\nprint('Exported samples:', len(math_wave))" } },
      { "id": "13", "type": "disconnect", "label": "Disconnect", "params": {} }
    ]
  }
]
```

### Golden Overlay Example

```json
[
  {
    "id": "scope-fast-hw-averaging-guidance",
    "name": "Fast HW Averaging Guidance",
    "description": "Contextual guidance for using FastAcq hardware averaging together with MATH1 accumulation on 4/5/6 Series scopes. Use this when you want the command pattern, workflow intent, and caveats without forcing the entire example script into an executable flow.",
    "triggers": [
      "fast hardware averaging",
      "fastacq averaging",
      "average waveform using math trace",
      "how do i use fast average on the scope"
    ],
    "tags": [
      "scope",
      "fastacq",
      "fastaverage",
      "math",
      "math1",
      "averaging",
      "performance",
      "guidance",
      "overlay"
    ],
    "author": "Tektronix example script",
    "version": "Python 3.10 / firmware 1.38+",
    "tested": false,
    "category": "instrument",
    "handlerRef": "static_result",
    "handlerConfig": {
      "text": "Use FastAverage when you need high-speed batched averaging and accumulate the result in MATH1 for deeper total averaging. Verify scaling and clipping before enabling dithering or exporting the result.",
      "data": {
        "summary": "This workflow combines FastAcq hardware averaging with a MATH1 average trace so the scope can accumulate many more averages than the hardware batch format alone. It is useful when acquisition speed matters more than a simple standard averaging setup.",
        "commandsOfInterest": [
          "acquire:fastaverage:state ON",
          "acquire:fastaverage:limit 256",
          "acquire:fastaverage:stopafter 32000",
          "math:math1:avg:mode ON",
          "math:math1:avg:weight 32000",
          "data:encdg FPBinary",
          "data:source MATH1",
          "curve?"
        ],
        "sequenceHighlights": [
          "Stop acquisition and define MATH1 from the source channel before enabling averaging.",
          "Configure MATH1 averaging and measurement tracking before enabling FastAverage.",
          "Set export format to FPBinary and source to MATH1 before reading curve data."
        ],
        "keyPoints": [
          "FastAverage handles batched hardware accumulation while MATH1 extends total averaging depth.",
          "Real-time sample-rate ranges can produce faster averaging in practice."
        ],
        "pitfalls": [
          "Autoset plus dithering can clip the signal.",
          "Saved sessions may not recall the averaged MATH trace correctly."
        ],
        "performanceNotes": [
          "Benefit past roughly 256 FastAverage samples can flatten if the signal is not noisy enough.",
          "Embedded Linux scope builds were observed to average faster than some other environments."
        ],
        "recommendedApproach": [
          "Set channel scaling first so dithering and averaging do not clip.",
          "Use the example command pattern as guidance, then verify exact settings for the target model and waveform."
        ],
        "toolHints": [
          "tek_router search",
          "search_scpi",
          "get_command_by_header"
        ],
        "verificationNeeded": [
          "Confirm exact support for FastAverage and MATH averaging on the target scope model.",
          "Confirm whether dithering is required and which command form the target firmware expects."
        ],
        "references": [
          "fast_HW_averaging 1.py"
        ]
      }
    },
    "match": {
      "keywords": [
        "fast hardware averaging",
        "fastacq averaging",
        "math trace averaging"
      ],
      "operations": [
        "configure averaging",
        "accumulate math averages",
        "export waveform"
      ],
      "backends": ["pyvisa"],
      "deviceTypes": ["SCOPE"],
      "modelFamilies": ["4/5/6 Series MSO"],
      "priority": 4,
      "minScore": 0.75
    }
  }
]
```

---

## Decision Rule

When authoring from a source:

- choose **template** if the source should be reused as an executable flow
- choose **overlay** if the source should guide the system but not rigidly control execution
- return **both** only when the source genuinely supports both, like the Fast HW averaging example above

That is the standard.
