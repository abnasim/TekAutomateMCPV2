# tm_devices Usage Patterns and Examples

This document provides comprehensive examples of tm_devices usage patterns for Custom GPT knowledge base and Blockly block generation reference.

## Table of Contents
1. [Device Connection Patterns](#device-connection-patterns)
2. [Scope Operations](#scope-operations)
3. [Signal Generation](#signal-generation)
4. [Measurements](#measurements)
5. [Data Capture and Saving](#data-capture-and-saving)
6. [Mainframe and Modular Devices](#mainframe-and-modular-devices)
7. [SMU Operations](#smu-operations)
8. [Advanced Patterns](#advanced-patterns)

---

## Device Connection Patterns

### Basic Device Connection

```python
from tm_devices import DeviceManager
from tm_devices.drivers import MSO6B

with DeviceManager(verbose=True) as dm:
    scope: MSO6B = dm.add_scope("192.168.0.1")
    # Device automatically closes when exiting context manager
```

### Multiple Device Types

```python
from tm_devices import DeviceManager
from tm_devices.drivers import MSO5, AFG3KC, PSU2200, SMU2470, AWG5K

with DeviceManager(verbose=True) as dm:
    scope: MSO5 = dm.add_scope("MSO56-100083")  # Hostname
    afg: AFG3KC = dm.add_afg("192.168.0.1")     # IP address
    psu: PSU2200 = dm.add_psu("MODEL-SERIAL", connection_type="USB")
    smu: SMU2470 = dm.add_smu("192.168.0.2")
    awg: AWG5K = dm.add_awg("192.168.0.3", lan_device_endpoint="inst0", alias="AWG5k")
```

### Connection Types

```python
from tm_devices import DeviceManager
from tm_devices.drivers import MSO6B, PSU2200, SMU2470, TMT4
from tm_devices.helpers import SerialConfig

with DeviceManager(verbose=True) as dm:
    # TCPIP (default)
    scope: MSO6B = dm.add_scope("TCPIP0::192.168.0.3::inst0::INSTR")
    
    # Socket connection
    mf = dm.add_mf("TCPIP0::192.168.0.4::4000::SOCKET")
    
    # USB connection
    psu: PSU2200 = dm.add_psu("MODEL-SERIAL", connection_type="USB")
    
    # Serial connection
    serial_settings = SerialConfig(
        baud_rate=9600,
        data_bits=8,
        flow_control=SerialConfig.FlowControl.xon_xoff,
        parity=SerialConfig.Parity.none,
        stop_bits=SerialConfig.StopBits.one,
        end_input=SerialConfig.Termination.none,
    )
    smu: SMU2470 = dm.add_smu("1", connection_type="SERIAL", serial_config=serial_settings)
    
    # Socket port specification
    mt: TMT4 = dm.add_mt("192.168.0.2", "TMT4", alias="margin tester", port=5000)
```

### VISA Backend Selection

```python
from tm_devices import DeviceManager
from tm_devices.drivers import MSO4B
from tm_devices.helpers import PYVISA_PY_BACKEND, SYSTEM_DEFAULT_VISA_BACKEND

with DeviceManager(verbose=True) as dm:
    # System default VISA backend (default)
    dm.visa_library = SYSTEM_DEFAULT_VISA_BACKEND
    # Or: dm.visa_library = "@ivi"
    
    # PyVISA-py backend
    dm.visa_library = PYVISA_PY_BACKEND
    # Or: dm.visa_library = "@py"
    
    scope: MSO4B = dm.add_scope("127.0.0.1")
```

### Device Aliases

```python
from tm_devices import DeviceManager
from tm_devices.drivers import AWG5200, MSO5

with DeviceManager(verbose=True) as dm:
    # Add devices with aliases
    dm.add_scope("MSO56-100083", alias="BOB")
    dm.add_awg("192.168.0.1", alias="JILL")
    
    # Retrieve devices by alias
    bobs_scope: MSO5 = dm.get_scope("BOB")
    jills_awg: AWG5200 = dm.get_awg("JILL")
```

### Environment Variable Configuration

```python
import os
from tm_devices import DeviceManager
from tm_devices.drivers import AFG31K, MSO2, SMU2601B

# Set environment variables (usually done outside Python)
os.environ["TM_OPTIONS"] = "STANDALONE"
os.environ["TM_DEVICES"] = (
    "device_type=SCOPE,address=<IP or hostname>"
    "~~~device_type=AFG,address=<IP or hostname>"
    "~~~device_type=SMU,address=<IP or hostname>"
)

with DeviceManager(verbose=True) as dm:
    scope: MSO2 = dm.get_scope(1)
    afg: AFG31K = dm.get_afg(1)
    smu: SMU2601B = dm.get_smu(1)
```

### Device Manager Cleanup

```python
from tm_devices import DeviceManager
from tm_devices.drivers import MSO6B
from tm_devices.helpers import DMConfigOptions

CONFIG_OPTIONS = DMConfigOptions(setup_cleanup=True)

with DeviceManager(verbose=True, config_options=CONFIG_OPTIONS) as dm:
    dm.setup_cleanup_enabled = True
    dm.teardown_cleanup_enabled = True
    scope: MSO6B = dm.add_scope("192.168.0.1")
```

### Device Manager Registration (Non-Context Manager)

```python
import atexit
from tm_devices import DeviceManager
from tm_devices.drivers import MSO6B

dm = DeviceManager()
atexit.register(dm.close)  # Auto-close on program exit

scope: MSO6B = dm.add_scope("192.168.0.1")
# Device manager closes automatically when script exits
```

---

## Scope Operations

### Basic Channel Configuration

```python
from tm_devices import DeviceManager
from tm_devices.drivers import MSO6B

with DeviceManager(verbose=True) as dm:
    scope: MSO6B = dm.add_scope("192.168.0.1")
    
    # Turn on channels
    scope.commands.display.waveview1.ch[1].state.write("ON")
    scope.commands.display.waveview1.ch[2].state.write("ON")
    
    # Set channel scale
    scope.commands.ch[1].scale.write(10e-3)  # 10mV
    scope.commands.ch[1].scale.write(0.5, verify=True)  # With verification
    
    # Alternative helper methods
    scope.turn_channel_on("CH2")
    scope.add_new_math("MATH1", "CH1")
```

### Horizontal Configuration

```python
from tm_devices import DeviceManager
from tm_devices.drivers import MSO6B

with DeviceManager(verbose=True) as dm:
    scope: MSO6B = dm.add_scope("192.168.0.1")
    
    # Set horizontal scale
    scope.set_and_check(":HORIZONTAL:SCALE", 100e-9)
    
    # Set record length
    scope.commands.horizontal.recordlength.write(20000)
    
    # Set horizontal position
    scope.commands.horizontal.position.write(10)
```

### Trigger Configuration

```python
from tm_devices import DeviceManager
from tm_devices.drivers import MSO6B

with DeviceManager(verbose=True) as dm:
    scope: MSO6B = dm.add_scope("192.168.0.1")
    
    # Set trigger type
    scope.commands.trigger.a.type.write("EDGE")
```

### Acquisition Control

```python
from tm_devices import DeviceManager
from tm_devices.drivers import MSO6B

with DeviceManager(verbose=True) as dm:
    scope: MSO6B = dm.add_scope("192.168.0.1")
    
    # Reset acquisition state
    scope.commands.acquire.state.write("OFF")
    
    # Set acquisition mode
    scope.commands.acquire.mode.write("Sample")
    
    # Set stop after sequence
    scope.commands.acquire.stopafter.write("Sequence")
    
    # Start acquisition
    scope.commands.acquire.state.write("ON")
    
    # Wait for completion using OPC
    if int(scope.commands.opc.query()) == 1:
        # Acquisition complete
        pass
```

### FastFrame Configuration

```python
from tm_devices import DeviceManager
from tm_devices.drivers import MSO6B

with DeviceManager(verbose=True) as dm:
    scope: MSO6B = dm.add_scope("192.168.0.1")
    
    # Enable FastFrame
    scope.write(":HORIZONTAL:FASTFRAME:STATE ON")
    
    # Set FastFrame count
    scope.write(":HORIZONTAL:FASTFRAME:COUNT 50")
    
    # Select specific frame
    scope.write(":HORIZONTAL:FASTFRAME:SELECTED:CH1 1")
```

---

## Signal Generation

### Internal AFG (Scope's Built-in Signal Generator)

```python
from tm_devices import DeviceManager
from tm_devices.drivers import MSO5

with DeviceManager(verbose=True) as dm:
    scope: MSO5 = dm.add_scope("192.168.0.1")
    
    # Method 1: Individual commands
    scope.commands.afg.frequency.write(10e6)  # 10 MHz
    scope.commands.afg.offset.write(0.2)
    scope.commands.afg.square.duty.write(50)  # 50% duty cycle
    scope.commands.afg.function.write("SQUARE")
    scope.commands.afg.output.load.impedance.write("FIFTY")
    scope.commands.ch[1].scale.write(0.5, verify=True)
    scope.commands.afg.output.state.write(1)  # Turn on output
    scope.commands.esr.query()  # Check for errors
    
    # Method 2: Single method call
    scope.generate_function(
        frequency=10e6,
        offset=0.2,
        amplitude=0.5,
        duty_cycle=50,
        function=scope.source_device_constants.functions.SQUARE,
        termination="FIFTY",
    )
    scope.commands.ch[1].scale.write(0.5, verify=True)
    scope.commands.acquire.stopafter.write("SEQUENCE")
```

### External AFG Control

```python
from tm_devices import DeviceManager
from tm_devices.drivers import AFG3KC, MSO5

with DeviceManager(verbose=True) as dm:
    scope: MSO5 = dm.add_scope("MSO56-100083")
    afg: AFG3KC = dm.add_afg("192.168.0.1")
    
    # Turn on AFG output
    afg.set_and_check(":OUTPUT1:STATE", "1")
```

---

## Measurements

### Adding and Configuring Measurements

```python
from tm_devices import DeviceManager
from tm_devices.drivers import MSO6B

with DeviceManager(verbose=True) as dm:
    scope: MSO6B = dm.add_scope("192.168.0.1")
    
    # Add measurements
    scope.commands.measurement.addmeas.write("AMPLitude")
    scope.commands.measurement.addmeas.write("PK2PK")
    scope.commands.measurement.addmeas.write("MAXIMUM")
    
    # Configure measurement sources
    scope.commands.measurement.meas[1].source.write("CH1")
    scope.commands.measurement.meas[2].source.write("CH1")
    scope.commands.measurement.meas[3].source.write("CH2")
    
    # Start acquisition
    scope.commands.acquire.state.write("ON")
    
    # Wait for completion
    if int(scope.commands.opc.query()) == 1:
        # Read measurement values
        mean_value = scope.commands.measurement.meas[1].results.currentacq.mean.query()
        max_value = scope.commands.measurement.meas[2].results.currentacq.maximum.query()
```

### Immediate Measurements

```python
from tm_devices import DeviceManager
from tm_devices.drivers import MSO6B

with DeviceManager(verbose=True) as dm:
    scope: MSO6B = dm.add_scope("192.168.0.1")
    
    # Configure immediate measurement
    scope.write(":MEASUREMENT:IMMED:TYPE PK2PK")
    scope.write(":MEASUREMENT:IMMED:SOURCE CH1")
    
    # Query measurement value
    value = float(scope.query(":MEASUREMENT:IMMED:VALUE?").strip())
```

### DPOJET Measurements (7K/70K/SX Scopes)

```python
from tm_devices import DeviceManager
from tm_devices.drivers import MSO70KDX
from tm_devices.helpers import PYVISA_PY_BACKEND

with DeviceManager(verbose=True) as dm:
    dm.visa_library = PYVISA_PY_BACKEND
    scope: MSO70KDX = dm.add_scope("127.0.0.1")
    
    # Start DPOJET
    scope.commands.dpojet.activate.write()
    scope.commands.dpojet.version.query()
    
    # Clear all measurements
    scope.commands.dpojet.clearallmeas.write()
    
    # Add DPOJET measurements
    scope.commands.dpojet.addmeas.write("Period")
    scope.commands.dpojet.addmeas.write("Pduty")
    scope.commands.dpojet.addmeas.write("RiseTime")
    scope.commands.dpojet.addmeas.write("acrms")
    
    # Add DPOJET plots
    scope.commands.dpojet.addplot.write("spectrum, MEAS1")
    scope.commands.dpojet.addplot.write("dataarray, MEAS2")
    scope.commands.dpojet.addplot.write("TimeTrend, MEAS3")
    scope.commands.dpojet.addplot.write("histogram, MEAS4")
    
    # Start measurement
    scope.commands.dpojet.state.write("single")
    
    # Get measurement values
    max_value = scope.commands.dpojet.meas[1].results.currentacq.max.query()
    population = scope.commands.dpojet.meas[1].results.currentacq.population.query()
    
    # Save all plots
    scope.commands.dpojet.saveallplots.write()
    
    # Save report
    scope.commands.dpojet.report.savewaveforms.write("1")
    scope.commands.dpojet.report.write("EXECUTE")
```

---

## Data Capture and Saving

### Screenshot Saving

```python
from tm_devices import DeviceManager
from tm_devices.drivers import MSO6B

with DeviceManager(verbose=True) as dm:
    scope: MSO6B = dm.add_scope("192.168.0.1")
    
    # Save screenshot with auto timestamp
    scope.save_screenshot()
    
    # Save screenshot with specific filename
    scope.save_screenshot("example.png")
    
    # Save screenshot with options
    scope.save_screenshot(
        "example.jpg",
        colors="INVERTED",
        local_folder="./images",
        device_folder="./device_folder",
        keep_device_file=True,  # Don't delete from device
    )
```

### Curve Query and CSV Saving

```python
from pathlib import Path
from tm_devices import DeviceManager
from tm_devices.drivers import AFG3KC, MSO5

EXAMPLE_CSV_FILE = Path("example_curve_query.csv")

with DeviceManager(verbose=True) as dm:
    scope: MSO5 = dm.add_scope("MSO56-100083")
    afg: AFG3KC = dm.add_afg("192.168.0.1")
    
    # Turn on AFG
    afg.set_and_check(":OUTPUT1:STATE", "1")
    
    # Perform curve query and save to CSV
    curve_returned = scope.curve_query(1, output_csv_file=EXAMPLE_CSV_FILE)
    
    # Read back from file
    with EXAMPLE_CSV_FILE.open(encoding="utf-8") as csv_content:
        curve_saved = [int(i) for i in csv_content.read().split(",")]
    
    # Verify
    assert curve_saved == curve_returned
```

### Saving and Recalling Waveforms and Sessions

```python
from tm_devices import DeviceManager
from tm_devices.drivers import MSO6B

with DeviceManager(verbose=True) as dm:
    scope: MSO6B = dm.add_scope("192.168.0.1")
    
    # Configure scope
    scope.add_new_math("MATH1", "CH1")
    scope.turn_channel_on("CH2")
    scope.set_and_check(":HORIZONTAL:SCALE", 100e-9)
    
    # Save session
    scope.commands.save.session.write("example.tss")
    
    # Save waveform
    scope.commands.save.waveform.write('CH1,"example.wfm"')
    
    # Reset scope
    scope.reset()
    
    # Recall session
    scope.recall_session("example.tss")
    
    # Recall waveform as reference
    scope.recall_reference("example.wfm", 1)  # Recall as REF1
```

---

## Mainframe and Modular Devices

### Mainframe Module Access

```python
from typing import cast, TYPE_CHECKING
from tm_devices import DeviceManager
from tm_devices.drivers import MP5103

if TYPE_CHECKING:
    from tm_devices.commands import MPSU50_2STCommands

with DeviceManager(verbose=True) as dm:
    # Add mainframe
    mainframe: MP5103 = dm.add_mf("192.168.0.1")
    
    # Mainframe level commands
    mf_model = mainframe.commands.localnode.model
    value = mainframe.commands.eventlog.count
    
    # Get PSU module commands (slot 3)
    modular_psu = cast("MPSU50_2STCommands", mainframe.get_module_commands_psu(slot=3))
    
    # Module level commands
    psu_model = modular_psu.model
    psu_version = modular_psu.version
    modular_psu.firmware.verify()
    
    # Channel level commands
    modular_psu.psu[1].measure.count = 5
    modular_psu.psu[2].source.output = 1
    rel_value = modular_psu.psu[1].measure.rel.levelv
    
    # Buffer access
    my_buffer = modular_psu.psu[1].defbuffer1
    
    # Measure voltage
    voltage_value = modular_psu.psu[1].measure.v()
```

---

## SMU Operations

### Dynamic Reading Buffers

```python
from tm_devices import DeviceManager
from tm_devices.drivers import SMU2601B

with DeviceManager() as dm:
    smu: SMU2601B = dm.add_smu("192.168.0.1")
    
    # Create a buffer
    BUFFER_NAME = "mybuffer"
    smu.write(f"{BUFFER_NAME} = smua.makebuffer(100)")
    
    # Configure buffer
    smu.commands.buffer_var[BUFFER_NAME].clear()
    smu.commands.buffer_var[BUFFER_NAME].collectsourcevalues = 1  # Enable source value storage
    smu.commands.buffer_var[BUFFER_NAME].appendmode = 1  # Enable append mode
    
    # Get buffer capacity
    capacity = smu.commands.buffer_var[BUFFER_NAME].capacity
```

### SMU Source and Measurement Configuration

```python
from tm_devices import DeviceManager
from tm_devices.drivers import SMU2602B

with DeviceManager() as dm:
    smu: SMU2602B = dm.add_smu("192.168.0.1")
    
    # Aliases for readability
    commands = smu.commands
    smua = smu.commands.smu["a"]
    smub = smu.commands.smu["b"]
    
    # Reset SMU channel
    smua.reset()
    
    # Configure source settings
    smua.source.settling = smua.SETTLE_FAST_POLARITY
    smua.source.autorangev = smua.AUTORANGE_OFF
    smua.source.autorangei = smua.AUTORANGE_OFF
    smua.source.rangev = 10.0  # Set voltage range
    smua.source.limiti = 100e-3  # Set current limit
    
    # Configure measurement settings
    smua.measure.autorangev = smua.AUTORANGE_OFF
    smua.measure.autorangei = smua.AUTORANGE_OFF
    smua.measure.autozero = smua.AUTOZERO_OFF
    smua.measure.rangei = 100e-3
    smua.measure.nplc = 0.001  # Integration time
    
    # Set source function (DC voltage or DC current)
    smua.source.func = smua.OUTPUT_DCVOLTS  # or OUTPUT_DCAMPS
    
    # Set source level
    smua.source.levelv = 5.0  # For voltage mode
    smua.source.leveli = 10e-3  # For current mode
    
    # Enable output
    smua.source.output = smua.OUTPUT_ON
    
    # Measure voltage and current
    voltage = smua.measure.v()
    current = smua.measure.i()
    
    # Disable output
    smua.source.output = smua.OUTPUT_OFF
```

### SMU AC Waveform Generation

```python
import math
from tm_devices import DeviceManager
from tm_devices.drivers import SMU2602B

RESOURCE_ID = "192.168.0.1"
VRMS = 12
VPP = VRMS * 2**0.5
NUM_CYCLES = 2
FREQUENCY = 60
LIMIT_I = 100e-3
NPLC = 0.001
PTS_PER_CYCLE = int(7200 / FREQUENCY)  # Must be integer
NUM_DATA_PTS = PTS_PER_CYCLE * NUM_CYCLES  # Must be integer

def waveform_sweep(inst: SMU2602B) -> None:
    """Performs an AC Waveform Sweep on the Instrument."""
    commands = inst.commands
    smua = inst.commands.smu["a"]
    
    # Configure SMU ranges
    smua.reset()
    smua.source.settling = smua.SETTLE_FAST_POLARITY
    smua.source.autorangev = smua.AUTORANGE_OFF
    smua.source.autorangei = smua.AUTORANGE_OFF
    smua.source.rangev = VPP
    smua.source.limiti = LIMIT_I
    
    smua.measure.autorangev = smua.AUTORANGE_OFF
    smua.measure.autorangei = smua.AUTORANGE_OFF
    smua.measure.autozero = smua.AUTOZERO_OFF
    smua.measure.rangei = LIMIT_I
    smua.measure.nplc = NPLC
    
    # Prepare reading buffers
    commands.buffer_var["smua.nvbuffer1"].clear()
    commands.buffer_var["smua.nvbuffer1"].collecttimestamps = 1
    commands.buffer_var["smua.nvbuffer2"].clear()
    commands.buffer_var["smua.nvbuffer2"].collecttimestamps = 1
    
    # Configure trigger model
    commands.trigger.timer[1].delay = 1 / 7200
    commands.trigger.timer[1].passthrough = "true"
    commands.trigger.timer[1].stimulus = smua.trigger.ARMED_EVENT_ID
    commands.trigger.timer[1].count = NUM_DATA_PTS - 1
    
    # Create source values list (sine wave)
    inst.write("src_values = {}")
    for index in range(1, NUM_DATA_PTS + 1):
        value = VPP * math.sin(index * 2 * math.pi / PTS_PER_CYCLE)
        inst.write(f"src_values[{index}] = {value:.2e}")
    inst.write("smua.trigger.source.listv(src_values)")
    
    # Configure SMU trigger model
    smua.trigger.source.limiti = LIMIT_I
    smua.trigger.measure.action = smua.ENABLE
    smua.trigger.measure.iv("smua.nvbuffer1", "smua.nvbuffer2")
    smua.trigger.endpulse.action = smua.SOURCE_HOLD
    smua.trigger.endsweep.action = smua.SOURCE_IDLE
    smua.trigger.count = NUM_DATA_PTS
    smua.trigger.arm.stimulus = 0
    smua.trigger.source.stimulus = commands.trigger.timer[1].EVENT_ID
    smua.trigger.measure.stimulus = 0
    smua.trigger.endpulse.stimulus = 0
    smua.trigger.source.action = smua.ENABLE
    
    # Begin the test
    smua.source.output = smua.OUTPUT_ON
    smua.trigger.initiate()
    
    # Wait for operation to complete
    inst.query("waitcomplete() print(1)")
    
    smua.source.output = smua.OUTPUT_OFF
    
    # Print buffer data
    print("Timestamps", "Voltage", "Current", sep="\t")
    inst.print_buffers("smua.nvbuffer1.timestamps", "smua.nvbuffer2", "smua.nvbuffer1")

with DeviceManager(verbose=False) as dm:
    inst_driver: SMU2602B = dm.add_smu(RESOURCE_ID)
    waveform_sweep(inst_driver)
```

### SMU Multi-Channel Operations (2602B)

```python
from tm_devices import DeviceManager
from tm_devices.drivers import SMU2602B

with DeviceManager() as dm:
    smu: SMU2602B = dm.add_smu("192.168.0.1")
    
    # Access SMU channels
    smua = smu.commands.smu["a"]  # Channel A
    smub = smu.commands.smu["b"]  # Channel B
    
    # Configure both channels independently
    smua.source.func = smua.OUTPUT_DCVOLTS
    smua.source.levelv = 5.0
    smua.source.limiti = 100e-3
    
    smub.source.func = smub.OUTPUT_DCAMPS
    smub.source.leveli = 10e-3
    smub.source.limitv = 10.0
    
    # Enable outputs
    smua.source.output = smua.OUTPUT_ON
    smub.source.output = smub.OUTPUT_ON
    
    # Measure from both channels
    voltage_a = smua.measure.v()
    current_a = smua.measure.i()
    voltage_b = smub.measure.v()
    current_b = smub.measure.i()
```

### SMU BJT Testing Example

```python
import time
from tm_devices import DeviceManager
from tm_devices.drivers import SMU2602B

RESOURCE_ID = "192.168.0.1"
NPLC = 0.001
VCEO_LIMIT = 40
SRC_COLLECTOR = 10e-3
SRC_BASE = 1e-3

def bjt_test(inst: SMU2602B) -> None:
    """Example BJT testing sequence."""
    smua = inst.commands.smu["a"]
    smub = inst.commands.smu["b"]
    
    # Setup SMUB - Base
    smub.reset()
    smub.source.func = smub.OUTPUT_DCVOLTS
    smub.source.levelv = 0
    smub.source.output = smub.OUTPUT_ON
    
    # Setup SMUA - Collector
    smua.reset()
    smua.source.func = smua.OUTPUT_DCVOLTS
    smua.source.levelv = 0
    smua.source.output = smua.OUTPUT_ON
    
    # VCEO Test
    smub.source.func = smub.OUTPUT_DCAMPS
    smub.source.leveli = 0
    smua.source.func = smua.OUTPUT_DCAMPS
    smua.source.leveli = 0.01
    time.sleep(0.01)
    vceo = float(smua.measure.v())
    
    # VCEsat/VBEsat Test
    smua.source.leveli = SRC_COLLECTOR
    smub.source.leveli = SRC_BASE
    time.sleep(0.01)
    vce_sat = float(smua.measure.v())
    vbe_sat = float(smub.measure.v())
    
    # HFE Test
    smua.source.func = smua.OUTPUT_DCVOLTS
    smua.source.levelv = 1.0
    smub.source.func = smub.OUTPUT_DCVOLTS
    smub.source.leveli = 0
    time.sleep(0.01)
    
    # Search for target collector current
    target_ic = 100e-6
    high_ib = 10e-7
    low_ib = 1e-9
    
    for _ in range(10):
        ib_value = (high_ib + low_ib) / 2 + low_ib
        smub.source.leveli = ib_value
        time.sleep(0.01)
        ic_meas = float(smua.measure.i())
        
        if ic_meas > target_ic:
            high_ib = ib_value
        else:
            low_ib = ib_value
        
        if abs(ic_meas - target_ic) < (0.05 * target_ic):
            break
    
    beta = ic_meas / ib_value
    
    # Cleanup
    smua.source.output = smua.OUTPUT_OFF
    smub.source.output = smub.OUTPUT_OFF

with DeviceManager(verbose=False) as dm:
    smu_driver: SMU2602B = dm.add_smu(RESOURCE_ID)
    bjt_test(smu_driver)
```

---

## AWG Operations

### Basic AWG Function Generation

```python
from tm_devices import DeviceManager
from tm_devices.drivers import AWG5K

with DeviceManager(verbose=True) as dm:
    awg: AWG5K = dm.add_awg("192.168.0.1")
    
    # Generate a function using generate_function helper
    awg.generate_function(
        function=awg.source_device_constants.functions.RAMP,
        channel="SOURCE1",
        frequency=10e6,
        amplitude=0.5,
        offset=0,
    )
```

### AWG Source Channel Configuration

```python
from tm_devices import DeviceManager
from tm_devices.drivers import AWG5K

with DeviceManager(verbose=True) as dm:
    awg: AWG5K = dm.add_awg("192.168.0.1")
    
    # Set offset on source channel
    awg.source_channel["SOURCE1"].set_offset(0.5)
    
    # Set amplitude on source channel
    awg.source_channel["SOURCE1"].set_amplitude(0.2)
    
    # Turn on source channel
    awg.source_channel["SOURCE1"].set_state(1)
```

### AWG Waveform Constraints

```python
from tm_devices import DeviceManager
from tm_devices.drivers import AWG5K
from tm_devices.helpers.enums import SignalGeneratorFunctionsAWG

DESIRED_FREQUENCY = 10e6
DESIRED_AMPLITUDE = 5.0
DESIRED_SAMPLE_RATE = 1e9
DESIRED_FUNCTION = SignalGeneratorFunctionsAWG.SIN
DESIRED_WAVEFORM_LENGTH = 1000000

with DeviceManager(verbose=True) as dm:
    awg: AWG5K = dm.add_awg("192.168.0.1")
    
    # Get constraints for specific function
    constraints_function = awg.get_waveform_constraints(function=DESIRED_FUNCTION)
    
    # Check frequency constraints
    frequency_range = constraints_function.frequency_range
    if frequency_range.lower <= DESIRED_FREQUENCY <= frequency_range.upper:
        awg.generate_function(
            function=awg.source_device_constants.functions.RAMP,
            channel="SOURCE1",
            frequency=DESIRED_FREQUENCY,
            amplitude=0.5,
            offset=0,
        )
    else:
        print(f"Frequency {DESIRED_FREQUENCY} out of range [{frequency_range.lower}, {frequency_range.upper}]")
    
    # Check amplitude constraints
    amplitude_range = constraints_function.amplitude_range
    if amplitude_range.lower <= DESIRED_AMPLITUDE <= amplitude_range.upper:
        awg.generate_function(
            function=awg.source_device_constants.functions.RAMP,
            channel="SOURCE1",
            frequency=500.0e3,
            amplitude=DESIRED_AMPLITUDE,
            offset=0,
        )
    else:
        print(f"Amplitude {DESIRED_AMPLITUDE} out of range [{amplitude_range.lower}, {amplitude_range.upper}]")
    
    # Get constraints for waveform length
    constraints_length = awg.get_waveform_constraints(waveform_length=DESIRED_WAVEFORM_LENGTH)
    sample_rate_range = constraints_length.sample_rate_range
    
    if not sample_rate_range.lower <= DESIRED_SAMPLE_RATE <= sample_rate_range.upper:
        print(f"Sample rate {DESIRED_SAMPLE_RATE} out of range [{sample_rate_range.lower}, {sample_rate_range.upper}]")
```

---

## AFG Operations

### AFG Function Generation

```python
from tm_devices import DeviceManager
from tm_devices.drivers import AFG3K

with DeviceManager(verbose=True) as dm:
    afg: AFG3K = dm.add_afg("192.168.0.1")
    
    # Generate a RAMP waveform with properties
    afg.generate_function(
        function=afg.source_device_constants.functions.RAMP,
        channel="SOURCE1",
        frequency=10e6,
        amplitude=0.5,
        offset=0,
        symmetry=50.0,  # AFG-specific parameter
    )
```

### AFG Output Control

```python
from tm_devices import DeviceManager
from tm_devices.drivers import AFG3KC

with DeviceManager(verbose=True) as dm:
    afg: AFG3KC = dm.add_afg("192.168.0.1")
    
    # Turn on AFG output
    afg.set_and_check(":OUTPUT1:STATE", "1")
    
    # Verify output state
    afg.expect_esr(0)
```

---

## Advanced Patterns

### Direct PyVISA Resource Access

```python
from tm_devices import DeviceManager
from tm_devices.drivers import MSO5B

with DeviceManager() as dm:
    scope: MSO5B = dm.add_scope("192.168.0.1")
    
    # Access PyVISA resource directly
    # scope.visa_resource returns MessageBasedResource from PyVISA
    raw_data = scope.visa_resource.read_bytes(1024)
```

### Error Checking Patterns

```python
from tm_devices import DeviceManager
from tm_devices.drivers import MSO6B

with DeviceManager(verbose=True) as dm:
    scope: MSO6B = dm.add_scope("192.168.0.1")
    
    # Set and check command
    scope.set_and_check(":HORIZONTAL:SCALE", 100e-9)
    
    # Check error status register
    scope.expect_esr(0)
    
    # Query event status register
    esr_value = scope.commands.esr.query()
```

### Verification Patterns

```python
from tm_devices import DeviceManager
from tm_devices.drivers import MSO6B

with DeviceManager(verbose=True) as dm:
    scope: MSO6B = dm.add_scope("192.168.0.1")
    
    # Write with verification
    scope.commands.ch[1].scale.write(0.5, verify=True)
    
    # Set and check pattern
    scope.set_and_check(":HORIZONTAL:SCALE", 100e-9)
```

---

## Key Patterns for Blockly Generation

### Command Tree Structure
- `scope.commands.ch[1].scale.write(value)` - Indexed access with brackets
- `scope.commands.measurement.meas[1].source.write("CH1")` - Nested indexed access
- `scope.commands.display.waveview1.ch[1].state.write("ON")` - Deep nesting
- `smu.commands.smu["a"].source.levelv.write(5.0)` - String-indexed access for SMU channels
- `smu.commands.buffer_var[BUFFER_NAME].clear()` - Dynamic buffer access

### Write vs Query
- `.write(value)` - Send command
- `.query()` - Query and return value
- `.write(value, verify=True)` - Write with verification
- `inst.write("script_code")` - Execute script code directly (SMU/AWG)

### Helper Methods
- `scope.turn_channel_on("CH1")` - High-level helper
- `scope.add_new_math("MATH1", "CH1")` - Helper method
- `scope.save_screenshot(filename)` - Convenience method
- `scope.curve_query(channel, output_csv_file=path)` - Specialized method
- `awg.generate_function(...)` - AWG function generation helper
- `afg.generate_function(...)` - AFG function generation helper
- `smu.commands.smu["a"].reset()` - SMU channel reset

### SMU Patterns
- Channel access: `smu.commands.smu["a"]` or `smu.commands.smu["b"]`
- Source configuration: `smua.source.func = smua.OUTPUT_DCVOLTS`
- Measurement: `voltage = smua.measure.v()`, `current = smua.measure.i()`
- Buffer operations: `smu.commands.buffer_var[BUFFER_NAME].clear()`
- Trigger model: `smua.trigger.initiate()`, `smua.trigger.count = NUM_PTS`

### AWG/AFG Patterns
- Function generation: `awg.generate_function(function, channel, frequency, amplitude, offset)`
- Source channel: `awg.source_channel["SOURCE1"].set_offset(0.5)`
- Constraints checking: `awg.get_waveform_constraints(function=DESIRED_FUNCTION)`

### OPC Pattern
```python
scope.commands.acquire.state.write("ON")
if int(scope.commands.opc.query()) == 1:
    # Operation complete
    pass
```

### SMU Wait Pattern
```python
smu.trigger.initiate()
smu.query("waitcomplete() print(1)")  # Wait for trigger sequence
```

### Context Manager Pattern
```python
with DeviceManager(verbose=True) as dm:
    scope = dm.add_scope("192.168.0.1")
    # Automatic cleanup on exit
```

---

## Notes for Custom GPT

1. **Indexed Access**: Always use `[x]` brackets for indexed nodes (ch[1], meas[1], psu[1])
2. **String Indexed Access**: SMU channels use string indices: `smu["a"]`, `smu["b"]`
3. **Command Tree**: Commands follow hierarchical tree structure
4. **Write/Query**: Use `.write()` for commands, `.query()` for queries
5. **Verification**: Can add `verify=True` to write operations
6. **Helper Methods**: Some operations have high-level helper methods
7. **Context Manager**: Always use `with DeviceManager()` for proper cleanup
8. **Backend Selection**: Can specify VISA backend via `dm.visa_library`
9. **Aliases**: Devices can have aliases for easier reference
10. **Error Checking**: Use `set_and_check()`, `expect_esr()`, or `verify=True`
11. **OPC Pattern**: Use OPC query to wait for operation completion
12. **SMU Script Execution**: SMU supports direct script execution via `smu.write("script_code")`
13. **SMU Buffers**: Dynamic buffers created via script, accessed via `commands.buffer_var[NAME]`
14. **SMU Trigger Model**: Complex trigger sequences for waveform generation
15. **AWG Constraints**: Check waveform constraints before generation
16. **AFG Symmetry**: AFG supports symmetry parameter for certain waveforms

---

## Blockly Block Implications

When generating Blockly blocks for tm_devices operations:

1. **Channel Operations**: Use indexed channel blocks (ch[1], ch[2], etc.)
2. **Measurement Blocks**: Support indexed measurements (meas[1], meas[2], etc.)
3. **SMU Channel Blocks**: Support string-indexed SMU channels ("a", "b")
4. **SMU Source Blocks**: Support source function selection (DCVOLTS, DCAMPS)
5. **SMU Buffer Blocks**: Support dynamic buffer creation and access
6. **AWG/AFG Function Blocks**: Support function generation with constraints checking
7. **Verification**: Include optional verification checkbox
8. **OPC Waiting**: Provide wait_for_opc blocks after critical operations
9. **Helper Methods**: Prefer helper methods when available (save_screenshot, curve_query, generate_function)
10. **Context Awareness**: Blocks should track device context automatically
11. **Error Handling**: Support error checking blocks (expect_esr, set_and_check)
12. **SMU Trigger Blocks**: Support trigger model configuration for complex sequences
13. **AWG Constraints Blocks**: Support waveform constraint checking before generation
