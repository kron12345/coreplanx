import { OrderItem } from '../../models/order-item.model';
import { TrainPlan } from '../../models/train-plan.model';
import { Timetable } from '../../models/timetable.model';
import type {
  CreatePlanOrderItemsPayload,
  CreateManualPlanOrderItemPayload,
  CreateImportedPlanOrderItemPayload,
  ImportedRailMlTrain,
} from '../order.service';
import { CreateScheduleTemplateStopPayload } from '../schedule-template.service';
import { TrainPlanService, PlanModificationStopInput } from '../train-plan.service';
import { TrafficPeriodService } from '../traffic-period.service';
import { TimetableService } from '../timetable.service';
import { TimetableYearService } from '../timetable-year.service';
import { normalizeCalendarDates, normalizeTimetableYearLabel } from './order-plan.utils';
import { timetableYearFromPlan } from './order-timetable.utils';
import { normalizeTags } from './order-item.utils';
import { buildDaysBitmapFromValidity } from './order-validity.utils';

export interface PlanFactoryDeps {
  trainPlanService: TrainPlanService;
  trafficPeriodService: TrafficPeriodService;
  timetableService: TimetableService;
  timetableYearService: TimetableYearService;
  ensureOrderTimetableYear: (orderId: string, label?: string | null) => void;
  applyPlanDetailsToItem: (item: OrderItem, plan: TrainPlan) => OrderItem;
  ensureTimetableForPlan: (plan: TrainPlan, item: OrderItem, refTrainIdOverride?: string) => Timetable | null;
  withTimetableMetadata: (item: OrderItem, timetable: Timetable | null) => OrderItem;
  linkTrainPlanToItem: (planId: string, itemId: string) => void;
  generateItemId: (orderId: string) => string;
  appendItems: (orderId: string, items: OrderItem[]) => void;
}

export class OrderPlanFactory {
  constructor(private readonly deps: PlanFactoryDeps) {}

  async addPlanOrderItems(payload: CreatePlanOrderItemsPayload): Promise<OrderItem[]> {
    const {
      orderId,
      namePrefix,
      responsible,
      timetableYearLabel,
      tags,
      variantType,
      variantLabel,
      variantGroupId,
      simulationId,
      simulationLabel,
      ...planConfig
    } = payload;
    const normalizedTags = normalizeTags(tags);
    const normalizedCalendarDates = normalizeCalendarDates(planConfig.calendarDates ?? []);
    const effectiveCalendarDates = normalizedCalendarDates.length ? normalizedCalendarDates : undefined;

    let planTrafficPeriodId = planConfig.trafficPeriodId;
    if (!planTrafficPeriodId && effectiveCalendarDates?.length) {
      planTrafficPeriodId = await this.createTrafficPeriodForPlanDates(
        effectiveCalendarDates,
        namePrefix?.trim() || undefined,
      );
    }

    const plans = await this.deps.trainPlanService.createPlansFromTemplate({
      ...planConfig,
      calendarDates: effectiveCalendarDates ?? planConfig.calendarDates,
      trafficPeriodId: planTrafficPeriodId,
      planVariantType: variantType ?? 'productive',
      variantLabel,
      simulationId,
      simulationLabel,
    });
    if (!plans.length) {
      return [];
    }
    const enrichedPlans = plans;
    const normalizedYearLabel =
      normalizeTimetableYearLabel(timetableYearLabel, this.deps.timetableYearService) ??
      timetableYearFromPlan(enrichedPlans[0] ?? plans[0], this.deps.timetableYearService);
    if (!normalizedYearLabel) {
      throw new Error('Fahrplanjahr konnte nicht ermittelt werden.');
    }
    this.deps.ensureOrderTimetableYear(orderId, normalizedYearLabel);

    const items: OrderItem[] = enrichedPlans.map((plan, index) => {
      const basePrefix = namePrefix?.trim() ?? plan.title;
      const itemName = enrichedPlans.length > 1 ? `${basePrefix} #${index + 1}` : basePrefix;
      const base: OrderItem = {
        id: this.deps.generateItemId(orderId),
        name: itemName,
        type: 'Fahrplan',
        tags: normalizedTags,
        responsible: plan.responsibleRu,
        linkedTemplateId: planConfig.templateId,
        linkedTrainPlanId: plan.id,
        timetableYearLabel: normalizedYearLabel,
        variantType: variantType ?? 'productive',
        variantGroupId: variantGroupId ?? undefined,
        variantLabel: variantLabel ?? undefined,
        simulationId,
        simulationLabel,
      } satisfies OrderItem;

      const enriched = this.deps.applyPlanDetailsToItem(base, plan);
      const timetable = this.deps.ensureTimetableForPlan(plan, enriched);
      return this.deps.withTimetableMetadata(enriched, timetable);
    });

    this.deps.appendItems(orderId, items);

    items.forEach((item, index) => {
      const plan = enrichedPlans[index];
      this.deps.linkTrainPlanToItem(plan.id, item.id);
    });

    return items;
  }

