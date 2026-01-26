import { Injectable } from '@angular/core';
import { TrafficPeriodVariantType } from '../../core/models/traffic-period.model';
import { TimetableYearService } from '../../core/services/timetable-year.service';
import { ImportedRailMlStop, ImportedRailMlTrain } from '../../core/services/order.service';
import { RailMlOperatingPeriod, RailMlTimetablePeriod } from './order-position-dialog.models';

@Injectable({ providedIn: 'root' })
export class OrderPositionRailmlService {
  private periodCounter = 0;

  constructor(
    private readonly timetableYearService: TimetableYearService,
  ) {}

  parseRailMl(xml: string): ImportedRailMlTrain[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      throw new Error('Ungültiges RailML-Dokument.');
    }

    const operatingPeriods = this.extractRailMlOperatingPeriods(doc);
    const timetablePeriods = this.extractRailMlTimetablePeriods(doc);
    const trainNodes = Array.from(
      doc.querySelectorAll('train, railml\\:train, ns1\\:train'),
    );
    const trains: ImportedRailMlTrain[] = [];

    trainNodes.forEach((node, index) => {
      const mapped = this.mapRailMlTrainParts(
        doc,
        node,
        index,
        operatingPeriods,
        timetablePeriods,
      );
      mapped.forEach((train) => trains.push(train));
    });

