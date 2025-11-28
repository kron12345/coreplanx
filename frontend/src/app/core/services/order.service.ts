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
import {
  TimetableService,
  TimetableStopInput,
} from './timetable.service';
import { TrafficPeriodService } from './traffic-period.service';
import { TrafficPeriod, TrafficPeriodVariantType } from '../models/traffic-period.model';
import { TimetableYearService } from './timetable-year.service';
import {
  TimetableHubService,
  TimetableHubSectionKey,
  TimetableHubStopSummary,
  TimetableHubTechnicalSummary,
  TimetableHubRouteMetadata,
} from './timetable-hub.service';

export type OrderTimelineReference = 'fpDay' | 'operationalDay' | 'fpYear';

export type OrderTtrPhase =
  | 'annual_request'
  | 'final_offer'
  | 'rolling_planning'
  | 'short_term'
  | 'ad_hoc'
  | 'operational_delivery'
  | 'unknown';

export type OrderTtrPhaseFilter =
  | 'all'
  | 'annual_request'
  | 'final_offer'
  | 'rolling_planning'
  | 'short_term'
  | 'ad_hoc'
  | 'operational_delivery';

export interface OrderTtrPhaseMeta {
  key: OrderTtrPhase;
  label: string;
  window: string;
  reference: OrderTimelineReference | 'mixed';
  hint: string;
}

export interface OrderFilters {
  search: string;
  tag: string | 'all';
  timeRange: 'all' | 'next4h' | 'next12h' | 'today' | 'thisWeek';
  trainStatus: TimetablePhase | 'all';
  businessStatus: BusinessStatus | 'all';
   internalStatus: InternalProcessingStatus | 'all';
  trainNumber: string;
  timetableYearLabel: string | 'all';
  linkedBusinessId: string | null;
  fpRangeStart: string | null;
  fpRangeEnd: string | null;
  timelineReference: OrderTimelineReference;
  ttrPhase: OrderTtrPhaseFilter;
}

const ORDER_FILTERS_STORAGE_KEY = 'orders.filters.v2';
const DEFAULT_ORDER_FILTERS: OrderFilters = {
  search: '',
  tag: 'all',
  timeRange: 'all',
  trainStatus: 'all',
  businessStatus: 'all',
  internalStatus: 'all',
  trainNumber: '',
  timetableYearLabel: 'all',
  linkedBusinessId: null,
  fpRangeStart: null,
  fpRangeEnd: null,
  timelineReference: 'fpDay',
  ttrPhase: 'all',
};
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const TTR_PHASE_META: Record<OrderTtrPhase, OrderTtrPhaseMeta> = {
  annual_request: {
    key: 'annual_request',
    label: 'Annual TT Request',
    window: '12–7 Monate vor Fahrplanjahr',
    reference: 'fpDay',
    hint: 'Jahresfahrplanbestellungen erstellen und einreichen.',
  },
  final_offer: {
    key: 'final_offer',
    label: 'Final Offer (ENFP)',
    window: '7–4 Monate vor Fahrplanjahr',
    reference: 'fpDay',
    hint: 'Angebote prüfen, final annehmen oder ablehnen.',
  },
  rolling_planning: {
    key: 'rolling_planning',
    label: 'Rolling Planning',
    window: '13–3 Wochen vor Fahrplantag',
    reference: 'fpDay',
    hint: 'Mittelfristige Zusatz- und Saisonlagen abstimmen.',
  },
  short_term: {
    key: 'short_term',
    label: 'Short-Term',
    window: '30–7 Tage vor Fahrplantag',
    reference: 'fpDay',
    hint: 'Kurzfristige Bedarfe mit schnellen Reaktionsfristen bedienen.',
  },
  ad_hoc: {
    key: 'ad_hoc',
    label: 'Ad-hoc',
    window: '0–7 Tage vor Produktionstag',
    reference: 'operationalDay',
    hint: 'Akute Bedarfe oder Störungen, Reaktion in Minuten/Stunden.',
  },
  operational_delivery: {
    key: 'operational_delivery',
    label: 'Operative Begleitung',
    window: 'laufender Betrieb',
    reference: 'operationalDay',
    hint: 'Leistung ist im Betrieb / Monitoring & Umsetzung.',
  },
  unknown: {
    key: 'unknown',
    label: 'Unklassifiziert',
    window: 'fehlende Daten',
    reference: 'mixed',
    hint: 'Es fehlen Fahrplan- oder Datumseigenschaften zur Einordnung.',
  },
};

type OrderSearchTokens = {
  textTerms: string[];
  tags: string[];
  responsibles: string[];
  customers: string[];
};

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
}

type EditableOrderItemKeys =
  | 'name'
  | 'start'
  | 'end'
  | 'responsible'
  | 'deviation'
  | 'serviceType'
  | 'fromLocation'
  | 'toLocation'
  | 'trafficPeriodId'
  | 'linkedBusinessIds'
  | 'linkedTemplateId'
  | 'linkedTrainPlanId'
  | 'tags';

