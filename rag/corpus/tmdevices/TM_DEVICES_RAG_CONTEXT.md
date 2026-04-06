# tm_devices RAG Context (TekAutomate)

This document is the canonical RAG context for how TekAutomate uses `tm_devices`.

It captures:
- Core `tm_devices` API surfaces (`shared_implementations`, `helpers`, `device_manager`)
- What TekAutomate currently implements
- What is metadata-only vs runtime-executed

## 1) `driver_mixins.shared_implementations`

Path: `tm_devices.driver_mixins.shared_implementations`

Purpose:
- Shared mixins and IEEE488.2 command helper classes used by multiple device families.

Key classes:
- `CommonPISystemErrorCheckMixin`
- `CommonTSPErrorCheckMixin`
- `IEEE4882Commands`
- `LegacyTSPIEEE4882Commands`
- `TSPIEEE4882Commands`

Important behavior:
- `CommonPISystemErrorCheckMixin` provides PI-side error checking helpers (for example `expect_esr(...)`).
- Classes using this mixin must also include PI control capabilities (`write/query`) from the proper control mixin hierarchy.

How TekAutomate uses this:
- TekAutomate does **not** directly instantiate these mixins.
- They are consumed indirectly through the official `tm_devices` driver classes when generated Python calls high-level command APIs.

## 2) `helpers`

Path: `tm_devices.helpers`

Purpose:
- Package-wide constants, dataclasses, enums, and connection/verification utilities.

Common constants used in TekAutomate context:
- `PYVISA_PY_BACKEND`
- `SYSTEM_DEFAULT_VISA_BACKEND`

High-value helper areas:
- Connection validation: `check_network_connection`, `check_port_connection`, `check_visa_connection`
- VISA creation/parsing: `create_visa_connection`, `detect_visa_resource_expression`, `get_visa_backend`
- Configuration/value safety: `validate_address`, `sanitize_enum`, `verify_values`

How TekAutomate uses this:
- Python generation can import backend constants for `DeviceManager.visa_library` selection.
- TekAutomate does **not** reimplement helper internals; those stay inside `tm_devices`.

## 3) `device_manager`

Path: `tm_devices.device_manager`

Purpose:
- Singleton manager for device lifecycle, connection setup, and typed accessors.

Core model:
- `DeviceManager(...)` is singleton.
- `add_*` methods register/connect typed drivers:
  - `add_scope`, `add_awg`, `add_afg`, `add_dmm`, `add_smu`, `add_psu`, `add_daq`, `add_ss`, `add_mf`, `add_mt`, `add_unsupported_device`
- `get_*` methods retrieve typed drivers by number/alias.
- Connection options include address, optional alias, transport details, serial config, GPIB board, etc.

How TekAutomate uses this:
- For `tm_devices` backend flows, generated code can instantiate `DeviceManager`, set VISA backend, and bind aliases.
- Generated high-level calls follow the pattern:
  - `scope1.commands.acquire.maxsamplerate.query()`
  - `scope1.commands.ch[1].scale.write(1.0)`

## 4) What TekAutomate Browser Data Represents

### `public/commands/tm_devices_full_tree.json`
- Structural command tree (paths, indexed factories, methods).
- Used for valid path construction and model-aware command browsing.
- Not a flat SCPI list.

### `public/commands/tm_devices_docstrings.json`
- Extracted docstrings and metadata used to render help/details.
- Loaded lazily at runtime to reduce bundle size.

### Extraction script
- `scripts/extract_tm_devices_docs.py`
- Parses installed `tm_devices` package to generate browser metadata artifacts.

## 5) Mapping: API Call vs SCPI Command

TekAutomate should present both forms whenever available:

- API command:
  - `scope1.commands.acquire.maxsamplerate.query()`
- Equivalent SCPI:
  - `ACQuire:MAXSamplerate?`

Rules:
- API path is authoritative for generation in tm_devices mode.
- SCPI text is explanatory/reference context for users and AI.

## 6) Current Known Boundaries

- Not every family/model appears unless it exists in the extracted command tree.
- If a selected model root is absent in `tm_devices_full_tree.json`, browser should show as unavailable (not empty-broken).
- Some docstrings are concise/boilerplate; SCPI syntax cards should still guide user input.

## 7) Recommended RAG Keys

Use these keys/anchors in your AI retrieval index:
- `tm_devices.driver_mixins.shared_implementations`
- `tm_devices.helpers`
- `tm_devices.device_manager`
- `DeviceManager.add_scope/add_awg/add_afg/add_dmm/add_smu/add_psu/add_daq/add_ss/add_mf/add_mt`
- `tm_devices_full_tree.json`
- `tm_devices_docstrings.json`

## 8) Practical Prompt Snippet for AI Tools

Use this context for model guidance:

1. In tm_devices mode, generate Python API calls from command paths, not raw SCPI writes, unless fallback is required.
2. Prefer explicit device aliases and model-compatible command paths.
3. Show both:
   - API call (`scope1.commands...`)
   - equivalent SCPI syntax when available.
4. If command path exists but parameters are unclear, use method signature/docstring + SCPI syntax card to request or infer valid value format.

---

For ingestion schema + chunk templates + retrieval tags, see [TM_DEVICES_AI_INGESTION_SPEC.md](./TM_DEVICES_AI_INGESTION_SPEC.md).

## 9) External High-Value Source: Signal Generation (tm_devices Docs)

Reference:
- https://tm-devices.readthedocs.io/stable/advanced/signal_generators/

Why this matters:
- It documents cross-family signal-generator behavior that is not obvious from command-tree metadata alone.
- It captures model constraints and execution caveats for AFG/AWG/IAFG families.

RAG-relevant takeaways to encode:
- `generate_function()` may accept parameter combinations that exceed real instrument limits; constraint checks should be consulted before generation.
- `get_waveform_constraints()` is the authoritative constraint source for waveform parameters and depends on model/path/options.
- AWG5200 and AWG70K families have command sequencing nuances (sequential/blocking/overlapping behavior) that can affect execution order and timeout handling.
- Constraints vary by model/options (for example sample-rate and amplitude ranges), so AI should avoid assuming one-size-fits-all limits.

How TekAutomate AI should use it:
1. When user asks for signal generation setup, retrieve this source with model-specific chunks first.
2. Propose parameter values only after checking constraints for selected model/family.
3. Warn when overlapping or long blocking operations are likely to affect immediate query timing.
