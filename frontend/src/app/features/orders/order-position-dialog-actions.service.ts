import { Injectable } from '@angular/core';
import { CreatePlanOrderItemsPayload, CreateServiceOrderItemPayload, ImportedRailMlTrain, OrderService } from '../../core/services/order.service';
import { Order } from '../../core/models/order.model';
import { OrderItem } from '../../core/models/order-item.model';
import { BusinessTemplateService } from '../../core/services/business-template.service';
import { TrafficPeriodRulePayload, TrafficPeriodService } from '../../core/services/traffic-period.service';
import { TimetableYearService } from '../../core/services/timetable-year.service';
import { PlanModificationStopInput } from '../../core/services/train-plan.service';
import type { ScheduleTemplate } from '../../core/models/schedule-template.model';
import { OrderPositionRailmlService } from './order-position-railml.service';
import type { OrderPositionForms } from './order-position-dialog.forms';
import { parseTimeToMinutes } from './order-position-time.utils';

type ServiceForm = OrderPositionForms['serviceForm'];
type PlanForm = OrderPositionForms['planForm'];
type ManualPlanForm = OrderPositionForms['manualPlanForm'];
type ImportOptionsForm = OrderPositionForms['importOptionsForm'];
type BusinessForm = OrderPositionForms['businessForm'];

@Injectable({ providedIn: 'root' })
export class OrderPositionDialogActionsService {
  constructor(
    private readonly orderService: OrderService,
    private readonly trafficPeriodService: TrafficPeriodService,
    private readonly timetableYearService: TimetableYearService,
    private readonly businessTemplateService: BusinessTemplateService,
    private readonly railmlService: OrderPositionRailmlService,
  ) {}

  createServiceItems(options: {
    order: Order;
    serviceForm: ServiceForm;
    businessForm: BusinessForm;
  }): string | null {
    const value = options.serviceForm.getRawValue();
    const serviceType = value.serviceType?.trim();
    if (!serviceType) {
      return 'Bitte einen Leistungstyp angeben.';
    }

    const startMinutes = parseTimeToMinutes(value.start);
    const endMinutes = parseTimeToMinutes(value.end);
    if (startMinutes === null || endMinutes === null) {
      return 'Bitte Zeiten im Format HH:MM angeben.';
    }

    const selectedDates = this.resolveCalendarDates(value.calendarDates, value.calendarExclusions);
    if (!selectedDates.length) {
      options.serviceForm.controls.calendarDates.markAsTouched();
      return 'Bitte mindestens einen Kalendertag auswählen.';
    }
    try {
      this.timetableYearService.ensureDatesWithinSameYear(selectedDates);
    } catch (error) {
      return error instanceof Error ? error.message : 'Ungültiges Fahrplanjahr.';
    }

    const endOffsetDays = endMinutes < startMinutes ? 1 : 0;

    const fromLocation = value.fromLocation?.trim();
    const toLocation = value.toLocation?.trim();
    if (!fromLocation || !toLocation) {
      return 'Bitte Herkunft und Ziel angeben.';
    }

    const businessError = this.validateBusinessSelection(options.businessForm);
    if (businessError) {
      return businessError;
    }

    const itemTags = this.parseTagsInput(value.tags);
    const createdItems: OrderItem[] = [];

    try {
      for (const date of selectedDates) {
        const start = this.buildIsoFromMinutes(date, startMinutes);
        const end = this.buildIsoFromMinutes(date, endMinutes, endOffsetDays);
        if (!start || !end) {
          throw new Error('Start/Ende konnten nicht berechnet werden.');
        }
        const trafficPeriodId = this.trafficPeriodService.createSingleDayPeriod({
          name: `${serviceType} ${date}`,
          date,
          variantType: 'special_day',
          tags: this.buildArchiveGroupTags(
            `${options.order.id}:service:${this.slugify(serviceType)}`,
            serviceType,
            'service',
          ),
        });
        if (!trafficPeriodId) {
          throw new Error('Referenzkalender konnte nicht erstellt werden.');
        }
        const payload: CreateServiceOrderItemPayload = {
          orderId: options.order.id,
          serviceType,
          fromLocation,
          toLocation,
          start,
          end,
          trafficPeriodId,
          deviation: value.deviation?.trim() || undefined,
          name: value.name?.trim() || undefined,
          timetableYearLabel: value.calendarYear ?? undefined,
          tags: itemTags,
        };
        const item = this.orderService.addServiceOrderItem(payload);
        createdItems.push(item);
      }
    } catch (error) {
      return error instanceof Error ? error.message : 'Unbekannter Fehler';
    }

    const businessLinkError = this.applyBusinessLink(createdItems, options.businessForm);
    if (businessLinkError) {
      return businessLinkError;
    }
    return null;
  }

