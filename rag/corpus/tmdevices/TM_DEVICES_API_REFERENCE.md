# Tektronix tm_devices Framework Reference

> For AI/RAG usage and package-level architecture mapping, see [TM_DEVICES_RAG_CONTEXT.md](./TM_DEVICES_RAG_CONTEXT.md).

## CRITICAL: Understanding tm_devices

### What tm_devices Actually Is

**tm_devices is NOT a SCPI command list.**

**tm_devices is a Python command framework that composes SCPI at runtime.**

**Key Point:** SCPI strings do not exist as static data. They are built when a method is executed.

### Using the tm_devices Command Browser

TekAutomate includes a **hierarchical command browser** specifically designed for tm_devices. Instead of searching for SCPI strings, you navigate the command object graph and generate valid Python API calls.

**To access the browser:**
1. Add a **tm_devices Command** step
2. Click **Browse Commands** in the step editor
3. Select your instrument model
4. Navigate the tree and select methods
5. Generated code is automatically inserted

For complete documentation, see [TM_DEVICES_COMMAND_BROWSER.md](./TM_DEVICES_COMMAND_BROWSER.md).

### What the Full Tree JSON Represents

`tm_devices_full_tree.json` is a **structural map of the tm_devices command object graph**.

It represents:
- Every command group
- Every valid subcommand
- Every indexed factory
- Every callable method
- Model-specific availability

**It does NOT represent literal SCPI strings.**

Think of it as an **AST (Abstract Syntax Tree) of the command language**, not assembly code.

### How Commands Exist in tm_devices

Commands are exposed as **Python objects, not strings**.

Example structure:
```
afg
 └── source[x]
      └── frequency
           └── write()
```

**Nothing here contains SCPI text.**

Instead, each object knows:
- Its position in the command hierarchy
- Its index if applicable
- How to format SCPI when executed

### How SCPI is Produced at Execution Time

When this is executed:
```python
afg.source[1].frequency.write(1e6)
```

tm_devices internally does something equivalent to:
```
:SOURce1:FREQuency 1000000
```

This happens because:
1. `source[1]` encodes the index
2. `frequency` encodes the SCPI token
3. `write()` assembles the final string
4. The driver sends it over VISA

**The SCPI string only exists inside the write call.**

### How to Interpret the JSON Nodes

Each node in the JSON has meaning:

#### Containers
```json
"trigger": { ... }
```
This is a SCPI command group.

#### Indexed Factories
```json
"source[x]": { ... }
```
This means the command requires an index. You must supply an integer at runtime.

#### LEAF Nodes
```json
"frequency": {
  "cmd_syntax": "LEAF"
}
```
This means:
- This is a terminal SCPI token
- It cannot be executed by itself
- It must be used through a method like `write()` or `query()`

#### METHOD Nodes
```json
"write": "METHOD"
```
This means:
- This is executable
- It produces SCPI when called
- Arguments become SCPI parameters

### How the Framework Makes Code

The framework follows this pattern:

**Step 1: Select model root**
Choose the correct top-level command object for the instrument model.

**Step 2: Traverse attributes**
Each attribute access moves deeper into the SCPI hierarchy.
Example: `afg.source[1].frequency`

**Step 3: Call a method**
Calling `write()` or `query()` triggers SCPI generation.
Example: `.write(1e6)`

**Step 4: Driver sends SCPI**
The assembled SCPI is sent through the transport layer.

### What the Full Tree is Used For

The JSON is used for **validation and discovery, not execution**.

It answers questions like:
- Does this command exist on this model?
- Does this command require an index?
- Is this node callable?
- Is this a terminal or a container?
- Is this path valid?

It prevents:
- Hallucinated commands
- Invalid indices
- Cross-model misuse
- Invalid method calls

### Why You Do Not See SCPI Strings

You do not see SCPI strings because:
- SCPI tokens are spread across many objects
- SCPI syntax is assembled dynamically
- tm_devices is designed as a compiler, not a lookup table

**This is intentional and correct.**

### Mental Model That Works

Use this mental model:

```
User intent
   ↓
Command path selection
   ↓
Path validation using full tree JSON
   ↓
Python object traversal
   ↓
Method call
   ↓
SCPI assembly
   ↓
Instrument
```

**The JSON guards the path. tm_devices executes the path.**

### What NOT to Do

❌ Do NOT look for SCPI strings in the JSON  
❌ Do NOT try to reconstruct SCPI statically  
❌ Do NOT flatten the tree into strings  
❌ Do NOT assume commands across models  

### Bottom Line

**The full tree JSON is a map of what is possible, not a list of what is sent.**

**tm_devices turns structure into SCPI at runtime.**

Once you understand that separation, everything lines up cleanly.

---

## Command Tree Structure Reference

### PIControl (Programmatic Interface)
**Target Devices:** MSO/DPO Scopes, AFG, AWG.

**Syntax Pattern:** `device.commands.<subsystem>.<node>.<method>(value)`

**Execution Methods:**
- `.write("VALUE")` - Set a parameter
- `.query()` - Retrieve a value
- `.verify("VAL")` - Assert a value

### TSPControl (Test Script Processor)
**Target Devices:** SMU (2460, 2635B), DMM (6500).

**Syntax Pattern:** `device.commands.<function>()` or attribute assignment.

**Execution:** These are Lua-based functions (e.g., `.reset()`, `.smu.source.output = smu.ON`).

