import { Injectable, computed, signal } from '@angular/core';
import { Order, OrderProcessStatus } from '../models/order.model';
import {
  OrderItem,
  OrderItemTimetableSnapshot,
  OrderItemValiditySegment,
  InternalProcessingStatus,
} from '../models/order-item.model';
import {
  Timetable,
  TimetablePhase,
  TimetableCalendarVariant,
  TimetableCalendarModification,
} from '../models/timetable.model';
import { MOCK_ORDERS } from '../mock/mock-orders.mock';
import {
  CreatePlansFromTemplatePayload,
  PlanModificationStopInput,
  TrainPlanService,
} from './train-plan.service';
import { TrainPlan } from '../models/train-plan.model';
import { CreateScheduleTemplateStopPayload } from './schedule-template.service';
import { BusinessStatus } from '../models/business.model';
import { CustomerService } from './customer.service';
import { TimetableService } from './timetable.service';
import { TrafficPeriodService } from './traffic-period.service';
import { TrafficPeriod, TrafficPeriodVariantType } from '../models/traffic-period.model';
import { TimetableYearService } from './timetable-year.service';
import { TimetableHubService, TimetableHubSectionKey } from './timetable-hub.service';
import { ScheduleTemplate } from '../models/schedule-template.model';
import {
  DEFAULT_ORDER_FILTERS,
  ORDER_FILTERS_STORAGE_KEY,
  OrderFilters,
  OrderSearchTokens,
  OrderTimelineReference,
  OrderTtrPhase,
  OrderTtrPhaseFilter,
  OrderTtrPhaseMeta,
  TTR_PHASE_META,
} from './orders/order-filters.model';
import { parseSearchTokens } from './orders/order-filter.utils';
import { OrderVariantsManager, OrderVariantMergeResult } from './orders/order-variants.manager';
import { OrderPlanLinkManager } from './orders/order-plan-link.manager';
import { OrderPlanHubHelper } from './orders/order-plan-hub.helper';
import {
  extractPlanEnd,
  extractPlanStart,
  normalizeCalendarDates,
  normalizeTimetableYearLabel,
  toTimetableStops,
} from './orders/order-plan.utils';
import {
  deriveOrderTimetableYear,
  getTrafficPeriodTimetableYear,
  timetableYearFromPlan,
  resolveTimetableYearBoundsForItem,
  resolveTimetableYearStart,
} from './orders/order-timetable.utils';
import {
  buildCalendarModifications,
  buildCalendarVariants,
} from './orders/order-timetable-calendar.utils';
import {
  deriveDefaultValidity,
  ensureSegmentsWithinValidity,
  expandSegmentsToDates,
  normalizeSegments,
  normalizeDateInput,
  prepareCustomSegments,
  resolveEffectiveValidity,
  resolveValiditySegments,
  segmentsWithinRanges,
  segmentsWithinYearBounds,
  splitSegments,
  subtractSegments,
  toUtcDate,
  fromUtcDate,
  buildDaysBitmapFromValidity,
} from './orders/order-validity.utils';
import { matchesItem, matchesTimeRange } from './orders/order-match.utils';
import {
  addDays,
  addHours,
  endOfDay,
  extractItemStartDate,
  extractReferenceSampleDate,
  isSameDay,
  isSameWeek,
  parseDateOnly,
  resolveReferenceDate,
  startOfDay,
  startOfWeek,
} from './orders/order-timeline.utils';
import {
  normalizeTags,
  prepareUpdatePayload,
  applyUpdatesToItem,
  ensureNoSiblingConflict,
} from './orders/order-item.utils';
import {
  ensureItemDefaults,
  normalizeItemsAfterChange,
} from './orders/order-normalize.utils';

import { DAY_IN_MS } from './orders/order-timeline.utils';

export interface OrderItemOption {
  itemId: string;
  orderId: string;
  orderName: string;
  itemName: string;
  type: OrderItem['type'];
  timetableYearLabel: string | null;
  serviceType?: string;
  start?: string;
  end?: string;
}

export interface CreateOrderPayload {
  id?: string;
  name: string;
  customerId?: string;
  customer?: string;
  tags?: string[];
  comment?: string;
  timetableYearLabel?: string;
}

export interface CreateServiceOrderItemPayload {
  orderId: string;
  serviceType: string;
  fromLocation: string;
  toLocation: string;
  start: string; // ISO
  end: string; // ISO
  trafficPeriodId: string;
  responsible?: string;
  deviation?: string;
  name?: string;
  timetableYearLabel?: string;
  tags?: string[];
}

export interface CreatePlanOrderItemsPayload
  extends CreatePlansFromTemplatePayload {
  orderId: string;
  namePrefix?: string;
  responsible?: string;
  timetableYearLabel?: string;
  tags?: string[];
  composition?: ScheduleTemplate['composition'];
  variantType?: 'productive' | 'simulation';
  variantGroupId?: string;
  variantLabel?: string;
  simulationId?: string;
  simulationLabel?: string;
}

export interface ImportedRailMlStop extends CreateScheduleTemplateStopPayload {}

export interface ImportedRailMlTemplateMatch {
  templateId: string;
  templateTitle: string;
  templateTrainNumber?: string;
  intervalMinutes?: number;
  expectedDeparture?: string;
  deviationMinutes: number;
  deviationLabel: string;
  toleranceMinutes: number;
  status: 'ok' | 'warning';
  matchScore: number;
  arrivalDeviationMinutes?: number;
  arrivalDeviationLabel?: string;
  travelTimeDeviationMinutes?: number;
  travelTimeDeviationLabel?: string;
  maxStopDeviationMinutes?: number;
  maxStopDeviationLabel?: string;
  stopComparisons: ImportedTemplateStopComparison[];
}

export interface ImportedTemplateStopComparison {
  locationCode: string;
  locationName: string;
  type: 'origin' | 'intermediate' | 'destination';
  templateArrival?: string;
  templateDeparture?: string;
  alignedTemplateArrival?: string;
  alignedTemplateDeparture?: string;
  actualArrival?: string;
  actualDeparture?: string;
  arrivalDeviationMinutes?: number;
  arrivalDeviationLabel?: string;
  departureDeviationMinutes?: number;
  departureDeviationLabel?: string;
  matched: boolean;
}

export interface ImportedRailMlTrain {
  id: string;
  name: string;
  number: string;
  category?: string;
  start?: string;
  end?: string;
  departureIso: string;
  arrivalIso?: string;
  departureTime?: string;
  arrivalTime?: string;
  stops: ImportedRailMlStop[];
  trafficPeriodId?: string;
  trafficPeriodName?: string;
  trafficPeriodSourceId?: string;
  groupId?: string;
  variantOf?: string;
  variantLabel?: string;
  operatingPeriodRef?: string;
  timetablePeriodRef?: string;
  trainPartId?: string;
  templateMatch?: ImportedRailMlTemplateMatch;
  calendarDates?: string[];
  calendarLabel?: string;
  calendarVariantType?: TrafficPeriodVariantType;
  timetableYearLabel?: string;
}

export interface CreateManualPlanOrderItemPayload {
  orderId: string;
  departure: string; // ISO
  trainNumber: string;
  stops: PlanModificationStopInput[];
  name?: string;
  responsible?: string;
  trafficPeriodId?: string;
  validFrom?: string;
  validTo?: string;
  daysBitmap?: string;
  timetableYearLabel?: string;
  tags?: string[];
  composition?: ScheduleTemplate['composition'];
  variantType?: 'productive' | 'simulation';
  variantGroupId?: string;
  variantLabel?: string;
  simulationId?: string;
  simulationLabel?: string;
}

export interface CreateImportedPlanOrderItemPayload {
  orderId: string;
  train: ImportedRailMlTrain;
  trafficPeriodId: string;
  namePrefix?: string;
  responsible?: string;
  parentItemId?: string;
  timetableYearLabel?: string;
  tags?: string[];
  composition?: ScheduleTemplate['composition'];
  variantType?: 'productive' | 'simulation';
  variantGroupId?: string;
  variantLabel?: string;
  simulationId?: string;
  simulationLabel?: string;
}

import { OrderItemUpdateData } from './orders/order-item.types';