    return trains;
  }

  ensureCalendarsForImportedTrains(
    trains: ImportedRailMlTrain[],
  ): Map<string, string> {
    const periodMap = new Map<string, string>();
    if (!trains.length) {
      return periodMap;
    }
    const groups = new Map<string, ImportedRailMlTrain[]>();
    trains.forEach((train) => {
      const key = train.groupId ?? train.id;
      const list = groups.get(key) ?? [];
      list.push(train);
      groups.set(key, list);
    });

    groups.forEach((groupTrains, groupId) => {
      const periodId = this.generatePeriodId();
      const baseTrain = groupTrains.find((train) => !train.variantOf) ?? groupTrains[0];
      const periodName = `${baseTrain?.name ?? groupId} Referenzkalender`;
      periodMap.set(groupId, periodId);
      groupTrains.forEach((train) => {
        train.trafficPeriodId = periodId;
        train.trafficPeriodName = periodName;
        train.trafficPeriodSourceId = groupId;
      });
    });

    return periodMap;
  }

  private generatePeriodId(): string {
    const ts = Date.now().toString(36).toUpperCase();
    this.periodCounter = (this.periodCounter + 1) % 1679616; // 36^4 combinations
    const suffix = this.periodCounter.toString(36).toUpperCase().padStart(4, '0');
    return `TPER-${ts}${suffix}`;
  }

  private resolveOperatingDates(
    operatingPeriod: RailMlOperatingPeriod | undefined,
    timetablePeriod: RailMlTimetablePeriod | undefined,
    fallbackDate?: string,
  ): string[] {
    const start =
      operatingPeriod?.startDate ?? timetablePeriod?.startDate ?? fallbackDate;
    const end =
      operatingPeriod?.endDate ?? timetablePeriod?.endDate ?? start;
    if (!start || !end) {
      return [];
    }
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return [];
    }
    const yearInfo = this.timetableYearService.getYearBounds(startDate);
    const clampedStart =
      startDate < yearInfo.start ? new Date(yearInfo.start) : startDate;
    const clampedEnd = endDate > yearInfo.end ? new Date(yearInfo.end) : endDate;
    if (clampedEnd.getTime() < clampedStart.getTime()) {
      return [];
    }
    const bitmap = this.sanitizeDaysBitmap(operatingPeriod?.operatingCode);
    return this.expandDateRange(
      clampedStart.toISOString().slice(0, 10),
      clampedEnd.toISOString().slice(0, 10),
      bitmap,
    );
  }

  private expandDateRange(startIso: string, endIso: string, daysBitmap: string): string[] {
    const start = new Date(startIso);
    const end = new Date(endIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return [];
    }
    const normalized = this.sanitizeDaysBitmap(daysBitmap);
    const result: string[] = [];
    const guardLimit = 3660;
    for (
      let cursor = new Date(start);
      cursor <= end && result.length <= guardLimit;
      cursor.setDate(cursor.getDate() + 1)
    ) {
      const weekday = cursor.getDay();
      const index = weekday === 0 ? 6 : weekday - 1;
      if (normalized[index] === '1') {
        result.push(cursor.toISOString().slice(0, 10));
      }
    }
    return result;
  }

  private mapRailMlTrainParts(
    doc: Document,
    node: Element,
    index: number,
    operatingPeriods: Map<string, RailMlOperatingPeriod>,
    timetablePeriods: Map<string, RailMlTimetablePeriod>,
  ): ImportedRailMlTrain[] {
    const trainId =
      node.getAttribute('id') ??
      node.getAttribute('trainID') ??
      `train-${index + 1}`;
    const trainName =
      node.getAttribute('name') ?? node.getAttribute('trainName') ?? trainId;
    const trainNumber = node.getAttribute('trainNumber') ?? trainId;
    const category =
      node.getAttribute('categoryRef') ?? node.getAttribute('category') ?? undefined;
    const timetablePeriodRef = node.getAttribute('timetablePeriodRef') ?? undefined;
    const partNodes = Array.from(
      node.querySelectorAll('trainPart, railml\\:trainPart, ns1\\:trainPart'),
    );
    const targetParts = partNodes.length ? partNodes : [node];

    const trains: ImportedRailMlTrain[] = [];

    targetParts.forEach((partNode, partIndex) => {
      const ocpNodes = Array.from(
        partNode.querySelectorAll('ocpTT, railml\\:ocpTT, ns1\\:ocpTT'),
      );
      if (!ocpNodes.length) {
        return;
      }
      const stops = ocpNodes.map((stop, idx) =>
        this.mapRailMlStop(doc, stop, idx),
      ) as ImportedRailMlStop[];
      if (!stops.length) {
        return;
      }
      stops[0].type = 'origin';
      stops[stops.length - 1].type = 'destination';
      for (let i = 1; i < stops.length - 1; i++) {
        stops[i].type = 'intermediate';
      }

      const operatingPeriodRef =
        partNode.getAttribute('operatingPeriodRef') ??
        node.getAttribute('operatingPeriodRef') ??
        undefined;
      const operatingPeriod = operatingPeriodRef
        ? operatingPeriods.get(operatingPeriodRef)
        : undefined;
      const timetablePeriod = timetablePeriodRef
        ? timetablePeriods.get(timetablePeriodRef)
        : undefined;
      const startDate =
        partNode.getAttribute('startDate') ??
        operatingPeriod?.startDate ??
        timetablePeriod?.startDate ??
        node.getAttribute('startDate') ??
        new Date().toISOString().slice(0, 10);

      const firstDeparture =
        stops.find((stop) => stop.departureEarliest || stop.departureLatest)
          ?.departureEarliest ??
        stops[0].departureEarliest ??
        stops[0].departureLatest ??
        '00:00';
      const lastArrival =
        [...stops]
          .reverse()
          .find((stop) => stop.arrivalLatest || stop.arrivalEarliest)?.arrivalLatest ??
        stops[stops.length - 1].arrivalLatest ??
        stops[stops.length - 1].arrivalEarliest ??
        firstDeparture;

      const departureIso = this.combineDateTime(startDate, firstDeparture);
      const arrivalIso = this.combineDateTime(startDate, lastArrival);

      const variantLabel = partIndex === 0 ? undefined : this.resolveVariantLabel(
        partNode,
        operatingPeriod,
      );

      const calendarDatesRaw = this.resolveOperatingDates(
        operatingPeriod,
        timetablePeriod,
        startDate,
      );
      const fallbackDate = departureIso.slice(0, 10);
      const calendarDates = this.normalizeCalendarDates(
        calendarDatesRaw.length ? calendarDatesRaw : [fallbackDate],
      );
      const calendarVariantType: TrafficPeriodVariantType =
        partIndex === 0 ? 'series' : 'special_day';
      const calendarLabel =
        variantLabel ??
        operatingPeriod?.description ??
        timetablePeriod?.id ??
        (partIndex === 0 ? 'Hauptlage' : `Variante ${partIndex + 1}`);

      const displayName =
        partIndex === 0 || !variantLabel
          ? trainName
          : `${trainName} (${variantLabel})`;
      const variantId =
        partIndex === 0
          ? trainId
          : partNode.getAttribute('id') ?? `${trainId}-variant-${partIndex + 1}`;

      trains.push({
        id: variantId,
        groupId: trainId,
        variantOf: partIndex === 0 ? undefined : trainId,
        variantLabel,
        operatingPeriodRef,
        timetablePeriodRef,
        trainPartId: partNode === node ? undefined : partNode.getAttribute('id') ?? undefined,
        name: displayName,
        number: trainNumber,
        category,
        start: stops[0].locationName ?? stops[0].locationCode,
        end:
          stops[stops.length - 1].locationName ??
          stops[stops.length - 1].locationCode,
        departureIso,
        arrivalIso,
        departureTime: firstDeparture,
        arrivalTime: lastArrival,
        stops,
        calendarDates,
        calendarLabel,
        calendarVariantType,
      });
    });

    return trains;
  }

  private mapRailMlStop(
    doc: Document,
    node: Element,
    index: number,
  ): ImportedRailMlStop {
    const ocpRef = node.getAttribute('ocpRef');
    const locationName = this.resolveLocationName(doc, ocpRef);
    const locationCode =
      ocpRef ??
      node.getAttribute('operationControlPointRef') ??
      `ocp-${index + 1}`;
    const resolvedName = locationName ?? locationCode;

    const arrivalNode =
      node.querySelector('arrival') ??
      node.querySelector('railml\\:arrival') ??
      node.querySelector('ns1\\:arrival');
    const departureNode =
      node.querySelector('departure') ??
      node.querySelector('railml\\:departure') ??
      node.querySelector('ns1\\:departure');
    const timesNode =
      node.querySelector('times') ??
      node.querySelector('railml\\:times') ??
      node.querySelector('ns1\\:times');

    const arrivalEarliest =
      this.sanitizeTime(timesNode?.getAttribute('arrival')) ??
      this.sanitizeTime(arrivalNode?.getAttribute('time')) ??
      this.sanitizeTime(node.getAttribute('arrival'));
    const arrivalLatest =
      this.sanitizeTime(timesNode?.getAttribute('arrivalLatest')) ??
      this.sanitizeTime(arrivalNode?.getAttribute('timeLatest')) ??
      this.sanitizeTime(arrivalNode?.getAttribute('time'));
    const departureEarliest =
      this.sanitizeTime(timesNode?.getAttribute('departure')) ??
      this.sanitizeTime(departureNode?.getAttribute('time')) ??
      this.sanitizeTime(node.getAttribute('departure'));
    const departureLatest =
      this.sanitizeTime(timesNode?.getAttribute('departureLatest')) ??
      this.sanitizeTime(departureNode?.getAttribute('timeLatest')) ??
      this.sanitizeTime(departureNode?.getAttribute('time'));

    const activitiesAttr =
      node.getAttribute('activities') ??
      arrivalNode?.getAttribute('activities') ??
      departureNode?.getAttribute('activities') ??
      '';
    const activities = activitiesAttr
      ? activitiesAttr.split(' ').filter(Boolean)
      : ['0001'];

    return {
      type: 'intermediate',
      locationCode,
      locationName: resolvedName,
      countryCode: undefined,
      arrivalEarliest,
      arrivalLatest,
      departureEarliest,
      departureLatest,
      offsetDays: undefined,
      dwellMinutes: undefined,
      activities,
      platformWish: undefined,
      notes: undefined,
    };
  }

  private resolveVariantLabel(
    partNode: Element,
    operatingPeriod: RailMlOperatingPeriod | undefined,
  ): string | undefined {
    return (
      partNode.getAttribute('name') ??
      partNode.getAttribute('description') ??
      operatingPeriod?.description ??
      partNode.getAttribute('operatingPeriodRef') ??
      undefined
    );
  }

  private extractRailMlOperatingPeriods(doc: Document): Map<string, RailMlOperatingPeriod> {
    const nodes = Array.from(
      doc.querySelectorAll('operatingPeriod, railml\\:operatingPeriod, ns1\\:operatingPeriod'),
    );
    const periods = new Map<string, RailMlOperatingPeriod>();
    nodes.forEach((node) => {
      const id = node.getAttribute('id');
      if (!id) {
        return;
      }
      const description = node.getAttribute('description') ?? undefined;
      const dayNodes = Array.from(
        node.querySelectorAll('operatingDay, railml\\:operatingDay, ns1\\:operatingDay'),
      );
      const firstCode = dayNodes.find((day) => day.getAttribute('operatingCode'));
      const operatingCode = firstCode?.getAttribute('operatingCode') ?? '1111111';
      const startDates = dayNodes
        .map((day) => day.getAttribute('startDate'))
        .filter((date): date is string => !!date)
        .sort();
      const endDates = dayNodes
        .map((day) => day.getAttribute('endDate'))
        .filter((date): date is string => !!date)
        .sort();
      const startDate = startDates[0];
      const endDate = endDates.length ? endDates[endDates.length - 1] : undefined;
      periods.set(id, {
        id,
        description,
        operatingCode,
        startDate,
        endDate,
      });
    });
    return periods;
  }

  private extractRailMlTimetablePeriods(doc: Document): Map<string, RailMlTimetablePeriod> {
    const nodes = Array.from(
      doc.querySelectorAll('timetablePeriod, railml\\:timetablePeriod, ns1\\:timetablePeriod'),
    );
    const periods = new Map<string, RailMlTimetablePeriod>();
    nodes.forEach((node) => {
      const id = node.getAttribute('id');
      if (!id) {
        return;
      }
      periods.set(id, {
        id,
        startDate: node.getAttribute('startDate') ?? undefined,
        endDate: node.getAttribute('endDate') ?? undefined,
      });
    });
    return periods;
  }

  private sanitizeDaysBitmap(code: string | null | undefined): string {
    if (!code) {
      return '1111111';
    }
    const cleaned = code
      .split('')
      .map((char) => (char === '1' ? '1' : '0'))
      .join('');
    if (/^[01]{7}$/.test(cleaned)) {
      return cleaned;
    }
    const compact = code.replace(/[^01]/g, '');
    if (/^[01]{7}$/.test(compact)) {
      return compact;
    }
    return '1111111';
  }

  private resolveLocationName(doc: Document, ocpRef: string | null): string | undefined {
    if (!ocpRef) {
      return undefined;
    }
    const selector = `[id="${ocpRef}"]`;
    const ocp =
      doc.querySelector(`operationControlPoint${selector}`) ??
      doc.querySelector(`ocp${selector}`) ??
      doc.querySelector(`railml\\:operationControlPoint${selector}`) ??
      doc.querySelector(`railml\\:ocp${selector}`) ??
      doc.querySelector(`ns1\\:operationControlPoint${selector}`) ??
      doc.querySelector(`ns1\\:ocp${selector}`) ??
      Array.from(doc.querySelectorAll(selector)).find((element) => {
        const localName = element.localName?.toLowerCase();
        return localName === 'ocp' || localName === 'operationcontrolpoint';
      });
    if (!ocp) {
      return undefined;
    }
    const nameAttr = ocp.getAttribute('name') ?? ocp.getAttribute('label');
    if (nameAttr) {
      return nameAttr;
    }
    const nameNode = ocp.querySelector('name') ?? ocp.querySelector('railml\\:name');
    return nameNode?.textContent?.trim() || undefined;
  }

  private combineDateTime(date: string, time: string | undefined): string {
    const baseTime = time && time.length >= 5 ? time.slice(0, 5) : '00:00';
    const iso = `${date}T${baseTime}`;
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  }

  private sanitizeTime(value: string | null | undefined): string | undefined {
    if (!value) {
      return undefined;
    }
    const match = value.match(/(\d{1,2}:\d{2})/);
    return match ? match[1] : undefined;
  }

  private normalizeCalendarDates(dates: string[]): string[] {
    return Array.from(
      new Set(
        dates
          .map((date) => date?.slice(0, 10))
          .filter((date): date is string => !!date && /^\d{4}-\d{2}-\d{2}$/.test(date)),
      ),
    ).sort();
  }

}
