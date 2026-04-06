# tm_devices Reference Guide

## Overview
tm_devices is Tektronix's official Python driver package for instrument control. It provides a unified API across all Tektronix instruments and uses PyVISA under the hood.

## Basic Connection Pattern

```python
from tm_devices import DeviceManager
from tm_devices.drivers import MSO6B

with DeviceManager(verbose=True) as device_manager:
    # Enable cleanup on connect/disconnect
    device_manager.setup_cleanup_enabled = True
    device_manager.teardown_cleanup_enabled = True
    
    # Add device by IP or hostname
    scope: MSO6B = device_manager.add_scope("192.168.0.1")
```

## Connection Methods

### By IP Address
```python
scope: MSO6B = device_manager.add_scope("192.168.0.1")
```

### By Hostname
```python
scope: MSO5 = device_manager.add_scope("MSO56-100083")
```

### With Alias
```python
smu: SMU2450 = device_manager.add_smu("192.168.0.1", alias="my2450")
```

## Configuring PyVISA Backend

```python
from tm_devices import DeviceManager
from tm_devices.helpers import PYVISA_PY_BACKEND

with DeviceManager(verbose=True) as device_manager:
    # Use PyVISA-py backend instead of NI-VISA
    device_manager.visa_library = PYVISA_PY_BACKEND
    
    scope: MSO6B = device_manager.add_scope("127.0.0.1")
```

## Device Types

### Oscilloscopes
```python
scope: MSO6B = device_manager.add_scope("192.168.0.1")
scope: MSO5 = device_manager.add_scope("192.168.0.2")
scope: MSO4 = device_manager.add_scope("192.168.0.3")
```

### Source Measure Units (SMU)
```python
smu: SMU2450 = device_manager.add_smu("192.168.0.1", alias="my2450")
smu: SMU2460 = device_manager.add_smu("192.168.0.2")
```

### Arbitrary Function Generators (AFG)
```python
afg: AFG3KC = device_manager.add_afg("192.168.0.1")
```

### Arbitrary Waveform Generators (AWG)
```python
awg: AWG5K = device_manager.add_awg("192.168.0.1")
```

### Power Supplies (PSU)
```python
psu: PWS4000 = device_manager.add_psu("192.168.0.1")
```

### Digital Multimeters (DMM)
```python
dmm: DMM6500 = device_manager.add_dmm("192.168.0.1")
```

## Using High-Level Driver Methods

tm_devices provides object-oriented methods for common operations:

```python
from tm_devices import DeviceManager
from tm_devices.drivers import MSO6B

with DeviceManager(verbose=True) as dm:
    scope: MSO6B = dm.add_scope("192.168.0.1")
    
    # Use high-level methods
    scope.commands.acquire.state.write("RUN")
    scale = scope.commands.ch1.scale.query()
    
    # Or use driver-specific methods
    scope.set_vertical_scale("CH1", 1.0)
```

## Directly Accessing PyVISA Resource

For raw SCPI commands not yet wrapped by tm_devices:

```python
from tm_devices import DeviceManager
from tm_devices.drivers import MSO5B

with DeviceManager() as device_manager:
    scope: MSO5B = device_manager.add_scope("192.168.0.1")
    
    # Access PyVISA resource directly
    scope.visa_resource.write("CH1:SCAle 1.0")
    response = scope.visa_resource.query("*IDN?")
    
    # Or use the device's methods (preferred)
    scope.write("CH1:SCAle 1.0")
    response = scope.query("*IDN?")
```

## Typical Workflow for Multi-Instrument Setup

```python
from tm_devices import DeviceManager
from tm_devices.drivers import MSO6B, SMU2450

with DeviceManager(verbose=True) as dm:
    dm.setup_cleanup_enabled = True
    dm.teardown_cleanup_enabled = True
    
    # Connect multiple instruments
    scope: MSO6B = dm.add_scope("192.168.1.100")
    smu: SMU2450 = dm.add_smu("192.168.1.101", alias="smu1")
    
    # Use them
    scope.write("CH1:SCAle 1.0")
    smu.write(":SOURce:FUNCtion VOLTage")
    smu.write(":SOURce:VOLTage:LEVel 1.0")
    
    # Wait for operations
    scope.query("*OPC?")
    
    # Save waveform
    scope.write("DATA:SOURCE CH1")
    scope.write("DATA:ENCDG ASCII")
    waveform = scope.query("CURVE?")

# Context manager handles cleanup automatically
```

## Important Notes

1. **Connection**: tm_devices uses IP address or hostname only - no VISA resource strings
2. **PyVISA Access**: Use `.visa_resource` for low-level PyVISA operations
3. **SCPI Commands**: Both `.write()` and `.visa_resource.write()` work
4. **Device Manager**: One `DeviceManager` instance can manage multiple devices
5. **Cleanup**: Enable cleanup flags for automatic *RST on connect/disconnect
6. **Type Hints**: Use driver type hints for IDE autocomplete

## Common Driver Classes

- **Oscilloscopes**: MSO6B, MSO6, MSO5B, MSO5, MSO4B, MSO4, DPO7K, etc.
- **SMUs**: SMU2450, SMU2460, SMU2461, SMU2470, etc.
- **AFGs**: AFG3K, AFG3KC, AFG31K, etc.
- **AWGs**: AWG5K, AWG7K, AWG70K, etc.
- **PSUs**: PWS4000, PWS2000, etc.
- **DMMs**: DMM6500, DMM7510, etc.

## TekAutomate Integration

When using tm_devices in TekAutomate Blockly:

```python
# Generated code structure
from tm_devices import DeviceManager
from tm_devices.drivers import MSO6B

if 'device_manager' not in globals():
    device_manager = DeviceManager(verbose=True)
    device_manager.setup_cleanup_enabled = True
    device_manager.teardown_cleanup_enabled = True

scope: MSO6B = device_manager.add_scope("192.168.0.1")
print(f"Connected to scope: {scope.query('*IDN?').strip()}")

# All subsequent SCPI commands use scope.write() / scope.query()
scope.write("CH1:SCAle 1.0")
```

This pattern ensures a single DeviceManager manages all instruments throughout the workflow.
