# Provider Source Distillation Standard

Use this standard for the **first pass** over source material.

This is the stage where we decide:

- what the source is really teaching
- whether it should become a template, SCPI overlay, or knowledge overlay
- what information is worth preserving for retrieval and AI guidance
- what still needs verification before any manifest is generated

This stage should **not default to JSON**.
The output should be a **human-reviewable Markdown skill card**.

---

## Why This Exists

Raw source material is messy:

- Python scripts mix workflow value with scaffolding
- transcripts mix good heuristics with loose wording
- internal notes mix exact commands with guesses
- manual examples mix syntax with explanatory filler

If we jump straight to a manifest, the model tends to overcommit:

- fake executable steps
- fake runtime assumptions
- invented parameter wiring
- overly rigid JSON that hides uncertainty

The distillation stage fixes that.

---

## Default Output Format

Return exactly one Markdown document with these sections in this order:

```md
# Skill Card: <title>

## Classification
- lane: <template | scpi_overlay | knowledge_overlay | reject>
- confidence: <high | medium | low>
- manifest_readiness: <ready | needs_review | not_manifest_material>

## What It Teaches
- <core workflow or concept>
- <core workflow or concept>

## Use When
- <real situations where this helps>

## Avoid When
- <cases where this source should not drive behavior>

## Workflow Signals
1. <major ordering clue or setup phase>
2. <major ordering clue or setup phase>

## Commands Of Interest
```text
<exact command or query if useful>
<exact command or query if useful>
```

## Key Insights
- <important heuristic or usage point>

## Pitfalls
- <common mistake, ambiguity, or failure mode>

## Performance Notes
- <throughput, scaling, firmware, or behavior note>

## Verification Needed
- <what must be confirmed before final execution>

## Suggested Retrieval Phrases
- <what an engineer would actually ask>

## Suggested Tags
- <high-value retrieval tags>

## Manifest Recommendation
- recommended_next_step: <template_manifest | scpi_overlay_manifest | knowledge_overlay_manifest | none>
- recommended_prompt: <prompt file or workflow to use next>
- notes: <short rationale>
```

---

## Classification Rules

### `template`

Use when the source is:

- exact
- repeatable
- safe enough to become a real flow
- backed by clear verified commands

### `scpi_overlay`

Use when the source contains:

- real SCPI commands
- example scripts
- manual-backed sequences
- workflow intent and ordering clues

but should mainly act as a **supplemental skill**, not a strict runnable template.

### `knowledge_overlay`

Use when the source is mostly:

- heuristics
- troubleshooting
- explanations
- notes
- transcripts
- partial workflow guidance

### `reject`

Use when the source is too weak, too noisy, too generic, or too unsupported to preserve.

---

## Rules

- Do not return JSON in this stage.
- Do not pretend uncertainty is resolved.
- Do not force prose into steps.
- Keep exact SCPI commands only under `Commands Of Interest`.
- Keep local plotting, CLI wrappers, and one-off scaffolding out of the core teaching summary.
- Preserve caveats, ordering, and verification needs.
- Prefer concise, high-signal bullets over long paragraphs.
- If the source mixes multiple ideas, distill the dominant one unless a clean split is obviously useful.

---

## What Happens Next

After the skill card is reviewed:

- `template` -> use [PROVIDER_SCPI_MANIFEST_PROMPT.md](C:/Users/u650455/Desktop/Tek_Automator/Tek_Automator/mcp-server/PROVIDER_SCPI_MANIFEST_PROMPT.md)
- `scpi_overlay` -> use [PROVIDER_SCPI_OVERLAY_PROMPT.md](C:/Users/u650455/Desktop/Tek_Automator/Tek_Automator/mcp-server/PROVIDER_SCPI_OVERLAY_PROMPT.md)
- `knowledge_overlay` -> use [PROVIDER_KNOWLEDGE_OVERLAY_PROMPT.md](C:/Users/u650455/Desktop/Tek_Automator/Tek_Automator/mcp-server/PROVIDER_KNOWLEDGE_OVERLAY_PROMPT.md)
- `reject` -> stop

The pipeline becomes:

`source -> skill card -> manifest only if warranted`

That is the new standard.
