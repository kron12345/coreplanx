import { Injectable } from '@angular/core';
import { ScheduleTemplate, ScheduleTemplateStop } from '../../core/models/schedule-template.model';
import {
  ImportedRailMlStop,
  ImportedRailMlTemplateMatch,
  ImportedTemplateStopComparison,
  ImportedRailMlTrain,
} from '../../core/services/order.service';
import {
  PlanGenerationPreview,
  PlanTemplateStats,
} from './order-plan-preview/plan-preview.models';
import {
  differenceBetweenTimes,
  durationBetweenTimes,
  formatDeviationLabel,
  formatDuration,
  minutesToTime,
  parseTimeToMinutes,
  shiftTimeLabel,
} from './order-position-time.utils';

export interface PlanPreviewInput {
  startTime?: string | null;
  endTime?: string | null;
  intervalMinutes?: number | null;
  otn?: string | number | null;
  otnInterval?: number | null;
}

@Injectable({ providedIn: 'root' })
export class OrderPositionTemplateService {
  planPreview(template: ScheduleTemplate | undefined, value: PlanPreviewInput): PlanGenerationPreview {
    const startMinutes = parseTimeToMinutes(value.startTime ?? null);
    const endMinutes = parseTimeToMinutes(value.endTime ?? null);
    const interval = Number(value.intervalMinutes) || 0;
    const warnings: string[] = [];

    if (!template) {
      warnings.push('Bitte eine Vorlage auswählen, um die Serie vorzubereiten.');
    }
    if (startMinutes === null || endMinutes === null) {
      warnings.push('Gültige Start- und Endzeiten angeben.');
    }
    if (interval <= 0) {
      warnings.push('Der Takt muss größer als 0 sein.');
    }

    let totalDepartures = 0;
    let sampleDepartures: string[] = [];
    const ready =
      warnings.length === 0 &&
      startMinutes !== null &&
      endMinutes !== null &&
      interval > 0 &&
      endMinutes > startMinutes &&
      !!template;

    if (!ready && startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes) {
      warnings.push('Die letzte Abfahrt muss nach der ersten Abfahrt liegen.');
    }

    if (ready && startMinutes !== null && endMinutes !== null) {
      for (let current = startMinutes; current <= endMinutes; current += interval) {
        totalDepartures += 1;
        if (sampleDepartures.length < 4) {
          sampleDepartures.push(minutesToTime(current) ?? '--:--');
        }
      }
    } else {
      sampleDepartures = [];
    }

    const otnValue =
      value.otn !== undefined && value.otn !== null && value.otn !== ''
        ? Number(value.otn)
        : null;
    const otnInterval = Number(value.otnInterval) || 1;
    const otnRange =
      ready && otnValue !== null && totalDepartures > 0
        ? `${otnValue} – ${otnValue + (totalDepartures - 1) * otnInterval}`
        : undefined;

    const durationMinutes =
      ready && startMinutes !== null && endMinutes !== null ? endMinutes - startMinutes : 0;
    const durationLabel =
      ready && durationMinutes > 0 ? formatDuration(durationMinutes) : undefined;

    return {
      ready,
      warnings,
      totalDepartures,
      durationMinutes,
      durationLabel,
      firstDeparture: value.startTime || undefined,
      lastDeparture: value.endTime || undefined,
      sampleDepartures,
      otnRange,
    };
  }

  planTemplateStats(template: ScheduleTemplate | undefined): PlanTemplateStats | null {
    if (!template) {
      return null;
    }
    const stops = template.stops;
    if (!stops.length) {
      return null;
    }
    const first = stops[0];
    const last = stops[stops.length - 1];
    const travelMinutes = this.estimateTemplateTravelMinutes(template);
    return {
      origin: first.locationName ?? first.locationCode,
      destination: last.locationName ?? last.locationCode,
      stopCount: stops.length,
      travelMinutes: travelMinutes ?? undefined,
      travelLabel: travelMinutes ? formatDuration(travelMinutes) : undefined,
      stopNames: stops.map((stop) => stop.locationName ?? stop.locationCode),
    };
  }