  createManualPlanItem(options: {
    order: Order;
    manualPlanForm: ManualPlanForm;
    businessForm: BusinessForm;
    stops: PlanModificationStopInput[];
    composition: ScheduleTemplate['composition'] | undefined;
  }): string | null {
    const stops = options.stops;
    if (!stops?.length) {
      return 'Bitte zuerst einen Fahrplan zusammenstellen.';
    }

    const value = options.manualPlanForm.getRawValue();
    const selectedDates = this.resolveCalendarDates(value.calendarDates, value.calendarExclusions);
    if (!selectedDates.length) {
      options.manualPlanForm.controls.calendarDates.markAsTouched();
      return 'Bitte mindestens einen Kalendertag auswählen.';
    }

    const trainNumber = value.trainNumber?.trim();
    if (!trainNumber) {
      return 'Bitte eine Zugnummer angeben.';
    }

    const businessError = this.validateBusinessSelection(options.businessForm);
    if (businessError) {
      return businessError;
    }

    try {
      const sortedDates = [...selectedDates].sort();
      const departure = new Date(`${sortedDates[0]}T00:00:00`);
      if (Number.isNaN(departure.getTime())) {
        throw new Error('Bitte ein gültiges Datum wählen.');
      }
      const responsible = value.responsible?.trim() || undefined;
      const planName = value.name?.trim() || undefined;
      const yearInfo = this.timetableYearService.ensureDatesWithinSameYear(sortedDates);
      const groupId = `${options.order.id}:manual:${this.slugify(trainNumber)}`;
      const periodTags = this.buildArchiveGroupTags(
        groupId,
        planName ?? options.order.name ?? 'Manueller Fahrplan',
        'manual',
      );
      const itemTags = this.parseTagsInput(value.tags);
      const trafficPeriodId = this.createManualTrafficPeriod({
        baseName: planName ?? 'Manueller Fahrplan',
        dates: sortedDates,
        responsible,
        tags: periodTags,
        timetableYearLabel: yearInfo.label,
      });
      if (!trafficPeriodId) {
        throw new Error('Referenzkalender konnte nicht erstellt werden.');
      }
      const payload = {
        orderId: options.order.id,
        departure: departure.toISOString(),
        stops,
        trainNumber,
        name: planName,
        responsible,
        trafficPeriodId,
        validFrom: sortedDates[0],
        validTo: sortedDates[sortedDates.length - 1],
        daysBitmap: this.buildDaysBitmapFromDates(sortedDates),
        timetableYearLabel: yearInfo.label,
        tags: itemTags,
        composition: options.composition,
        variantType: value.variantType,
        variantLabel: value.variantLabel?.trim() || undefined,
        variantGroupId: this.resolveVariantGroupId(options.order),
        simulationId: options.manualPlanForm.controls.simulationId.value || undefined,
        simulationLabel: options.manualPlanForm.controls.simulationLabel.value || undefined,
      };
      const item = this.orderService.addManualPlanOrderItem(payload);
      const businessLinkError = this.applyBusinessLink([item], options.businessForm);
      if (businessLinkError) {
        return businessLinkError;
      }
    } catch (error) {
      return error instanceof Error ? error.message : 'Unbekannter Fehler';
    }

    return null;
  }

