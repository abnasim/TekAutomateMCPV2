# TekExpress Integration Guide

## Overview

TekExpress is Tektronix's automated compliance test application suite (USB4Tx, PCIe, Thunderbolt, etc.). This guide explains how to properly integrate TekExpress automation into TekAutomate's Blockly and Steps UI systems.

---

## Critical Principle

> **TekExpress automation uses PyVISA SOCKET transport (TCPIP::host::5000::SOCKET). All TekExpress commands are SCPI strings sent via .write() and .query(). Never generate raw socket code or embed line terminators in command text.**

TekExpress is an **SCPI endpoint**, not a Python socket program. The transport is abstracted exactly like PyVISA for oscilloscopes.

---

## Architecture

### Control Plane Separation

TekAutomate supports three independent control planes:

| Control Plane | Transport | Default Port | Library | Commands |
|--------------|-----------|--------------|---------|----------|
| **Scope Control** | VXI-11 / HiSLIP / Socket | 4000 | PyVISA or tm_devices | `ACQuire:`, `CH1:`, `MEASurement:` |
| **TekExpress Control** | TCP Socket | 5000 | PyVISA SOCKET | `TEKEXP:*` |
| **File Transfer** | Same as TekExpress | 5000 | PyVISA SOCKET | Binary data after TEKEXP:EXPORT |

### Backend Type

TekExpress uses the **PyVISA SOCKET backend** - the same library as scope automation, just different transport:

```
Backend: pyvisa (with SOCKET connection type)
Resource String: TCPIP::<host>::5000::SOCKET
Write Termination: \n
Read Termination: \n
```

---

## Why Previous GPT Generation Failed

### The Problem

GPT was given a raw Python socket script like:

```python
skt = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
skt.connect(("localhost", 5000))
skt.sendall("TEKEXP:STATE RUN\n".encode())
response = skt.recv(1024).decode()
```

And GPT **literally translated** this as:
- `socket.sendall()` → embedded in Blockly
- `\n` terminators → embedded in command strings
- Low-level I/O → preserved in generated code

### The Root Cause

The prompt did not clearly state:
> "Treat TEKEXP:* as SCPI commands, not as Python socket code"

So GPT had no abstraction boundary and copied the socket API instead of abstracting transport.

### The Solution

TekExpress must be modeled as:
1. **SCPI commands** (same semantics as scope commands)
2. **Different transport** (socket instead of VXI-11)
3. **Same Blockly abstraction** (connect → write/query → disconnect)

---

## Correct Implementation

### Connection (PyVISA SOCKET)

```python
import pyvisa

rm = pyvisa.ResourceManager()
tekexp = rm.open_resource("TCPIP::localhost::5000::SOCKET")
tekexp.write_termination = "\n"
tekexp.read_termination = "\n"
tekexp.timeout = 30000  # 30 seconds
```

### SCPI Write

```python
# Correct - uses PyVISA abstraction
tekexp.write("TEKEXP:ACQUIRE_MODE LIVE")
tekexp.write('TEKEXP:SELECT DEVICE,"Device"')
tekexp.write("TEKEXP:STATE RUN")
```

**NOT** this (wrong - raw socket):
```python
# WRONG - never generate this
skt.sendall("TEKEXP:STATE RUN\n".encode())
```

### SCPI Query

```python
# Correct
state = tekexp.query("TEKEXP:STATE?")
popup = tekexp.query("TEKEXP:POPUP?")
device = tekexp.query("TEKEXP:SELECT? DEVICE")
```

### Disconnect

```python
tekexp.close()
```

---

## TekExpress Execution Model

Unlike scope SCPI which is mostly synchronous, TekExpress uses a **state machine** execution model:

### State Flow

```
TEKEXP:STATE RUN
       ↓
TEKEXP:STATE? → RUNNING | WAIT | ERROR | COMPLETE
       ↓
If WAIT/ERROR:
    TEKEXP:POPUP? → Get popup message
    TEKEXP:POPUP "OK" → Respond to popup
       ↓
Loop back to STATE? until COMPLETE
```

### Key Differences from Scope SCPI

| Feature | Scope SCPI | TekExpress SCPI |
|---------|------------|-----------------|
| Synchronization | `*OPC?` supported | Use `TEKEXP:STATE?` polling |
| Execution | Immediate | State machine (async) |
| User Interaction | None | Popup handling required |
| Timeouts | Standard | Extended (tests can run minutes) |

---

## Blockly Block Mapping

### Required Blocks for TekExpress

#### 1. Connection Block

**Block Type:** `connect_tekexpress`

**Fields:**
- HOST: IP address or hostname
- PORT: Default 5000
- TIMEOUT: Default 30000ms

