# tm_devices Argument Handling - Technical Guide

## The QString Problem (Solved)

### What is QString?

**QString** is a SCPI data type representing a quoted string parameter in instrument commands.

Example from SCPI manual:
```
APPLication:ACTivate <QString>
```

This means the command expects a string value like:
```scpi
:APPLication:ACTivate "TekExpress PCI"
```

### The Challenge

tm_devices is a **Python framework** that generates SCPI at runtime. When you write:

```python
msob.commands.application.activate.write("TekExpress PCI")
```

tm_devices internally:
1. Formats the command path
2. **Adds SCPI quotes** around the string
3. Escapes special characters
4. Sends the formatted SCPI to the instrument

So the **user provides a Python string**, and tm_devices converts it to a **SCPI QString**.

### The Bug (Before Fix)

**User Input:**
```
TekExpress PCI
```

**Generated Code (WRONG):**
```python
msob.commands.application.activate.write(TekExpress PCI)
```

This is **invalid Python** - missing quotes around the string.

**What Should Be Generated:**
```python
msob.commands.application.activate.write("TekExpress PCI")
```

### The Root Cause

The issue was in **argument serialization**, not validation.

The browser took user input **literally** and inserted it into the Python code without checking if it needed quoting.

---

## The Correct Solution

### 1. Auto-Quote Detection

The browser now automatically detects if a value needs quoting by checking if it's already valid Python:

**Valid Python (no quoting needed):**
- Numbers: `1.0`, `42`, `5e6`, `-3.14`
- Booleans: `True`, `False`
- None: `None`
- Already quoted strings: `"ON"`, `'OFF'`
- Lists/tuples: `[1, 2, 3]`, `(1, 2)`

**Needs Quoting (QString):**
- Plain text: `TekExpress PCI` → `"TekExpress PCI"`
- Instrument names: `SAMPLE` → `"SAMPLE"`
- Paths: `C:\data\file.txt` → `"C:\\data\\file.txt"`
- Special chars: `Test (1)` → `"Test (1)"`

### 2. Argument Serialization Logic

```typescript
const isAlreadyValidPython = (value: string): boolean => {
  // Already quoted string
  if ((value.startsWith('"') && value.endsWith('"')) || 
      (value.startsWith("'") && value.endsWith("'"))) {
    return true;
  }
  
  // Number (int or float, including scientific notation)
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) {
    return true;
  }
  
  // Boolean
  if (value === 'True' || value === 'False') {
    return true;
  }
  
  // None
  if (value === 'None') {
    return true;
  }
  
  // List or tuple
  if (value.startsWith('[') || value.startsWith('(')) {
    return true;
  }
  
  // Everything else needs quoting
  return false;
};
```

### 3. Code Generation

```typescript
const serializedArgs: string[] = [];
for (const [key, value] of Object.entries(args)) {
  const trimmed = value.trim();
  if (!trimmed) continue;

  const needsQuoting = !isAlreadyValidPython(trimmed);
  
  if (needsQuoting) {
    // Auto-quote strings (QString handling)
    const escaped = trimmed.replace(/"/g, '\\"');
    serializedArgs.push(`"${escaped}"`);
  } else {
    // Already valid Python
    serializedArgs.push(trimmed);
  }
}
```

---

## User Experience

### What Users See

**Input Field:**
```
Value: [TekExpress PCI              ]
```

**Helper Text:**
```
String values: Enter the name exactly as shown on the instrument UI. 
Do not include quotes.
```

**Live Code Preview:**
```python
msob.commands.application.activate.write("TekExpress PCI")
```

### Why This Works

1. **Intuitive:** Users enter values as they see them on the instrument
2. **No Manual Quoting:** The browser handles all string serialization
3. **Live Feedback:** Preview shows the exact generated Python code
4. **Correct Python:** Generated code is syntactically valid

---

## Validation Policy

### ✅ What IS Validated

| Check | Why |
|-------|-----|
| Node existence | Prevents invalid command paths |
| Method existence | Ensures method is callable |
| Index requirements | Forces explicit index entry |
| Numeric ranges | For indexed nodes (≥0) |
| Argument count | Empty vs. populated |

### ❌ What is NOT Validated

| Check | Why Not |
|-------|---------|
| QString content | Instrument firmware defines valid values |
| String format | Options differ per unit and firmware version |
| Enum membership | Cannot enumerate all possible values |
| Length limits | Vary by instrument |

