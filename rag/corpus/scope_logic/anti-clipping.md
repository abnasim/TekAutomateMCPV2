# Anti-Clipping Procedure

Use this procedure when clipping is detected, a measurement or cursor query returns `9.91E+37`, or the waveform is clearly over-ranging.

## Trigger Signals

- Channel clipping query reports `1`
- Result values come back as `9.91E+37`
- DVM or measurement results mention clipping
- Trace is flattened against the top or bottom of the display

## Procedure

1. Identify the affected analog channel.
2. Increase the vertical scale on that channel until the waveform no longer hits the display rails.
3. Re-center the waveform with channel offset or position if needed.
4. Check channel termination, attenuation, and probe settings to confirm they match the actual setup.
5. If bandwidth limiting is enabled and the signal is still clipping, keep the larger scale anyway; bandwidth limiting is not a clipping fix.
6. Re-run the clipping query or the failing measurement.
7. Only trust amplitude, overshoot, rise/fall, or statistics results after clipping clears.

## Notes

- `9.91E+37` should be treated as an invalid-result sentinel, not a usable numeric value.
- For automated recovery, prefer fixing vertical scale and position before changing trigger settings.
- If clipping remains after reasonable scaling changes, suspect the probe attenuation or hardware range.
