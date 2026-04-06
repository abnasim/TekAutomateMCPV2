# Autoset First Procedure

Use this procedure when the user has an unknown signal, the display is badly scaled, or the fastest safe move is to get the scope close before fine tuning.

## Trigger Signals

- User says "just set it up"
- Unknown signal on a channel
- Display is unstable or clearly mis-scaled
- User asks for quick bring-up or basic optimization

## Procedure

1. Confirm the active probe attenuation and termination are reasonable for the channel.
2. Enable only the channels that matter for the immediate setup.
3. Run `AUTOSet EXECute` once.
4. Re-check trigger source, trigger slope, and trigger level after autoset completes.
5. If autoset chose the wrong source, keep the scaling it found and correct only the trigger and measurement setup manually.

## Notes

- Autoset is a starting point, not a final scope configuration.
- Do not loop autoset repeatedly after manual adjustments have started.
- Prefer autoset early in a flow, before decode, measurements, or screenshots.