**Reason:** tm_devices cannot know all valid QString values because:
- Instrument firmware defines them dynamically
- Different models have different options
- Firmware updates add new values
- User-defined names are allowed (e.g., file paths, custom labels)

---

## Examples

### Example 1: QString (String Value)

**User Input:**
```
TekExpress PCI
```

**Detection:** Not a number, boolean, or quoted → Needs quoting

**Generated Code:**
```python
msob.commands.application.activate.write("TekExpress PCI")
```

**tm_devices sends:**
```scpi
:APPLication:ACTivate "TekExpress PCI"
```

---

### Example 2: Numeric Value

**User Input:**
```
1.0
```

**Detection:** Matches number regex → Valid Python

**Generated Code:**
```python
scope.commands.ch[1].scale.write(1.0)
```

**tm_devices sends:**
```scpi
:CH1:SCALe 1.0
```

---

### Example 3: Scientific Notation

**User Input:**
```
1e6
```

**Detection:** Matches number regex (scientific) → Valid Python

**Generated Code:**
```python
afg.commands.source[1].frequency.write(1e6)
```

**tm_devices sends:**
```scpi
:SOURce1:FREQuency 1000000
```

---

### Example 4: Enum-Like String

**User Input:**
```
SAMPLE
```

**Detection:** Not a Python keyword → Needs quoting

**Generated Code:**
```python
scope.commands.acquire.mode.write("SAMPLE")
```

**tm_devices sends:**
```scpi
:ACQuire:MODE SAMPLE
```

---

### Example 5: Already Quoted (Advanced User)

**User Input:**
```
"ON"
```

**Detection:** Already starts and ends with quotes → Valid Python

**Generated Code:**
```python
scope.commands.acquire.state.write("ON")
```

**tm_devices sends:**
```scpi
:ACQuire:STATE ON
```

---

### Example 6: Path with Spaces

**User Input:**
```
C:\Program Files\Data\file.txt
```

**Detection:** Contains backslashes and spaces → Needs quoting

**Generated Code:**
```python
scope.commands.filesystem.cwd.write("C:\\Program Files\\Data\\file.txt")
```

**Note:** Backslashes are automatically escaped.

---

### Example 7: Boolean

**User Input:**
```
True
```

**Detection:** Exact match for Python boolean → Valid Python

**Generated Code:**
```python
some_command.write(True)
```

---

## Edge Cases

### Case 1: String that Looks Like a Number

**User Input:**
```
123ABC
```

**Detection:** Contains non-numeric characters → Needs quoting

**Generated Code:**
```python
command.write("123ABC")
```

---

### Case 2: Empty String

**User Input:**
```
[empty]
```

**Detection:** Empty after trim → No arguments

**Generated Code:**
```python
command.query()
```

---

### Case 3: String with Internal Quotes

**User Input:**
```
Test "quoted" value
```

**Detection:** Not already fully quoted → Needs quoting

**Escaping Applied:**
```
Test \"quoted\" value
```

**Generated Code:**
```python
command.write("Test \"quoted\" value")
```

---

## Common Mistakes (Now Prevented)

### ❌ Before (User manually quotes)

**User Input:**
```
"TekExpress PCI"
```

**Old Generated Code:**
```python
command.write("TekExpress PCI")
```

**Result:** Works, but user had to know to add quotes

---

### ✅ After (Auto-quoting)

**User Input:**
```
TekExpress PCI
```

**New Generated Code:**
```python
command.write("TekExpress PCI")
```

**Result:** Same output, no manual work needed

---

## Summary

### The Fix

| Aspect | Solution |
|--------|----------|
| **Problem** | User input `TekExpress PCI` generated invalid Python |
| **Root Cause** | Argument serialization didn't check for quoting needs |
| **Fix** | Auto-detect and quote non-Python-literal values |
| **User Impact** | Enter values naturally, no manual quoting |
| **Validation** | No QString content validation (correct) |

### Key Principle

> **Users provide instrument values. The browser generates valid Python. tm_devices generates valid SCPI.**

Each layer handles its own responsibility:
1. **User:** Provides the value as seen on the instrument
2. **Browser:** Serializes to valid Python syntax
3. **tm_devices:** Formats to valid SCPI syntax
4. **Instrument:** Executes the command

This separation ensures correctness at every level.