**Generated Python:**
```python
rm = pyvisa.ResourceManager()
tekexp = rm.open_resource(f"TCPIP::{host}::{port}::SOCKET")
tekexp.write_termination = "\n"
tekexp.read_termination = "\n"
tekexp.timeout = timeout
```

#### 2. SCPI Write Block (TekExpress)

**Block Type:** `tekexp_write` (or reuse `scpi_write` with backend guard)

**Fields:**
- COMMAND: SCPI command string

**Generated Python:**
```python
tekexp.write("TEKEXP:STATE RUN")
```

**CRITICAL:** Termination is added by PyVISA, NOT in command string.

#### 3. SCPI Query Block (TekExpress)

**Block Type:** `tekexp_query` (or reuse `scpi_query` with backend guard)

**Fields:**
- COMMAND: SCPI query string
- VARIABLE: Output variable name

**Generated Python:**
```python
status = tekexp.query("TEKEXP:STATE?")
```

#### 4. Wait/Poll State Block

**Block Type:** `tekexp_wait_state`

**Fields:**
- QUERY: `TEKEXP:STATE?`
- EXPECTED_VALUES: `COMPLETE`, `DONE`
- POLL_INTERVAL: Default 2 seconds
- TIMEOUT: Default 300 seconds

**Generated Python:**
```python
import time
start_time = time.time()
while True:
    state = tekexp.query("TEKEXP:STATE?").strip()
    if state in ("COMPLETE", "DONE"):
        break
    if state in ("WAIT", "ERROR"):
        # Handle popup
        popup = tekexp.query("TEKEXP:POPUP?")
        print(f"Popup: {popup}")
        tekexp.write('TEKEXP:POPUP "OK"')
    if time.time() - start_time > timeout:
        raise TimeoutError("TekExpress did not complete in time")
    time.sleep(poll_interval)
```

#### 5. Popup Handling Block

**Block Type:** `tekexp_popup`

**Fields:**
- RESPONSE: User response string (default "OK")

**Generated Python:**
```python
popup_msg = tekexp.query("TEKEXP:POPUP?")
tekexp.write(f'TEKEXP:POPUP "{response}"')
```

#### 6. Run Measurement Block

**Block Type:** `tekexp_run`

**Fields:** None (high-level helper)

**Generated Python:**
```python
tekexp.write("TEKEXP:STATE RUN")
```

#### 7. Export Report Block

**Block Type:** `tekexp_export_report`

**Fields:**
- REPORT_TYPE: `REPORT`, `LOG`, `CSV`
- FILENAME: Output filename

**Generated Python:**
```python
tekexp.write("TEKEXP:EXPORT REPORT")
# Binary transfer handling
```

---

## Correct Blockly XML Structure

### Conceptual Flow

```xml
<xml xmlns="https://developers.google.com/blockly/xml">
  <variables>
    <variable>state</variable>
    <variable>popup</variable>
  </variables>
  
  <!-- Connect to TekExpress -->
  <block type="connect_tekexpress" id="c1" x="20" y="20">
    <field name="HOST">localhost</field>
    <field name="PORT">5000</field>
    <field name="TIMEOUT">30000</field>
    <next>
    
      <!-- Configure Device -->
      <block type="tekexp_write" id="w1">
        <field name="COMMAND">TEKEXP:ACQUIRE_MODE LIVE</field>
        <next>
        
          <block type="tekexp_write" id="w2">
            <field name="COMMAND">TEKEXP:SELECT DEVICE,"Device"</field>
            <next>
            
              <!-- Select Test -->
              <block type="tekexp_write" id="w3">
                <field name="COMMAND">TEKEXP:SELECT TEST,"UI-Unit Interval",1</field>
                <next>
                
                  <!-- Run -->
                  <block type="tekexp_run" id="r1">
                    <next>
                    
                      <!-- Wait for completion with popup handling -->
                      <block type="tekexp_wait_state" id="ws1">
                        <field name="EXPECTED">COMPLETE</field>
                        <field name="POLL_INTERVAL">2</field>
                        <field name="TIMEOUT">300</field>
                        <next>
                        
                          <!-- Disconnect -->
                          <block type="disconnect" id="d1">
                            <field name="DEVICE_CONTEXT">(tekexp)</field>
                          </block>
                          
                        </next>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </next>
  </block>
</xml>
```

---

## Steps UI JSON Structure

