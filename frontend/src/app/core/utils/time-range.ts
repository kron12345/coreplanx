import { startOfDay, addDays } from './time-math';

export function clampToFullDayRange(start: Date, end: Date): { start: Date; end: Date } {
  const rangeStart = startOfDay(start);
  const rangeEnd = addDays(startOfDay(end), 1);
  return { start: rangeStart, end: rangeEnd };
}

