# tm_devices Command Browser

## Overview

The **tm_devices Command Browser** is a full-screen hierarchical command explorer specifically designed for the tm_devices Python framework. Unlike traditional SCPI browsers that display raw SCPI strings, this browser helps you construct valid tm_devices Python API calls by navigating through the command object graph.

**Features:**
- **70+ instrument models** including oscilloscopes, AFGs, AWGs, SMUs, DMMs, DAQs, and power supplies
- **Full-screen interface** for maximum visibility
- **Model search** to quickly find your instrument
- **Hierarchical navigation** with visual node type indicators
- **Construction-based validation** - invalid commands cannot be created

## Key Concepts

### What is tm_devices?

tm_devices is a Python framework that composes SCPI commands at runtime through a structured object hierarchy. Instead of sending raw SCPI strings, you traverse Python objects that represent command groups, attributes, and methods.

### Browser vs. SCPI Browser

| Feature | SCPI Browser | tm_devices Browser |
|---------|-------------|-------------------|
| Purpose | Browse SCPI command strings | Navigate tm_devices object graph |
| Output | SCPI string (e.g., `CH1:SCALE 1.0`) | Python code (e.g., `scope.commands.ch[1].scale.write(1.0)`) |
| Navigation | Search and filter text | Hierarchical tree navigation |
| Validation | Manual validation required | Construction-based validation |
| Indexed nodes | N/A | Explicit index prompts |

## How to Use

### 1. Access the Browser

There are two ways to access the tm_devices Command Browser:

#### From the Builder (Steps UI)

1. Click **+ Add Step**
2. Select **tm_devices Command**
3. In the step editor panel, click **Browse Commands**

#### From the Commands Tab

1. Click the **Commands** tab at the top
2. Click the **tm_devices Browser** button (purple, with ⚡ icon)
3. Navigate the tree and select a command
4. The command is **added directly to your workflow**
5. You're automatically switched to the Builder view
6. The new step is selected and ready to configure

**Use when:** You want to quickly add tm_devices commands while exploring the command library

### 2. Select Instrument Model

The browser now supports **70+ instrument models** organized by category:

**Oscilloscopes:**
- MSO6B, MSO5B, MSO4B, MSO5, MSO4, MSO2 Series
- DPO7000, DPO5000, DPO4000, DPO2000 Series
- MDO3000, MDO4000 Series
- TekScope PC

**Function/Waveform Generators:**
- AFG3000, AFG31000, AFG3000B, AFG3000C Series
- AWG5000, AWG5200, AWG7000, AWG70000 Series

**Source Measure Units (SMU):**
- SMU2400 Series
- SMU2450, SMU2460, SMU2461, SMU2470
- SMU26xxB Series (2601B through 2657A)

**Digital Multimeters:**
- DMM6500, DMM7510, DMM7512

**Data Acquisition:**
- DAQ6510

**Power Supplies:**
- PSU2200/2220/2230/2231/2280/2281 Series

**And more...**

**Finding Your Model:**
- Use the **search box** in the left sidebar to filter models
- Type your model number (e.g., "2460", "MSO6", "AFG")
- Click the model name to load its command tree

The browser will load the command tree specific to your selected model.

### 3. Navigate the Command Tree

#### Node Types

The browser displays four types of nodes:

1. **Attribute Nodes** (regular folders)
   - Example: `acquire`, `horizontal`, `trigger`
   - Click to expand and navigate deeper

2. **Indexed Nodes** (blue, marked with `[x]`)
   - Example: `ch[x]`, `source[x]`
   - Requires an integer index before expanding
   - When clicked, a prompt appears asking for the index
   - Example: `ch[x]` → enter `1` → becomes `ch[1]`

3. **LEAF Nodes** (yellow badge)
   - Example: `scale`, `position`, `frequency`
   - Terminal nodes that represent SCPI command endpoints
   - Cannot be executed directly
   - Must have a method called on them (like `write()` or `query()`)

4. **METHOD Nodes** (green badge)
   - Example: `write()`, `query()`, `verify()`
   - Executable methods that generate SCPI when called
   - Clicking these opens the argument input modal

#### Navigation Path

As you navigate, the current path is displayed at the top:

```
mso6b.commands.ch[1].scale
```

Use the **← Back** button to move up the hierarchy.

### 4. Handle Indexed Nodes

When you click an indexed node (e.g., `ch[x]`):

1. A modal appears asking for an index
2. Enter an integer (e.g., `1`, `2`, `3`)
3. Click **OK**
4. The browser navigates to `ch[1]` and shows its children

**Valid indices:**
- Channels: `1`, `2`, `3`, `4` (depending on instrument)
- Sources: `1`, `2` (for multi-channel AFGs/AWGs)
- Measurements: `1` through `8` (for MSO/DPO)

### 5. Select a Method and Provide Arguments