  async addManualPlanOrderItem(payload: CreateManualPlanOrderItemPayload): Promise<OrderItem> {
    if (!payload.stops.length) {
      throw new Error('Der Fahrplan benötigt mindestens einen Halt.');
    }

    const stopPayloads = payload.stops.map((stop) => this.manualStopToTemplatePayload(stop));
    const responsible =
      payload.responsible?.trim() && payload.responsible.trim().length
        ? payload.responsible.trim()
        : 'Manuelle Planung';
    const title =
      payload.name?.trim() && payload.name.trim().length
        ? payload.name.trim()
        : `Manueller Fahrplan ${payload.trainNumber}`;

    const plan = await this.deps.trainPlanService.createManualPlan({
      title,
      trainNumber: payload.trainNumber,
      responsibleRu: responsible,
      departure: payload.departure,
      stops: stopPayloads,
      sourceName: title,
      trafficPeriodId: payload.trafficPeriodId,
      validFrom: payload.validFrom,
      validTo: payload.validTo,
      daysBitmap: payload.daysBitmap,
      composition: payload.composition,
      simulationId: payload.simulationId,
      simulationLabel: payload.simulationLabel,
      planVariantType: payload.variantType ?? 'productive',
      variantLabel: payload.variantLabel,
    });
    const timetableYearLabel =
      normalizeTimetableYearLabel(payload.timetableYearLabel, this.deps.timetableYearService) ??
      timetableYearFromPlan(plan, this.deps.timetableYearService);
    if (!timetableYearLabel) {
      throw new Error('Fahrplanjahr konnte nicht bestimmt werden.');
    }
    this.deps.ensureOrderTimetableYear(payload.orderId, timetableYearLabel);

    const tags = normalizeTags(payload.tags);
    const base: OrderItem = {
      id: this.deps.generateItemId(payload.orderId),
      name: title,
      type: 'Fahrplan',
      tags,
      responsible,
      linkedTrainPlanId: plan.id,
      timetableYearLabel,
      variantType: payload.variantType ?? 'productive',
      variantGroupId: payload.variantGroupId,
      variantLabel: payload.variantLabel,
      simulationId: payload.simulationId,
      simulationLabel: payload.simulationLabel,
    } satisfies OrderItem;
    const item = this.deps.applyPlanDetailsToItem(base, plan);
    const timetable = this.deps.ensureTimetableForPlan(plan, item);
    const enriched = this.deps.withTimetableMetadata(item, timetable);

    this.deps.appendItems(payload.orderId, [enriched]);
    this.deps.linkTrainPlanToItem(plan.id, enriched.id);
    return enriched;
  }

