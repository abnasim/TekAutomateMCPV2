# Invalid Measurement Results Procedure

Use this procedure when the scope returns invalid numeric sentinels such as `9.91E+37`, clipping flags, or obviously impossible values.

## Trigger Signals

- `9.91E+37`
- Measurement result is huge or impossible
- Clipping reported by channel or measurement queries
- Measurement exists but does not produce a usable value

## Procedure

1. Treat the value as invalid and do not use it in decisions or pass/fail logic.
2. Check whether the waveform is clipped, off-screen, or under-ranged.
3. Fix vertical scale and vertical position before touching the measurement definition.
4. Verify the measurement source and reference levels after the waveform is visible and stable.
5. Re-run the measurement only after the signal is no longer clipped or obviously malformed.

## Notes

- `9.91E+37` is usually a sentinel, not a real numeric measurement.
- Invalid results often mean setup is wrong, not that the measurement command itself is wrong.
- Prefer fixing signal visibility before deleting and recreating measurements.