export interface SplitOrderItemPayload {
  orderId: string;
  itemId: string;
  rangeStart: string; // ISO date (YYYY-MM-DD)
  rangeEnd: string; // ISO date (YYYY-MM-DD)
  updates?: Partial<OrderItemUpdateData>;
  segments?: OrderItemValiditySegment[];
}

@Injectable({ providedIn: 'root' })
export class OrderService {
  private readonly _orders = signal<Order[]>(MOCK_ORDERS);
  private readonly _filters = signal<OrderFilters>({ ...DEFAULT_ORDER_FILTERS });
  private readonly browserStorage = this.detectStorage();
  private readonly variants: OrderVariantsManager;
  private readonly planLinks: OrderPlanLinkManager;
  private readonly planHub: OrderPlanHubHelper;

  constructor(
    private readonly trainPlanService: TrainPlanService,
    private readonly customerService: CustomerService,
    private readonly timetableService: TimetableService,
    private readonly trafficPeriodService: TrafficPeriodService,
    private readonly timetableYearService: TimetableYearService,
    private readonly timetableHubService: TimetableHubService,
  ) {
    this._orders.set(
      this._orders().map((order) => this.initializeOrder(order)),
    );
    this._orders().forEach((order) =>
      order.items.forEach((item) =>
        this.syncTimetableCalendarArtifacts(item.generatedTimetableRefId),
      ),
    );
    const restoredFilters = this.restoreFilters();
    if (restoredFilters) {
      this._filters.set(restoredFilters);
    }
    this.variants = new OrderVariantsManager({
      trainPlanService: this.trainPlanService,
      updateOrder: (orderId, updater) =>
        this._orders.update((orders) => orders.map((ord) => (ord.id === orderId ? updater(ord) : ord))),
      appendItems: (orderId, items) => this.appendItems(orderId, items),
      markSimulationMerged: (orderId, simId, targetId, status) =>
        this.markSimulationMerged(orderId, simId, targetId, status),
      generateItemId: (orderId) => this.generateItemId(orderId),
      applyPlanDetailsToItem: (item, plan) => this.applyPlanDetailsToItem(item, plan),
      linkTrainPlanToItem: (planId, itemId) => this.linkTrainPlanToItem(planId, itemId),
      getOrderById: (orderId) => this.getOrderById(orderId),
    });
    this.planLinks = new OrderPlanLinkManager({
      trainPlanService: this.trainPlanService,
      timetableService: this.timetableService,
      trafficPeriodService: this.trafficPeriodService,
      updateItem: (itemId, updater) => this.updateItem(itemId, updater),
      applyPlanDetailsToItem: (item, plan) => this.applyPlanDetailsToItem(item, plan),
      ensureTimetableForPlan: (plan, item, refOverride) =>
        this.ensureTimetableForPlan(plan, item, refOverride),
      updateItemTimetableMetadata: (itemId, timetable) =>
        this.updateItemTimetableMetadata(itemId, timetable),
      ordersProvider: () => this._orders(),
      buildCalendarVariants: (base, period) => buildCalendarVariants(base, period),
      buildCalendarModifications: (items, period) =>
        buildCalendarModifications(items, period),
      generateTimetableRefId: (plan) => this.generateTimetableRefId(plan),
      getTrafficPeriod: (id) => this.trafficPeriodService.getById(id),
    });
    this.planHub = new OrderPlanHubHelper({
      timetableHubService: this.timetableHubService,
      timetableYearService: this.timetableYearService,
      getItemTimetableYear: (item) => this.getItemTimetableYear(item),
      generateTimetableRefId: (plan) => this.generateTimetableRefId(plan),
    });
  }

  readonly filters = computed(() => this._filters());
  readonly orders = computed(() => this._orders());
  readonly orderItems = computed(() =>
    this._orders().flatMap((order) =>
      order.items.map((item) => ({
        orderId: order.id,
        orderName: order.name,
        item,
      })),
    ),
  );
  readonly orderItemOptions = computed<OrderItemOption[]>(() =>
    this.orderItems().map((entry) => ({
      itemId: entry.item.id,
      orderId: entry.orderId,
      orderName: entry.orderName,
      itemName: entry.item.name,
      type: entry.item.type,
      timetableYearLabel: this.getItemTimetableYear(entry.item),
      serviceType: entry.item.serviceType,
      start: entry.item.start,
      end: entry.item.end,
    })),
  );
  readonly itemTtrPhaseIndex = computed(() => {
    const reference = this._filters().timelineReference;
    const map = new Map<string, OrderTtrPhase>();
    this._orders().forEach((order) => {
      order.items.forEach((item) => {
        map.set(item.id, this.computeTtrPhase(item, reference));
      });
    });
    return { reference, map };
  });

  readonly filteredOrders = computed(() => {
    const filters = this._filters();
    const searchTokens = this.parseSearchTokens(filters.search);
    const itemFiltersActive =
      filters.timeRange !== 'all' ||
      filters.trainStatus !== 'all' ||
      filters.businessStatus !== 'all' ||
      filters.internalStatus !== 'all' ||
      filters.trainNumber.trim() !== '' ||
      filters.timetableYearLabel !== 'all' ||
      filters.ttrPhase !== 'all' ||
      Boolean(filters.fpRangeStart) ||
      Boolean(filters.fpRangeEnd) ||
      Boolean(filters.linkedBusinessId);

    return this._orders().filter((order) => {
      if (!this.matchesOrder(order, filters, searchTokens)) {
        return false;
      }
      const filteredItems = this.filterItemsForOrder(order);
      if (itemFiltersActive && filteredItems.length === 0) {
        return false;
      }
      return true;
    });
  });

  setFilter(patch: Partial<OrderFilters>) {
    this._filters.update((f) => {
      const next = { ...f, ...patch };
      this.persistFilters(next);
      return next;
    });
  }

  clearLinkedBusinessFilter(): void {
    this._filters.update((filters) => {
      const next = { ...filters, linkedBusinessId: null };
      this.persistFilters(next);
      return next;
    });
  }

  hasActiveFilters(snapshot: OrderFilters = this._filters()): boolean {
    return (
      snapshot.search.trim().length > 0 ||
      snapshot.tag !== DEFAULT_ORDER_FILTERS.tag ||
      snapshot.timeRange !== DEFAULT_ORDER_FILTERS.timeRange ||
      snapshot.trainStatus !== DEFAULT_ORDER_FILTERS.trainStatus ||
      snapshot.businessStatus !== DEFAULT_ORDER_FILTERS.businessStatus ||
      snapshot.internalStatus !== DEFAULT_ORDER_FILTERS.internalStatus ||
      snapshot.trainNumber.trim().length > 0 ||
      snapshot.timetableYearLabel !== DEFAULT_ORDER_FILTERS.timetableYearLabel ||
      snapshot.variantType !== DEFAULT_ORDER_FILTERS.variantType ||
      snapshot.linkedBusinessId !== DEFAULT_ORDER_FILTERS.linkedBusinessId ||
      snapshot.fpRangeStart !== DEFAULT_ORDER_FILTERS.fpRangeStart ||
      snapshot.fpRangeEnd !== DEFAULT_ORDER_FILTERS.fpRangeEnd ||
      snapshot.timelineReference !== DEFAULT_ORDER_FILTERS.timelineReference ||
      snapshot.ttrPhase !== DEFAULT_ORDER_FILTERS.ttrPhase
    );
  }

  getOrderById(orderId: string): Order | undefined {
    return this._orders().find((order) => order.id === orderId);
  }

  getOrderItemById(itemId: string): OrderItem | undefined {
    for (const order of this._orders()) {
      const match = order.items.find((item) => item.id === itemId);
      if (match) {
        return match;
      }
    }
    return undefined;
  }

  filterItemsForOrder(order: Order): OrderItem[] {
    const filters = this._filters();
    return order.items.filter((item) =>
      matchesItem(item, filters, {
        timetableService: this.timetableService,
        trainPlanService: this.trainPlanService,
        getItemTimetableYear: (it) => this.getItemTimetableYear(it),
        resolveReferenceDate: (it, reference) => this.resolveReferenceDate(it, reference),
        computeTtrPhase: (it, reference, override) =>
          this.computeTtrPhase(it, reference, override),
      }),
    );
  }