When you click a METHOD node:

1. A modal appears showing the method name
2. Enter arguments based on the method type:

#### Common Methods

**write(value)**
- Sets a parameter value
- Example: `scope.commands.ch[1].scale.write(1.0)`
- Argument: The value to write (e.g., `1.0`, `"SAMPLE"`, `1e6`)

**query()**
- Retrieves the current value
- Example: `scope.commands.horizontal.recordlength.query()`
- No arguments required

**verify(expected_value)**
- Asserts a value matches expectations
- Example: `scope.commands.acquire.state.verify("RUN")`
- Argument: The expected value

## Contextual Help (Docstring Guidance)

The browser provides contextual help for each method to replace lost IDE hover functionality.

### Help Information Shown

When you select a method, you'll see:

**SCPI Path Display:**
```
SCPI Path: application.activate.write()
```

**Method-Specific Guidance:**

**For `write()` methods:**
- Purpose: Sets a parameter value on the instrument
- String values: Enter exactly as shown on instrument UI
- Quotes: Added automatically

**For `query()` methods:**
- Purpose: Retrieves current parameter value
- Arguments: Most take no arguments

**For `verify()` methods:**
- Purpose: Asserts parameter matches expected value
- String values: Enter without quotes

### Help Philosophy

**✅ What Help Provides:**
- Explanation of what the method does
- Parameter type guidance (QString, numeric, etc.)
- Usage hints and best practices
- SCPI syntax reference (read-only)

**❌ What Help Does NOT Do:**
- Validate QString content
- Enumerate all valid values
- Enforce specific formats
- Block invalid entries

**Reason:** Instrument firmware defines valid values dynamically. Help text guides users without restricting them.

### Example: QString Guidance

When entering a string parameter:

```
Command Help:
Sets a parameter value on the instrument.

String values: Enter the name exactly as it appears on the 
instrument UI. Quotes are added automatically.
```

This clarifies:
1. Where the value comes from (instrument UI)
2. How to enter it (no manual quotes)
3. What happens (auto-quoting)

Without enforcing what values are valid (instrument-specific).

### 6. Review Help and Code Preview

**Contextual Help Section** (blue box):
- Explains what the method does
- Provides guidance for string vs. numeric values
- Shows SCPI path for reference

**Code Preview** (dark box):

Before clicking **Add Command**, you'll see a live preview of the generated Python code:

```python
scope.commands.ch[1].scale.write(1.0)
```

This is the exact code that will be inserted into your workflow step.

### 7. Add to Workflow

Click **Add Command** to insert the command into your selected step. The step will now show:

- **Model**: MSO6B
- **Generated Code**: `scope.commands.ch[1].scale.write(1.0)`
- **Description**: MSO6B: ch[1].scale.write()

## Example Workflows

### Example 1: Configure Oscilloscope Channel

1. Select model: **MSO6B**
2. Navigate: `ch[x]` → enter index `1`
3. Navigate: `scale`
4. Click: `write()`
5. Enter value: `1.0`
6. Generated code: `scope.commands.ch[1].scale.write(1.0)`

### Example 2: Set AFG Frequency

1. Select model: **AFG3K**
2. Navigate: `source[x]` → enter index `1`
3. Navigate: `frequency`
4. Click: `write()`
5. Enter value: `1e6` (1 MHz)
6. Generated code: `afg.commands.source[1].frequency.write(1e6)`

### Example 3: Query DMM Reading

1. Select model: **DMM6500**
2. Navigate: `read`
3. Click: `query()`
4. No arguments needed
5. Generated code: `dmm.commands.read.query()`

### Example 4: Configure Trigger

1. Select model: **MSO6B**
2. Navigate: `trigger.a.edge.source`
3. Click: `write()`
4. Enter value: `"CH1"`
5. Generated code: `scope.commands.trigger.a.edge.source.write("CH1")`

## Understanding the JSON Tree

The browser loads its command tree from `/public/commands/tm_devices_full_tree.json`, which is a structural map of the entire tm_devices API.

### Node Properties

Each node in the JSON can have:

- **cmd_syntax: "LEAF"** - Terminal node requiring a method
- **write: "METHOD"** - Executable write method
- **query: "METHOD"** - Executable query method
- **verify: "METHOD"** - Executable verify method
- **Nested objects** - Attribute containers

### Why Not SCPI Strings?

SCPI strings are composed dynamically at runtime by tm_devices. The JSON tree represents **what is possible**, not **what is sent**. This separation allows:

- Model-specific validation
- Correct index handling
- Method argument validation
- Prevention of invalid command paths

## Tips and Best Practices

### 1. Start Broad, Then Narrow

Begin your exploration at the root level to understand the command structure, then navigate to specific subsystems.

### 2. Use Search to Find Commands Quickly