  applyTemplateMatching(
    trains: ImportedRailMlTrain[],
    templates: ScheduleTemplate[],
  ): ImportedRailMlTrain[] {
    if (!templates.length) {
      return trains;
    }
    return trains.map((train) => ({
      ...train,
      templateMatch: this.findTemplateMatch(train, templates),
    }));
  }

  trainDeviationMagnitude(train: ImportedRailMlTrain): number {
    const match = train.templateMatch;
    if (!match) {
      return 0;
    }
    const candidates = [
      match.deviationMinutes,
      match.arrivalDeviationMinutes,
      match.travelTimeDeviationMinutes,
      match.maxStopDeviationMinutes,
    ]
      .filter((value): value is number => typeof value === 'number')
      .map((value) => Math.abs(value));
    return candidates.length ? Math.max(...candidates) : 0;
  }

  stopHasDeviation(comparison: ImportedTemplateStopComparison): boolean {
    return (
      this.hasDeviation(comparison.arrivalDeviationMinutes) ||
      this.hasDeviation(comparison.departureDeviationMinutes)
    );
  }

  private hasDeviation(value: number | null | undefined): boolean {
    return typeof value === 'number' && Math.abs(value) > 0.01;
  }

  private findTemplateMatch(
    train: ImportedRailMlTrain,
    templates: ScheduleTemplate[],
  ): ImportedRailMlTemplateMatch | undefined {
    if (!train.stops.length || !train.departureTime) {
      return undefined;
    }
    const departureMinutes = parseTimeToMinutes(train.departureTime);
    if (departureMinutes === null) {
      return undefined;
    }
    const trainStartKey = this.normalizeStopKey(
      train.stops[0].locationCode,
      train.stops[0].locationName,
    );
    const trainEndKey = this.normalizeStopKey(
      train.stops[train.stops.length - 1].locationCode,
      train.stops[train.stops.length - 1].locationName,
    );
    if (!trainStartKey || !trainEndKey) {
      return undefined;
    }

    let best: ImportedRailMlTemplateMatch | null = null;

    templates.forEach((template) => {
      const recurrence = template.recurrence;
      if (!recurrence?.intervalMinutes || !template.stops.length) {
        return;
      }
      const templateStartKey = this.normalizeStopKey(
        template.stops[0].locationCode,
        template.stops[0].locationName,
      );
      const templateEndKey = this.normalizeStopKey(
        template.stops[template.stops.length - 1].locationCode,
        template.stops[template.stops.length - 1].locationName,
      );
      if (!templateStartKey || !templateEndKey) {
        return;
      }
      if (trainStartKey !== templateStartKey || trainEndKey !== templateEndKey) {
        return;
      }
      const startMinutes = parseTimeToMinutes(recurrence.startTime);
      const endMinutes = parseTimeToMinutes(recurrence.endTime);
      if (startMinutes === null || endMinutes === null) {
        return;
      }
      const expected = this.closestRecurrenceDeparture(
        departureMinutes,
        startMinutes,
        endMinutes,
        recurrence.intervalMinutes,
      );
      const deviation = departureMinutes - expected;
      const templateBaseDeparture = this.templateStopTime(
        template.stops[0],
        'departure',
      );
      const templateBaseMinutes = parseTimeToMinutes(templateBaseDeparture ?? null);
      const offsetMinutes =
        templateBaseMinutes !== null ? expected - templateBaseMinutes : 0;
      const tolerance = Math.max(2, Math.round(recurrence.intervalMinutes * 0.25));
      const status: 'ok' | 'warning' =
        Math.abs(deviation) <= tolerance ? 'ok' : 'warning';
      const comparisons = this.buildStopComparisons(
        train.stops,
        template.stops,
        offsetMinutes,
      );
      const sharedStops = comparisons.filter((comp) => comp.matched).length;
      const stopDelta = Math.abs(train.stops.length - template.stops.length);
      const baseScore = 10 + sharedStops - stopDelta * 0.5;
      const maxStopDeviation = this.maxStopDeviation(comparisons);
      const timePenalty =
        Math.abs(deviation) / Math.max(1, tolerance) +
        (maxStopDeviation ? Math.abs(maxStopDeviation) / 10 : 0);
      const matchScore = baseScore - timePenalty;
      const arrivalDeviation = this.compareTerminalArrival(
        train,
        template,
        offsetMinutes,
      );
      const travelDeviation = this.compareTravelTime(train, template);
      if (!best || matchScore > best.matchScore) {
        best = {
          templateId: template.id,
          templateTitle: template.title,
          templateTrainNumber: template.trainNumber,
          intervalMinutes: recurrence.intervalMinutes,
          expectedDeparture: minutesToTime(expected),
          deviationMinutes: deviation,
          deviationLabel: formatDeviationLabel(deviation),
          toleranceMinutes: tolerance,
          status,
          matchScore,
          arrivalDeviationMinutes: arrivalDeviation ?? undefined,
          arrivalDeviationLabel:
            arrivalDeviation !== null && arrivalDeviation !== undefined
              ? formatDeviationLabel(arrivalDeviation)
              : undefined,
          travelTimeDeviationMinutes: travelDeviation ?? undefined,
          travelTimeDeviationLabel:
            travelDeviation !== null && travelDeviation !== undefined
              ? formatDeviationLabel(travelDeviation)
              : undefined,
          maxStopDeviationMinutes: maxStopDeviation ?? undefined,
          maxStopDeviationLabel:
            maxStopDeviation !== null && maxStopDeviation !== undefined
              ? formatDeviationLabel(maxStopDeviation)
              : undefined,
          stopComparisons: comparisons,
        };
      }
    });

    return best ?? undefined;
  }

