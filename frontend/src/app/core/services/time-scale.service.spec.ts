import { TestBed } from '@angular/core/testing';
import { TimeScaleService } from './time-scale.service';
import { ZoomLevel } from '../../models/time-scale';
import { ZOOM_CONFIG_MAP } from '../constants/time-scale.config';

describe('TimeScaleService', () => {
  let service: TimeScaleService;
  const rangeStart = new Date('2024-01-01T00:00:00Z');
  const rangeEnd = new Date('2024-02-01T00:00:00Z');

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TimeScaleService);
    service.setTimelineRange(rangeStart, rangeEnd);
  });

  it('round-trips time to pixels across zoom levels', () => {
    const zoomLevels: ZoomLevel[] = ['month', 'week', 'day', 'hour', '15min'];
    const sampleTime = new Date('2024-01-10T12:34:00Z');

    zoomLevels.forEach((zoom) => {
      service.setPixelsPerMs(ZOOM_CONFIG_MAP[zoom].pxPerMs);
      const px = service.timeToPx(sampleTime);
      const result = service.pxToTime(px);
      expect(Math.abs(result.getTime() - sampleTime.getTime())).toBeLessThan(1);
      expect(px).toBeGreaterThan(0);
    });
  });

  it('generates day ticks for month zoom', () => {
    service.setPixelsPerMs(ZOOM_CONFIG_MAP['month'].pxPerMs);
    const viewStart = new Date('2024-01-05T00:00:00Z');
    const viewEnd = new Date('2024-01-09T00:00:00Z');

    const ticks = service.getTicks(viewStart, viewEnd);

    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks[0].widthPx).toBeGreaterThan(0);
    expect(ticks.some((tick) => tick.isWeekend)).toBeTrue();
  });

  it('generates quarter-hour ticks for hour zoom', () => {
    service.setPixelsPerMs(ZOOM_CONFIG_MAP['hour'].pxPerMs);
    const viewStart = new Date('2024-01-12T08:00:00Z');
    const viewEnd = new Date('2024-01-12T09:00:00Z');

    const ticks = service.getTicks(viewStart, viewEnd);

    expect(ticks.length).toBeGreaterThan(3);
    const fifteenMinuteWidth = ticks[0].widthPx;
    expect(fifteenMinuteWidth).toBeGreaterThan(0);
    const allWidthsIdentical = ticks.every((tick) => Math.abs(tick.widthPx - fifteenMinuteWidth) < 0.01);
    expect(allWidthsIdentical).toBeTrue();
  });
});