  async addImportedPlanOrderItem(payload: CreateImportedPlanOrderItemPayload): Promise<OrderItem> {
    const departureIso = payload.train.departureIso;
    if (!departureIso) {
      throw new Error(`Zug ${payload.train.name} enthält keine Abfahrtszeit.`);
    }

    const responsible = payload.responsible ?? 'RailML Import';

    const normalizedCalendarDates = normalizeCalendarDates(payload.train.calendarDates ?? []);
    const fallbackDate = departureIso.slice(0, 10);
    const validFrom = normalizedCalendarDates[0] ?? fallbackDate;
    const validTo = normalizedCalendarDates[normalizedCalendarDates.length - 1] ?? validFrom;
    const dateSegments = normalizedCalendarDates.map((date) => ({
      startDate: date,
      endDate: date,
    }));
    const daysBitmap = buildDaysBitmapFromValidity(dateSegments, validFrom, validTo);

    const plan = await this.deps.trainPlanService.createManualPlan({
      title: payload.train.name,
      trainNumber: payload.train.number,
      responsibleRu: responsible,
      departure: departureIso,
      stops: payload.train.stops,
      sourceName: payload.train.category ?? 'RailML',
      notes: undefined,
      templateId: undefined,
      trafficPeriodId: payload.trafficPeriodId,
      validFrom,
      validTo,
      daysBitmap,
      composition: payload.composition,
      planVariantType: payload.variantType ?? 'productive',
      variantLabel: payload.variantLabel,
      simulationId: payload.simulationId,
      simulationLabel: payload.simulationLabel,
    });
    const timetableYearLabel =
      normalizeTimetableYearLabel(payload.timetableYearLabel, this.deps.timetableYearService) ??
      payload.train.timetableYearLabel ??
      timetableYearFromPlan(plan, this.deps.timetableYearService);
    if (!timetableYearLabel) {
      throw new Error('Fahrplanjahr konnte nicht bestimmt werden.');
    }
    this.deps.ensureOrderTimetableYear(payload.orderId, timetableYearLabel);

    const firstStop = plan.stops[0];
    const lastStop = plan.stops[plan.stops.length - 1];

    const namePrefix = payload.namePrefix?.trim();
    const tags = normalizeTags(payload.tags);
    const itemName = namePrefix ? `${namePrefix} ${payload.train.name}` : payload.train.name;
    const base: OrderItem = {
      id: this.deps.generateItemId(payload.orderId),
      name: itemName,
      type: 'Fahrplan',
      tags,
      responsible,
      linkedTrainPlanId: plan.id,
      parentItemId: payload.parentItemId,
      timetableYearLabel,
      variantType: payload.variantType ?? 'productive',
      variantGroupId: payload.variantGroupId,
      variantLabel: payload.variantLabel,
      simulationId: payload.simulationId,
      simulationLabel: payload.simulationLabel,
    } satisfies OrderItem;

    const item = this.deps.applyPlanDetailsToItem(
      {
        ...base,
        fromLocation: firstStop?.locationName ?? payload.train.start,
        toLocation: lastStop?.locationName ?? payload.train.end,
      },
      plan,
    );
    const timetable = this.deps.ensureTimetableForPlan(plan, item);
    const enriched = this.deps.withTimetableMetadata(item, timetable);

    this.deps.appendItems(payload.orderId, [enriched]);
    this.deps.linkTrainPlanToItem(plan.id, enriched.id);
    return enriched;
  }

  private async createTrafficPeriodForPlanDates(
    dates: string[],
    name?: string,
  ): Promise<string> {
    const normalizedDates = normalizeCalendarDates(dates);
    if (!normalizedDates.length) {
      throw new Error('Referenzkalender enthält keine aktiven Tage.');
    }
    const year = Number.parseInt(normalizedDates[0].slice(0, 4), 10);
    const periodName = name ?? 'Referenzkalender';
    const id = await this.deps.trafficPeriodService.createPeriod({
      name: periodName,
      type: 'standard',
      year,
      rules: [
        {
          name: `${periodName} ${year}`,
          year,
          selectedDates: normalizedDates,
          variantType: 'series',
          appliesTo: 'both',
          variantNumber: '00',
          primary: true,
        },
      ],
    });
    if (!id) {
      throw new Error('Referenzkalender konnte nicht erstellt werden.');
    }
    return id;
  }

  private manualStopToTemplatePayload(
    stop: PlanModificationStopInput,
  ): CreateScheduleTemplateStopPayload {
    const arrivalTime = stop.arrivalTime?.trim();
    const departureTime = stop.departureTime?.trim();
    const locationName = stop.locationName?.trim() || stop.locationCode?.trim() || 'Unbekannt';
    const locationCode = stop.locationCode?.trim() || locationName || 'LOC';

    return {
      type: stop.type,
      locationCode,
      locationName,
      countryCode: stop.countryCode?.trim() || undefined,
      arrivalEarliest: arrivalTime || undefined,
      arrivalLatest: arrivalTime || undefined,
      departureEarliest: departureTime || undefined,
      departureLatest: departureTime || undefined,
      offsetDays: stop.arrivalOffsetDays ?? stop.departureOffsetDays ?? undefined,
      dwellMinutes: stop.dwellMinutes ?? undefined,
      activities: stop.activities && stop.activities.length ? [...stop.activities] : ['0001'],
      platformWish: stop.platform,
      notes: stop.notes,
    };
  }

  
}