  createImportedPlanItems(options: {
    order: Order;
    trains: ImportedRailMlTrain[];
    selectedTrainIds: Set<string>;
    importOptionsForm: ImportOptionsForm;
    businessForm: BusinessForm;
    composition: ScheduleTemplate['composition'] | undefined;
  }): string | null {
    const trains = options.trains;
    const selected = options.selectedTrainIds;
    if (!trains.length || !selected.size) {
      return 'Bitte mindestens einen Zug auswählen.';
    }

    const items = trains.filter((train) => selected.has(train.id));
    if (!items.length) {
      return 'Bitte mindestens einen Zug auswählen.';
    }

    const businessError = this.validateBusinessSelection(options.businessForm);
    if (businessError) {
      return businessError;
    }

    const optionsValue = options.importOptionsForm.getRawValue();
    const namePrefix = optionsValue.namePrefix?.trim();
    const responsible = optionsValue.responsible?.trim() || undefined;
    const overridePeriodId = optionsValue.trafficPeriodId?.trim() || undefined;
    const itemTags = this.parseTagsInput(optionsValue.tags);
    const variantType = optionsValue.variantType;
    const variantLabel = optionsValue.variantLabel?.trim() || undefined;
    const variantGroupId = this.resolveVariantGroupId(options.order);
    const simulationId = optionsValue.simulationId?.trim() || undefined;
    const simulationLabel = optionsValue.simulationLabel?.trim() || undefined;

    try {
      const periodAssignments =
        overridePeriodId || !items.length
          ? null
          : this.railmlService.ensureCalendarsForImportedTrains(items, (groupId, label, origin) =>
              this.buildArchiveGroupTags(groupId, label, origin),
            );
      const missingPeriods: string[] = [];
      const payloads: Array<{ train: ImportedRailMlTrain; trafficPeriodId: string }> = [];

      items.forEach((train) => {
        const groupKey = train.groupId ?? train.id;
        const effectivePeriodId =
          overridePeriodId ?? periodAssignments?.get(groupKey) ?? train.trafficPeriodId;
        if (!effectivePeriodId) {
          missingPeriods.push(train.name ?? train.id);
          return;
        }
        payloads.push({ train, trafficPeriodId: effectivePeriodId });
      });

      if (missingPeriods.length) {
        return `Für folgende Züge konnte kein Referenzkalender bestimmt werden: ${missingPeriods
          .slice(0, 5)
          .join(', ')}${missingPeriods.length > 5 ? ' …' : ''}`;
      }

      const orderedPayloads: Array<{ train: ImportedRailMlTrain; trafficPeriodId: string }> = [];
      payloads.forEach((entry) => {
        if (!entry.train.variantOf) {
          orderedPayloads.push(entry);
        }
      });
      payloads.forEach((entry) => {
        if (entry.train.variantOf) {
          orderedPayloads.push(entry);
        }
      });

      const createdItemIds = new Map<string, string>();
      const groupRootIds = new Map<string, string>();

      const createdItems: OrderItem[] = [];
      orderedPayloads.forEach(({ train, trafficPeriodId }) => {
        let parentItemId: string | undefined;
        if (train.variantOf) {
          parentItemId =
            createdItemIds.get(train.variantOf) ??
            (train.groupId ? groupRootIds.get(train.groupId) : undefined);
        }
        const item = this.orderService.addImportedPlanOrderItem({
          orderId: options.order.id,
          train,
          trafficPeriodId,
          responsible,
          namePrefix,
          parentItemId,
          timetableYearLabel: train.timetableYearLabel ?? optionsValue.calendarYear ?? undefined,
          tags: itemTags,
          composition: options.composition,
          variantType,
          variantLabel,
          variantGroupId,
          simulationId,
          simulationLabel,
        });
        createdItemIds.set(train.id, item.id);
        if (!train.variantOf) {
          groupRootIds.set(train.groupId ?? train.id, item.id);
        }
        createdItems.push(item);
      });

      const businessLinkError = this.applyBusinessLink(createdItems, options.businessForm);
      if (businessLinkError) {
        return businessLinkError;
      }
    } catch (error) {
      return error instanceof Error ? error.message : 'Unbekannter Fehler';
    }

    return null;
  }