  getItemReferenceDate(
    itemOrId: OrderItem | string,
    reference?: OrderTimelineReference,
  ): Date | null {
    const item = typeof itemOrId === 'string' ? this.getOrderItemById(itemOrId) : itemOrId;
    if (!item) {
      return null;
    }
    return this.resolveReferenceDate(item, reference ?? this._filters().timelineReference);
  }

  getTtrPhaseForItem(
    item: OrderItem,
    reference?: OrderTimelineReference,
  ): OrderTtrPhase {
    if (reference) {
      return this.computeTtrPhase(item, reference);
    }
    const cache = this.itemTtrPhaseIndex();
    if (cache.map.has(item.id)) {
      return cache.map.get(item.id)!;
    }
    return this.computeTtrPhase(item, cache.reference);
  }

  getTtrPhaseMeta(phase: OrderTtrPhase): OrderTtrPhaseMeta {
    return TTR_PHASE_META[phase] ?? TTR_PHASE_META.unknown;
  }

  createOrder(payload: CreateOrderPayload): Order {
    const id = payload.id?.trim().length ? payload.id.trim() : this.generateOrderId();
    const customerId = payload.customerId;
    const customerName = this.resolveCustomerName(customerId, payload.customer);
    const timetableYearLabel = normalizeTimetableYearLabel(
      payload.timetableYearLabel,
      this.timetableYearService,
    );
    const order: Order = {
      id,
      name: payload.name,
      customerId,
      customer: customerName,
      tags: normalizeTags(payload.tags),
      comment: payload.comment,
      items: [],
      timetableYearLabel,
      processStatus: 'auftrag',
    };

    this._orders.update((orders) => [order, ...orders]);
    return order;
  }

  removeCustomerAssignments(customerId: string) {
    if (!customerId) {
      return;
    }
    this._orders.update((orders) =>
      orders.map((order) => {
        if (order.customerId !== customerId) {
          return order;
        }
        const next: Order = {
          ...order,
          customerId: undefined,
          customer: undefined,
        };
        return next;
      }),
    );
  }

  addServiceOrderItem(payload: CreateServiceOrderItemPayload): OrderItem {
    const serviceType = payload.serviceType.trim();
    const name =
      payload.name?.trim() && payload.name.trim().length > 0
        ? payload.name.trim()
        : serviceType;
    const timetableYearLabel =
      normalizeTimetableYearLabel(payload.timetableYearLabel, this.timetableYearService) ??
      this.timetableYearService.getYearBounds(payload.start).label;
    this.ensureOrderTimetableYear(payload.orderId, timetableYearLabel);

    const tags = normalizeTags(payload.tags);
    const item: OrderItem = {
      id: this.generateItemId(payload.orderId),
      name,
      type: 'Leistung',
      tags,
      serviceType,
      fromLocation: payload.fromLocation,
      toLocation: payload.toLocation,
      start: payload.start,
      end: payload.end,
      trafficPeriodId: payload.trafficPeriodId,
      responsible: payload.responsible,
      deviation: payload.deviation,
      timetableYearLabel,
    };

    this.appendItems(payload.orderId, [item]);
    return item;
  }

  addPlanOrderItems(payload: CreatePlanOrderItemsPayload) {
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
      planTrafficPeriodId = this.createTrafficPeriodForPlanDates(
        orderId,
        namePrefix,
        effectiveCalendarDates,
        timetableYearLabel,
        planConfig.responsibleRu ?? responsible,
      );
    }

