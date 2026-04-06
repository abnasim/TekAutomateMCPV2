# SCPI Command Groups - Academy Article

## Overview

The Tektronix MSO (Mixed Signal Oscilloscope) Programmer Manual organizes SCPI commands into logical groups. Understanding these command groups helps you navigate the extensive command set and find the right commands for your automation tasks.

**Note:** Some commands may not be available on all instrument models. Also, some commands are only available if your instrument has the associated option installed.

## Command Groups Overview

The MSO Programmer Manual defines **34 command groups** containing **2,952 total commands**. Each group focuses on a specific aspect of instrument control and measurement.

---

## Command Groups by Category

### Acquisition and Measurement

#### Acquisition (15 commands)
Acquisition commands set up the modes and functions that control how the instrument acquires signals and processes them into waveforms. Using these commands for acquiring waveforms, you can:
- Start and stop acquisitions
- Control whether each waveform is simply acquired, averaged, or enveloped over successive acquisitions
- Set the controls or conditions that start and stop acquisitions
- Control acquisition of acquired channel waveforms
- Set acquisition parameters

#### Measurement (367 commands)
Use the commands in the Measurement Command Group to control the automated measurement system. Measurement commands can set and query measurement parameters. You can assign parameters, such as waveform sources and reference levels, differently for each measurement.

#### Digital Power Management (26 commands)
Use the commands in the DPM command group for Digital Power Management functionality. Requires option 5-DPM (5 Series MSO instruments) or 6-DPM (6 Series MSO instrument).

#### Inverter Motors and Drive Analysis (81 commands)
Use the commands in the IMDA group for input analysis, output analysis, ripple analysis measurements.

#### Wide Band Gap Analysis (WBG) (47 commands)
Use the commands in the Wide Band Gap Analysis (WBG) command group for WBG-DPT (Wide Band Gap Device Power Test) measurements.

---

### Display and Visualization

#### Display (130 commands)
Display commands control general instrument settings, such as the intensity of the graticule, stacked or overlay display mode, and the fastacq color palette. Display commands also control how and where waveforms are shown, their position on screen, and zoom settings applied to the view.

#### Cursor (121 commands)
Use the commands in the Cursor Command Group to control the cursor display and readout. You can use these commands to control the setups for each cursor, such as waveform source, and cursor position.

#### Zoom (20 commands)
Zoom commands let you expand and position the waveform display horizontally and vertically, without changing the time base or vertical settings. Note: Zoom commands are available once a view has been added.

#### Histogram (28 commands)
Use the commands in the Histogram command group for Histogram functionality.

#### Plot (47 commands)
Plot commands let you select the type and control the appearance of your plots.

#### Spectrum view (52 commands)
The Spectrum view commands control the selection and execution of spectrum analysis.

---

### Triggering and Search

#### Trigger (266 commands)
Use the commands in the Trigger Command Group to control all aspects of triggering for the instrument. There are two triggers: A and B. Where appropriate, the command set has parallel constructions for each trigger. You can set the A or B triggers to edge mode, pulse mode, or logic modes. The trigger types of Pulse Width, Timeout, Runt, Window, and Rise/Fall Time can be further qualified by a logic pattern.

#### Search and Mark (650 commands)
Use search and mark commands to seek out and identify information in waveform records that warrant further investigation. This is the largest command group, covering extensive bus protocol search capabilities.

---

### Bus Protocols

#### Bus (339 commands)
Use the commands in the Bus Command Group to configure a bus. These commands let you:
- Specify the bus type
- Specify the signals to be used in the bus
- Specify its display style

Note: Bus commands are present once a bus has been added. This group supports numerous bus protocols including CAN, I2C, SPI, USB, Ethernet, ARINC429A, FlexRay, LIN, MIL-STD-1553B, and many more.

---

### Waveform Processing

#### Math (85 commands)
Use the commands in the Math Command Group to create and define math waveforms. Use the available math functions to define your math waveform.

#### Waveform Transfer (41 commands)
Use the commands in the Waveform Transfer Command Group to transfer waveform data points from the instrument. Waveform data points are a collection of values that define a waveform. One data value usually represents one data point in the waveform record. When working with envelope waveforms, each data value is either the minimum or maximum of a min/max pair.

**Data Formats:**
- **Acquired waveform data** uses eight or more bits to represent each data point, depending on acquisition mode
- **ASCII format**: More readable but requires more bytes
- **Binary formats**: RIBinary, SRIBinary, RFBinary, SRFBinary for efficient data transfer

Before you transfer waveform data, you must specify the data format, record length, and waveform source.

---

### Power Analysis

#### Power (268 commands)
Use the commands in the Power command group for power measurement functionality. This comprehensive group includes commands for:
- Control Loop Response
- Impedance measurements
- Efficiency measurements
- Harmonics analysis
- Switching loss measurements
- And many more power-related measurements

---

### File and Data Management

