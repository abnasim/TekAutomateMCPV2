# Auto Setup Scope Procedure

Use this procedure when the user asks for a quick known-good display setup or when the current view is too mis-scaled to diagnose manually.

## Procedure

1. Enable only the channels that are relevant to the signal under test.
2. Set reasonable probe attenuation and termination first.
3. Run Autoset or front-panel autoset once.
4. Re-check horizontal scale, trigger source, trigger slope, and trigger level after autoset completes.
5. If autoset picked the wrong trigger source, correct trigger source manually and leave the acquired scale settings in place.
6. If the display is still unstable, adjust vertical scale and trigger level manually instead of looping autoset repeatedly.

## Notes

- Autoset is a starting point, not a final configuration.
- Repeated autoset can undo careful setup work later in a workflow.
- In generated flows, place autoset early, before fine trigger and measurement configuration.