    const plans = this.trainPlanService.createPlansFromTemplate({
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
    const enrichedPlans =
      planTrafficPeriodId && planTrafficPeriodId.length
        ? plans
        : plans.map((plan) =>
            this.ensurePlanHasTrafficPeriod(plan, namePrefix ?? plan.title),
          );
    const normalizedYearLabel =
      normalizeTimetableYearLabel(timetableYearLabel, this.timetableYearService) ??
      timetableYearFromPlan(enrichedPlans[0] ?? plans[0], this.timetableYearService);
    if (!normalizedYearLabel) {
      throw new Error('Fahrplanjahr konnte nicht ermittelt werden.');
    }
    this.ensureOrderTimetableYear(orderId, normalizedYearLabel);

    const items: OrderItem[] = enrichedPlans.map((plan, index) => {
      const basePrefix = namePrefix?.trim() ?? plan.title;
      const itemName =
        enrichedPlans.length > 1 ? `${basePrefix} #${index + 1}` : basePrefix;
      const base: OrderItem = {
        id: this.generateItemId(orderId),
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

      const enriched = this.applyPlanDetailsToItem(base, plan);
      const timetable = this.ensureTimetableForPlan(plan, enriched);
      return this.withTimetableMetadata(enriched, timetable);
    });

    this.appendItems(orderId, items);

    items.forEach((item, index) => {
      const plan = enrichedPlans[index];
      this.linkTrainPlanToItem(plan.id, item.id);
    });

    return items;
  }

  addManualPlanOrderItem(payload: CreateManualPlanOrderItemPayload): OrderItem {
    if (!payload.stops.length) {
      throw new Error('Der Fahrplan benötigt mindestens einen Halt.');
    }

    const stopPayloads = payload.stops.map((stop) =>
      this.manualStopToTemplatePayload(stop),
    );
    const responsible =
      payload.responsible?.trim() && payload.responsible.trim().length
        ? payload.responsible.trim()
        : 'Manuelle Planung';
    const title =
      payload.name?.trim() && payload.name.trim().length
        ? payload.name.trim()
        : `Manueller Fahrplan ${payload.trainNumber}`;

    const plan = this.trainPlanService.createManualPlan({
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
      normalizeTimetableYearLabel(payload.timetableYearLabel, this.timetableYearService) ??
      timetableYearFromPlan(plan, this.timetableYearService);
    if (!timetableYearLabel) {
      throw new Error('Fahrplanjahr konnte nicht bestimmt werden.');
    }
    this.ensureOrderTimetableYear(payload.orderId, timetableYearLabel);

    const tags = normalizeTags(payload.tags);
    const base: OrderItem = {
      id: this.generateItemId(payload.orderId),
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
    const item = this.applyPlanDetailsToItem(base, plan);
    const timetable = this.ensureTimetableForPlan(plan, item);
    const enriched = this.withTimetableMetadata(item, timetable);

    this.appendItems(payload.orderId, [enriched]);
    this.linkTrainPlanToItem(plan.id, enriched.id);
    return enriched;
  }

  addImportedPlanOrderItem(payload: CreateImportedPlanOrderItemPayload): OrderItem {
    const departureIso = payload.train.departureIso;
    if (!departureIso) {
      throw new Error(`Zug ${payload.train.name} enthält keine Abfahrtszeit.`);
    }

    const responsible = payload.responsible ?? 'RailML Import';

    const plan = this.trainPlanService.createManualPlan({
      title: payload.train.name,
      trainNumber: payload.train.number,
      responsibleRu: responsible,
      departure: departureIso,
      stops: payload.train.stops,
      sourceName: payload.train.category ?? 'RailML',
      notes: undefined,
      templateId: undefined,
      trafficPeriodId: payload.trafficPeriodId,
      composition: payload.composition,
      planVariantType: payload.variantType ?? 'productive',
      variantLabel: payload.variantLabel,
      simulationId: payload.simulationId,
      simulationLabel: payload.simulationLabel,
    });
    const timetableYearLabel =
      normalizeTimetableYearLabel(payload.timetableYearLabel, this.timetableYearService) ??
      payload.train.timetableYearLabel ??
      getTrafficPeriodTimetableYear(
        payload.trafficPeriodId,
        this.trafficPeriodService,
        this.timetableYearService,
      ) ??
      timetableYearFromPlan(plan, this.timetableYearService);
    if (!timetableYearLabel) {
      throw new Error('Fahrplanjahr konnte nicht bestimmt werden.');
    }
    this.ensureOrderTimetableYear(payload.orderId, timetableYearLabel);

    const firstStop = plan.stops[0];
    const lastStop = plan.stops[plan.stops.length - 1];

    const namePrefix = payload.namePrefix?.trim();
    const tags = normalizeTags(payload.tags);
    const itemName = namePrefix ? `${namePrefix} ${payload.train.name}` : payload.train.name;
    const base: OrderItem = {
      id: this.generateItemId(payload.orderId),
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

    const item = this.applyPlanDetailsToItem(
      {
        ...base,
        fromLocation: firstStop?.locationName ?? payload.train.start,
        toLocation: lastStop?.locationName ?? payload.train.end,
      },
      plan,
    );
    const timetable = this.ensureTimetableForPlan(plan, item);
    const enriched = this.withTimetableMetadata(item, timetable);

    this.appendItems(payload.orderId, [enriched]);
    this.linkTrainPlanToItem(plan.id, enriched.id);
    return enriched;
  }

  applyPlanModification(payload: {
    orderId: string;
    itemId: string;
    plan: TrainPlan;
  }): void {
    const { orderId, itemId, plan } = payload;

    this._orders.update((orders) =>
      orders.map((order) => {
        if (order.id !== orderId) {
          return order;
        }

        const items = order.items.map((item) => {
          if (item.id !== itemId) {
            return item;
          }

          const base: OrderItem = {
            ...item,
            linkedTrainPlanId: plan.id,
          } satisfies OrderItem;

          return this.applyPlanDetailsToItem(base, plan);
        });

        return { ...order, items } satisfies Order;
      }),
    );

    this.trainPlanService.linkOrderItem(plan.id, itemId);
    const updatedOrder = this.getOrderById(orderId);
    const updatedItem =
      updatedOrder?.items.find((entry) => entry.id === itemId) ?? null;
    if (updatedItem) {
      const section = this.resolveHubSectionForItem(updatedItem);
      this.planHub.publishPlanToHub(plan, updatedItem, section);
    }
  }

  splitOrderItem(
    payload: SplitOrderItemPayload,
  ): { created: OrderItem; original: OrderItem } {
    const rangeStart = normalizeDateInput(payload.rangeStart);
    const rangeEnd = normalizeDateInput(payload.rangeEnd);
    if (!rangeStart || !rangeEnd) {
      throw new Error('Ungültiger Datumsbereich.');
    }
    if (rangeStart > rangeEnd) {
      throw new Error('Das Startdatum darf nicht nach dem Enddatum liegen.');
    }

    type SplitResult = { created: OrderItem; original: OrderItem };
    let result: SplitResult | null = null;

    this._orders.update((orders) =>
      orders.map((order) => {
        if (order.id !== payload.orderId) {
          return order;
        }

        const targetIndex = order.items.findIndex(
          (item) => item.id === payload.itemId,
        );
        if (targetIndex === -1) {
          throw new Error(
            `Auftragsposition ${payload.itemId} wurde im Auftrag ${order.id} nicht gefunden.`,
          );
        }

        const target = this.ensureItemDefaults(order.items[targetIndex]);
        let validity = resolveEffectiveValidity(
          target,
          this.trafficPeriodService,
          this.timetableYearService,
        );
        const timetableYearBounds = resolveTimetableYearBoundsForItem(
          target,
          this.trafficPeriodService,
          this.timetableYearService,
          (it) => this.getItemTimetableYear(it),
        );

        const customSegments = payload.segments?.length
          ? prepareCustomSegments(payload.segments)
          : null;

    if (customSegments) {
      const withinValidity = segmentsWithinRanges(validity, customSegments);
      if (!withinValidity) {
        if (
          timetableYearBounds &&
          segmentsWithinYearBounds(customSegments, timetableYearBounds, this.timetableYearService)
        ) {
          validity = [
            { startDate: timetableYearBounds.startIso, endDate: timetableYearBounds.endIso },
          ];
        } else {
          ensureSegmentsWithinValidity(validity, customSegments);
        }
      }
    }

    const { retained, extracted } = customSegments
      ? {
          retained: subtractSegments(validity, customSegments),
          extracted: customSegments,
        }
      : splitSegments(validity, rangeStart, rangeEnd);

        if (!extracted.length) {
          throw new Error(
            'Die ausgewählten Tage überschneiden sich nicht mit der Auftragsposition.',
          );
        }

        ensureNoSiblingConflict(order.items, target, extracted);

        const childId = this.generateItemId(order.id);
        const preparedUpdates = prepareUpdatePayload(payload.updates);

        let child: OrderItem = applyUpdatesToItem(
          {
            ...target,
            id: childId,
            validity: extracted,
            parentItemId: target.id,
            childItemIds: [],
          },
          preparedUpdates,
        );

        child = this.cleanupChildAfterSplit(child, preparedUpdates);

        if (preparedUpdates.linkedTrainPlanId) {
          const linkedPlan = this.trainPlanService.getById(
            preparedUpdates.linkedTrainPlanId,
          );
          if (linkedPlan) {
            const planStart = extractPlanStart(linkedPlan);
            const planEnd = extractPlanEnd(linkedPlan);
            if (planStart) {
              child.start = planStart;
            }
            if (planEnd) {
              child.end = planEnd;
            }
          }
        }

        const updatedOriginal: OrderItem = {
          ...target,
          validity: retained,
          childItemIds: [...(target.childItemIds ?? []), childId],
        };

        const nextItems = [...order.items];
        nextItems[targetIndex] = updatedOriginal;
        nextItems.push(child);

        const normalizedItems = this.normalizeItemsAfterChange(nextItems);

        const normalizedChild =
          normalizedItems.find((item) => item.id === childId) ?? child;
        const normalizedOriginal =
          normalizedItems.find((item) => item.id === target.id) ?? updatedOriginal;

        result = { created: normalizedChild, original: normalizedOriginal };

        if (target.trafficPeriodId) {
          this.applyCalendarExclusions(target.trafficPeriodId, extracted);
        }

        return { ...order, items: normalizedItems };
      }),
    );

    if (!result) {
      throw new Error(
        `Der Split der Auftragsposition ${payload.itemId} konnte nicht durchgeführt werden.`,
      );
    }

    const resultNonNull = result as SplitResult;
    const { created, original } = resultNonNull;
    const refId =
      created.generatedTimetableRefId ?? original.generatedTimetableRefId;
    this.syncTimetableCalendarArtifacts(refId);

    return resultNonNull;
  }

  updateOrderItemInPlace(params: {
    orderId: string;
    itemId: string;
    updates?: Partial<OrderItemUpdateData>;
    forceSyncTimetable?: boolean;
  }): OrderItem {
    const { orderId, itemId, updates, forceSyncTimetable } = params;
    const order = this.getOrderById(orderId);
    const current = order?.items.find((entry) => entry.id === itemId);
    if (!current) {
      throw new Error(`Auftragsposition ${itemId} wurde im Auftrag ${orderId} nicht gefunden.`);
    }
    const hasUpdates = !!(updates && Object.keys(updates).length);
    if (!hasUpdates && !forceSyncTimetable) {
      return current;
    }

    let updatedItem = current;
    if (hasUpdates && updates) {
      const { linkedTrainPlanId, ...rest } = updates;
      if (Object.keys(rest).length) {
    this.updateItem(itemId, (item) => applyUpdatesToItem(item, rest));
      }

      updatedItem =
        this.getOrderById(orderId)?.items.find((entry) => entry.id === itemId) ?? current;

      if (
        linkedTrainPlanId &&
        linkedTrainPlanId.trim().length &&
        linkedTrainPlanId !== updatedItem.linkedTrainPlanId
      ) {
        this.linkTrainPlanToItem(linkedTrainPlanId, itemId);
        updatedItem =
          this.getOrderById(orderId)?.items.find((entry) => entry.id === itemId) ?? updatedItem;
      }
    }

    if (
      updatedItem.type === 'Fahrplan' &&
      (forceSyncTimetable || hasUpdates)
    ) {
      this.syncTimetableCalendarArtifacts(updatedItem.generatedTimetableRefId);
    }

    return this.ensureItemDefaults(updatedItem);
  }

  createPlanVersionFromSplit(parent: OrderItem, child: OrderItem): void {
    const basePlanId = parent.linkedTrainPlanId ?? child.linkedTrainPlanId;
    if (!basePlanId) {
      return;
    }
    const basePlan = this.trainPlanService.getById(basePlanId);
    if (!basePlan) {
      return;
    }
    const calendar = this.deriveCalendarForChild(child, basePlan);
    const stops: PlanModificationStopInput[] = basePlan.stops.map((stop, index) => ({
      sequence: stop.sequence ?? index + 1,
      type: stop.type,
      locationCode: stop.locationCode ?? `LOC-${index + 1}`,
      locationName: stop.locationName ?? stop.locationCode ?? `LOC-${index + 1}`,
      countryCode: stop.countryCode,
      arrivalTime: stop.arrivalTime,
      departureTime: stop.departureTime,
      arrivalOffsetDays: stop.arrivalOffsetDays,
      departureOffsetDays: stop.departureOffsetDays,
      dwellMinutes: stop.dwellMinutes,
      activities: stop.activities?.length ? [...stop.activities] : ['0001'],
      platform: stop.platform,
      notes: stop.notes,
    }));

    const plan = this.trainPlanService.createPlanModification({
      originalPlanId: basePlan.id,
      title: child.name ?? basePlan.title,
      trainNumber: basePlan.trainNumber,
      responsibleRu: child.responsible ?? basePlan.responsibleRu,
      notes: basePlan.notes,
      trafficPeriodId: basePlan.trafficPeriodId ?? undefined,
      calendar,
      stops,
      rollingStock: basePlan.rollingStock,
    });

    this.linkTrainPlanToItem(plan.id, child.id);
  }

  private cleanupChildAfterSplit(
    child: OrderItem,
    updates: Partial<OrderItemUpdateData>,
  ): OrderItem {
    const next: OrderItem = { ...child };
    if (!updates.linkedTemplateId) {
      delete next.linkedTemplateId;
    }
    delete next.linkedBusinessIds;
    if (next.type === 'Fahrplan' && !updates.trafficPeriodId) {
      delete next.trafficPeriodId;
    }
    return next;
  }

  private matchesOrder(
    order: Order,
    filters: OrderFilters,
    tokens: OrderSearchTokens,
  ): boolean {
    const aggregatedTags = this.collectOrderAndItemTags(order);
    if (filters.tag !== 'all' && !aggregatedTags.includes(filters.tag)) {
      return false;
    }
    if (tokens.tags.length && !this.hasAllTags(aggregatedTags, tokens.tags)) {
      return false;
    }
    if (filters.timetableYearLabel !== 'all') {
      if (order.timetableYearLabel) {
        if (order.timetableYearLabel !== filters.timetableYearLabel) {
          return false;
        }
      } else {
        const matchesYear = order.items.some(
          (item) => this.getItemTimetableYear(item) === filters.timetableYearLabel,
        );
        if (!matchesYear) {
          return false;
        }
      }
    }
    if (tokens.responsibles.length) {
      const hasResponsible = order.items.some((item) => {
        if (!item.responsible) {
          return false;
        }
        const lower = item.responsible.toLowerCase();
        return tokens.responsibles.some((term) => lower.includes(term));
      });
      if (!hasResponsible) {
        return false;
      }
    }
    if (tokens.customers.length) {
      const customer = (order.customer ?? '').toLowerCase();
      const matchesCustomer = tokens.customers.some((term) =>
        customer.includes(term),
      );
      if (!matchesCustomer) {
        return false;
      }
    }
    if (tokens.textTerms.length) {
      const haystack = `
        ${order.name}
        ${order.id}
        ${order.customer ?? ''}
        ${order.comment ?? ''}
        ${order.tags?.join(' ') ?? ''}
        ${order.items.map((item) => this.buildItemSearchHaystack(item)).join(' ')}
      `.toLowerCase();
      const hasAll = tokens.textTerms.every((term) => haystack.includes(term));
      if (!hasAll) {
        return false;
      }
    }
    return true;
  }

  private buildItemSearchHaystack(item: OrderItem): string {
    const timetable = item.originalTimetable;
    const timetableStops =
      timetable?.stops?.map((stop) => stop.locationName).join(' ') ?? '';
    const timetableVariants =
      timetable?.variants
        ?.map(
          (variant) =>
            `${variant.variantNumber ?? variant.id ?? ''} ${variant.description ?? ''}`,
        )
        .join(' ') ?? '';
    const timetableModifications =
      timetable?.modifications
        ?.map((modification) => `${modification.date} ${modification.description ?? ''}`)
        .join(' ') ?? '';
    const validitySegments =
      item.validity
        ?.map((segment) => `${segment.startDate} ${segment.endDate}`)
        .join(' ') ?? '';
    const timetableYear = this.getItemTimetableYear(item);

    const fields = [
      item.id,
      item.name,
      item.type,
      item.serviceType,
      item.responsible,
      item.deviation,
      item.fromLocation,
      item.toLocation,
      item.start,
      item.end,
      timetableYear ?? '',
      item.timetableYearLabel ?? '',
      item.timetablePhase ?? '',
      item.linkedBusinessIds?.join(' ') ?? '',
      item.tags?.join(' ') ?? '',
      timetable?.refTrainId ?? '',
      timetable?.trainNumber ?? '',
      timetable?.title ?? '',
      timetableStops,
      timetableVariants,
      timetableModifications,
      validitySegments,
    ];

    return fields
      .filter((value): value is string => !!value && value.trim().length > 0)
      .join(' ');
  }

  private deriveCalendarForChild(
    child: OrderItem,
    plan: TrainPlan,
  ): TrainPlan['calendar'] {
    const segments = resolveValiditySegments(child);
    const firstSegment = segments[0];
    const lastSegment = segments[segments.length - 1] ?? firstSegment;
    const fallbackStart =
      child.start?.slice(0, 10) ??
      plan.calendar.validFrom ??
      child.end?.slice(0, 10) ??
      new Date().toISOString().slice(0, 10);
    const fallbackEnd =
      child.end?.slice(0, 10) ??
      plan.calendar.validTo ??
      fallbackStart;

    const validFrom = firstSegment?.startDate ?? fallbackStart;
    const validTo = lastSegment?.endDate ?? fallbackEnd;
    const daysBitmap =
      plan.calendar.daysBitmap ?? buildDaysBitmapFromValidity(segments, validFrom, validTo);

    return {
      validFrom,
      validTo,
      daysBitmap,
    };
  }

  private applyCalendarExclusions(
    trafficPeriodId: string,
    segments: OrderItemValiditySegment[],
  ) {
    const dates = expandSegmentsToDates(segments);
    if (!dates.length) {
      return;
    }
    this.trafficPeriodService.addExclusionDates(trafficPeriodId, dates);
  }

  private resolveReferenceDate(
    item: OrderItem,
    reference: OrderTimelineReference,
  ): Date | null {
    return resolveReferenceDate(item, reference, (it) =>
      resolveTimetableYearStart(
        it,
        this.timetableYearService,
        (entity) => this.getItemTimetableYear(entity),
        (entity) => extractReferenceSampleDate(entity),
      ),
    );
  }

  private computeTtrPhase(
    item: OrderItem,
    reference: OrderTimelineReference,
    referenceDateOverride?: Date | null,
  ): OrderTtrPhase {
    const referenceDate =
      referenceDateOverride ?? this.resolveReferenceDate(item, reference);
    if (!referenceDate) {
      return 'unknown';
    }
    const today = startOfDay(new Date());
    const diffDays = Math.floor((referenceDate.getTime() - today.getTime()) / DAY_IN_MS);
    if (Number.isNaN(diffDays)) {
      return 'unknown';
    }
    if (diffDays >= 210) {
      return 'annual_request';
    }
    if (diffDays >= 120) {
      return 'final_offer';
    }
    if (diffDays >= 21) {
      return 'rolling_planning';
    }
    if (diffDays >= 7) {
      return 'short_term';
    }
    if (diffDays >= 0) {
      return 'ad_hoc';
    }
    return 'operational_delivery';
  }

  linkBusinessToItem(businessId: string, itemId: string) {
    this.updateItem(itemId, (item) => {
      const ids = new Set(item.linkedBusinessIds ?? []);
      if (ids.has(businessId)) {
        return item;
      }
      ids.add(businessId);
      return { ...item, linkedBusinessIds: Array.from(ids) };
    });
  }

  unlinkBusinessFromItem(businessId: string, itemId: string) {
    this.updateItem(itemId, (item) => {
      const ids = new Set(item.linkedBusinessIds ?? []);
      if (!ids.has(businessId)) {
        return item;
      }
      ids.delete(businessId);
      const next = Array.from(ids);
      return {
        ...item,
        linkedBusinessIds: next.length ? next : undefined,
      };
    });
  }

  setItemTimetablePhase(itemId: string, phase: TimetablePhase): void {
    this.updateItem(itemId, (item) => ({ ...item, timetablePhase: phase }));
  }

  setItemInternalStatus(itemId: string, status: InternalProcessingStatus | null): void {
    this.updateItem(itemId, (item) => {
      if (!status) {
        const next = { ...item };
        delete next.internalStatus;
        return next;
      }
      return { ...item, internalStatus: status };
    });
  }

  setOrderProcessStatus(orderId: string, status: OrderProcessStatus): void {
    this._orders.update((orders) =>
      orders.map((order) =>
        order.id === orderId ? { ...order, processStatus: status } : order,
      ),
    );
  }

  /**
   * Ermittelt alle Fahrplan-Positionen eines Auftrags, die noch nicht im Status „Booked“ sind.
   * Im Mock wird hierfür die Timetable-Phase der Position verwendet.
   */
  getItemsMissingBookedStatus(orderId: string): OrderItem[] {
    const order = this.getOrderById(orderId);
    if (!order) {
      return [];
    }
    return order.items.filter((item) => {
      if (item.type !== 'Fahrplan') {
        return false;
      }
      return item.timetablePhase !== 'contract';
    });
  }

  private detectStorage(): Storage | null {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return null;
      }
      return window.localStorage;
    } catch {
      return null;
    }
  }

  private restoreFilters(): OrderFilters | null {
    if (!this.browserStorage) {
      return null;
    }
    try {
      const raw = this.browserStorage.getItem(ORDER_FILTERS_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as Partial<OrderFilters>;
      return { ...DEFAULT_ORDER_FILTERS, ...parsed };
    } catch {
      return null;
    }
  }

  private persistFilters(filters: OrderFilters): void {
    if (!this.browserStorage) {
      return;
    }
    try {
      this.browserStorage.setItem(ORDER_FILTERS_STORAGE_KEY, JSON.stringify(filters));
    } catch {
      // ignore persistence issues
    }
  }

  linkTemplateToItem(templateId: string, itemId: string) {
    this.updateItem(itemId, (item) => {
      if (item.linkedTemplateId === templateId) {
        return item;
      }
      return { ...item, linkedTemplateId: templateId };
    });
  }

  unlinkTemplateFromItem(templateId: string, itemId: string) {
    this.updateItem(itemId, (item) => {
      if (item.linkedTemplateId !== templateId) {
        return item;
      }
      const next = { ...item };
      delete next.linkedTemplateId;
      return next;
    });
  }

  linkTrainPlanToItem(planId: string, itemId: string) {
    this.planLinks.linkTrainPlanToItem(planId, itemId);
  }

  unlinkTrainPlanFromItem(planId: string, itemId: string) {
    this.planLinks.unlinkTrainPlanFromItem(planId, itemId);
  }

  createSimulationVariant(orderId: string, itemId: string, label?: string): OrderItem | null {
    return this.variants.createSimulationVariant(orderId, itemId, label);
  }

  promoteSimulationToProductive(orderId: string, variantItemId: string): OrderItem | null {
    return this.variants.promoteSimulationToProductive(orderId, variantItemId);
  }

  mergeSimulationIntoProductive(orderId: string, simulationItemId: string): OrderVariantMergeResult {
    return this.variants.mergeSimulationIntoProductive(orderId, simulationItemId);
  }

  submitOrderItems(orderId: string, itemIds: string[]): void {
    if (!itemIds.length) {
      return;
    }
    const targetIds = new Set(itemIds);
    this._orders.update((orders) =>
      orders.map((order) => {
        if (order.id !== orderId) {
          return order;
        }
        const items = order.items.map((item) => {
          if (!targetIds.has(item.id)) {
            return item;
          }
          if (item.variantType === 'simulation') {
            return item;
          }
          if (item.generatedTimetableRefId) {
            this.timetableService.updateStatus(item.generatedTimetableRefId, 'path_request');
          }
          return {
            ...item,
            timetablePhase: 'path_request' as TimetablePhase,
          };
        });
        return { ...order, items };
      }),
    );
  }

  private appendItems(orderId: string, items: OrderItem[]) {
    if (!items.length) {
      return;
    }
    let updated = false;
    this._orders.update((orders) =>
      orders.map((order) => {
        if (order.id !== orderId) {
          return order;
        }
        updated = true;
        const prepared = this.prepareItemsForInsertion(items);
        return {
          ...order,
          items: normalizeItemsAfterChange([...order.items, ...prepared]),
        };
      }),
    );

    if (!updated) {
      throw new Error(`Auftrag ${orderId} nicht gefunden`);
    }
  }

  private prepareItemsForInsertion(items: OrderItem[]): OrderItem[] {
    return items.map((item) => ensureItemDefaults(item));
  }

  private initializeOrder(order: Order): Order {
    const prepared = order.items.map((item) => ensureItemDefaults(item));
    const customer = this.resolveCustomerName(order.customerId, order.customer);
    const timetableYearLabel =
      order.timetableYearLabel ??
      deriveOrderTimetableYear(prepared, (item) => this.getItemTimetableYear(item)) ??
      undefined;
    const processStatus: OrderProcessStatus =
      order.processStatus ??
      (prepared.length ? 'planung' : 'auftrag');
    return {
      ...order,
      customer,
      timetableYearLabel,
      processStatus,
      items: normalizeItemsAfterChange(prepared),
    };
  }

  private matchesCustomerTerm(order: Order, term: string): boolean {
    const normalized = term.trim().toLowerCase();
    if (!normalized.length) {
      return true;
    }
    const customer = this.customerService.getById(order.customerId);
    if (!customer) {
      return order.customer?.toLowerCase().includes(normalized) ?? false;
    }
    const attributes: Array<string | undefined> = [
      customer.name,
      customer.customerNumber,
      customer.projectNumber,
      order.customer,
    ];
    if (
      attributes
        .filter((value): value is string => !!value)
        .some((value) => value.toLowerCase().includes(normalized))
    ) {
      return true;
    }
    return customer.contacts.some((contact) =>
      [contact.name, contact.email, contact.phone]
        .filter((value): value is string => !!value)
        .some((value) => value.toLowerCase().includes(normalized)),
    );
  }

  private hasAllTags(source: string[], required: string[]): boolean {
    if (!required.length) {
      return true;
    }
    return required.every((tag) =>
      source.some((existing) => existing.toLowerCase() === tag.toLowerCase()),
    );
  }

  private collectOrderAndItemTags(order: Order): string[] {
    const tags = new Set<string>();
    order.tags?.forEach((tag) => tags.add(tag));
    order.items.forEach((item) => {
      item.tags?.forEach((tag) => tags.add(tag));
    });
    return Array.from(tags);
  }

  private parseSearchTokens(search: string): OrderSearchTokens {
    return parseSearchTokens(search);
  }

  private resolveCustomerName(
    customerId: string | undefined,
    fallback?: string,
  ): string | undefined {
    if (customerId) {
      const customer = this.customerService.getById(customerId);
      if (customer) {
        return customer.name;
      }
    }
    const trimmed = fallback?.trim();
    return trimmed?.length ? trimmed : undefined;
  }

  private ensureItemDefaults(item: OrderItem): OrderItem {
    const validity =
      item.validity && item.validity.length
        ? normalizeSegments(item.validity)
        : deriveDefaultValidity(item);
    const originalTimetable = item.originalTimetable
      ? {
          ...item.originalTimetable,
          calendar: { ...item.originalTimetable.calendar },
          stops: [...(item.originalTimetable.stops ?? [])].map((stop) => ({
            ...stop,
          })),
        }
      : undefined;

    return {
      ...item,
      tags: item.tags ? [...item.tags] : undefined,
      validity,
      childItemIds: [...(item.childItemIds ?? [])],
      versionPath: item.versionPath ? [...item.versionPath] : undefined,
      linkedBusinessIds: item.linkedBusinessIds
        ? [...item.linkedBusinessIds]
        : undefined,
      linkedTemplateId: item.linkedTemplateId,
      linkedTrainPlanId: item.linkedTrainPlanId,
      generatedTimetableRefId: item.generatedTimetableRefId,
      timetablePhase: item.timetablePhase,
      originalTimetable,
    };
  }

  private normalizeItemsAfterChange(items: OrderItem[]): OrderItem[] {
    const itemMap = new Map<string, OrderItem>();
    items.forEach((item) => {
      const defaults = this.ensureItemDefaults(item);
      itemMap.set(defaults.id, defaults);
    });

    // Reset child references to avoid duplicates.
    itemMap.forEach((item) => {
      item.childItemIds = [];
    });
    itemMap.forEach((item) => {
      if (!item.parentItemId) {
        return;
      }
      const parent = itemMap.get(item.parentItemId);
      if (!parent) {
        return;
      }
      parent.childItemIds = parent.childItemIds ?? [];
      if (!parent.childItemIds.includes(item.id)) {
        parent.childItemIds.push(item.id);
      }
    });

    const result: OrderItem[] = Array.from(itemMap.values());

    // Assign version paths depth-first, preserving original ordering as much as possible.
    const inputOrder = items.map((item) => item.id);
    const roots = inputOrder
      .map((id) => itemMap.get(id))
      .filter((item): item is OrderItem => !!item && !item.parentItemId);

    roots.forEach((root) => {
      this.assignVersionPath(root, [1], itemMap, inputOrder);
    });

    const orphans = inputOrder
      .map((id) => itemMap.get(id))
      .filter(
        (item): item is OrderItem =>
          !!item &&
          !!item.parentItemId &&
          !itemMap.has(item.parentItemId),
      );
    orphans.forEach((orphan) => {
      this.assignVersionPath(orphan, [1], itemMap, inputOrder);
    });

    return result;
  }

  private assignVersionPath(
    item: OrderItem,
    path: number[],
    itemMap: Map<string, OrderItem>,
    inputOrder: string[],
  ) {
    item.versionPath = [...path];
    const childrenIds = [...(item.childItemIds ?? [])].sort((a, b) => {
      const indexA = inputOrder.indexOf(a);
      const indexB = inputOrder.indexOf(b);
      const safeA = indexA === -1 ? Number.MAX_SAFE_INTEGER : indexA;
      const safeB = indexB === -1 ? Number.MAX_SAFE_INTEGER : indexB;
      return safeA - safeB;
    });
    let childCounter = 1;
    childrenIds.forEach((childId) => {
      const child = itemMap.get(childId);
      if (!child) {
        return;
      }
      const existingChildNumber =
        child.versionPath && child.versionPath.length === path.length + 1
          ? child.versionPath[path.length]
          : undefined;
      let nextIndex: number;
      if (typeof existingChildNumber === 'number') {
        nextIndex = existingChildNumber;
        childCounter = Math.max(childCounter, existingChildNumber + 1);
      } else {
        nextIndex = childCounter;
        childCounter += 1;
      }
      const nextPath = [...path, nextIndex];
      this.assignVersionPath(child, nextPath, itemMap, inputOrder);
    });
  }



  private generateOrderId(): string {
    return `A-${Date.now().toString(36).toUpperCase()}`;
  }

  private generateItemId(orderId: string): string {
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `${orderId}-OP-${suffix}`;
  }

  private manualStopToTemplatePayload(
    stop: PlanModificationStopInput,
  ): CreateScheduleTemplateStopPayload {
    const arrivalTime = stop.arrivalTime?.trim();
    const departureTime = stop.departureTime?.trim();
    const locationName =
      stop.locationName?.trim() || stop.locationCode?.trim() || 'Unbekannt';
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
      activities:
        stop.activities && stop.activities.length ? [...stop.activities] : ['0001'],
      platformWish: stop.platform,
      notes: stop.notes,
    };
  }

  private applyPlanDetailsToItem(item: OrderItem, plan: TrainPlan): OrderItem {
    const start = extractPlanStart(plan);
    const end = extractPlanEnd(plan);
    const firstStop = plan.stops[0];
    const lastStop = plan.stops[plan.stops.length - 1];

    const updated: OrderItem = {
      ...item,
      responsible: plan.responsibleRu,
      fromLocation: firstStop?.locationName ?? item.fromLocation,
      toLocation: lastStop?.locationName ?? item.toLocation,
      simulationId: plan.simulationId ?? item.simulationId,
      simulationLabel: plan.simulationLabel ?? item.simulationLabel,
    };

    if (start) {
      updated.start = start;
    }
    if (end) {
      updated.end = end;
    }

    if (plan.trafficPeriodId) {
      updated.trafficPeriodId = plan.trafficPeriodId;
      updated.validity = undefined;
    } else if (plan.calendar?.validFrom) {
      updated.trafficPeriodId = undefined;
      const endDate = plan.calendar.validTo ?? plan.calendar.validFrom;
      updated.validity = [
        {
          startDate: plan.calendar.validFrom,
          endDate,
        },
      ];
    } else {
      updated.trafficPeriodId = undefined;
      updated.validity = undefined;
    }

    return updated;
  }

  private createTrafficPeriodForPlanDates(
    orderId: string,
    namePrefix: string | undefined,
    dates: string[],
    timetableYearLabel?: string,
    responsible?: string,
  ): string {
    const normalizedDates = normalizeCalendarDates(dates);
    if (!normalizedDates.length) {
      throw new Error('Referenzkalender enthält keine aktiven Tage.');
    }

    const groupedByYear = normalizedDates.reduce<Map<number, string[]>>(
      (acc: Map<number, string[]>, date: string) => {
        const year = Number.parseInt(date.slice(0, 4), 10);
        const list = acc.get(year);
        if (list) {
          list.push(date);
        } else {
          acc.set(year, [date]);
        }
        return acc;
      },
      new Map<number, string[]>(),
    );

    const sortedYears = Array.from(groupedByYear.keys()).sort(
      (a: number, b: number) => a - b,
    );
    const baseYear =
      sortedYears[0] ?? Number.parseInt(normalizedDates[0].slice(0, 4), 10);
    const calendarName = this.buildPlanCalendarName(orderId, namePrefix);
    const normalizedYearLabel = normalizeTimetableYearLabel(
      timetableYearLabel,
      this.timetableYearService,
    );

    const rules = sortedYears.map((year, index) => ({
      name: `${calendarName} ${year}`,
      year,
      selectedDates: groupedByYear.get(year) ?? [],
      variantType: 'special_day' as const,
      variantNumber: (index + 1).toString().padStart(2, '0'),
      appliesTo: 'both' as const,
      primary: index === 0,
    }));

    const periodId = this.trafficPeriodService.createPeriod({
      name: calendarName,
      type: 'standard',
      description: 'Automatisch erzeugter Referenzkalender aus Serienfahrplan',
      responsible,
      year: baseYear,
      timetableYearLabel: normalizedYearLabel,
      rules,
    });

    if (!periodId) {
      throw new Error('Referenzkalender konnte nicht angelegt werden.');
    }
    return periodId;
  }

  private buildPlanCalendarName(orderId: string, namePrefix?: string): string {
    const order = this.getOrderById(orderId);
    const orderLabel = order?.name ?? orderId;
    if (namePrefix?.trim()) {
      return `${namePrefix.trim()} · ${orderLabel}`;
    }
    return `Serie ${orderLabel}`;
  }

  private ensurePlanHasTrafficPeriod(plan: TrainPlan, baseName: string): TrainPlan {
    const calendarDate =
      plan.calendar?.validFrom ?? plan.calendar?.validTo ?? new Date().toISOString().slice(0, 10);
    const calendarName = `${baseName} ${calendarDate}`;
    const periodId = this.trafficPeriodService.createSingleDayPeriod({
      name: calendarName,
      date: calendarDate,
      variantType: 'series',
      responsible: plan.responsibleRu,
    });
    return this.trainPlanService.assignTrafficPeriod(plan.id, periodId) ?? plan;
  }

  private ensureTimetableForPlan(
    plan: TrainPlan,
    item: OrderItem,
    refTrainIdOverride?: string,
  ): Timetable | null {
    const refTrainId = refTrainIdOverride ?? this.generateTimetableRefId(plan);
    const existing = this.timetableService.getByRefTrainId(refTrainId);
    if (existing) {
      const stops = toTimetableStops(plan.stops);
      let updated = existing;
      if (stops.length >= 2) {
        updated = this.timetableService.replaceStops(refTrainId, stops);
      }
      const calendar = plan.calendar
        ? { ...plan.calendar }
        : {
            validFrom:
              extractPlanStart(plan)?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
            daysBitmap: '1111111',
          };
      updated = this.timetableService.updateCalendar(refTrainId, calendar);
      this.planHub.publishPlanToHub(plan, item, 'commercial');
      return updated;
    }
    const stops = toTimetableStops(plan.stops);
    if (stops.length < 2) {
      return null;
    }
    const calendar = plan.calendar
      ? { ...plan.calendar }
      : {
          validFrom:
            extractPlanStart(plan)?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
          daysBitmap: '1111111',
        };
    const payload = {
      refTrainId,
      opn: this.generateOpn(plan),
      title: plan.title,
      trainNumber: plan.trainNumber,
      responsibleRu: plan.responsibleRu,
      calendar,
      status: 'bedarf',
      source: {
        type: 'manual',
        pathRequestId: plan.pathRequestId,
        externalSystem: 'OrderManager',
      },
      stops,
      linkedOrderItemId: item.id,
      notes: `Automatisch erstellt aus Auftragsposition ${item.id}`,
      rollingStock: plan.rollingStock,
    } as const;

    try {
      const created = this.timetableService.createTimetable(payload);
      this.planHub.publishPlanToHub(plan, item, 'commercial');
      return created;
    } catch (error) {
      console.error('Timetable creation failed', error);
      return null;
    }
  }

  private withTimetableMetadata(
    item: OrderItem,
    timetable: Timetable | null,
  ): OrderItem {
    if (!timetable) {
      return item;
    }
    return {
      ...item,
      generatedTimetableRefId: timetable.refTrainId,
      timetablePhase: timetable.status,
      originalTimetable: this.buildSnapshotFromTimetable(timetable),
    };
  }

  private updateItemTimetableMetadata(itemId: string, timetable: Timetable): void {
    this.updateItem(itemId, (item) => ({
      ...item,
      generatedTimetableRefId: timetable.refTrainId,
      timetablePhase: timetable.status,
      originalTimetable: this.buildSnapshotFromTimetable(timetable),
    }));
  }

  private buildSnapshotFromTimetable(timetable: Timetable): OrderItemTimetableSnapshot {
    return {
      refTrainId: timetable.refTrainId,
      title: timetable.title,
      trainNumber: timetable.trainNumber,
      calendar: {
        validFrom: timetable.calendar.validFrom,
        validTo: timetable.calendar.validTo,
        daysBitmap: timetable.calendar.daysBitmap,
      },
      stops: timetable.stops.map((stop) => ({
        sequence: stop.sequence,
        locationName: stop.locationName,
        arrivalTime: stop.commercial.arrivalTime,
        departureTime: stop.commercial.departureTime,
      })),
      variants: timetable.calendarVariants?.map((variant) => ({
        id: variant.id,
        description: variant.description,
        type: variant.type,
        validFrom: variant.validFrom,
        validTo: variant.validTo,
        daysOfWeek: variant.daysOfWeek,
        dates: variant.dates,
        appliesTo: variant.appliesTo,
        variantNumber: variant.variantNumber ?? variant.id,
        reason: variant.reason,
      })),
      modifications: timetable.calendarModifications?.map((mod) => ({
        date: mod.date,
        description: mod.description,
        type: mod.type,
        notes: mod.notes,
      })),
    };
  }

  private syncTimetableCalendarArtifacts(refTrainId: string | undefined): void {
    this.planLinks.syncTimetableCalendarArtifacts(refTrainId);
  }

  private collectItemsForTimetable(refTrainId: string): OrderItem[] {
    return this._orders().flatMap((order) =>
      order.items.filter((item) => item.generatedTimetableRefId === refTrainId),
    );
  }

  private findBaseItem(items: OrderItem[]): OrderItem | undefined {
    return items.find((item) => !item.parentItemId) ?? items[0];
  }

  private findOrderByItemId(itemId: string): { order: Order; item: OrderItem } | null {
    for (const order of this._orders()) {
      const item = order.items.find((it) => it.id === itemId);
      if (item) {
        return { order, item };
      }
    }
    return null;
  }

  private resolveHubSectionForItem(item: OrderItem): TimetableHubSectionKey {
    if (item.parentItemId) {
      return 'operational';
    }
    const phase = item.timetablePhase ?? 'bedarf';
    switch (phase) {
      case 'operational':
        return 'operational';
      case 'archived':
        return 'actual';
      default:
        return 'commercial';
    }
  }

  private generateTimetableRefId(plan: TrainPlan): string {
    const sanitized = plan.id.replace(/^TP-?/i, '');
    return `TT-${sanitized}`;
  }

  private generateOpn(plan: TrainPlan): string {
    if (plan.pathRequestId) {
      return plan.pathRequestId.replace(/^PR/i, 'OPN');
    }
    return `OPN-${plan.trainNumber}`;
  }

  private updateItem(
    itemId: string,
    updater: (item: OrderItem) => OrderItem,
  ): void {
    this._orders.update((orders) =>
      orders.map((order) => {
        let mutated = false;
        const items = order.items.map((item) => {
          if (item.id !== itemId) {
            return item;
          }
          mutated = true;
          return updater(item);
        });
        return mutated ? { ...order, items } : order;
      }),
    );
  }

  private readonly timetableYearOptionsSignal = computed(() => {
    const labels = new Map<string, number>();
    this.timetableYearService.managedYearBounds().forEach((year) => {
      labels.set(year.label, year.startYear);
    });
    this._orders().forEach((order) =>
      order.items.forEach((item) => {
        const label = this.getItemTimetableYear(item);
        if (label && !labels.has(label)) {
          const bounds = this.timetableYearService.getYearByLabel(label);
          labels.set(label, bounds.startYear);
        }
      }),
    );
    return Array.from(labels.entries())
      .sort((a, b) => a[1] - b[1])
      .map(([label]) => label);
  });

  timetableYearOptions(): string[] {
    return this.timetableYearOptionsSignal();
  }

  getItemTimetableYear(item: OrderItem): string | null {
    if (item.timetableYearLabel) {
      return item.timetableYearLabel;
    }
    if (item.trafficPeriodId) {
      const period = this.trafficPeriodService.getById(item.trafficPeriodId);
      if (period?.timetableYearLabel) {
        return period.timetableYearLabel;
      }
      const sampleDate =
        period?.rules?.find((rule) => rule.includesDates?.length)?.includesDates?.[0] ??
        period?.rules?.[0]?.validityStart;
      if (sampleDate) {
        try {
          return this.timetableYearService.getYearBounds(sampleDate).label;
        } catch {
          return null;
        }
      }
    }
    const sampleDate =
      item.validity?.[0]?.startDate ??
      item.start ??
      item.end ??
      null;
    if (!sampleDate) {
      return null;
    }
    try {
      return this.timetableYearService.getYearBounds(sampleDate).label;
    } catch {
      return null;
    }
  }

  private ensureOrderTimetableYear(orderId: string, label?: string | null) {
    if (!label) {
      return;
    }
    let mismatch: string | null = null;
    let found = false;
    this._orders.update((orders) =>
      orders.map((order) => {
        if (order.id !== orderId) {
          return order;
        }
        found = true;
        if (order.timetableYearLabel && order.timetableYearLabel !== label) {
          mismatch = order.timetableYearLabel;
          return order;
        }
        if (order.timetableYearLabel === label) {
          return order;
        }
        return { ...order, timetableYearLabel: label };
      }),
    );
    if (mismatch) {
      throw new Error(
        `Auftrag ${orderId} gehört zum Fahrplanjahr ${mismatch}. Bitte einen Auftrag für ${label} anlegen oder das vorhandene Fahrplanjahr wählen.`,
      );
    }
    if (!found) {
      throw new Error(`Auftrag ${orderId} wurde nicht gefunden.`);
    }
  }

  private markSimulationMerged(orderId: string, simId: string, targetId: string, status: 'applied' | 'proposed') {
    this.updateItem(simId, (item) => ({
      ...item,
      mergeStatus: status,
      mergeTargetId: targetId,
    }));
  }
}

export {
  DEFAULT_ORDER_FILTERS,
  ORDER_FILTERS_STORAGE_KEY,
  TTR_PHASE_META,
};

export type {
  OrderFilters,
  OrderTimelineReference,
  OrderTtrPhase,
  OrderTtrPhaseFilter,
  OrderTtrPhaseMeta,
  OrderSearchTokens,
  OrderItemUpdateData,
};