---

## Global Oscilloscope Command Tree (MSO/DPO/PC)

Applies to MSO 4/5/6 Series, DPO 2/4/5/7K, and TekScopePC.

### [ACQUIRE] - Acquisition Control
```python
device.commands.acquire.mode.write("SAMPLE")  # or "PEAKDETECT", "HIRES", "AVERAGE", "ENVELOPE"
device.commands.acquire.state.write("ON")     # or "OFF", 1, 0
device.commands.acquire.stopafter.write("RUNSTOP")  # or "SEQUENCE"
device.commands.acquire.numavg.write(16)      # Number of averages for Average mode
```

### [HORIZONTAL] - Timebase Logic
```python
device.commands.horizontal.scale.write(1e-3)      # Horizontal time per division
device.commands.horizontal.position.write(50.0)     # Horizontal trigger position percentage
device.commands.horizontal.recordlength.write(10000) # Total acquisition record length
device.commands.horizontal.samplerate.query()      # Sampling speed (Query only for some models)
```

### [VERTICAL] - Channel Control (Indexed as .ch[x])
```python
device.commands.ch[1].scale.write(1.0)        # Vertical volts per division
device.commands.ch[1].offset.write(0.0)         # Vertical offset
device.commands.ch[1].coupling.write("DC")      # "AC", "DC", "GND", "DCREJECT"
device.commands.ch[1].bandwidth.write(20e6)      # Frequency limit (e.g., 20E6 for 20MHz)
device.commands.ch[1].termination.write("FIFTY") # Input impedance: "FIFTY" or "MEG"
```

### [TRIGGER] - Triggering Subsystem
```python
device.commands.trigger.a.edge.source.write("CH1")  # "CH[x]", "LINE", "AUX"
device.commands.trigger.a.level.write(1.5)          # Trigger threshold level
device.commands.trigger.a.mode.write("AUTO")       # "AUTO" or "NORMAL"
device.commands.trigger.a.force_trigger()          # Method to force a trigger event
```

### [MEASUREMENT] - Automated Analysis
```python
device.commands.measurement.addnew("FREQUENCY")     # Adds a new measurement
device.commands.measurement.meas[1].value.query()   # Query the current measurement result
device.commands.measurement.statistics.mean.query() # Query the mean of all acquired statistics
device.commands.measurement.clearsnapshot()         # Clears results in the snapshot table
```

### [FILESYSTEM] - Device File I/O
```python
device.commands.filesystem.cwd.write("/path/to/dir")  # Change working directory
device.commands.filesystem.cwd.query()                 # Query working directory
device.commands.filesystem.mkdir("NAME")               # Create directory
device.commands.filesystem.delete("PATH")              # Remove file
device.commands.filesystem.copy("SRC", "DEST")        # Duplicate file
```

---

## SMU & DMM Logic (TSP-Based)

Primary controls for 2460 and 2635B.

### SMU Core (Source-Measure)
```python
device.commands.smu.source.func.write("FUNC_DC_VOLTAGE")  # or "FUNC_DC_CURRENT"
device.commands.smu.source.level.write(5.0)               # Set output level
device.commands.smu.measure.read()                         # Execute and return measurement
device.commands.smu.measure.range.write(10.0)              # Set measurement sensitivity range
```

### Buffer Management
```python
device.commands.buffer.make(1000)                    # Allocate a reading buffer
device.commands.buffer_var.readings                  # Array of recorded data
device.commands.buffer.save("/path/to/file.csv")     # Export buffer to disk
```

---

## Signal Generator Logic (AFG/AWG)

Paths for AFG3K and AWG series.

### Output/Source Control (Indexed as .source[n])
```python
device.commands.source[1].frequency.write(1e6)       # Waveform frequency
device.commands.source[1].amplitude.write(2.0)       # Peak-to-peak voltage
device.commands.source[1].function.write("SINE")     # "SINE", "SQUARE", "RAMP", "PULSE", "NOISE", "DC", "ARBITRARY"
device.commands.output[1].state.write("ON")          # "ON" or "OFF" toggles physical output
```

---

## Global Constant Mapping

Always use these exact strings for arguments:
* **Logic:** `"ON"`, `"OFF"`, `"ENABLE"`, `"DISABLE"`, `"RUN"`, `"STOP"`
* **Trigger:** `"RISE"`, `"FALL"`, `"EITHER"`
* **Units:** `"VOLT"`, `"AMP"`, `"OHM"`, `"WATT"`, `"HERTZ"`, `"SECOND"`
* **Windows:** `"RECTANGULAR"`, `"HAMMING"`, `"HANNING"`, `"BLACKMANHARRIS"`

---

## Usage in Workflows

When generating workflows with `backend: "tm_devices"`, use Python object syntax inside `python_code` blocks (Blockly) or `python` steps (JSON):

**Blockly XML Example:**
```xml
<block type="python_code">
  <field name="CODE">scope.commands.acquire.mode.write("SAMPLE")
scope.commands.acquire.state.write("ON")</field>
</block>
```

**Steps UI JSON Example:**
```json
{
  "type": "python",
  "params": {
    "code": "scope.commands.ch[1].scale.write(1.0)\nscope.commands.ch[1].coupling.write('DC')"
  }
}
```

**NEVER use SCPI strings with tm_devices backend.** Use the Python object framework syntax shown above.
