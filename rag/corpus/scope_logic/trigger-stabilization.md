# Trigger Stabilization Procedure

This is the primary playbook for a rolling waveform, unstable trigger, or jittery display caused by poor trigger setup.

Use this procedure when the waveform is rolling, acquisitions are unstable, or measurements vary because the trigger is not well defined.

## Trigger Signals

- User says the waveform is not stable
- User says the waveform is rolling
- Display rolls or jitters horizontally
- Measurements jump around between acquisitions
- Trigger source or level looks wrong after autoset

## Procedure

1. Set the trigger source to the channel carrying the signal of interest.
2. Use edge trigger first unless the user clearly needs a more advanced trigger type.
3. Choose the expected slope and place the trigger level near the signal midpoint.
4. Set trigger mode to `AUTO` only for bring-up; switch to `NORMal` when the signal is understood.
5. If the display is still unstable, widen time scale briefly, confirm the signal amplitude, then fine tune level and slope again.

## Notes

- Edge trigger is the safest baseline trigger for unknown or simple signals.
- Do not jump to bus or logic trigger until basic edge trigger behavior is confirmed.
- Trigger stabilization should happen before measurement or decode troubleshooting.
