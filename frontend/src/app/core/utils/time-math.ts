const MS_IN_SECOND = 1000;
export const MS_IN_MINUTE = 60 * MS_IN_SECOND;
export const MS_IN_HOUR = 60 * MS_IN_MINUTE;
export const MS_IN_DAY = 24 * MS_IN_HOUR;

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MS_IN_MINUTE);
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * MS_IN_HOUR);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_IN_DAY);
}

export function clampDate(value: Date, min: Date, max: Date): Date {
  if (value.getTime() < min.getTime()) {
    return new Date(min);
  }
  if (value.getTime() > max.getTime()) {
    return new Date(max);
  }
  return value;
}

export function differenceInMs(a: Date, b: Date): number {
  return a.getTime() - b.getTime();
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

export function startOfWeek(date: Date): Date {
  const result = startOfDay(date);
  const day = result.getDay();
  const diff = (day + 6) % 7; // Monday as first day
  return addDays(result, -diff);
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function floorToStep(date: Date, stepMs: number): Date {
  const time = date.getTime();
  const floored = Math.floor(time / stepMs) * stepMs;
  return new Date(floored);
}

export function ceilToStep(date: Date, stepMs: number): Date {
  const time = date.getTime();
  const ceiled = Math.ceil(time / stepMs) * stepMs;
  return new Date(ceiled);
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

