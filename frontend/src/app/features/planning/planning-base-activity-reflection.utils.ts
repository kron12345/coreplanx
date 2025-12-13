import type { Activity } from '../../models/activity';
import type { TemplatePeriod } from '../../core/api/timeline-api.types';

export function reflectBaseActivities(options: {
  activities: Activity[];
  periods: TemplatePeriod[];
  specialDays: ReadonlySet<string>;
  viewStart: Date | null;
  viewEnd: Date | null;
  defaultPeriodEnd: Date | null;
}): Activity[] {
  const { activities, periods, specialDays, viewStart, viewEnd, defaultPeriodEnd } = options;
  if (!periods.length) {
    return activities;
  }
  if (!defaultPeriodEnd) {
    return activities;
  }

  const reflected: Activity[] = [];

  periods.forEach((period) => {
    const periodStart = new Date(period.validFrom);
    const periodEnd = period.validTo ? new Date(period.validTo) : defaultPeriodEnd;
    const windowStart = viewStart && viewStart > periodStart ? viewStart : periodStart;
    const windowEnd = viewEnd && viewEnd < periodEnd ? viewEnd : periodEnd;
    if (windowEnd < windowStart) {
      return;
    }

    activities.forEach((activity) => {
      const startTime = new Date(activity.start);
      const endTime = activity.end ? new Date(activity.end) : null;
      const weekday = startTime.getUTCDay();
      const timeMs =
        startTime.getUTCHours() * 3600_000 +
        startTime.getUTCMinutes() * 60_000 +
        startTime.getUTCSeconds() * 1000 +
        startTime.getUTCMilliseconds();
      const endMs = endTime
        ? endTime.getUTCHours() * 3600_000 +
          endTime.getUTCMinutes() * 60_000 +
          endTime.getUTCSeconds() * 1000 +
          endTime.getUTCMilliseconds()
        : null;

      const first = alignToWeekday(windowStart, weekday);
      if (!first || first > windowEnd) {
        return;
      }

      for (let cursor = first; cursor <= windowEnd; cursor.setUTCDate(cursor.getUTCDate() + 7)) {
        const iso = cursor.toISOString().slice(0, 10);
        if (specialDays.has(iso)) {
          continue;
        }
        const baseDay = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate()));
        const newStart = new Date(baseDay);
        newStart.setUTCMilliseconds(newStart.getUTCMilliseconds() + timeMs);
        let newEnd: Date | null = null;
        if (endMs !== null) {
          newEnd = new Date(baseDay);
          newEnd.setUTCMilliseconds(newEnd.getUTCMilliseconds() + endMs);
        }
        reflected.push({
          ...activity,
          id: `${activity.id}@${iso}`,
          start: newStart.toISOString(),
          end: newEnd ? newEnd.toISOString() : null,
        });
      }
    });
  });

  return reflected;
}

function alignToWeekday(date: Date, weekday: number): Date | null {
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  const result = new Date(date);
  const diff = (weekday - result.getUTCDay() + 7) % 7;
  result.setUTCDate(result.getUTCDate() + diff);
  return result;
}

