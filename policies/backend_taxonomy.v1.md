# Backend Taxonomy Policy v1

## Decision Tree
1. Default: pyvisa (works with all instruments, all SCPI commands)
2. tm_devices: ONLY when user explicitly requests tm_devices or flow already uses it
3. TekHSI: ONLY when user explicitly says "tekhsi" or "grpc" — for high-speed waveform capture only
4. TekExpress: pyvisa with SOCKET (port 5000), TEKEXP:* commands, no *OPC? → use TEKEXP:STATE? polling

## pyvisa (default)
- Standard SCPI commands via write/query steps
- Works with ALL Tektronix instruments
- Connection types: TCP/IP (INSTR), Socket, USB, GPIB
- VXI-11 used automatically with ::INSTR suffix

## vxi11
- vxi11 is used automatically by pyvisa when the resource string ends with `::INSTR` suffix
- Rarely needs explicit selection by the user — pyvisa handles it transparently
- Valid backend value; accept it if user requests it explicitly

## tm_devices
- Use tm_device_command step type ONLY — never raw write/query
- Python object API: device.commands.<subsystem>.<method>(value)
- Socket connection NOT supported
- Requires known device model for command tree validation
- Supports: MSO4/5/6, DPO5K/7K, AWG, AFG, SMU

## TekHSI
- gRPC-based high-speed waveform transfer (10x faster than SCPI)
- ONLY for waveform acquisition — NOT for measurements, search, histogram, general SCPI
- Requires MSO 4/5/6/7 with specific firmware
- Do NOT suggest TekHSI unless user explicitly requests it

## Hybrid
- Multi-backend orchestration (e.g., pyvisa for control + TekHSI for data)
- NOT a standalone command API
- Rare — only suggest when user explicitly needs mixed backends

## Preserve Context
- If flow already specifies a backend, preserve it unless user asks to change
- Do not switch backends without explicit user request
