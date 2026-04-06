# Blockly XML Strict Policy v1

## Required Root
`<xml xmlns="https://developers.google.com/blockly/xml">`
New flow root block must include x="20" y="20".

## Template
```xml
<xml xmlns="https://developers.google.com/blockly/xml">
  <variables><variable>v</variable></variables>
  <block type="connect_scope" id="c1" x="20" y="20">
    <field name="DEVICE_NAME">scope</field>
    <field name="BACKEND">pyvisa</field>
    <field name="DEV_TYPE">SCOPE</field>
  </block>
</xml>
```
CRITICAL: xmlns MANDATORY, root block x="20" y="20", all IDs unique.

## Allowed Block Types

### Connection
- `connect_scope`: DEVICE_NAME, BACKEND (pyvisa|tm_devices), DEV_TYPE
  - DEV_TYPE valid values: `SCOPE | AWG | AFG | PSU | SMU | DMM | DAQ | MT | MF | SS`
- `disconnect`: (no fields)
- `set_device_context`: DEVICE

### SCPI
- `scpi_write`: DEVICE_CONTEXT, COMMAND
- `scpi_query`: DEVICE_CONTEXT, COMMAND, VARIABLE

### Save/Recall
- `recall`: DEVICE_CONTEXT, RECALL_TYPE (FACTORY|SETUP|SESSION|WAVEFORM), FILE_PATH, REFERENCE
  - FACTORY = reset to defaults
  - SETUP = .set file (settings only)
  - SESSION = .tss file (full session with waveforms)
  - WAVEFORM = .wfm file → loads into reference slot (REF1–REF4)
- `save`: DEVICE_CONTEXT, SAVE_TYPE (SETUP|SESSION|WAVEFORM|IMAGE), FILE_PATH, SOURCE
- `save_screenshot`: DEVICE_CONTEXT, FILENAME, SCOPE_TYPE (MODERN|LEGACY)
- `save_waveform`: SOURCE, FILENAME, FORMAT

### Timing
- `wait_seconds`: SECONDS
- `wait_for_opc`: TIMEOUT

### tm_devices
- `tm_devices_write`, `tm_devices_query`, `tm_devices_save_screenshot`, `tm_devices_recall_session`

### Control (Standard Blockly)
- `controls_for`: VAR, FROM/TO/BY, DO
- `controls_if`: IF0, DO0 — accepts **any type** (Number/String/Boolean) — Python truthy behavior
- `variables_set` / `variables_get`: VAR
- `math_number`: NUM
- `math_arithmetic`: OP, A, B

## Forbidden in XML
`group`, `comment`, `error_check` — these are Steps UI only, not valid Blockly blocks.

## Structural Rules
- All block IDs must be unique strings
- Use `<next>` for sequential blocks, `<statement name="DO">` for loop bodies
- Use `<value>` for inputs; numeric inputs use shadow block pattern:
  ```xml
  <value name="VALUE">
    <shadow type="math_number"><field name="NUM">5</field></shadow>
  </value>
  ```
- `scpi_query` must include a non-empty VARIABLE field
- `connect_scope` must include DEVICE_NAME and BACKEND fields (DEVICE_NAME is the instrument alias, NOT an IP address)
- `controls_for` must preserve mutation and variable XML attributes

## Device Context Rules (CRITICAL for multi-instrument)
Command prefix determines device context:
- `CH<x>: | ACQuire: | MEASU: | DATa: | HOR: | TRIG:` → scope
- `:SOURce: | :OUTPut: | :MEASure:` → smu / psu
- `:SOURce:FREQuency | :OUTPut:SYNC` → awg / afg

VALIDATE EVERY BLOCK's DEVICE_CONTEXT against its SCPI prefix.

## Backend Rules
- `tm_devices` backend: use `tm_devices_*` block family ONLY — never raw scpi_write/scpi_query
- `pyvisa` backend: use `scpi_write`, `scpi_query` blocks
- NEVER use raw SCPI blocks with tm_devices backend
- Generator uses the connect_scope BACKEND field to determine output — set correctly!

## Concrete XML Examples

### Recall Block
```xml
<block type="recall" id="r1">
  <field name="DEVICE_CONTEXT">scope</field>
  <field name="RECALL_TYPE">SESSION</field>
  <field name="FILE_PATH">C:/path/file.tss</field>
  <field name="REFERENCE">REF1</field>
</block>
```

### Save Block
```xml
<block type="save" id="s1">
  <field name="DEVICE_CONTEXT">scope</field>
  <field name="SAVE_TYPE">SESSION</field>
  <field name="FILE_PATH">C:/path/file.tss</field>
</block>
```

### Save Screenshot Block
```xml
<block type="save_screenshot" id="ss1">
  <field name="DEVICE_CONTEXT">scope</field>
  <field name="FILENAME">capture.png</field>
  <field name="SCOPE_TYPE">MODERN</field>
</block>
```

### Sequential Connect → Write → Disconnect
```xml
<xml xmlns="https://developers.google.com/blockly/xml">
  <variables><variable>result</variable></variables>
  <block type="connect_scope" id="c1" x="20" y="20">
    <field name="DEVICE_NAME">scope</field>
    <field name="BACKEND">pyvisa</field>
    <field name="DEV_TYPE">SCOPE</field>
    <next>
      <block type="scpi_write" id="w1">
        <field name="DEVICE_CONTEXT">scope</field>
        <field name="COMMAND">*RST</field>
        <next>
          <block type="disconnect" id="d1">
            <field name="DEVICE_NAME">scope</field>
          </block>
        </next>
      </block>
    </next>
  </block>
</xml>
```

## File Extension Reference
- `.TSS` = Full session (settings + waveforms + references) — use with SESSION
- `.SET` = Settings only — use with SETUP
- `.WFM` = Waveform data — use with WAVEFORM

## Validation Checklist
1. `xmlns` present on root `<xml>`, variables declared, all block types are valid (NO `group`/`comment`/`error_check` in XML)
2. All IDs are unique strings; root block has x="20" y="20"
3. Flow starts with `connect_scope` → ... → `disconnect`; `scpi_query` has non-empty VARIABLE field
4. DEVICE_CONTEXT on every SCPI block matches command prefix (scope vs smu vs awg etc.)
5. `tm_devices` backend: use `tm_devices_*` blocks only — never raw `scpi_write`/`scpi_query`
6. Use `.TSS` for full session restore, `.SET` for settings only
