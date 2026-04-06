# Command JSON Field Reference

Complete reference for all fields in a command JSON entry.

## Required Fields

- `id` - Unique identifier for the command (string)
- `category` - Category ID (string, e.g., "acquisition", "channels")
- `scpi` - Full SCPI command string (string, e.g., "ACQuire:STATE")
- `header` - Command header without arguments (string)
- `commandType` - "set", "query", or "both"

## Basic Information

- `shortDescription` - Brief one-line description (string)
- `description` - Full detailed description (string)
- `mnemonics` - Array of mnemonic components (string[])
- `commandGroup` - Display name for command group (string)
- `subGroup` - Optional subgroup name (string)

## Instrument Compatibility

```json
"instruments": {
  "families": ["MSO4", "MSO5", "MSO6", "MSO7"],
  "models": ["MSO4XB", "MSO5XB", "MSO6XB"],
  "exclusions": ["AWG70000"]
}
```

## Arguments

Array of argument definitions:

```json
"arguments": [
  {
    "name": "argumentName",
    "type": "numeric|enumeration|mnemonic|quoted_string|block",
    "required": true|false,
    "position": 0,
    "description": "What this argument does",
    "mnemonicType": "channel|reference|math|bus|measurement" (if type is mnemonic),
    "validValues": { /* see below */ },
    "defaultValue": "default value"
  }
]
```

### Valid Values by Type

**Numeric:**
```json
"validValues": {
  "type": "numeric",
  "format": "NR1|NR2|NR3",
  "min": 0.001,
  "max": 1000,
  "unit": "volts",
  "increment": 0.001,
  "default": 1.0,
  "notes": "Additional notes"
}
```

**Enumeration:**
```json
"validValues": {
  "type": "enumeration",
  "values": ["OPTION1", "OPTION2", "OPTION3"],
  "caseSensitive": false,
  "default": "OPTION1",
  "notes": "Case insensitive"
}
```

**Mnemonic:**
```json
"validValues": {
  "type": "mnemonic_range",
  "pattern": "CH<x>|REF<x>|MATH<x>",
  "examples": ["CH1", "CH2", "REF1"],
  "range": {
    "channels": { "min": 1, "max": 4 },
    "references": { "min": 1, "max": 4 },
    "math": { "min": 1, "max": 4 }
  }
}
```

## Query Response

```json
"queryResponse": {
  "type": "numeric|enumeration|string",
  "format": "NR1|NR2|NR3|Enumeration string|Quoted string",
  "description": "What the query returns",
  "example": "1.0",
  "unit": "volts" (optional)
}
```

## Syntax

```json
"syntax": {
  "set": "ACQuire:MODe <enumeration>",
  "query": "ACQuire:MODe?",
  "argumentType": "enumeration|NR1|NR2|NR3|mnemonic",
  "description": "Detailed syntax description"
}
```

## Code Examples

Array of example objects, each with multiple language examples:

```json
"codeExamples": [
  {
    "description": "What this example demonstrates",
    "codeExamples": {
      "scpi": {
        "code": "ACQuire:STATE RUN",
        "library": "SCPI",
        "description": "Raw SCPI command"
      },
      "python": {
        "code": "scope.write('ACQuire:STATE RUN')",
        "library": "PyVISA",
        "description": "PyVISA example"
      },
      "tm_devices": {
        "code": "scope.commands.acquire.state.write(1)",
        "library": "tm_devices",
        "description": "TM Devices library"
      }
    },
    "result": "1",
    "resultDescription": "What the result means"
  }
]
```

## Related Commands

Array of related command headers:

```json
"relatedCommands": [
  "ACQuire:STOPAfter",
  "ACQuire:MODe",
  "ACQuire:NUMAVg"
]
```

## Manual Reference

```json
"manualReference": {
  "section": "Acquisition Commands",
  "page": 164,
  "subsection": "ACQuire:STATE"
}
```

## Notes

Array of additional notes:

```json
"notes": [
  "Note 1",
  "Note 2",
  "Note 3"
]
```

## Backward Compatibility

```json
"backwardCompatibility": {
  "legacyCommands": ["OLD:COMMAND"],
  "notes": "Legacy command mapping notes"
}
```

## Dynamic Activation

For commands that create objects implicitly:

```json
"dynamicActivation": {
  "implicitlyActivates": true,
  "createsObject": "measurement|math|bus",
  "defaultType": "PERIod",
  "notes": "Querying creates measurement with default type"
}
```

## Concatenation

```json
"concatenation": {
  "canConcatenate": true,
  "requiresColon": true,
  "example": "ACQuire:MODe AVErage;:ACQuire:NUMAVg 8"
}
```

## Field Summary

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `id` | Yes | string | Unique identifier |
| `category` | Yes | string | Category ID |
| `scpi` | Yes | string | Full SCPI command |
| `header` | Yes | string | Command header |
| `commandType` | Yes | string | "set", "query", or "both" |
| `shortDescription` | Yes | string | Brief description |
| `description` | Yes | string | Full description |
| `mnemonics` | Yes | string[] | Mnemonic components |
| `instruments` | Yes | object | Instrument compatibility |
| `arguments` | No | array | Argument definitions |
| `queryResponse` | No | object | Query response format |
| `syntax` | No | object | Syntax specification |
| `codeExamples` | No | array | Code examples |
| `relatedCommands` | No | string[] | Related commands |
| `manualReference` | No | object | Manual reference |
| `notes` | No | string[] | Additional notes |
| `backwardCompatibility` | No | object | Legacy compatibility |
| `dynamicActivation` | No | object | Dynamic object creation |
| `concatenation` | No | object | Concatenation rules |
| `commandGroup` | No | string | Display group name |
| `subGroup` | No | string | Subgroup name |


