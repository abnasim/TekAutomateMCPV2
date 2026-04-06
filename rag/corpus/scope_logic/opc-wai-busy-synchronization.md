# Synchronization with *OPC, *OPC?, *WAI, and BUSY?

Use this procedure when the scope needs time to finish an operation before the next command is safe, especially for single-sequence acquisition, autoset, save/recall, waveform recall, trigger level set, calibration, or measurement result queries that depend on acquisition completion.

## Trigger Signals

- `*OPC`
- `*OPC?`
- `*WAI`
- `BUSY?`
- `single sequence acquisition`
- `acquire complete`
- `wait until operation complete`
- `timeout while waiting`
- `no trigger`
- `operation pending`
- `measurement query returned too early`
- `synchronization`
- `ACQUIRE:STOPAFTER SEQUENCE`
- `MEASUREMENT after acquisition`

## Procedure

1. Identify whether the operation is one of the long-running or completion-generating operations.
2. Prefer `*OPC?` when you want the simplest blocking synchronization and can afford to wait on the output queue.
3. Prefer `*WAI` when you want the instrument to defer later command execution until pending OPC-generating work is complete, but you do not need a query response.
4. Prefer `BUSY?` only when polling is acceptable and you intentionally want an explicit busy loop.
5. Prefer bare `*OPC` with status handling when you are using serial poll or SRQ-based synchronization.
6. Set the controller timeout long enough for the slowest expected operation before using `*OPC?` or a busy loop.
7. If the operation may never complete, such as single-sequence acquisition with no trigger, do not wait forever. Handle timeout by checking `*ESR?` and the event queue (`EVMsg?`, `ALLEv?`, or equivalent status/event tools for the scope).
8. After synchronization confirms completion, issue the measurement or follow-up command.

## Recommended Patterns

### Simplest Blocking Wait

Use `*OPC?` when you want a single blocking wait and then continue:

```text
ACQUIRE:STATE OFF
DISPLAY:WAVEVIEW1:CH1:STATE 1
HORIZONTAL:RECORDLENGTH 1000
ACQUIRE:MODE SAMPLE
ACQUIRE:STOPAFTER SEQUENCE
MEASUREMENT:MEAS1:TYPE AMPLITUDE
MEASUREMENT:MEAS1:SOURCE CH1
ACQUIRE:STATE ON
*OPC?
MEASUREMENT:MEAS1:RESUlts:CURRentacq:MEAN?
```

### Instrument-Gated Sequence

Use `*WAI` when later commands should not execute until pending work is complete:

```text
ACQUIRE:STATE ON
*WAI
MEASUREMENT:MEAS1:RESUlts:CURRentacq:MEAN?
```

### Polling Loop

Use `BUSY?` only when explicit polling is acceptable:

```text
ACQUIRE:STATE ON
While BUSY? keep looping
MEASUREMENT:IMMED:VALUE?
```

### Status/SRQ Synchronization

Use `*OPC` with status registers when polling or service request workflow is desired:

```text
DESE 1
*ESE 1
*SRE 32
ACQUIRE:STATE ON
*OPC
```

## Notes

- `*OPC` sets bit 0 of the Standard Event Status Register when all pending OPC-generating operations are complete. Read it through `*ESR?` or status handling.
- `*OPC?` returns `1` only after all pending OPC-generating operations complete, or a device clear is received.
- `*WAI` blocks instrument-side processing of later commands until pending OPC-generating operations complete.
- `BUSY?` returns `1` while operations are still pending and `0` when complete.
- Not every command supports OPC. Important examples that can generate OPC include `ACQuire:STATE ON` in single-sequence mode, `AUTOSet EXECute`, `*RST`, `SAVe:IMAGe`, `SAVe:SETUp`, `SAVe:WAVEform`, `RECAll:SETUp`, `RECAll:WAVEform`, internal calibration commands, probe auto-zero/degauss, `TRIGger:A SETLevel`, and some measurement result operations in single sequence or waveform recall contexts.
- Single-sequence acquisition may never complete if no trigger event occurs. Timeout handling is mandatory.
- If the AI is unsure which synchronization primitive to choose, default to `*OPC?` for simple blocking waits and use a generous timeout.
