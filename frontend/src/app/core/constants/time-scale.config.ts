import { ZoomLevel } from '../../models/time-scale';
import { MS_IN_DAY, MS_IN_HOUR, MS_IN_MINUTE } from '../utils/time-math';

export interface ZoomConfig {
  level: ZoomLevel;
  rangeMs: number;
  pxPerMs: number;
  stepMs: number;
  majorStepMs: number;
  label: (date: Date) => string;
  majorLabel?: (date: Date) => string;
  minorLabel?: (date: Date) => string;
  compactLabel?: (date: Date) => string;
}

const format = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('de-DE', options);

const monthLabel = format({ month: 'long', year: 'numeric' });
const monthOnlyLabel = format({ month: 'short' });
const yearLabel = format({ year: 'numeric' });
const weekdayWithDateLabel = format({ weekday: 'short', day: '2-digit', month: '2-digit' });
const weekdayShortLabel = format({ weekday: 'short' });
const dayNumberLabel = format({ day: '2-digit' });
const hourLabel = format({ hour: '2-digit' });
const hourMinuteLabel = format({ hour: '2-digit', minute: '2-digit' });

export const ZOOM_CONFIGS: ZoomConfig[] = [
  {
    level: 'year',
    rangeMs: 365 * MS_IN_DAY,
    pxPerMs: 12 / MS_IN_DAY,
    stepMs: 5 * MS_IN_DAY,
    majorStepMs: 30 * MS_IN_DAY,
    label: (date) => monthOnlyLabel.format(date),
    majorLabel: (date) => yearLabel.format(date),
    minorLabel: (date) => monthLabel.format(date),
    compactLabel: (date) => monthOnlyLabel.format(date),
  },
  {
    level: 'quarter',
    rangeMs: 150 * MS_IN_DAY,
    pxPerMs: 20 / MS_IN_DAY,
    stepMs: MS_IN_DAY,
    majorStepMs: 7 * MS_IN_DAY,
    label: (date) => dayNumberLabel.format(date),
    majorLabel: (date) => monthLabel.format(date),
    minorLabel: (date) => `${weekdayShortLabel.format(date)} ${dayNumberLabel.format(date)}`,
    compactLabel: (date) => dayNumberLabel.format(date),
  },
  {
    level: '2month',
    rangeMs: 75 * MS_IN_DAY,
    pxPerMs: 24 / MS_IN_DAY,
    stepMs: MS_IN_DAY,
    majorStepMs: 7 * MS_IN_DAY,
    label: (date) => dayNumberLabel.format(date),
    majorLabel: (date) => monthLabel.format(date),
    minorLabel: (date) => `${weekdayShortLabel.format(date)} ${dayNumberLabel.format(date)}`,
  },
  {
    level: 'month',
    rangeMs: 40 * MS_IN_DAY,
    pxPerMs: 30 / MS_IN_DAY,
    stepMs: MS_IN_DAY,
    majorStepMs: 7 * MS_IN_DAY,
    label: (date) => dayNumberLabel.format(date),
    majorLabel: (date) => monthLabel.format(date),
    minorLabel: (date) => `${weekdayShortLabel.format(date)} ${dayNumberLabel.format(date)}`,
  },
  {
    level: '2week',
    rangeMs: 18 * MS_IN_DAY,
    pxPerMs: 24 / MS_IN_HOUR,
    stepMs: 12 * MS_IN_HOUR,
    majorStepMs: MS_IN_DAY,
    label: (date) => `${weekdayShortLabel.format(date)} ${dayNumberLabel.format(date)}`,
    majorLabel: (date) => monthLabel.format(date),
  },
  {
    level: 'week',
    rangeMs: 10 * MS_IN_DAY,
    pxPerMs: 36 / MS_IN_HOUR,
    stepMs: 6 * MS_IN_HOUR,
    majorStepMs: MS_IN_DAY,
    label: (date) => hourMinuteLabel.format(date),
    majorLabel: (date) => weekdayWithDateLabel.format(date),
    compactLabel: (date) => hourLabel.format(date),
  },
  {
    level: '3day',
    rangeMs: 4 * MS_IN_DAY,
    pxPerMs: 64 / MS_IN_HOUR,
    stepMs: 6 * MS_IN_HOUR,
    majorStepMs: MS_IN_DAY,
    label: (date) => hourLabel.format(date),
    majorLabel: (date) => weekdayWithDateLabel.format(date),
    compactLabel: (date) => hourLabel.format(date),
  },
  {
    level: 'day',
    rangeMs: 2 * MS_IN_DAY,
    pxPerMs: 96 / MS_IN_HOUR,
    stepMs: MS_IN_HOUR,
    majorStepMs: 3 * MS_IN_HOUR,
    label: (date) => hourLabel.format(date),
    majorLabel: (date) => weekdayWithDateLabel.format(date),
    compactLabel: (date) => hourLabel.format(date),
  },
  {
    level: '12hour',
    rangeMs: 30 * MS_IN_HOUR,
    pxPerMs: 128 / MS_IN_HOUR,
    stepMs: 30 * MS_IN_MINUTE,
    majorStepMs: 2 * MS_IN_HOUR,
    label: (date) => hourMinuteLabel.format(date),
    majorLabel: (date) => weekdayWithDateLabel.format(date),
    compactLabel: (date) => hourLabel.format(date),
  },
  {
    level: '6hour',
    rangeMs: 24 * MS_IN_HOUR,
    pxPerMs: 160 / MS_IN_HOUR,
    stepMs: MS_IN_HOUR,
    majorStepMs: 6 * MS_IN_HOUR,
    label: (date) => hourLabel.format(date),
    majorLabel: (date) => weekdayWithDateLabel.format(date),
    compactLabel: (date) => hourLabel.format(date),
  },
  {
    level: '3hour',
    rangeMs: 12 * MS_IN_HOUR,
    pxPerMs: 220 / MS_IN_HOUR,
    stepMs: 10 * MS_IN_MINUTE,
    majorStepMs: MS_IN_HOUR,
    label: (date) => hourMinuteLabel.format(date),
    majorLabel: (date) => weekdayWithDateLabel.format(date),
    compactLabel: (date) => hourLabel.format(date),
  },
  {
    level: 'hour',
    rangeMs: 8 * MS_IN_HOUR,
    pxPerMs: 320 / MS_IN_HOUR,
    stepMs: 15 * MS_IN_MINUTE,
    majorStepMs: MS_IN_HOUR,
    label: (date) => hourMinuteLabel.format(date),
    majorLabel: (date) => weekdayWithDateLabel.format(date),
    compactLabel: (date) => hourLabel.format(date),
  },
  {
    level: '30min',
    rangeMs: 6 * MS_IN_HOUR,
    pxPerMs: 480 / MS_IN_HOUR,
    stepMs: 30 * MS_IN_MINUTE,
    majorStepMs: MS_IN_HOUR,
    label: (date) => hourMinuteLabel.format(date),
    majorLabel: (date) => weekdayWithDateLabel.format(date),
    compactLabel: (date) => hourLabel.format(date),
  },
  {
    level: '15min',
    rangeMs: 4 * MS_IN_HOUR,
    pxPerMs: 12 / MS_IN_MINUTE,
    stepMs: 5 * MS_IN_MINUTE,
    majorStepMs: 15 * MS_IN_MINUTE,
    label: (date) => hourMinuteLabel.format(date),
    majorLabel: (date) => weekdayWithDateLabel.format(date),
    compactLabel: (date) => hourLabel.format(date),
  },
  {
    level: '10min',
    rangeMs: 3 * MS_IN_HOUR,
    pxPerMs: 16 / MS_IN_MINUTE,
    stepMs: 2 * MS_IN_MINUTE,
    majorStepMs: 10 * MS_IN_MINUTE,
    label: (date) => hourMinuteLabel.format(date),
    majorLabel: (date) => weekdayWithDateLabel.format(date),
    compactLabel: (date) => hourLabel.format(date),
  },
  {
    level: '5min',
    rangeMs: 2 * MS_IN_HOUR,
    pxPerMs: 20 / MS_IN_MINUTE,
    stepMs: MS_IN_MINUTE,
    majorStepMs: 5 * MS_IN_MINUTE,
    label: (date) => hourMinuteLabel.format(date),
    majorLabel: (date) => weekdayWithDateLabel.format(date),
    compactLabel: (date) => hourLabel.format(date),
  },
];