The search bar filters available nodes in real-time. Use it when you know what you're looking for but not where it's located.

### 3. Understand Device Variable Names

The browser generates device variable names based on the model:

- **MSO6B** → `mso6b` or `scope`
- **AFG3K** → `afg`
- **SMU2460** → `smu`
- **DMM6500** → `dmm`

Make sure your workflow's connection step uses matching aliases.

### 4. Combine with Python Steps

tm_devices commands can be combined with Python steps for advanced logic:

```python
# tm_device_command step
voltage = scope.commands.ch[1].scale.query()

# Python step (next)
voltage_float = float(voltage)
if voltage_float > 5.0:
    print("Warning: High voltage detected")
```

### 5. Use Verify for Assertions

The `verify()` method is useful for test automation:

```python
scope.commands.acquire.state.verify("RUN")
scope.commands.trigger.a.mode.verify("NORMAL")
```

If the value doesn't match, tm_devices raises an exception.

## Validation and Error Prevention

### Construction-Based Validation

Unlike free-text SCPI entry, the browser prevents:

❌ Invalid paths (e.g., `scope.commands.notarealcommand`)  
❌ Missing indices (e.g., `scope.commands.ch.scale` without `[1]`)  
❌ Unsupported commands for the selected model  
❌ Cross-model command mistakes

### Runtime Validation

When the Python script executes, tm_devices:

1. Validates the command exists for the connected instrument
2. Checks argument types and ranges
3. Formats the SCPI string correctly
4. Sends it via the underlying VISA connection

## Integration with Steps UI

### Step Creation

When you add a **tm_devices Command** step, it appears in the Steps UI with:

- Purple icon (⚡)
- Step label showing the command description
- Code preview in the details panel

### Editing Steps

Click on a tm_devices command step to:

- View the generated code
- See the target model
- Browse and select a new command
- Copy the code for reuse

### Code Generation

When you export to Python, tm_devices command steps are inserted directly into the generated script:

```python
def main():
    # Device connections
    dm_scope = DeviceManager()
    scope = dm_scope.add_scope("192.168.1.100", connection_type="TCPIP")
    
    # Your commands
    scope.commands.ch[1].scale.write(1.0)
    scope.commands.acquire.state.write("RUN")
    
    # Cleanup
    dm_scope.close()
```

## Troubleshooting

### "No commands found"

**Cause:** The tm_devices_full_tree.json file is missing or failed to load.

**Solution:** Ensure `/public/commands/tm_devices_full_tree.json` exists and is valid JSON.

### "Invalid index"

**Cause:** You entered a non-integer or negative index.

**Solution:** Enter a valid integer (0, 1, 2, etc.).

### "Command not found at runtime"

**Cause:** The command may not be supported on the actual connected instrument model.

**Solution:** Verify your instrument model matches the browser model selection.

### "Method requires argument"

**Cause:** You clicked Add without entering a required method argument.

**Solution:** Enter the required value(s) in the argument modal before clicking Add Command.

## Advanced Usage

### Combining SCPI and tm_devices

You can mix traditional SCPI steps with tm_devices command steps:

1. Use **Write** steps for simple SCPI commands
2. Use **tm_devices Command** steps for complex, indexed commands
3. Both execute correctly when the backend is `tm_devices`

### Custom Device Drivers

If you're using a custom tm_devices driver not in the default list, you can:

1. Add the model to the `MODELS` array in `TmDevicesCommandBrowser.tsx`
2. Ensure the corresponding key exists in `tm_devices_full_tree.json`
3. Regenerate the tree JSON from your tm_devices installation

### Extending the Browser

The browser is fully modular and can be extended:

- Add new method types (e.g., `set_and_check()`)
- Customize argument input UI for specific methods
- Add tooltips and help text for common commands
- Integrate command examples from instrument manuals

## Summary

The tm_devices Command Browser transforms the complexity of the tm_devices API into an intuitive, hierarchical navigation experience. By enforcing valid command construction and providing model-specific validation, it eliminates common errors and accelerates workflow development.

**Access Points:**

✅ **Builder View:** Add tm_devices Command step → Browse Commands (adds to workflow)  
✅ **Commands Tab:** Click tm_devices Browser button (exploration/learning)  

**Key Takeaways:**

✅ Use the browser for tm_devices API calls, not raw SCPI  
✅ Navigate the tree, don't search for SCPI strings  
✅ Provide indices explicitly when prompted  
✅ Preview generated code before adding  
✅ Combine with Python steps for advanced logic  

For more information, see:

- [TM_DEVICES_API_REFERENCE.md](./TM_DEVICES_API_REFERENCE.md)
- [TEMPLATE_GUIDELINES.md](./TEMPLATE_GUIDELINES.md)
- [CUSTOM_GPT_SPECIFICATION.md](./CUSTOM_GPT_SPECIFICATION.md)