```json
{
  "name": "TekExpress USB4Tx Test",
  "description": "Run USB4Tx compliance tests",
  "backend": "pyvisa",
  "deviceType": "TEKEXPRESS",
  "connectionType": "socket",
  "port": 5000,
  "steps": [
    {
      "id": "1",
      "type": "connect",
      "label": "Connect to TekExpress",
      "params": {
        "instrumentIds": ["tekexp"],
        "connectionType": "socket",
        "port": 5000
      }
    },
    {
      "id": "2",
      "type": "scpi_write",
      "label": "Set Acquire Mode",
      "params": {
        "command": "TEKEXP:ACQUIRE_MODE LIVE"
      },
      "boundDeviceId": "tekexp"
    },
    {
      "id": "3",
      "type": "scpi_write",
      "label": "Select Device",
      "params": {
        "command": "TEKEXP:SELECT DEVICE,\"Device\""
      },
      "boundDeviceId": "tekexp"
    },
    {
      "id": "4",
      "type": "scpi_write",
      "label": "Select Test",
      "params": {
        "command": "TEKEXP:SELECT TEST,\"UI-Unit Interval\",1"
      },
      "boundDeviceId": "tekexp"
    },
    {
      "id": "5",
      "type": "scpi_write",
      "label": "Run Test",
      "params": {
        "command": "TEKEXP:STATE RUN"
      },
      "boundDeviceId": "tekexp"
    },
    {
      "id": "6",
      "type": "python",
      "label": "Wait for Completion",
      "params": {
        "code": "import time\nwhile True:\n    state = tekexp.query('TEKEXP:STATE?').strip()\n    if state == 'COMPLETE':\n        break\n    if state in ('WAIT', 'ERROR'):\n        popup = tekexp.query('TEKEXP:POPUP?')\n        print(f'Popup: {popup}')\n        tekexp.write('TEKEXP:POPUP \"OK\"')\n    time.sleep(2)"
      }
    },
    {
      "id": "7",
      "type": "disconnect",
      "label": "Disconnect",
      "params": {
        "instrumentIds": ["tekexp"]
      }
    }
  ]
}
```

---

## Generator Rules

### Rule 1: Never Generate Raw Socket Code

**WRONG:**
```python
import socket
skt = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
skt.sendall("TEKEXP:STATE RUN\n".encode())
```

**CORRECT:**
```python
import pyvisa
tekexp = rm.open_resource("TCPIP::host::5000::SOCKET")
tekexp.write("TEKEXP:STATE RUN")
```

### Rule 2: Termination Handled by Resource Config

**WRONG:**
```python
tekexp.write("TEKEXP:STATE RUN\n")  # Don't add \n manually
```

**CORRECT:**
```python
tekexp.write_termination = "\n"  # Set once at connection
tekexp.write("TEKEXP:STATE RUN")  # Termination added automatically
```

### Rule 3: Use TEKEXP:STATE? Instead of *OPC?

**WRONG:**
```python
tekexp.query("*OPC?")  # Not supported by TekExpress
```

**CORRECT:**
```python
state = tekexp.query("TEKEXP:STATE?")
```

### Rule 4: Handle Popups

TekExpress may pause for user input. Always include popup handling in wait loops.

---

## Error Handling

```python
try:
    tekexp = rm.open_resource(f"TCPIP::{host}::5000::SOCKET")
    tekexp.write_termination = "\n"
    tekexp.read_termination = "\n"
    tekexp.timeout = 30000
    
    # Run test
    tekexp.write("TEKEXP:STATE RUN")
    
    # Wait with timeout
    start_time = time.time()
    while True:
        state = tekexp.query("TEKEXP:STATE?").strip()
        if state == "COMPLETE":
            print("Test completed successfully")
            break
        if state == "ERROR":
            error = tekexp.query("TEKEXP:LASTERROR?")
            raise RuntimeError(f"TekExpress error: {error}")
        if time.time() - start_time > 300:
            raise TimeoutError("Test timed out after 5 minutes")
        time.sleep(2)
        
except pyvisa.VisaIOError as e:
    print(f"Connection error: {e}")
except Exception as e:
    print(f"Error: {e}")
finally:
    tekexp.close()
```

---

## Backend Compatibility Matrix

| Backend | TekExpress Support | Notes |
|---------|-------------------|-------|
| PyVISA (SOCKET) | ✅ Full | Recommended |
| PyVISA (INSTR) | ❌ No | TekExpress requires socket |
| tm_devices | ❌ No | Not designed for TekExpress |
| TekHSI | ❌ No | Different protocol (gRPC) |
| VXI-11 | ❌ No | TekExpress requires socket |

---

## Summary

1. **TekExpress uses PyVISA SOCKET backend** - same library, different transport
2. **Commands are standard SCPI** - `TEKEXP:*` namespace
3. **Never generate raw socket code** - only `.write()`/`.query()` methods
4. **Termination is handled by config** - don't embed `\n` in commands
5. **Use state polling** - `TEKEXP:STATE?` instead of `*OPC?`
6. **Handle popups** - TekExpress may pause for user input
7. **Blockly blocks work the same** - just different device type/transport

---

## Version History

- **v1.0** (2026-01-25): Initial TekExpress integration guide
