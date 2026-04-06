import type {
  ParsedBusIntent,
  ParsedMeasurementIntent,
  PlannerIntent,
} from './intentPlanner';

export interface ResourceConflict {
  type: 'CHANNEL_CONFLICT' | 'BUS_CONFLICT' | 'TRIGGER_CONFLICT';
  severity: 'ERROR' | 'WARNING';
  message: string;
  affectedResources: string[];
  suggestion?: string;
}

export interface ResourceState {
  channels: Map<string, string>;
  buses: Map<string, string>;
  triggerSource?: string;
}

function busClaimTag(bus: ParsedBusIntent): string {
  return `${bus.protocol}_${bus.bus || 'B?'}`;
}

function collectBusSources(bus: ParsedBusIntent): string[] {
  const raw = [
    bus.source1,
    bus.source2,
    bus.source3,
    bus.clockSource,
    bus.dataSource,
    bus.chipSelect,
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const source of raw) {
    if (!source) continue;
    const normalized = source.toUpperCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function hasFastMeasurement(measurements: ParsedMeasurementIntent[]): boolean {
  return measurements.some((measurement) =>
    ['FREQUENCY', 'RISETIME', 'FALLTIME', 'PERIOD'].includes(measurement.type)
  );
}

function hasSlowBus(buses: ParsedBusIntent[]): boolean {
  return buses.some((bus) => {
    const rate = bus.baudRate ?? bus.bitrateBps;
    return typeof rate === 'number' && rate > 0 && rate < 1_000_000;
  });
}

function hasMeasurementOnBusChannel(
  measurements: ParsedMeasurementIntent[],
  state: ResourceState
): boolean {
  return measurements.some((measurement) => {
    const source = String(measurement.source1 || '').toUpperCase();
    return source ? state.channels.has(source) : false;
  });
}

export function checkPlannerConflicts(intent: PlannerIntent): ResourceConflict[] {
  const conflicts: ResourceConflict[] = [];
  const state: ResourceState = {
    channels: new Map(),
    buses: new Map(),
  };

  for (const bus of intent.buses || []) {
    const claim = busClaimTag(bus);
    const busSlot = String(bus.bus || '').toUpperCase();
    const sources = collectBusSources(bus);

    for (const channel of sources) {
      if (state.channels.has(channel)) {
        const existing = state.channels.get(channel) || 'UNKNOWN';
        if (existing !== claim) {
          conflicts.push({
            type: 'CHANNEL_CONFLICT',
            severity: 'ERROR',
            message: `${channel} is claimed by both ${existing} and ${claim}.`,
            affectedResources: [channel, busSlot || claim],
            suggestion: `Use a different channel for ${claim}.`,
          });
          continue;
        }
      }
      state.channels.set(channel, claim);
    }

    if (!busSlot) continue;
    if (state.buses.has(busSlot)) {
      const existing = state.buses.get(busSlot) || 'UNKNOWN';
      if (existing !== bus.protocol) {
        conflicts.push({
          type: 'BUS_CONFLICT',
          severity: 'ERROR',
          message: `${busSlot} is assigned to both ${existing} and ${bus.protocol}.`,
          affectedResources: [busSlot],
          suggestion: `Use a different bus slot for ${bus.protocol}.`,
        });
      }
      continue;
    }
    state.buses.set(busSlot, bus.protocol);
  }

  if (intent.trigger?.source) {
    const triggerSource = intent.trigger.source.toUpperCase();
    state.triggerSource = triggerSource;
    const owner = state.channels.get(triggerSource);
    if (owner && intent.trigger.type === 'EDGE') {
      conflicts.push({
        type: 'TRIGGER_CONFLICT',
        severity: 'WARNING',
        message: `Trigger source ${triggerSource} is also used by ${owner}.`,
        affectedResources: [triggerSource],
        suggestion: 'Set TRIGger:A:TYPe BUS and trigger on the bus directly.',
      });
    }
  }

  const measurements = intent.measurements || [];
  if (
    hasFastMeasurement(measurements) &&
    hasSlowBus(intent.buses || []) &&
    hasMeasurementOnBusChannel(measurements, state)
  ) {
    conflicts.push({
      type: 'TRIGGER_CONFLICT',
      severity: 'WARNING',
      message:
        'Timebase conflict: slow bus decode and fast signal measurement may require separate acquisitions.',
      affectedResources: [],
      suggestion:
        'Split into two acquisitions: one optimized for bus decode and one for high-speed measurement.',
    });
  }

  return conflicts;
}