  createPlanItems(options: {
    order: Order;
    planForm: PlanForm;
    businessForm: BusinessForm;
    composition: ScheduleTemplate['composition'] | undefined;
  }): string | null {
    const value = options.planForm.getRawValue();
    const selectedDates = this.resolveCalendarDates(value.calendarDates, value.calendarExclusions);
    if (!selectedDates.length) {
      options.planForm.controls.calendarDates.markAsTouched();
      return 'Bitte mindestens einen Kalendertag auswählen.';
    }
    const startMinutes = parseTimeToMinutes(value.startTime);
    const endMinutes = parseTimeToMinutes(value.endTime);
    const interval = value.intervalMinutes ?? 0;

    if (startMinutes === null || endMinutes === null) {
      return 'Bitte gültige Start- und Endzeiten im Format HH:MM angeben.';
    }

    if (startMinutes < 4 * 60 || endMinutes > 23 * 60) {
      return 'Bitte Zeiten zwischen 04:00 und 23:00 Uhr wählen.';
    }

    if (endMinutes <= startMinutes) {
      return 'Die Endzeit muss nach der Startzeit liegen.';
    }

    if (!interval || interval < 1) {
      return 'Bitte einen gültigen Takt angeben.';
    }

    let count = 0;
    for (let current = startMinutes; current <= endMinutes; current += interval) {
      count += 1;
    }

    if (count <= 0) {
      return 'Es konnte kein Zug im angegebenen Zeitraum erzeugt werden.';
    }

    const otnValue = value.otn?.toString().trim();
    let trainNumberStart: number | undefined;
    let trainNumberInterval: number | undefined;
    if (otnValue) {
      const parsedBase = Number.parseInt(otnValue, 10);
      if (Number.isNaN(parsedBase)) {
        return 'Bitte eine gültige Zugnummer (OTN) angeben.';
      }
      trainNumberStart = parsedBase;
      const intervalRaw = Number(value.otnInterval ?? 1);
      if (!Number.isFinite(intervalRaw) || intervalRaw < 1) {
        return 'Bitte ein gültiges OTN-Intervall ≥ 1 angeben.';
      }
      trainNumberInterval = Math.floor(intervalRaw);
    }

    const businessError = this.validateBusinessSelection(options.businessForm);
    if (businessError) {
      return businessError;
    }

    const planPayload: CreatePlanOrderItemsPayload = {
      orderId: options.order.id,
      templateId: value.templateId!,
      startTime: value.startTime!,
      intervalMinutes: value.intervalMinutes!,
      departuresPerDay: count,
      calendarDates: selectedDates,
      namePrefix: value.namePrefix?.trim() || undefined,
      responsible: value.responsible?.trim() || undefined,
      responsibleRu: value.responsible?.trim() || undefined,
      timetableYearLabel: value.calendarYear ?? undefined,
      tags: this.parseTagsInput(value.tags),
      composition: options.composition,
      variantType: value.variantType,
      variantLabel: value.variantLabel?.trim() || undefined,
      variantGroupId: this.resolveVariantGroupId(options.order),
      simulationId: options.planForm.controls.simulationId.value || undefined,
      simulationLabel: options.planForm.controls.simulationLabel.value || undefined,
    };

    if (trainNumberStart !== undefined) {
      planPayload.trainNumberStart = trainNumberStart;
      planPayload.trainNumberInterval = trainNumberInterval;
    }

    try {
      const items = this.orderService.addPlanOrderItems(planPayload);
      if (!items.length) {
        return 'Es konnten keine Auftragspositionen erzeugt werden.';
      }
      const businessLinkError = this.applyBusinessLink(items, options.businessForm);
      if (businessLinkError) {
        return businessLinkError;
      }
    } catch (error) {
      return error instanceof Error ? error.message : 'Unbekannter Fehler';
    }

    return null;
  }

