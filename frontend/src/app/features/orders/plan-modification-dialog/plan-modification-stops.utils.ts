import type { TrainPlan, TrainPlanStop } from '../../../core/models/train-plan.model';
import type { ScheduleTemplate } from '../../../core/models/schedule-template.model';
import type { PlanModificationStopInput } from '../../../core/services/train-plan.service';

export function operationReferenceIso(plan: TrainPlan): string {
  const firstDeparture = plan.stops.find((stop) => stop.departureTime)?.departureTime;
  if (firstDeparture) {
    return firstDeparture;
  }
  const firstArrival = plan.stops.find((stop) => stop.arrivalTime)?.arrivalTime;
  if (firstArrival) {
    return firstArrival;
  }
  return `${plan.calendar.validFrom}T00:00:00.000Z`;
}

export function combineDateWithTime(options: {
  referenceIso: string;
  time: string;
  fallbackValidFromIso: string;
}): Date {
  const reference = new Date(options.referenceIso);
  const [hours, minutes] = options.time.split(':').map((value) => Number.parseInt(value, 10));
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return new Date(NaN);
  }
  if (Number.isNaN(reference.getTime())) {
    return new Date(`${options.fallbackValidFromIso}T${options.time}:00.000Z`);
  }
  const result = new Date(reference);
  result.setUTCHours(hours, minutes, 0, 0);
  return result;
}

export function buildStopsFromTemplate(template: ScheduleTemplate, departure: Date): PlanModificationStopInput[] {
  const baseMinutes = extractReferenceMinutes(template.stops) ?? 0;
  return template.stops.map((stop) => {
    const arrivalMinutes = extractTime(stop.arrival?.earliest ?? stop.arrival?.latest);
    const departureMinutes = extractTime(stop.departure?.earliest ?? stop.departure?.latest);

    const offsetMinutes = (stop.offsetDays ?? 0) * 1440;
    const arrivalTime =
      arrivalMinutes !== undefined ? addMinutesToDate(departure, arrivalMinutes - baseMinutes + offsetMinutes) : undefined;
    const departureTime =
      departureMinutes !== undefined
        ? addMinutesToDate(departure, departureMinutes - baseMinutes + offsetMinutes)
        : undefined;

    return {
      sequence: stop.sequence,
      type: stop.type,
      locationCode: stop.locationCode,
      locationName: stop.locationName,
      countryCode: stop.countryCode,
      arrivalTime: arrivalTime ? arrivalTime.toISOString() : undefined,
      departureTime: departureTime ? departureTime.toISOString() : undefined,
      arrivalOffsetDays: arrivalTime ? offsetDays(departure, arrivalTime) : undefined,
      departureOffsetDays: departureTime ? offsetDays(departure, departureTime) : undefined,
      dwellMinutes: stop.dwellMinutes,
      activities: stop.activities && stop.activities.length ? [...stop.activities] : ['0001'],
      platform: stop.platformWish,
      notes: stop.notes,
    } satisfies PlanModificationStopInput;
  });
}

export function toTrainPlanStop(planId: string, stop: PlanModificationStopInput): TrainPlanStop {
  return {
    id: `${planId}-TMP-${String(stop.sequence).padStart(3, '0')}`,
    sequence: stop.sequence,
    type: stop.type,
    locationCode: stop.locationCode,
    locationName: stop.locationName,
    countryCode: stop.countryCode,
    arrivalTime: stop.arrivalTime,
    departureTime: stop.departureTime,
    arrivalOffsetDays: stop.arrivalOffsetDays,
    departureOffsetDays: stop.departureOffsetDays,
    dwellMinutes: stop.dwellMinutes,
    activities: stop.activities,
    platform: stop.platform,
    notes: stop.notes,
  };
}

export function mapPlanStop(stop: TrainPlanStop): PlanModificationStopInput {
  return {
    sequence: stop.sequence,
    type: stop.type,
    locationCode: stop.locationCode,
    locationName: stop.locationName,
    countryCode: stop.countryCode,
    arrivalTime: stop.arrivalTime,
    departureTime: stop.departureTime,
    arrivalOffsetDays: stop.arrivalOffsetDays,
    departureOffsetDays: stop.departureOffsetDays,
    dwellMinutes: stop.dwellMinutes,
    activities: [...stop.activities],
    platform: stop.platform,
    notes: stop.notes,
  };
}

export function formatIsoTime(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(11, 16);
}

export function stopLabel(stop: PlanModificationStopInput, preferDeparture: boolean): string {
  const primary = preferDeparture ? stop.departureTime : stop.arrivalTime;
  const fallback = preferDeparture ? stop.arrivalTime : stop.departureTime;
  const time = primary || fallback || '–';
  return `${stop.locationName} (${time})`;
}

export function resolveStopIdBySequence(options: {
  planId: string;
  stops: TrainPlanStop[];
  sequence?: number;
}): string {
  if (!options.sequence) {
    return options.stops[0]?.id ?? `${options.planId}-STOP-001`;
  }
  const match = options.stops.find((stop) => stop.sequence === options.sequence);
  return match?.id ?? options.stops[0]?.id ?? `${options.planId}-STOP-001`;
}

export function resolveStopSequenceById(stops: TrainPlanStop[], stopId: string | undefined): number | undefined {
  if (!stopId) {
    return undefined;
  }
  return stops.find((stop) => stop.id === stopId)?.sequence;
}

function extractReferenceMinutes(stops: ScheduleTemplate['stops']): number | undefined {
  for (const stop of stops) {
    const candidate = stop.departure?.earliest ?? stop.departure?.latest ?? stop.arrival?.earliest ?? stop.arrival?.latest;
    const minutes = extractTime(candidate);
    if (minutes !== undefined) {
      return minutes + (stop.offsetDays ?? 0) * 1440;
    }
  }
  return undefined;
}

function extractTime(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  return parseTimeToMinutes(value);
}

function parseTimeToMinutes(time: string): number | undefined {
  const match = /^([0-9]{1,2}):([0-9]{2})$/.exec(time);
  if (!match) {
    return undefined;
  }
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  return hours * 60 + minutes;
}

function addMinutesToDate(base: Date, deltaMinutes: number): Date {
  const result = new Date(base.getTime());
  result.setMinutes(result.getMinutes() + deltaMinutes);
  return result;
}

function offsetDays(base: Date, target: Date): number | undefined {
  const diff = target.getTime() - base.getTime();
  const days = Math.round(diff / 86400000);
  return days === 0 ? undefined : days;
}

