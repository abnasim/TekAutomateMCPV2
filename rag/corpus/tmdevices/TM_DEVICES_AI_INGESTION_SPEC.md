# tm_devices AI Ingestion Spec (RAG + Custom GPT)

This file is optimized for ingestion pipelines. It defines:
- JSON chunk schema
- Retrieval tag taxonomy
- Chunking rules
- Ready-to-use chunk examples

Use alongside:
- [TM_DEVICES_RAG_CONTEXT.md](./TM_DEVICES_RAG_CONTEXT.md)

## 1) Canonical Chunk JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "tekautomate.tm_devices.rag.chunk.schema.v1",
  "title": "TekAutomate tm_devices RAG Chunk",
  "type": "object",
  "required": [
    "id",
    "source",
    "title",
    "body",
    "tags",
    "retrieval",
    "version"
  ],
  "properties": {
    "id": { "type": "string", "minLength": 1 },
    "source": {
      "type": "object",
      "required": ["repo_path", "doc_section"],
      "properties": {
        "repo_path": { "type": "string" },
        "doc_section": { "type": "string" },
        "package_path": { "type": "string" },
        "origin": { "type": "string", "enum": ["manual", "extracted", "generated"] }
      },
      "additionalProperties": false
    },
    "title": { "type": "string", "minLength": 1 },
    "body": { "type": "string", "minLength": 1 },
    "code_examples": {
      "type": "array",
      "items": { "type": "string" }
    },
    "tags": {
      "type": "array",
      "minItems": 1,
      "items": { "type": "string" }
    },
    "retrieval": {
      "type": "object",
      "required": ["intent", "priority"],
      "properties": {
        "intent": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "api_reference",
              "implementation_mapping",
              "troubleshooting",
              "generation_rules",
              "model_coverage",
              "backend_behavior"
            ]
          }
        },
        "priority": { "type": "integer", "minimum": 1, "maximum": 5 },
        "must_include_when_query_mentions": {
          "type": "array",
          "items": { "type": "string" }
        },
        "avoid_when_query_mentions": {
          "type": "array",
          "items": { "type": "string" }
        }
      },
      "additionalProperties": false
    },
    "version": { "type": "string", "pattern": "^v[0-9]+$" },
    "updated_at_utc": { "type": "string" }
  },
  "additionalProperties": false
}
```

## 2) Retrieval Tag Taxonomy

Use only these normalized tags in chunks:

- `tm_devices`
- `shared_implementations`
- `helpers`
- `device_manager`
- `common_pi_error_check`
- `common_tsp_error_check`
- `ieee4882`
- `add_device_methods`
- `get_device_methods`
- `backend_selection`
- `tekautomate_mapping`
- `api_to_scpi_mapping`
- `docstrings`
- `command_tree`
- `model_availability`
- `generation_runtime`
- `signal_generators`
- `awg5200`
- `awg70k`
- `constraints`

## 3) Chunking Rules

- Chunk target size: 500 to 1200 characters of body text.
- Keep one main concept per chunk.
- Include at least one deterministic retrieval keyword in `must_include_when_query_mentions`.
- Do not mix package API semantics with UI styling details in same chunk.
- Repeat critical disambiguation:
  - `tm_devices` API path is runtime-authoritative.
  - SCPI text is reference/mapping context.

## 4) Chunk ID Convention

Use deterministic IDs:

`tmdev::<section>::<slug>::v1`

Examples:
- `tmdev::shared_implementations::overview::v1`
- `tmdev::helpers::constants_connection_validation::v1`
- `tmdev::device_manager::add_get_methods::v1`
- `tmdev::tekautomate_mapping::api_vs_scpi::v1`

## 5) Golden Chunk Examples

```json
[
  {
    "id": "tmdev::shared_implementations::overview::v1",
    "source": {
      "repo_path": "docs/TM_DEVICES_RAG_CONTEXT.md",
      "doc_section": "1) driver_mixins.shared_implementations",
      "package_path": "tm_devices.driver_mixins.shared_implementations",
      "origin": "manual"
    },
    "title": "shared_implementations overview",
    "body": "shared_implementations contains cross-family mixins and IEEE488.2 helper classes. TekAutomate does not instantiate these mixins directly; they are consumed through official driver classes when generated tm_devices API calls execute.",
    "code_examples": [
      "scope1.commands.acquire.state.write(\"ON\")"
    ],
    "tags": ["tm_devices", "shared_implementations", "ieee4882", "generation_runtime"],
    "retrieval": {
      "intent": ["api_reference", "implementation_mapping"],
      "priority": 5,
      "must_include_when_query_mentions": ["shared_implementations", "CommonPISystemErrorCheckMixin", "IEEE4882Commands"],
      "avoid_when_query_mentions": ["css", "theme", "layout"]
    },
    "version": "v1",
    "updated_at_utc": "2026-03-11T00:00:00Z"
  },
  {
    "id": "tmdev::helpers::constants_connection_validation::v1",
    "source": {
      "repo_path": "docs/TM_DEVICES_RAG_CONTEXT.md",
      "doc_section": "2) helpers",
      "package_path": "tm_devices.helpers",
      "origin": "manual"
    },
    "title": "helpers constants and connection helpers",
    "body": "tm_devices.helpers exposes backend constants (PYVISA_PY_BACKEND, SYSTEM_DEFAULT_VISA_BACKEND) and connection/validation helpers. TekAutomate imports backend constants for generated DeviceManager VISA library selection, while helper internals remain in tm_devices package.",
    "code_examples": [
      "from tm_devices.helpers import PYVISA_PY_BACKEND"
    ],
    "tags": ["tm_devices", "helpers", "backend_selection", "generation_runtime"],
    "retrieval": {
      "intent": ["api_reference", "backend_behavior"],
      "priority": 4,
      "must_include_when_query_mentions": ["helpers", "PYVISA_PY_BACKEND", "SYSTEM_DEFAULT_VISA_BACKEND"],
      "avoid_when_query_mentions": ["block color", "modal spacing"]
    },
    "version": "v1",
    "updated_at_utc": "2026-03-11T00:00:00Z"
  },
  {
    "id": "tmdev::device_manager::add_get_methods::v1",
    "source": {
      "repo_path": "docs/TM_DEVICES_RAG_CONTEXT.md",
      "doc_section": "3) device_manager",
      "package_path": "tm_devices.device_manager",
      "origin": "manual"
    },
    "title": "DeviceManager add/get semantics",
    "body": "DeviceManager is singleton and owns device lifecycle. add_* methods register/connect typed drivers (add_scope, add_awg, add_afg, add_dmm, add_smu, add_psu, add_daq, add_ss, add_mf, add_mt). get_* methods fetch by number or alias. TekAutomate generated code should keep aliases explicit and model-compatible.",
    "code_examples": [
      "dm = DeviceManager(verbose=False)",
      "scope1 = dm.add_scope(\"192.168.1.100\", alias=\"scope1\")"
    ],
    "tags": ["tm_devices", "device_manager", "add_device_methods", "get_device_methods", "tekautomate_mapping"],
    "retrieval": {
      "intent": ["api_reference", "generation_rules", "implementation_mapping"],
      "priority": 5,
      "must_include_when_query_mentions": ["DeviceManager", "add_scope", "add_psu", "get_scope", "alias"],
      "avoid_when_query_mentions": ["pure SCPI only"]
    },
    "version": "v1",
    "updated_at_utc": "2026-03-11T00:00:00Z"
  },
  {
    "id": "tmdev::tekautomate_mapping::api_vs_scpi::v1",
    "source": {
      "repo_path": "docs/TM_DEVICES_RAG_CONTEXT.md",
      "doc_section": "5) Mapping: API Call vs SCPI Command",
      "origin": "manual"
    },
    "title": "API path vs SCPI mapping rule",
    "body": "In tm_devices mode, API path is authoritative for code generation; SCPI is explanatory mapping. Always show both when available to reduce ambiguity: scope1.commands.acquire.maxsamplerate.query() <-> ACQuire:MAXSamplerate?.",
    "code_examples": [
      "scope1.commands.acquire.maxsamplerate.query()",
      "ACQuire:MAXSamplerate?"
    ],
    "tags": ["tm_devices", "tekautomate_mapping", "api_to_scpi_mapping", "generation_rules"],
    "retrieval": {
      "intent": ["generation_rules", "implementation_mapping"],
      "priority": 5,
      "must_include_when_query_mentions": ["SCPI syntax", "API command", "equivalent command"],
      "avoid_when_query_mentions": []
    },
    "version": "v1",
    "updated_at_utc": "2026-03-11T00:00:00Z"
  }
]
```

## 6) Query Routing Heuristics

- If query includes `add_scope`, `add_psu`, `DeviceManager`, boost chunks tagged `device_manager`.
- If query includes `shared_implementations`, `ESR`, `IEEE488.2`, boost chunks tagged `shared_implementations` or `ieee4882`.
- If query includes `PYVISA_PY_BACKEND`, `visa_library`, boost `helpers` and `backend_selection`.
- If query includes `what should I type`, `parameter`, `write()`, boost `generation_rules` + `api_to_scpi_mapping`.
- If query includes `no commands found`, `model`, `missing family`, boost `model_availability` + `command_tree`.
- If query includes `AFG`, `AWG`, `signal generator`, `generate_function`, `constraints`, boost `signal_generators` + `constraints`.
- If query includes `AWG5200` or `AWG70K`, boost family-specific chunks and timeout/sequencing guidance.

## 7) Ingestion Quality Gates

Before publishing embeddings:
- Validate chunks against schema.
- Assert no duplicate `id`.
- Assert at least one `must_include_when_query_mentions` token for priority >= 4.
- Assert all `repo_path` values exist in repository.
- Assert tags are from approved taxonomy only.

## 8) Minimal JSONL Output Format

If your vector DB expects JSONL, emit one chunk per line with the same schema.

Recommended file:
- `rag/tm_devices_chunks.jsonl`
