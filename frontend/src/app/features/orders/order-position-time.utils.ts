export function parseTimeToMinutes(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(value);
  if (!match) {
    return null;
  }
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  return hours * 60 + minutes;
}

export function minutesToTime(value: number | null | undefined): string | undefined {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return undefined;
  }
  const totalMinutes = Math.round(value);
  const minutesInDay = 24 * 60;
  const normalized = ((totalMinutes % minutesInDay) + minutesInDay) % minutesInDay;
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

export function formatDeviationLabel(deviation: number): string {
  const prefix = deviation > 0 ? '+' : '';
  return `${prefix}${deviation} min`;
}

export function formatDuration(minutes: number): string {
  const abs = Math.abs(Math.round(minutes));
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  if (hours && mins) {
    return `${hours} h ${mins} min`;
  }
  if (hours) {
    return `${hours} h`;
  }
  return `${mins} min`;
}

export function differenceBetweenTimes(
  actual: string | undefined | null,
  template: string | undefined | null,
  offsetMinutes = 0,
): number | null {
  const actualMinutes = parseTimeToMinutes(actual ?? null);
  const templateMinutes = parseTimeToMinutes(template ?? null);
  if (actualMinutes === null || templateMinutes === null) {
    return null;
  }
  return actualMinutes - (templateMinutes + offsetMinutes);
}

export function durationBetweenTimes(
  start: string | undefined | null,
  end: string | undefined | null,
): number | null {
  const startMinutes = parseTimeToMinutes(start ?? null);
  const endMinutes = parseTimeToMinutes(end ?? null);
  if (startMinutes === null || endMinutes === null) {
    return null;
  }
  return endMinutes - startMinutes;
}

export function shiftTimeLabel(time: string | undefined, offsetMinutes: number): string | undefined {
  if (!time) {
    return undefined;
  }
  const templateMinutes = parseTimeToMinutes(time);
  if (templateMinutes === null) {
    return time;
  }
  return minutesToTime(templateMinutes + offsetMinutes);
}