export const ZOOM_LEVELS = ZOOM_CONFIGS.map((config) => config.level);

export const ZOOM_RANGE_MS = ZOOM_CONFIGS.reduce<Record<ZoomLevel, number>>((acc, config) => {
  acc[config.level] = config.rangeMs;
  return acc;
}, {} as Record<ZoomLevel, number>);

export const ZOOM_CONFIG_MAP = ZOOM_CONFIGS.reduce<Record<ZoomLevel, ZoomConfig>>((acc, config) => {
  acc[config.level] = config;
  return acc;
}, {} as Record<ZoomLevel, ZoomConfig>);

export const MIN_RANGE_MS = Math.min(...ZOOM_CONFIGS.map((config) => config.rangeMs));
export const MAX_RANGE_MS = Math.max(...ZOOM_CONFIGS.map((config) => config.rangeMs));

export function findNearestZoomConfig(rangeMs: number): ZoomConfig {
  return ZOOM_CONFIGS.reduce((closest, config) => {
    if (!closest) {
      return config;
    }
    const diffCurrent = Math.abs(config.rangeMs - rangeMs);
    const diffClosest = Math.abs(closest.rangeMs - rangeMs);
    return diffCurrent < diffClosest ? config : closest;
  });
}

export function interpolatePixelsPerMs(rangeMs: number): number {
  const sorted = [...ZOOM_CONFIGS].sort((a, b) => b.rangeMs - a.rangeMs);
  if (rangeMs >= sorted[0].rangeMs) {
    return sorted[0].pxPerMs;
  }
  if (rangeMs <= sorted[sorted.length - 1].rangeMs) {
    return sorted[sorted.length - 1].pxPerMs;
  }
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const current = sorted[i];
    const next = sorted[i + 1];
    if (rangeMs <= current.rangeMs && rangeMs >= next.rangeMs) {
      const span = current.rangeMs - next.rangeMs;
      const offset = rangeMs - next.rangeMs;
      const t = span === 0 ? 0 : offset / span;
      return current.pxPerMs * t + next.pxPerMs * (1 - t);
    }
  }
  return sorted[sorted.length - 1].pxPerMs;
}

export function findNearestZoomConfigByPixels(pxPerMs: number): ZoomConfig {
  return ZOOM_CONFIGS.reduce((closest, config) => {
    if (!closest) {
      return config;
    }
    const diffCurrent = Math.abs(config.pxPerMs - pxPerMs);
    const diffClosest = Math.abs(closest.pxPerMs - pxPerMs);
    return diffCurrent < diffClosest ? config : closest;
  });
}