#### Save and Recall (26 commands)
Use the commands in the Save and Recall Command Group to store and retrieve internal waveforms and settings. When you save a setup, you save all the settings of the instrument. When you recall a setup, the instrument restores itself to the state that it was in when you originally saved that setting.

#### Save on (8 commands)
Use this group of commands to program the instrument to save images, measurements, waveforms, or the instrument setup, on triggers that you select. These commands still function, however the Act On Event commands are preferred.

#### File System (19 commands)
Use the commands in the File System Command Group to help you use the built-in hard disk drive. You can use the commands to list directory contents, create and delete directories, and create, copy, read, rename, or delete files.

---

### System and Configuration

#### Miscellaneous (71 commands)
Miscellaneous commands do not fit into other categories. Several commands and queries are common to all devices. The 488.2-1987 standard defines these commands. The common commands begin with an asterisk (*) character.

#### Status and Error (17 commands)
Use the commands in the Status and Error command Group to determine the status of the instrument and control events. Several commands and queries used with the instrument are common to all devices. The IEEE Std 488.2-1987 defines these commands and queries. The common commands begin with an asterisk (*) character.

#### Calibration (8 commands)
The Calibration commands provide information about the current state of instrument calibration and allow you to initiate signal path calibration (SPC).

#### Self Test (10 commands)
The Self test commands control the selection and execution of diagnostic tests.

---

### Specialized Features

#### Act On Event (32 commands)
Use this group of commands to program the instrument to perform an action on trigger, search, measurement limit, and mask test events.

#### Mask (29 commands)
Mask commands compare incoming waveforms to standard or user-defined masks. A mask is a set of polygonal regions on the screen. Unlike limit testing, the inside of a mask is the region where waveform data would not normally fall.

#### Alias (7 commands)
Alias commands allow you to define new commands as a sequence of standard commands. You might find this useful when repeatedly using the same commands to perform certain tasks like setting up measurements.

#### Callout (14 commands)
The Callout commands creates custom callouts to document specific details of your test results.

---

### Channel and Signal Control

#### Digital (33 commands)
Use the commands in the Digital Command Group to acquire up to 64 digital signals and analyze them. Digital channels are only available when a digital probe is attached to the super channel.

#### Horizontal (48 commands)
Horizontal commands control the time base of the instrument. You can set the time per division (or time per point) of the main time base.

#### DVM (12 commands)
Use the commands in the DVM command group for Digital Voltmeter functionality. Requires DVM option (free with product registration).

---

### Communication and Interface

#### Ethernet (14 commands)
Use the commands in the Ethernet Command Group to set up the 10BASE-T, 100BASE-TX, 1000BASE-TX or 100BASE-T Ethernet remote interface.

---

### Optional Features

#### AFG (18 commands)
Use the AFG commands for Arbitrary Function Generator functionality. Requires option AFG.

#### History (3 commands)
Use the commands in the History command group for History mode functionality.

---

## Using Command Groups in TekAutomate

The command groups mapping provides several benefits for automation:

1. **Group Validation**: When extracting commands from the PDF, we can validate that each command belongs to the correct group.

2. **Organized Navigation**: Commands are logically organized, making it easier to find related functionality.

3. **Academy Articles**: Each command group has a detailed description that can be used to create educational content.

4. **Command Discovery**: Users can browse commands by functional area rather than alphabetically.

## Command Structure

Each command in the extracted JSON includes:
- **scpi**: The SCPI command string
- **description**: Detailed description of what the command does
- **group**: The command group it belongs to (validated against our mapping)
- **syntax**: One or more syntax examples
- **arguments**: Parameter descriptions (when applicable)
- **examples**: Usage examples (when available)
- **relatedCommands**: Related commands (when available)
- **conditions**: Special conditions or requirements (when applicable)
- **returns**: Return value descriptions (for query commands)

## Summary

Understanding command groups helps you:
- Navigate the extensive command set efficiently
- Find related commands for your automation tasks
- Understand the instrument's capabilities by functional area
- Create better automation scripts by grouping related operations

With 34 command groups and 2,952 commands, the MSO provides comprehensive programmatic control over all aspects of signal acquisition, analysis, and measurement.

## Command Compatibility and Migration

When migrating automation scripts from older Tektronix oscilloscopes (DPO7000, MSO/DPO5000) to newer models (2 Series MSO, 4 Series MSO, 5 Series MSO, 6 Series MSO), you may encounter command syntax differences.

**PI Command Translator**: Modern Tektronix oscilloscopes (firmware v1.30+) include a built-in Programming Interface (PI) Command Translator that automatically converts legacy commands to modern equivalents. This feature allows existing automation scripts to work on new hardware without immediate code changes.

For detailed information on:
- How the PI Translator works
- Enabling and configuring the translator
- Creating custom command translations
- Migration strategies

See the Academy article: **"PI Command Translator: Migrating Legacy Commands to Modern Oscilloscopes"** in the Measurements & Commands section.

**Source**: [Tektronix Technical Brief - PI Command Translator](https://www.tek.com/en/documents/technical-brief/pi-command-translator-on-oscilloscopes-tech-brief)








