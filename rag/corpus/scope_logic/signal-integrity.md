# Signal Integrity Triage

Use this when the user mentions ringing, overshoot, undershoot, unstable edges, or poor signal quality.

## Procedure

1. Verify the channel is not clipping before interpreting overshoot or ringing.
2. Confirm probe attenuation, grounding, and compensation are correct.
3. Reduce loop area in the probe ground connection if a passive probe is used.
4. Check whether bandwidth limiting should be enabled for the measurement goal.
5. Use a shorter time scale to inspect the edge directly.
6. Add overshoot, rise time, fall time, or pk-to-pk measurements only after the displayed edge is trustworthy.

## Notes

- Apparent overshoot on a clipped waveform is not trustworthy.
- Bad probe setup often looks like a signal problem.
- For quantitative edge analysis, stabilize the display first and measure second.