  private normalizeStopKey(code?: string | null, name?: string | null): string {
    return (code ?? name ?? '').trim().toLowerCase();
  }

  private buildStopComparisons(
    trainStops: ImportedRailMlStop[],
    templateStops: ScheduleTemplateStop[],
    offsetMinutes: number,
  ): ImportedTemplateStopComparison[] {
    const actualByKey = new Map<string, ImportedRailMlStop>();
    trainStops.forEach((stop) => {
      const key = this.normalizeStopKey(stop.locationCode, stop.locationName);
      if (key && !actualByKey.has(key)) {
        actualByKey.set(key, stop);
      }
    });

    return templateStops.map((templateStop) => {
      const key = this.normalizeStopKey(templateStop.locationCode, templateStop.locationName);
      const actual = key ? actualByKey.get(key) : undefined;
      const templateArrival = this.templateStopTime(templateStop, 'arrival');
      const templateDeparture = this.templateStopTime(templateStop, 'departure');
      const actualArrival = actual ? this.importedStopTime(actual, 'arrival') : undefined;
      const actualDeparture = actual ? this.importedStopTime(actual, 'departure') : undefined;
      const arrivalDeviation = differenceBetweenTimes(
        actualArrival,
        templateArrival,
        offsetMinutes,
      );
      const departureDeviation = differenceBetweenTimes(
        actualDeparture,
        templateDeparture,
        offsetMinutes,
      );

      return {
        locationCode: templateStop.locationCode,
        locationName: templateStop.locationName ?? templateStop.locationCode,
        type: templateStop.type,
        templateArrival,
        templateDeparture,
        alignedTemplateArrival: shiftTimeLabel(templateArrival, offsetMinutes),
        alignedTemplateDeparture: shiftTimeLabel(templateDeparture, offsetMinutes),
        actualArrival,
        actualDeparture,
        arrivalDeviationMinutes: arrivalDeviation ?? undefined,
        arrivalDeviationLabel:
          arrivalDeviation !== null && arrivalDeviation !== undefined
            ? formatDeviationLabel(arrivalDeviation)
            : undefined,
        departureDeviationMinutes: departureDeviation ?? undefined,
        departureDeviationLabel:
          departureDeviation !== null && departureDeviation !== undefined
            ? formatDeviationLabel(departureDeviation)
            : undefined,
        matched: !!actual,
      };
    });
  }