export type OrderItemUpdateData = Pick<OrderItem, EditableOrderItemKeys>;

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
    return order.items.filter((item) => this.matchesItem(item, filters));
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
    const timetableYearLabel = this.normalizeTimetableYearLabel(payload.timetableYearLabel);
    const order: Order = {
      id,
      name: payload.name,
      customerId,
      customer: customerName,
      tags: this.normalizeTags(payload.tags),
      comment: payload.comment,
      items: [],
      timetableYearLabel,
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
      this.normalizeTimetableYearLabel(payload.timetableYearLabel) ??
      this.timetableYearService.getYearBounds(payload.start).label;
    this.ensureOrderTimetableYear(payload.orderId, timetableYearLabel);

    const tags = this.normalizeTags(payload.tags);
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
      ...planConfig
    } = payload;
    const normalizedTags = this.normalizeTags(tags);
    const normalizedCalendarDates = this.normalizeCalendarDates(planConfig.calendarDates ?? []);
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
      this.normalizeTimetableYearLabel(timetableYearLabel) ??
      this.timetableYearFromPlan(enrichedPlans[0] ?? plans[0]);
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
    });
    const timetableYearLabel =
      this.normalizeTimetableYearLabel(payload.timetableYearLabel) ??
      this.timetableYearFromPlan(plan);
    if (!timetableYearLabel) {
      throw new Error('Fahrplanjahr konnte nicht bestimmt werden.');
    }
    this.ensureOrderTimetableYear(payload.orderId, timetableYearLabel);

    const tags = this.normalizeTags(payload.tags);
    const base: OrderItem = {
      id: this.generateItemId(payload.orderId),
      name: title,
      type: 'Fahrplan',
      tags,
      responsible,
      linkedTrainPlanId: plan.id,
      timetableYearLabel,
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
    });
    const timetableYearLabel =
      this.normalizeTimetableYearLabel(payload.timetableYearLabel) ??
      payload.train.timetableYearLabel ??
      this.getTrafficPeriodTimetableYear(payload.trafficPeriodId) ??
      this.timetableYearFromPlan(plan);
    if (!timetableYearLabel) {
      throw new Error('Fahrplanjahr konnte nicht bestimmt werden.');
    }
    this.ensureOrderTimetableYear(payload.orderId, timetableYearLabel);

    const firstStop = plan.stops[0];
    const lastStop = plan.stops[plan.stops.length - 1];

    const namePrefix = payload.namePrefix?.trim();
    const tags = this.normalizeTags(payload.tags);
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
      this.publishPlanToHub(plan, updatedItem, section);
    }
  }

  splitOrderItem(
    payload: SplitOrderItemPayload,
  ): { created: OrderItem; original: OrderItem } {
    const rangeStart = this.normalizeDateInput(payload.rangeStart);
    const rangeEnd = this.normalizeDateInput(payload.rangeEnd);
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
        const validity = target.validity ?? [];

    const customSegments = payload.segments?.length
      ? this.prepareCustomSegments(payload.segments)
      : null;

    if (customSegments) {
      this.ensureSegmentsWithinValidity(validity, customSegments);
    }

    const { retained, extracted } = customSegments
      ? {
          retained: this.subtractSegments(validity, customSegments),
          extracted: customSegments,
        }
      : this.splitSegments(validity, rangeStart, rangeEnd);

        if (!extracted.length) {
          throw new Error(
            'Die ausgewählten Tage überschneiden sich nicht mit der Auftragsposition.',
          );
        }

        this.ensureNoSiblingConflict(order.items, target, extracted);

        const childId = this.generateItemId(order.id);
        const preparedUpdates = this.prepareUpdatePayload(payload.updates);

        let child: OrderItem = this.applyUpdatesToItem(
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
            const planStart = this.extractPlanStart(linkedPlan);
            const planEnd = this.extractPlanEnd(linkedPlan);
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
        this.updateItem(itemId, (item) => this.applyUpdatesToItem(item, rest));
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
    const segments = this.resolveValiditySegments(child);
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
      plan.calendar.daysBitmap ?? this.buildDaysBitmapFromValidity(segments, validFrom, validTo);

    return {
      validFrom,
      validTo,
      daysBitmap,
    };
  }

  private ensureNoSiblingConflict(
    items: OrderItem[],
    parent: OrderItem,
    extracted: OrderItemValiditySegment[],
  ): void {
    const siblings = items.filter((item) => item.parentItemId === parent.id);
    if (!siblings.length) {
      return;
    }
    siblings.forEach((sibling) => {
      const segments = this.resolveValiditySegments(sibling);
      extracted.forEach((candidate) => {
        segments.forEach((segment) => {
          if (this.segmentsOverlap(candidate, segment)) {
            throw new Error(
              `Für den Zeitraum ${segment.startDate} – ${segment.endDate} existiert bereits eine Modifikation. Bitte einen anderen Tag wählen.`,
            );
          }
        });
      });
    });
  }

  private segmentsOverlap(
    a: OrderItemValiditySegment,
    b: OrderItemValiditySegment,
  ): boolean {
    return !(a.endDate < b.startDate || a.startDate > b.endDate);
  }

  private applyCalendarExclusions(
    trafficPeriodId: string,
    segments: OrderItemValiditySegment[],
  ) {
    const dates = this.expandSegmentsToDates(segments);
    if (!dates.length) {
      return;
    }
    this.trafficPeriodService.addExclusionDates(trafficPeriodId, dates);
  }

  private expandSegmentsToDates(segments: OrderItemValiditySegment[]): string[] {
    const result: string[] = [];
    segments.forEach((segment) => {
      const start = this.toUtcDate(segment.startDate);
      const end = this.toUtcDate(segment.endDate);
      if (!start || !end) {
        return;
      }
      const cursor = new Date(start.getTime());
      while (cursor <= end) {
        result.push(this.fromUtcDate(cursor));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    });
    return Array.from(new Set(result)).sort();
  }

  private buildDaysBitmapFromValidity(
    segments: OrderItemValiditySegment[],
    fallbackStart: string,
    fallbackEnd: string,
  ): string {
    if (!segments.length) {
      return this.deriveBitmapFromRange(fallbackStart, fallbackEnd);
    }
    const activeWeekdays = new Set<number>();
    segments.forEach((segment) => {
      const cursor = this.toUtcDate(segment.startDate);
      const end = this.toUtcDate(segment.endDate);
      if (!cursor || !end) {
        return;
      }
      while (cursor <= end) {
        const weekday = cursor.getUTCDay();
        activeWeekdays.add(weekday === 0 ? 6 : weekday - 1);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    });
    if (!activeWeekdays.size) {
      return this.deriveBitmapFromRange(fallbackStart, fallbackEnd);
    }
    return Array.from({ length: 7 })
      .map((_, index) => (activeWeekdays.has(index) ? '1' : '0'))
      .join('');
  }

  private deriveBitmapFromRange(startIso: string, endIso: string): string {
    const start = this.toUtcDate(startIso);
    const end = this.toUtcDate(endIso);
    if (!start || !end) {
      return '1111111';
    }
    const activeWeekdays = new Set<number>();
    const cursor = new Date(start.getTime());
    while (cursor <= end && activeWeekdays.size < 7) {
      const weekday = cursor.getUTCDay();
      activeWeekdays.add(weekday === 0 ? 6 : weekday - 1);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return Array.from({ length: 7 })
      .map((_, index) => (activeWeekdays.has(index) ? '1' : '0'))
      .join('');
  }

  private matchesItem(item: OrderItem, filters: OrderFilters): boolean {
    if (filters.linkedBusinessId) {
      const businessIds = item.linkedBusinessIds ?? [];
      if (!businessIds.includes(filters.linkedBusinessId)) {
        return false;
      }
    }

    if (filters.trainStatus !== 'all' || filters.trainNumber.trim()) {
      if (item.type !== 'Fahrplan') {
        if (filters.trainStatus !== 'all' || filters.trainNumber.trim() !== '') {
          return false;
        }
      } else {
        const timetable = item.generatedTimetableRefId
          ? this.timetableService.getByRefTrainId(item.generatedTimetableRefId)
          : undefined;
        const plan = item.linkedTrainPlanId
          ? this.trainPlanService.getById(item.linkedTrainPlanId)
          : undefined;

        if (filters.trainStatus !== 'all') {
          const currentPhase = timetable?.status ?? item.timetablePhase;
          if (!currentPhase || currentPhase !== filters.trainStatus) {
            return false;
          }
        }
        if (filters.trainNumber.trim()) {
          const search = filters.trainNumber.trim().toLowerCase();
          const trainNumber =
            timetable?.trainNumber ?? plan?.trainNumber ?? item.name;
          if (!trainNumber.toLowerCase().includes(search)) {
            return false;
          }
        }
      }
    }

    if (filters.timetableYearLabel !== 'all') {
      const itemYear = this.getItemTimetableYear(item);
      if (itemYear !== filters.timetableYearLabel) {
        return false;
      }
    }

    let referenceDateCache: Date | null | undefined;
    const resolveReferenceDate = () => {
      if (referenceDateCache === undefined) {
        referenceDateCache = this.resolveReferenceDate(item, filters.timelineReference);
      }
      return referenceDateCache;
    };

    if (filters.fpRangeStart || filters.fpRangeEnd) {
      const referenceDate = resolveReferenceDate();
      if (!referenceDate) {
        return false;
      }
      if (filters.fpRangeStart) {
        const boundaryStart = this.parseDateOnly(filters.fpRangeStart);
        if (boundaryStart && referenceDate < boundaryStart) {
          return false;
        }
      }
      if (filters.fpRangeEnd) {
        const boundaryEnd = this.endOfDay(this.parseDateOnly(filters.fpRangeEnd));
        if (boundaryEnd && referenceDate > boundaryEnd) {
          return false;
        }
      }
    }

    if (filters.ttrPhase !== 'all') {
      const phase = this.computeTtrPhase(item, filters.timelineReference, resolveReferenceDate());
      if (phase !== filters.ttrPhase) {
        return false;
      }
    }

    if (filters.timeRange !== 'all') {
      if (!this.matchesTimeRange(item, filters.timeRange)) {
        return false;
      }
    }

    if (filters.internalStatus !== 'all') {
      if (item.internalStatus !== filters.internalStatus) {
        return false;
      }
    }

    return true;
  }

  private matchesTimeRange(
    item: OrderItem,
    range: OrderFilters['timeRange'],
  ): boolean {
    if (range === 'all') {
      return true;
    }
    if (!item.start) {
      return false;
    }
    const start = new Date(item.start);
    if (Number.isNaN(start.getTime())) {
      return false;
    }
    const now = new Date();
    switch (range) {
      case 'next4h':
        return start >= now && start <= this.addHours(now, 4);
      case 'next12h':
        return start >= now && start <= this.addHours(now, 12);
      case 'today':
        return this.isSameDay(start, now);
      case 'thisWeek':
        return this.isSameWeek(start, now);
      default:
        return true;
    }
  }

  private addHours(date: Date, hours: number): Date {
    const result = new Date(date.getTime());
    result.setHours(result.getHours() + hours);
    return result;
  }

  private addDays(date: Date, days: number): Date {
    const result = new Date(date.getTime());
    result.setDate(result.getDate() + days);
    return result;
  }

  private isSameDay(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  private isSameWeek(date: Date, reference: Date): boolean {
    const start = this.startOfWeek(reference);
    const end = this.addDays(start, 7);
    return date >= start && date < end;
  }

  private startOfWeek(date: Date): Date {
    const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = result.getDay();
    const diff = (day + 6) % 7; // Monday start
    result.setDate(result.getDate() - diff);
    result.setHours(0, 0, 0, 0);
    return result;
  }

  private startOfDay(date: Date): Date {
    const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    result.setHours(0, 0, 0, 0);
    return result;
  }

  private endOfDay(date: Date | null): Date | null {
    if (!date) {
      return null;
    }
    const result = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
    return result;
  }

  private parseDateOnly(value?: string | null): Date | null {
    if (!value) {
      return null;
    }
    const normalized = value.slice(0, 10);
    if (!normalized) {
      return null;
    }
    const date = new Date(`${normalized}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date;
  }

  private extractItemStartDate(item: OrderItem): Date | null {
    if (!item.start) {
      return null;
    }
    const date = new Date(item.start);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return this.startOfDay(date);
  }

  private resolveTimetableYearStart(item: OrderItem): Date | null {
    const label = this.getItemTimetableYear(item);
    try {
      if (label) {
        return this.timetableYearService.getYearByLabel(label).start;
      }
      const sample = this.extractReferenceSampleDate(item);
      return sample ? this.timetableYearService.getYearBounds(sample).start : null;
    } catch {
      return null;
    }
  }

  private extractReferenceSampleDate(item: OrderItem): Date | null {
    const candidate =
      item.validity?.[0]?.startDate ??
      item.start ??
      item.end ??
      item.originalTimetable?.calendar?.validFrom ??
      null;
    return candidate ? new Date(candidate) : null;
  }

  private resolveReferenceDate(
    item: OrderItem,
    reference: OrderTimelineReference,
  ): Date | null {
    const validityStart = this.parseDateOnly(item.validity?.[0]?.startDate);
    const timetableStart = this.parseDateOnly(item.originalTimetable?.calendar?.validFrom);
    const itemStart = this.extractItemStartDate(item);
    if (reference === 'fpDay') {
      return validityStart ?? itemStart ?? timetableStart;
    }
    if (reference === 'fpYear') {
      return this.resolveTimetableYearStart(item);
    }
    return itemStart ?? validityStart ?? timetableStart;
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
    const today = this.startOfDay(new Date());
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
    const plan = this.trainPlanService.getById(planId);
    let updatedItem: OrderItem | null = null;
    this._orders.update((orders) =>
      orders.map((order) => {
        let mutated = false;
        const items = order.items.map((item) => {
          if (item.id === itemId) {
            mutated = true;
            const base: OrderItem = {
              ...item,
              linkedTrainPlanId: planId,
            };
            const next = plan ? this.applyPlanDetailsToItem(base, plan) : base;
            updatedItem = next;
            return next;
          }
          if (item.linkedTrainPlanId === planId && item.id !== itemId) {
            mutated = true;
            const next = { ...item };
            delete next.linkedTrainPlanId;
            return next;
          }
          return item;
        });
        return mutated ? { ...order, items } : order;
      }),
    );

    this.trainPlanService.linkOrderItem(planId, itemId);

    if (plan && updatedItem) {
      const timetable = this.ensureTimetableForPlan(plan, updatedItem);
      if (timetable) {
        this.updateItemTimetableMetadata(itemId, timetable);
        this.syncTimetableCalendarArtifacts(timetable.refTrainId);
      }
    }
  }

  unlinkTrainPlanFromItem(planId: string, itemId: string) {
    this.updateItem(itemId, (item) => {
      if (item.linkedTrainPlanId !== planId) {
        return item;
      }
      const next = { ...item };
      delete next.linkedTrainPlanId;
      return next;
    });
    this.trainPlanService.unlinkOrderItem(planId);
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
          items: this.normalizeItemsAfterChange([...order.items, ...prepared]),
        };
      }),
    );

    if (!updated) {
      throw new Error(`Auftrag ${orderId} nicht gefunden`);
    }
  }

  private prepareItemsForInsertion(items: OrderItem[]): OrderItem[] {
    return items.map((item) => this.ensureItemDefaults(item));
  }

  private initializeOrder(order: Order): Order {
    const prepared = order.items.map((item) => this.ensureItemDefaults(item));
    const customer = this.resolveCustomerName(order.customerId, order.customer);
    const timetableYearLabel =
      order.timetableYearLabel ?? this.deriveOrderTimetableYear(prepared) ?? undefined;
    const processStatus: OrderProcessStatus =
      order.processStatus ??
      (prepared.length ? 'planung' : 'auftrag');
    return {
      ...order,
      customer,
      timetableYearLabel,
      processStatus,
      items: this.normalizeItemsAfterChange(prepared),
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
    const tokens: OrderSearchTokens = {
      textTerms: [],
      tags: [],
      responsibles: [],
      customers: [],
    };
    const trimmed = search.trim();
    if (!trimmed.length) {
      return tokens;
    }
    const segments = this.tokenizeSearch(trimmed);
    segments.forEach((segment) => {
      const lower = segment.toLowerCase();
      if (lower.startsWith('tag:')) {
        const value = this.stripQuotes(segment.slice(4).trim());
        if (value) {
          tokens.tags.push(value);
        }
        return;
      }
      if (segment.startsWith('#')) {
        const value = this.stripQuotes(segment.slice(1).trim());
        if (value) {
          tokens.tags.push(value);
        }
        return;
      }
      if (
        lower.startsWith('resp:') ||
        lower.startsWith('responsible:') ||
        segment.startsWith('@')
      ) {
        const suffix = segment.startsWith('@')
          ? segment.slice(1)
          : segment.slice(segment.indexOf(':') + 1);
        const value = this.stripQuotes(suffix.trim()).toLowerCase();
        if (value) {
          tokens.responsibles.push(value);
        }
        return;
      }
      if (lower.startsWith('cust:') || lower.startsWith('kunde:')) {
        const value = this.stripQuotes(
          segment.slice(segment.indexOf(':') + 1).trim(),
        ).toLowerCase();
        if (value) {
          tokens.customers.push(value);
        }
        return;
      }
      tokens.textTerms.push(this.stripQuotes(segment).toLowerCase());
    });

    if (
      !tokens.textTerms.length &&
      !tokens.tags.length &&
      !tokens.responsibles.length &&
      !tokens.customers.length
    ) {
      tokens.textTerms.push(trimmed.toLowerCase());
    }

    return tokens;
  }

  private tokenizeSearch(search: string): string[] {
    const segments: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < search.length; i += 1) {
      const char = search[i];
      if (char === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (/\s/.test(char) && !inQuotes) {
        if (current.trim().length) {
          segments.push(current.trim());
          current = '';
        }
        continue;
      }
      current += char;
    }
    if (current.trim().length) {
      segments.push(current.trim());
    }
    return segments;
  }

  private stripQuotes(value: string): string {
    if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
      return value.slice(1, -1);
    }
    return value;
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
        ? this.normalizeSegments(item.validity)
        : this.deriveDefaultValidity(item);
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

  private deriveDefaultValidity(item: OrderItem): OrderItemValiditySegment[] {
    if (!item.start && !item.end) {
      return [];
    }
    const startDate = item.start ? item.start.slice(0, 10) : item.end?.slice(0, 10);
    const endDate = item.end ? item.end.slice(0, 10) : startDate;
    if (!startDate || !endDate) {
      return [];
    }
    if (!this.isValidDate(startDate) || !this.isValidDate(endDate)) {
      return [];
    }
    const normalizedStart =
      startDate <= endDate ? startDate : endDate;
    const normalizedEnd =
      endDate >= startDate ? endDate : startDate;
    return [{ startDate: normalizedStart, endDate: normalizedEnd }];
  }

  private splitSegments(
    segments: OrderItemValiditySegment[],
    rangeStart: string,
    rangeEnd: string,
  ): { retained: OrderItemValiditySegment[]; extracted: OrderItemValiditySegment[] } {
    const retained: OrderItemValiditySegment[] = [];
    const extracted: OrderItemValiditySegment[] = [];

    segments.forEach((segment) => {
      const segStart = segment.startDate;
      const segEnd = segment.endDate;

      if (rangeEnd < segStart || rangeStart > segEnd) {
        retained.push(segment);
        return;
      }

      const overlapStart = rangeStart > segStart ? rangeStart : segStart;
      const overlapEnd = rangeEnd < segEnd ? rangeEnd : segEnd;

      if (overlapStart > overlapEnd) {
        retained.push(segment);
        return;
      }

      extracted.push({ startDate: overlapStart, endDate: overlapEnd });

      if (segStart < overlapStart) {
        retained.push({
          startDate: segStart,
          endDate: this.addDaysToDateString(overlapStart, -1),
        });
      }

      if (overlapEnd < segEnd) {
        retained.push({
          startDate: this.addDaysToDateString(overlapEnd, 1),
          endDate: segEnd,
        });
      }
    });

    return {
      retained: this.normalizeSegments(retained),
      extracted: this.normalizeSegments(extracted),
    };
  }

  private normalizeSegments(
    segments: OrderItemValiditySegment[],
  ): OrderItemValiditySegment[] {
    if (!segments.length) {
      return [];
    }
    const sorted = [...segments].sort((a, b) =>
      a.startDate.localeCompare(b.startDate),
    );
    const merged: OrderItemValiditySegment[] = [];
    let current = { ...sorted[0] };
    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i];
      const dayAfterCurrentEnd = this.addDaysToDateString(current.endDate, 1);
      if (dayAfterCurrentEnd >= next.startDate) {
        const maxEnd =
          current.endDate > next.endDate ? current.endDate : next.endDate;
        current = { startDate: current.startDate, endDate: maxEnd };
      } else {
        merged.push(current);
        current = { ...next };
      }
    }
    merged.push(current);
    return merged;
  }

  private addDaysToDateString(date: string, days: number): string {
    const utc = this.toUtcDate(date);
    if (!utc) {
      return date;
    }
    utc.setUTCDate(utc.getUTCDate() + days);
    return this.fromUtcDate(utc);
  }

  private toUtcDate(value: string): Date | null {
    if (!this.isValidDate(value)) {
      return null;
    }
    const [year, month, day] = value.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  private fromUtcDate(date: Date): string {
    return [
      date.getUTCFullYear().toString().padStart(4, '0'),
      (date.getUTCMonth() + 1).toString().padStart(2, '0'),
      date.getUTCDate().toString().padStart(2, '0'),
    ].join('-');
  }

  private isValidDate(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  private normalizeDateInput(value: string): string | null {
    if (!value) {
      return null;
    }
    const trimmed = value.trim();
    if (!this.isValidDate(trimmed)) {
      return null;
    }
    return trimmed;
  }

  private requireDateInput(value: string): string {
    const normalized = this.normalizeDateInput(value);
    if (!normalized) {
      throw new Error('Ungültiges Datum.');
    }
    return normalized;
  }

  private prepareUpdatePayload(
    updates: Partial<OrderItemUpdateData> | undefined,
  ): Partial<OrderItemUpdateData> {
    if (!updates) {
      return {};
    }
    const clone: Partial<OrderItemUpdateData> = { ...updates };
    if (updates.linkedBusinessIds) {
      clone.linkedBusinessIds = [...updates.linkedBusinessIds];
    }
    if ('tags' in updates) {
      clone.tags = updates.tags ? [...updates.tags] : [];
    }
    return clone;
  }

  private applyUpdatesToItem(
    item: OrderItem,
    updates: Partial<OrderItemUpdateData>,
  ): OrderItem {
    if (!updates || Object.keys(updates).length === 0) {
      return item;
    }
    const next: OrderItem = { ...item, ...updates };
    if (updates.linkedBusinessIds) {
      next.linkedBusinessIds = [...updates.linkedBusinessIds];
    }
    if ('tags' in updates) {
      next.tags = updates.tags ? [...updates.tags] : [];
    }
    return next;
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

  private normalizeTags(tags?: string[]): string[] | undefined {
    if (!tags?.length) {
      return undefined;
    }
    return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)));
  }

  private normalizeCalendarDates(dates: string[]): string[] {
    if (!dates?.length) {
      return [];
    }
    return Array.from(
      new Set(
        dates
          .map((date) => date?.slice(0, 10))
          .filter(
            (date): date is string =>
              !!date && /^\d{4}-\d{2}-\d{2}$/.test(date),
          ),
      ),
    ).sort((a, b) => a.localeCompare(b));
  }

  private extractPlanStart(plan: { stops: TrainPlan['stops'] }): string | undefined {
    const sorted = [...plan.stops].sort((a, b) => a.sequence - b.sequence);
    for (const stop of sorted) {
      if (stop.departureTime) {
        return stop.departureTime;
      }
      if (stop.arrivalTime) {
        return stop.arrivalTime;
      }
    }
    return undefined;
  }

  private extractPlanEnd(plan: { stops: TrainPlan['stops'] }): string | undefined {
    const sorted = [...plan.stops].sort((a, b) => b.sequence - a.sequence);
    for (const stop of sorted) {
      if (stop.arrivalTime) {
        return stop.arrivalTime;
      }
      if (stop.departureTime) {
        return stop.departureTime;
      }
    }
    return undefined;
  }

  private applyPlanDetailsToItem(item: OrderItem, plan: TrainPlan): OrderItem {
    const start = this.extractPlanStart(plan);
    const end = this.extractPlanEnd(plan);
    const firstStop = plan.stops[0];
    const lastStop = plan.stops[plan.stops.length - 1];

    const updated: OrderItem = {
      ...item,
      responsible: plan.responsibleRu,
      fromLocation: firstStop?.locationName ?? item.fromLocation,
      toLocation: lastStop?.locationName ?? item.toLocation,
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
    const normalizedDates = this.normalizeCalendarDates(dates);
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
    const normalizedYearLabel = this.normalizeTimetableYearLabel(timetableYearLabel);

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

  private ensureTimetableForPlan(plan: TrainPlan, item: OrderItem): Timetable | null {
    const refTrainId = this.generateTimetableRefId(plan);
    const existing = this.timetableService.getByRefTrainId(refTrainId);
    if (existing) {
      this.publishPlanToHub(plan, item, 'commercial');
      return existing;
    }
    const stops = this.toTimetableStops(plan.stops);
    if (stops.length < 2) {
      return null;
    }
    const calendar = plan.calendar
      ? { ...plan.calendar }
      : {
          validFrom:
            this.extractPlanStart(plan)?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
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
      this.publishPlanToHub(plan, item, 'commercial');
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
    if (!refTrainId) {
      return;
    }
    const relatedItems = this.collectItemsForTimetable(refTrainId);
    if (!relatedItems.length) {
      return;
    }
    const baseItem = this.findBaseItem(relatedItems);
    const period = baseItem?.trafficPeriodId
      ? this.trafficPeriodService.getById(baseItem.trafficPeriodId)
      : undefined;

    const variants = this.buildCalendarVariants(baseItem, period);
    if (variants.length) {
      this.timetableService.updateCalendarVariants(refTrainId, variants);
    }

    const modifications = this.buildCalendarModifications(relatedItems, period);
    this.timetableService.updateCalendarModifications(refTrainId, modifications);
  }

  private collectItemsForTimetable(refTrainId: string): OrderItem[] {
    return this._orders().flatMap((order) =>
      order.items.filter((item) => item.generatedTimetableRefId === refTrainId),
    );
  }

  private findBaseItem(items: OrderItem[]): OrderItem | undefined {
    return items.find((item) => !item.parentItemId) ?? items[0];
  }

  private buildCalendarVariants(
    baseItem: OrderItem | undefined,
    period: TrafficPeriod | undefined,
  ): TimetableCalendarVariant[] {
    if (period) {
      return this.buildVariantsFromTrafficPeriod(period);
    }
    if (!baseItem) {
      return [];
    }
    const segments = this.resolveValiditySegments(baseItem);
    if (!segments.length) {
      return [];
    }
    return segments.map((segment, index) => ({
      id: `${baseItem.id}-segment-${index}`,
      type: 'series',
      description: baseItem.name ?? 'Referenzkalender',
      validFrom: segment.startDate,
      validTo: segment.endDate,
      appliesTo: 'both',
    }));
  }

  private buildVariantsFromTrafficPeriod(
    period: TrafficPeriod,
  ): TimetableCalendarVariant[] {
    if (!period.rules?.length) {
      return [];
    }
    return period.rules.map((rule, index) => ({
      id: rule.id ?? `${period.id}-rule-${index}`,
      type: rule.variantType ?? 'series',
      description: rule.name ?? period.name,
      validFrom: rule.validityStart,
      validTo: rule.validityEnd,
      daysOfWeek: this.daysFromBitmap(rule.daysBitmap),
      dates: rule.includesDates?.length ? [...rule.includesDates] : undefined,
      appliesTo: rule.appliesTo ?? 'both',
      variantNumber: rule.variantNumber ?? `${index}`.padStart(2, '0'),
      reason: rule.reason ?? period.description,
    }));
  }

  private buildCalendarModifications(
    items: OrderItem[],
    period: TrafficPeriod | undefined,
  ): TimetableCalendarModification[] {
    const modifications: TimetableCalendarModification[] = [];

    period?.rules?.forEach((rule) => {
      rule.excludesDates?.forEach((date) => {
        modifications.push({
          date,
          description: `${rule.name ?? period.name} · Ausfall`,
          type: 'cancelled',
          notes: period.description,
        });
      });
    });

    items
      .filter((item) => !!item.parentItemId)
      .forEach((child) => {
        this.resolveValiditySegments(child).forEach((segment, idx) => {
          const range =
            segment.endDate && segment.endDate !== segment.startDate
              ? `${segment.startDate} – ${segment.endDate}`
              : segment.startDate;
          modifications.push({
            date: segment.startDate,
            description: `${child.name ?? 'Sub-Auftragsposition'} (${range})`,
            type: 'modified_timetable',
            notes: child.deviation ?? `Child ${child.id}-${idx}`,
          });
        });
      });

    return modifications;
  }

  private resolveValiditySegments(item: OrderItem | undefined): OrderItemValiditySegment[] {
    if (!item) {
      return [];
    }
    if (item.validity?.length) {
      return item.validity;
    }
    return this.deriveDefaultValidity(item);
  }

  private daysFromBitmap(bitmap?: string): string[] | undefined {
    if (!bitmap || bitmap.length !== 7) {
      return undefined;
    }
    const map = ['MO', 'DI', 'MI', 'DO', 'FR', 'SA', 'SO'];
    const result: string[] = [];
    bitmap.split('').forEach((bit, index) => {
      if (bit === '1') {
        result.push(map[index]);
      }
    });
    return result.length ? result : undefined;
  }

  private toTimetableStops(stops: TrainPlan['stops']): TimetableStopInput[] {
    return stops.map((stop) => ({
      sequence: stop.sequence,
      type: stop.type,
      locationCode: stop.locationCode ?? `LOC-${stop.sequence}`,
      locationName: stop.locationName ?? stop.locationCode ?? 'Unbekannter Halt',
      countryCode: stop.countryCode,
      arrivalTime: this.formatIsoToTime(stop.arrivalTime),
      departureTime: this.formatIsoToTime(stop.departureTime),
      arrivalOffsetDays: stop.arrivalOffsetDays,
      departureOffsetDays: stop.departureOffsetDays,
      dwellMinutes: stop.dwellMinutes,
      activities: stop.activities?.length ? stop.activities : ['0001'],
      platform: stop.platform,
      notes: stop.notes,
    }));
  }

  private formatIsoToTime(value: string | undefined): string | undefined {
    if (!value) {
      return undefined;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return undefined;
    }
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  private publishPlanToHub(
    plan: TrainPlan,
    item: OrderItem,
    section: TimetableHubSectionKey,
  ): void {
    const calendarDays = this.collectPlanCalendarDays(plan);
    if (!calendarDays.length) {
      return;
    }
    const timetableYearLabel =
      item.timetableYearLabel ??
      this.getItemTimetableYear(item) ??
      this.timetableYearService.getYearBounds(
        plan.calendar?.validFrom ?? calendarDays[0],
      ).label;
    const stops = this.planStopsToSummaries(plan);
    this.timetableHubService.registerPlanUpdate({
      refTrainId: this.generateTimetableRefId(plan),
      trainNumber: plan.trainNumber,
      title: plan.title,
      timetableYearLabel,
      calendarDays,
      section,
      stops,
      notes: plan.notes,
      vehicles: plan.rollingStock,
      technical: this.toHubTechnicalSummary(plan.technical),
      routeMetadata: this.toHubRouteMetadata(plan.routeMetadata),
    });
  }

  private collectPlanCalendarDays(plan: TrainPlan): string[] {
    const validFrom =
      plan.calendar?.validFrom ?? this.extractPlanStart(plan)?.slice(0, 10);
    if (!validFrom) {
      return [];
    }
    const validTo = plan.calendar?.validTo ?? validFrom;
    const daysBitmap = plan.calendar?.daysBitmap ?? '1111111';
    return this.expandPlanCalendarDays(validFrom, validTo, daysBitmap);
  }

  private expandPlanCalendarDays(validFrom: string, validTo: string, bitmap: string): string[] {
    const start = new Date(validFrom);
    const end = new Date(validTo);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return [];
    }
    const normalized = bitmap.padEnd(7, '1').slice(0, 7);
    const result: string[] = [];
    const cursor = new Date(start);
    while (cursor <= end && result.length <= 1096) {
      const weekday = cursor.getDay() === 0 ? 6 : cursor.getDay() - 1;
      if (normalized[weekday] === '1') {
        result.push(cursor.toISOString().slice(0, 10));
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return result;
  }

  private planStopsToSummaries(plan: TrainPlan): TimetableHubStopSummary[] {
    let lastHoldReason = plan.stops[0]?.holdReason?.trim() || 'Planhalt';
    let lastResponsible = plan.responsibleRu ?? 'TTT';
    let lastVehicleInfo = plan.rollingStock?.designation ?? 'n/a';
    return plan.stops.map((stop) => {
      const holdReason = stop.holdReason?.trim() || lastHoldReason;
      const responsible = stop.responsibleRu?.trim() || lastResponsible;
      const vehicleInfo = stop.vehicleInfo?.trim() || lastVehicleInfo;
      lastHoldReason = holdReason;
      lastResponsible = responsible;
      lastVehicleInfo = vehicleInfo;
      return {
        sequence: stop.sequence ?? 0,
        locationName: stop.locationName ?? stop.locationCode ?? 'Unbekannt',
        type: stop.type,
        arrivalTime: stop.arrivalTime,
        departureTime: stop.departureTime,
        commercialArrivalTime: stop.arrivalTime,
        commercialDepartureTime: stop.departureTime,
        operationalArrivalTime: stop.arrivalTime,
        operationalDepartureTime: stop.departureTime,
        holdReason,
        responsibleRu: responsible,
        vehicleInfo,
      };
    });
  }

  private toHubTechnicalSummary(
    technical?: TrainPlan['technical'],
  ): TimetableHubTechnicalSummary | undefined {
    if (!technical) {
      return undefined;
    }
    const summary: TimetableHubTechnicalSummary = {
      trainType: technical.trainType,
      maxSpeed: technical.maxSpeed,
      lengthMeters: technical.lengthMeters,
      weightTons: technical.weightTons,
      traction: technical.traction,
      energyType: technical.energyType,
      brakeType: technical.brakeType,
      etcsLevel: technical.etcsLevel,
    };
    const hasValue = Object.values(summary).some((value) => {
      if (typeof value === 'number') {
        return !Number.isNaN(value);
      }
      return Boolean(value && value.toString().trim().length);
    });
    return hasValue ? summary : undefined;
  }

  private toHubRouteMetadata(
    metadata?: TrainPlan['routeMetadata'],
  ): TimetableHubRouteMetadata | undefined {
    if (!metadata) {
      return undefined;
    }
    const normalized: TimetableHubRouteMetadata = {
      originBorderPoint: metadata.originBorderPoint?.trim() || undefined,
      destinationBorderPoint: metadata.destinationBorderPoint?.trim() || undefined,
      borderNotes: metadata.borderNotes?.trim() || undefined,
    };
    if (
      !normalized.originBorderPoint &&
      !normalized.destinationBorderPoint &&
      !normalized.borderNotes
    ) {
      return undefined;
    }
    return normalized;
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

  private combineDateTime(date: string, time: string): string {
    const match = /^([0-9]{1,2}):([0-9]{2})$/.exec(time);
    const [year, month, day] = date.split('-').map(Number);
    const hours = match ? Number.parseInt(match[1], 10) : 0;
    const minutes = match ? Number.parseInt(match[2], 10) : 0;
    const result = new Date(year, month - 1, day, hours, minutes, 0, 0);
    return result.toISOString();
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

  private normalizeTimetableYearLabel(label?: string | null): string | undefined {
    if (!label) {
      return undefined;
    }
    try {
      return this.timetableYearService.getYearByLabel(label).label;
    } catch {
      return undefined;
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

  private deriveOrderTimetableYear(items: OrderItem[]): string | undefined {
    let label: string | undefined;
    for (const item of items) {
      const current = this.getItemTimetableYear(item) ?? undefined;
      if (!current) {
        continue;
      }
      if (!label) {
        label = current;
        continue;
      }
      if (label !== current) {
        return undefined;
      }
    }
    return label;
  }

  private getTrafficPeriodTimetableYear(periodId: string): string | null {
    if (!periodId) {
      return null;
    }
    const period = this.trafficPeriodService.getById(periodId);
    if (!period) {
      return null;
    }
    if (period.timetableYearLabel) {
      return period.timetableYearLabel;
    }
    const sample =
      period.rules?.find((rule) => rule.includesDates?.length)?.includesDates?.[0] ??
      period.rules?.[0]?.validityStart;
    if (!sample) {
      return null;
    }
    try {
      return this.timetableYearService.getYearBounds(sample).label;
    } catch {
      return null;
    }
  }

  private timetableYearFromPlan(plan: TrainPlan): string | null {
    const sample =
      plan.calendar?.validFrom ??
      plan.calendar?.validTo ??
      this.extractPlanStart(plan) ??
      this.extractPlanEnd(plan);
    if (!sample) {
      return null;
    }
    try {
      return this.timetableYearService.getYearBounds(sample).label;
    } catch {
      return null;
    }
  }

  private prepareCustomSegments(
    segments: OrderItemValiditySegment[],
  ): OrderItemValiditySegment[] {
    const normalized = segments
      .map((segment) => {
        const startDate = this.requireDateInput(segment.startDate);
        const endDate = this.requireDateInput(segment.endDate);
        const [start, end] =
          startDate <= endDate ? [startDate, endDate] : [endDate, startDate];
        return { startDate: start, endDate: end };
      })
      .filter((segment) => segment.startDate && segment.endDate);
    return this.normalizeSegments(normalized);
  }

  private ensureSegmentsWithinValidity(
    validity: OrderItemValiditySegment[],
    segments: OrderItemValiditySegment[],
  ): void {
    segments.forEach((segment) => {
      const fits = validity.some(
        (range) => segment.startDate >= range.startDate && segment.endDate <= range.endDate,
      );
      if (!fits) {
        throw new Error(
          `Der Zeitraum ${segment.startDate} – ${segment.endDate} liegt nicht innerhalb der Gültigkeit der Auftragsposition.`,
        );
      }
    });
  }

  private subtractSegments(
    validity: OrderItemValiditySegment[],
    removals: OrderItemValiditySegment[],
  ): OrderItemValiditySegment[] {
    let retained = validity;
    removals.forEach((segment) => {
      const result = this.splitSegments(retained, segment.startDate, segment.endDate);
      retained = result.retained;
    });
    return retained;
  }

}