  resolveCalendarDates(
    include: readonly string[] | null | undefined,
    exclusions?: readonly string[] | null | undefined,
  ): string[] {
    const includeSet = new Set(
      (include ?? []).map((date) => date?.trim()).filter((date): date is string => !!date),
    );
    if (!includeSet.size) {
      return [];
    }
    if (!exclusions?.length) {
      return Array.from(includeSet).sort();
    }
    const exclusionSet = new Set(
      exclusions.map((date) => date?.trim()).filter((date): date is string => !!date),
    );
    return Array.from(includeSet)
      .filter((date) => !exclusionSet.has(date))
      .sort();
  }

  private parseTagsInput(value: string | null | undefined): string[] | undefined {
    if (!value?.trim()) {
      return undefined;
    }
    const tags = value
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length);
    return tags.length ? Array.from(new Set(tags)) : undefined;
  }

  private createManualTrafficPeriod(options: {
    baseName: string;
    dates: string[];
    responsible?: string;
    tags: string[];
    timetableYearLabel?: string;
  }): string {
    if (!options.dates.length) {
      return '';
    }
    const baseName = options.baseName?.trim() || 'Manueller Fahrplan';
    const sortedDates = [...new Set(options.dates)].sort();
    const yearInfo = options.timetableYearLabel
      ? this.timetableYearService.getYearByLabel(options.timetableYearLabel)
      : this.timetableYearService.ensureDatesWithinSameYear(sortedDates);
    const grouped = this.groupDatesByYear(sortedDates);
    const groupedEntries = Array.from(grouped.entries()).sort((a, b) => a[0] - b[0]);
    if (groupedEntries.length > 1) {
      throw new Error(
        'Die Fahrtage erstrecken sich über mehrere Fahrplanjahre. Bitte separate Auftragspositionen anlegen.',
      );
    }
    const firstYear = groupedEntries[0]?.[0] ?? yearInfo.startYear;
    const rules: TrafficPeriodRulePayload[] = groupedEntries.map(([year, dates], index) => ({
      name: `${baseName} ${year}`,
      year,
      selectedDates: dates,
      variantType: 'special_day',
      variantNumber: String(index + 1).padStart(2, '0'),
      appliesTo: 'both',
      primary: index === 0,
    }));
    const firstDate = sortedDates[0];
    const lastDate = sortedDates[sortedDates.length - 1];
    const rangeLabel = firstDate === lastDate ? firstDate : `${firstDate} - ${lastDate}`;
    const periodName = `${baseName} ${rangeLabel}`;
    return this.trafficPeriodService.createPeriod({
      name: periodName,
      type: 'special',
      responsible: options.responsible,
      year: firstYear,
      rules,
      timetableYearLabel: yearInfo.label,
      tags: options.tags.length ? options.tags : undefined,
    });
  }

  private groupDatesByYear(dates: string[]): Map<number, string[]> {
    const groups = new Map<number, string[]>();
    dates.forEach((date) => {
      const normalized = date?.trim();
      if (!normalized) {
        return;
      }
      const year = Number.parseInt(normalized.slice(0, 4), 10);
      const safeYear = Number.isNaN(year)
        ? this.timetableYearService.defaultYearBounds().startYear
        : year;
      const list = groups.get(safeYear) ?? [];
      list.push(normalized);
      groups.set(safeYear, list);
    });
    groups.forEach((list, year) => {
      const deduped = Array.from(new Set(list)).sort();
      groups.set(year, deduped);
    });
    return groups;
  }

  private buildDaysBitmapFromDates(dates: string[]): string {
    if (!dates.length) {
      return '1111111';
    }
    const bitmap = Array(7).fill('0');
    let hasValidDate = false;
    dates.forEach((date) => {
      const parsed = new Date(`${date}T00:00:00`);
      if (Number.isNaN(parsed.getTime())) {
        return;
      }
      hasValidDate = true;
      const weekday = parsed.getDay();
      const index = weekday === 0 ? 6 : weekday - 1;
      bitmap[index] = '1';
    });
    return hasValidDate ? bitmap.join('') : '1111111';
  }

  private buildIsoFromMinutes(baseDate: string, minutes: number, dayOffset = 0): string | null {
    const base = new Date(`${baseDate}T00:00:00`);
    if (Number.isNaN(base.getTime())) {
      return null;
    }
    base.setDate(base.getDate() + dayOffset);
    base.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    return base.toISOString();
  }

  validateBusinessSelection(businessForm: BusinessForm): string | null {
    const mode = businessForm.controls.mode.value;
    if (mode === 'existing' && !businessForm.controls.existingBusinessId.value) {
      businessForm.controls.existingBusinessId.markAsTouched();
      return 'Bitte ein bestehendes Geschäft auswählen oder Modus anpassen.';
    }
    if (mode === 'template' && !businessForm.controls.templateId.value) {
      businessForm.controls.templateId.markAsTouched();
      return 'Bitte eine Geschäftsvorlage auswählen.';
    }
    return null;
  }

  private applyBusinessLink(items: OrderItem[], businessForm: BusinessForm): string | null {
    if (!items.length) {
      return null;
    }
    const mode = businessForm.controls.mode.value;
    if (mode === 'none') {
      return null;
    }
    if (mode === 'existing') {
      const businessId = businessForm.controls.existingBusinessId.value?.trim();
      if (!businessId) {
        return null;
      }
      items.forEach((item) => this.orderService.linkBusinessToItem(businessId, item.id));
      return null;
    }
    const templateId = businessForm.controls.templateId.value?.trim();
    if (!templateId) {
      return null;
    }
    try {
      const targetDateRaw = businessForm.controls.targetDate.value?.trim();
      const targetDate = targetDateRaw ? new Date(`${targetDateRaw}T00:00:00`) : undefined;
      if (targetDate && Number.isNaN(targetDate.getTime())) {
        throw new Error('Das Zieldatum für das Geschäft ist ungültig.');
      }
      const business = this.businessTemplateService.instantiateTemplate(templateId, {
        targetDate,
        note: businessForm.controls.note.value?.trim() || undefined,
        customTitle: businessForm.controls.customTitle.value?.trim() || undefined,
        linkedOrderItemIds: items.map((item) => item.id),
      });
      if (businessForm.controls.enableAutomations.value) {
        const automationIds = businessForm.controls.automationRuleIds.value ?? [];
        this.businessTemplateService.triggerAutomationsForTemplate(templateId, business.id, {
          automationIds: automationIds.length ? automationIds : undefined,
          linkedOrderItemIds: items.map((item) => item.id),
        });
      }
      return null;
    } catch (error) {
      return error instanceof Error
        ? error.message
        : 'Geschäftsvorlage konnte nicht instanziiert werden.';
    }
  }

  private buildArchiveGroupTags(groupId: string, label?: string, origin?: string): string[] {
    const tags = [`archive-group:${groupId}`];
    if (label?.trim()) {
      tags.push(`archive-label:${label.trim()}`);
    }
    if (origin) {
      tags.push(`archive-origin:${origin}`);
    }
    return tags;
  }

  private slugify(value: string): string {
    const normalized = value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    return normalized || 'gruppe';
  }

  private resolveVariantGroupId(order: Order): string {
    return `${order.id}:var`;
  }
}