  private maxStopDeviation(comparisons: ImportedTemplateStopComparison[]): number | null {
    let max: number | null = null;
    comparisons.forEach((comparison) => {
      const arrival = comparison.arrivalDeviationMinutes ?? null;
      const departure = comparison.departureDeviationMinutes ?? null;
      [arrival, departure].forEach((value) => {
        if (value === null || value === undefined) {
          return;
        }
        const abs = Math.abs(value);
        if (max === null || abs > Math.abs(max)) {
          max = value;
        }
      });
    });
    return max;
  }

  private compareTerminalArrival(
    train: ImportedRailMlTrain,
    template: ScheduleTemplate,
    offsetMinutes: number,
  ): number | null {
    const actualArrival =
      this.importedStopTime(train.stops[train.stops.length - 1], 'arrival') ?? train.arrivalTime;
    const templateArrival = this.templateStopTime(
      template.stops[template.stops.length - 1],
      'arrival',
    );
    return differenceBetweenTimes(actualArrival, templateArrival, offsetMinutes);
  }

  private compareTravelTime(
    train: ImportedRailMlTrain,
    template: ScheduleTemplate,
  ): number | null {
    const actualDeparture =
      this.importedStopTime(train.stops[0], 'departure') ?? train.departureTime;
    const actualArrival =
      this.importedStopTime(train.stops[train.stops.length - 1], 'arrival') ?? train.arrivalTime;
    const templateDeparture = this.templateStopTime(template.stops[0], 'departure');
    const templateArrival = this.templateStopTime(
      template.stops[template.stops.length - 1],
      'arrival',
    );

    const actualTime = durationBetweenTimes(actualDeparture, actualArrival);
    const templateTime = durationBetweenTimes(templateDeparture, templateArrival);
    if (actualTime === null || templateTime === null) {
      return null;
    }
    return actualTime - templateTime;
  }

  private closestRecurrenceDeparture(
    departure: number,
    startMinutes: number,
    endMinutes: number,
    interval: number,
  ): number {
    if (interval <= 0) {
      return departure;
    }
    if (departure <= startMinutes) {
      return startMinutes;
    }
    if (departure >= endMinutes) {
      return endMinutes;
    }
    const steps = Math.round((departure - startMinutes) / interval);
    const candidate = startMinutes + steps * interval;
    return Math.max(startMinutes, Math.min(endMinutes, candidate));
  }

  private templateStopTime(
    stop: ScheduleTemplateStop,
    type: 'arrival' | 'departure',
  ): string | undefined {
    const window = type === 'arrival' ? stop.arrival : stop.departure;
    return window?.earliest ?? window?.latest ?? undefined;
  }

  private importedStopTime(
    stop: ImportedRailMlStop,
    type: 'arrival' | 'departure',
  ): string | undefined {
    if (type === 'arrival') {
      return stop.arrivalEarliest ?? stop.arrivalLatest ?? undefined;
    }
    return stop.departureEarliest ?? stop.departureLatest ?? undefined;
  }

  private estimateTemplateTravelMinutes(template: ScheduleTemplate): number | null {
    if (!template.stops.length) {
      return null;
    }
    const first = template.stops[0];
    const last = template.stops[template.stops.length - 1];
    const departure =
      parseTimeToMinutes(first.departure?.earliest ?? first.departure?.latest ?? null) ??
      parseTimeToMinutes(first.arrival?.earliest ?? first.arrival?.latest ?? null);
    const arrival =
      parseTimeToMinutes(last.arrival?.earliest ?? last.arrival?.latest ?? null) ??
      parseTimeToMinutes(last.departure?.earliest ?? last.departure?.latest ?? null);
    if (departure === null || arrival === null) {
      return null;
    }
    const diff = arrival - departure;
    return diff >= 0 ? diff : diff + 24 * 60;
  }
}
