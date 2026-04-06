# Decode Bring-Up Procedure

This is the primary playbook for decode setup, bus decode bring-up, or when protocol decode is requested before the waveform is stable.

Use this procedure when the user wants protocol decode and the AI needs a safe order of operations before configuring bus-specific details.

## Trigger Signals

- User asks to set up I2C, SPI, UART, CAN, or similar decode
- User asks for decode setup or bus setup
- Bus table is empty or decode does not lock
- Clock and data sources are known but results are unreadable

## Procedure

1. Get the analog waveforms stable first: correct scaling, visible edges, and stable triggering.
2. Confirm the intended bus sources channel by channel before enabling decode.
3. Configure the bus sources and polarity/threshold settings required for that protocol.
4. Turn on decode only after the underlying waveforms are readable.
5. If decode looks wrong, check thresholds, polarity, and source mapping before assuming the bus type is wrong.

## Notes

- Decode setup should follow waveform bring-up, not replace it.
- Bus decode failures are often threshold or source issues, not missing bus commands.
- Save screenshots or bus tables only after decode is readable.
