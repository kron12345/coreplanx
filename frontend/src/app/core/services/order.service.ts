import { Injectable, computed, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Order, OrderProcessStatus } from '../models/order.model';
import {
  OrderItem,
  OrderItemValiditySegment,
  InternalProcessingStatus,
} from '../models/order-item.model';
import { TimetablePhase } from '../models/timetable.model';
import { OrderApiService, OrderUpsertPayload } from '../api/order-api.service';
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
import { TrafficPeriodVariantType } from '../models/traffic-period.model';
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
import { detectFilterStorage, persistFilters, restoreFilters } from './orders/order-filter.storage';
import { OrderVariantsManager, OrderVariantMergeResult } from './orders/order-variants.manager';
import { OrderPlanLinkManager } from './orders/order-plan-link.manager';
import { OrderPlanHubHelper } from './orders/order-plan-hub.helper';
import {
  extractPlanEnd,
  extractPlanStart,
  applyPlanDetailsToItem,
  normalizeTimetableYearLabel,
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
import { toUtcDate, fromUtcDate } from './orders/order-validity.utils';
import { extractReferenceSampleDate, resolveReferenceDate } from './orders/order-timeline.utils';
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
import { OrderFilterEngine } from './orders/order-filter.engine';
import { OrderStoreHelper } from './orders/order-store.utils';
import {
  generateItemId,
  generateOrderId,
  initializeOrder,
  resolveCustomerName,
} from './orders/order-init.utils';
import { OrderPlanFactory } from './orders/order-plan.factory';
import { OrderTimetableFactory } from './orders/order-timetable.factory';
import { OrderItemSplitManager } from './orders/order-item-split.manager';
import { OrderTimetableYearHelper } from './orders/order-timetable-year.helper';
import { OrderStatusManager } from './orders/order-status.manager';
import { OrderLinkingHelper } from './orders/order-linking.helper';
import { OrderPlanModificationManager } from './orders/order-plan-modification.manager';

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
  private readonly _orders = signal<Order[]>([]);
  private readonly _filters = signal<OrderFilters>({ ...DEFAULT_ORDER_FILTERS });
  private readonly browserStorage = detectFilterStorage();
  private readonly loading = signal(false);
  private readonly hasMore = signal(false);
  private readonly total = signal(0);
  private readonly pageSize = signal(30);
  private readonly currentPage = signal(1);
  private fetchToken = 0;
  private readonly orderItemsLoaded = new Set<string>();
  private readonly orderItemsLoading = new Set<string>();
  private orderItemsFetchToken = 0;
  private readonly orderItemsPageSize = 200;
  private readonly pendingSaves = new Map<string, Order>();
  private persistTimer: number | null = null;
  private readonly variants: OrderVariantsManager;
  private readonly planLinks: OrderPlanLinkManager;
  private readonly planHub: OrderPlanHubHelper;
  private readonly filterEngine: OrderFilterEngine;
  private readonly store: OrderStoreHelper;
  private readonly planFactory: OrderPlanFactory;
  private readonly timetableFactory: OrderTimetableFactory;
  private readonly itemSplitManager: OrderItemSplitManager;
  private readonly timetableYearHelper: OrderTimetableYearHelper;
  private readonly statusManager: OrderStatusManager;
  private readonly linkingHelper: OrderLinkingHelper;
  private readonly planModificationManager: OrderPlanModificationManager;

  constructor(
    private readonly trainPlanService: TrainPlanService,
    private readonly customerService: CustomerService,
    private readonly orderApi: OrderApiService,
    private readonly timetableService: TimetableService,
    private readonly trafficPeriodService: TrafficPeriodService,
    private readonly timetableYearService: TimetableYearService,
    private readonly timetableHubService: TimetableHubService,
  ) {
    const restoredFilters = restoreFilters(this.browserStorage);
    if (restoredFilters) {
      this._filters.set(restoredFilters);
    }
    this.store = new OrderStoreHelper({
      setOrders: (updater) => this.updateOrders(updater),
      timetableYearService: this.timetableYearService,
    });
    const factories = this.initializeFactories();
    this.timetableYearHelper = factories.timetableYearHelper;
    this.planHub = factories.planHub;
    this.timetableFactory = factories.timetableFactory;
    this.itemSplitManager = factories.itemSplitManager;
    this.statusManager = factories.statusManager;
    this.linkingHelper = factories.linkingHelper;
    this.planModificationManager = factories.planModificationManager;
    this.planFactory = factories.planFactory;
    this.variants = new OrderVariantsManager({
      trainPlanService: this.trainPlanService,
      updateOrder: (orderId, updater) => this.updateOrder(orderId, updater),
      appendItems: (orderId, items) => this.appendItems(orderId, items),
      markSimulationMerged: (orderId, simId, targetId, status) =>
        this.markSimulationMerged(orderId, simId, targetId, status),
      generateItemId: (orderId) => generateItemId(orderId),
      applyPlanDetailsToItem: (item, plan) => applyPlanDetailsToItem(item, plan),
      linkTrainPlanToItem: (planId, itemId) => this.linkTrainPlanToItem(planId, itemId),
      getOrderById: (orderId) => this.getOrderById(orderId),
    });
    this.planLinks = new OrderPlanLinkManager({
      trainPlanService: this.trainPlanService,
      timetableService: this.timetableService,
      trafficPeriodService: this.trafficPeriodService,
      updateItem: (itemId, updater) => this.updateItem(itemId, updater),
      applyPlanDetailsToItem: (item, plan) => applyPlanDetailsToItem(item, plan),
      ensureTimetableForPlan: (plan, item, refOverride) =>
        this.timetableFactory.ensureTimetableForPlan(plan, item, refOverride),
      updateItemTimetableMetadata: (itemId, timetable) =>
        this.timetableFactory.updateItemTimetableMetadata(itemId, timetable),
      ordersProvider: () => this._orders(),
      buildCalendarVariants: (base, period) => buildCalendarVariants(base, period),
      buildCalendarModifications: (items, period) =>
        buildCalendarModifications(items, period),
      generateTimetableRefId: (plan) => this.timetableFactory.generateTimetableRefId(plan),
      getTrafficPeriod: (id) => this.trafficPeriodService.getById(id),
    });
    this._orders().forEach((order) =>
      order.items.forEach((item) =>
        this.syncTimetableCalendarArtifacts(item.generatedTimetableRefId),
      ),
    );
    this.filterEngine = new OrderFilterEngine({
      timetableService: this.timetableService,
      trainPlanService: this.trainPlanService,
      getItemTimetableYear: (item) => this.timetableYearHelper.getItemTimetableYear(item),
      resolveReferenceDate: (item, reference) =>
        resolveReferenceDate(item, reference, (it) =>
          resolveTimetableYearStart(
            it,
            this.timetableYearService,
            (entity) => this.timetableYearHelper.getItemTimetableYear(entity),
            (entity) => extractReferenceSampleDate(entity),
          ),
        ),
      findItemById: (id) => this.getOrderItemById(id),
    });

    void this.refreshOrders();
  }

  readonly filters = computed(() => this._filters());
  readonly orders = computed(() => this._orders());
  readonly totalCount = computed(() => this.total());
  readonly hasMoreOrders = computed(() => this.hasMore());
  readonly isLoading = computed(() => this.loading());
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
      timetableYearLabel: this.timetableYearHelper.getItemTimetableYear(entry.item),
      serviceType: entry.item.serviceType,
      start: entry.item.start,
      end: entry.item.end,
    })),
  );
  readonly itemTtrPhaseIndex = computed(() => {
    const reference = this._filters().timelineReference;
    const map = this.filterEngine.buildTtrPhaseIndex(this._orders(), reference);
    return { reference, map };
  });

  readonly filteredOrders = computed(() => this._orders());

  async refreshOrders(force = false): Promise<void> {
    if (this.loading() && !force) {
      return;
    }
    this.currentPage.set(1);
    await this.fetchOrders(1, false);
  }

  async loadMoreOrders(): Promise<void> {
    if (this.loading() || !this.hasMore()) {
      return;
    }
    await this.fetchOrders(this.currentPage() + 1, true);
  }

  async ensureOrderItemsLoaded(orderId: string): Promise<void> {
    if (this.orderItemsLoaded.has(orderId) || this.orderItemsLoading.has(orderId)) {
      return;
    }
    const order = this.getOrderById(orderId);
    if (!order) {
      return;
    }
    const requestToken = this.orderItemsFetchToken;
    this.orderItemsLoading.add(orderId);
    try {
      const items = await this.fetchAllOrderItems(orderId, requestToken);
      if (requestToken !== this.orderItemsFetchToken) {
        return;
      }
      this._orders.update((orders) =>
        orders.map((entry) =>
          entry.id === orderId ? { ...entry, items } : entry,
        ),
      );
      items.forEach((item) =>
        this.syncTimetableCalendarArtifacts(item.generatedTimetableRefId),
      );
      this.orderItemsLoaded.add(orderId);
    } catch (error) {
      console.warn('[OrderService] Failed to load order items from backend', error);
    } finally {
      this.orderItemsLoading.delete(orderId);
    }
  }

  private async fetchOrders(page: number, append: boolean): Promise<void> {
    if (this.loading()) {
      return;
    }
    this.loading.set(true);
    const requestId = (this.fetchToken += 1);
    try {
      const response = await firstValueFrom(
        this.orderApi.searchOrders({
          filters: this._filters(),
          page,
          pageSize: this.pageSize(),
        }),
      );
      if (requestId !== this.fetchToken) {
        return;
      }
      const orders = (response.orders ?? []).map((order) =>
        this.normalizeOrderFromApi(order),
      );
      this.total.set(response.total ?? orders.length);
      this.hasMore.set(Boolean(response.hasMore));
      this.currentPage.set(response.page ?? page);
      this._orders.update((current) =>
        append ? this.appendOrders(current, orders) : orders,
      );
      this.syncCalendarArtifactsForOrders(orders);
    } catch (error) {
      console.warn('[OrderService] Failed to load orders from backend', error);
    } finally {
      if (requestId === this.fetchToken) {
        this.loading.set(false);
      }
    }
  }

  private async fetchAllOrderItems(orderId: string, requestToken: number): Promise<OrderItem[]> {
    const items: OrderItem[] = [];
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const response = await firstValueFrom(
        this.orderApi.searchOrderItems(orderId, {
          filters: this._filters(),
          page,
          pageSize: this.orderItemsPageSize,
        }),
      );
      if (requestToken !== this.orderItemsFetchToken) {
        return [];
      }
      const pageItems = (response.items ?? []).map((item) =>
        this.normalizeOrderItem(item),
      );
      items.push(...pageItems);
      hasMore = Boolean(response.hasMore);
      page += 1;
      if (!response.pageSize) {
        break;
      }
    }
    return items;
  }

  private appendOrders(current: Order[], incoming: Order[]): Order[] {
    if (!incoming.length) {
      return current;
    }
    const existingIds = new Set(current.map((order) => order.id));
    const additions = incoming.filter((order) => !existingIds.has(order.id));
    return [...current, ...additions];
  }

  private normalizeOrderFromApi(order: Order): Order {
    const items = (order.items ?? []).map((item) =>
      this.normalizeOrderItem(item),
    );
    return initializeOrder(
      {
        ...order,
        items,
      },
      {
        customerService: this.customerService,
        timetableYearService: this.timetableYearService,
        getItemTimetableYear: (item) =>
          this.timetableYearHelper.getItemTimetableYear(item),
      },
    );
  }

  private normalizeOrderItem(item: OrderItem): OrderItem {
    const validity = Array.isArray(item.validity)
      ? (item.validity as OrderItemValiditySegment[])
      : undefined;
    return {
      ...item,
      validity,
      tags: item.tags?.length ? item.tags : undefined,
      linkedBusinessIds: item.linkedBusinessIds ?? [],
      versionPath: item.versionPath ?? [],
    };
  }

  private syncCalendarArtifactsForOrders(orders: Order[]): void {
    orders.forEach((order) =>
      order.items.forEach((item) =>
        this.syncTimetableCalendarArtifacts(item.generatedTimetableRefId),
      ),
    );
  }

  setFilter(patch: Partial<OrderFilters>) {
    this._filters.update((f) => {
      const next = { ...f, ...patch };
      persistFilters(this.browserStorage, next);
      return next;
    });
    this.resetOrderItemCache();
    void this.refreshOrders();
  }

  clearLinkedBusinessFilter(): void {
    this._filters.update((filters) => {
      const next = { ...filters, linkedBusinessId: null };
      persistFilters(this.browserStorage, next);
      return next;
    });
    this.resetOrderItemCache();
    void this.refreshOrders();
  }

  private resetOrderItemCache(): void {
    this.orderItemsLoaded.clear();
    this.orderItemsLoading.clear();
    this.orderItemsFetchToken += 1;
  }

  private updateOrders(
    updater: (orders: Order[]) => Order[],
    options: { persist?: boolean } = {},
  ): void {
    const changedIds: string[] = [];
    this._orders.update((orders) => {
      const next = updater(orders);
      const previousById = new Map(orders.map((order) => [order.id, order]));
      next.forEach((order) => {
        const previous = previousById.get(order.id);
        if (!previous || previous !== order) {
          changedIds.push(order.id);
        }
      });
      return next;
    });
    if (options.persist !== false) {
      this.queuePersistOrders(changedIds);
    }
  }

  private updateOrder(orderId: string, updater: (order: Order) => Order): void {
    let updated = false;
    this.updateOrders((orders) =>
      orders.map((order) => {
        if (order.id !== orderId) {
          return order;
        }
        updated = true;
        return updater(order);
      }),
    );
    if (!updated) {
      throw new Error(`Auftrag ${orderId} wurde nicht gefunden.`);
    }
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

  private queuePersistOrders(orderIds: Iterable<string>): void {
    const ids = Array.from(orderIds);
    if (!ids.length) {
      return;
    }
    ids.forEach((id) => {
      const order = this.getOrderById(id);
      if (order) {
        this.pendingSaves.set(id, order);
      }
    });
    if (this.persistTimer !== null) {
      return;
    }
    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = null;
      void this.flushPersistQueue();
    }, 400);
  }

  private async flushPersistQueue(): Promise<void> {
    if (!this.pendingSaves.size) {
      return;
    }
    const entries = Array.from(this.pendingSaves.values());
    this.pendingSaves.clear();
    for (const order of entries) {
      await this.persistOrder(order);
    }
  }

  private async persistOrder(order: Order): Promise<void> {
    try {
      const payload = this.toOrderPayload(order);
      await firstValueFrom(this.orderApi.upsertOrder(order.id, payload));
    } catch (error) {
      console.warn('[OrderService] Failed to persist order', error);
    }
  }

  filterItemsForOrder(order: Order): OrderItem[] {
    return order.items;
  }

  getItemReferenceDate(
    itemOrId: OrderItem | string,
    reference?: OrderTimelineReference,
  ): Date | null {
    return this.filterEngine.getItemReferenceDate(
      itemOrId,
      reference ?? this._filters().timelineReference,
    );
  }

  getTtrPhaseForItem(
    item: OrderItem,
    reference?: OrderTimelineReference,
  ): OrderTtrPhase {
    if (reference) {
      return this.filterEngine.computeTtrPhase(item, reference);
    }
    const cache = this.itemTtrPhaseIndex();
    if (cache.map.has(item.id)) {
      return cache.map.get(item.id)!;
    }
    return this.filterEngine.computeTtrPhase(item, cache.reference);
  }

  getTtrPhaseMeta(phase: OrderTtrPhase): OrderTtrPhaseMeta {
    return TTR_PHASE_META[phase] ?? TTR_PHASE_META.unknown;
  }

  createOrder(payload: CreateOrderPayload): Order {
    const id = payload.id?.trim().length ? payload.id.trim() : generateOrderId();
    const customerId = payload.customerId;
    const customerName = resolveCustomerName(this.customerService, customerId, payload.customer);
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

    this.updateOrders((orders) => [order, ...orders]);
    return order;
  }

  removeCustomerAssignments(customerId: string) {
    this.store.removeCustomerAssignments(customerId);
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
      id: generateItemId(payload.orderId),
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
    return this.planFactory.addPlanOrderItems(payload);
  }

  addManualPlanOrderItem(payload: CreateManualPlanOrderItemPayload): OrderItem {
    return this.planFactory.addManualPlanOrderItem(payload);
  }

  addImportedPlanOrderItem(payload: CreateImportedPlanOrderItemPayload): OrderItem {
    return this.planFactory.addImportedPlanOrderItem(payload);
  }

  applyPlanModification(payload: {
    orderId: string;
    itemId: string;
    plan: TrainPlan;
  }): void {
    this.planModificationManager.applyPlanModification(payload);
  }

  splitOrderItem(
    payload: SplitOrderItemPayload,
  ): { created: OrderItem; original: OrderItem } {
    return this.itemSplitManager.splitOrderItem(payload);
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

    return ensureItemDefaults(updatedItem);
  }

  createPlanVersionFromSplit(parent: OrderItem, child: OrderItem): void {
    this.planModificationManager.createPlanVersionFromSplit(parent, child);
  }

  linkBusinessToItem(businessId: string, itemId: string) {
    this.linkingHelper.linkBusinessToItem(businessId, itemId);
  }

  unlinkBusinessFromItem(businessId: string, itemId: string) {
    this.linkingHelper.unlinkBusinessFromItem(businessId, itemId);
  }

  setItemTimetablePhase(itemId: string, phase: TimetablePhase): void {
    this.statusManager.setItemTimetablePhase(itemId, phase);
  }

  setItemInternalStatus(itemId: string, status: InternalProcessingStatus | null): void {
    this.statusManager.setItemInternalStatus(itemId, status);
  }

  setOrderProcessStatus(orderId: string, status: OrderProcessStatus): void {
    this.statusManager.setOrderProcessStatus(orderId, status);
  }

  /**
   * Ermittelt alle Fahrplan-Positionen eines Auftrags, die noch nicht im Status „Booked“ sind.
   * Im Mock wird hierfür die Timetable-Phase der Position verwendet.
   */
  getItemsMissingBookedStatus(orderId: string): OrderItem[] {
    return this.statusManager.getItemsMissingBookedStatus(orderId);
  }

  linkTemplateToItem(templateId: string, itemId: string) {
    this.linkingHelper.linkTemplateToItem(templateId, itemId);
  }

  unlinkTemplateFromItem(templateId: string, itemId: string) {
    this.linkingHelper.unlinkTemplateFromItem(templateId, itemId);
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
    this.statusManager.submitOrderItems(orderId, itemIds);
  }

  private toOrderPayload(order: Order): OrderUpsertPayload {
    return {
      order: {
        id: order.id,
        name: order.name,
        customerId: order.customerId,
        customer: order.customer,
        tags: order.tags,
        comment: order.comment,
        timetableYearLabel: order.timetableYearLabel,
        processStatus: order.processStatus,
      },
      items: order.items.map((item) => this.toOrderItemPayload(item)),
    };
  }

  private toOrderItemPayload(item: OrderItem): OrderItem {
    return {
      ...item,
      tags: item.tags?.length ? item.tags : undefined,
      linkedBusinessIds: item.linkedBusinessIds ?? [],
      validity: item.validity?.length ? item.validity : undefined,
      versionPath: item.versionPath ?? [],
    };
  }

  private appendItems(orderId: string, items: OrderItem[]) {
    this.store.appendItems(orderId, items);
  }

  private initializeOrder(order: Order): Order {
    const prepared = order.items.map((item) => ensureItemDefaults(item));
    const customer = resolveCustomerName(this.customerService, order.customerId, order.customer);
    const timetableYearLabel =
      order.timetableYearLabel ??
      deriveOrderTimetableYear(prepared, (item) => this.timetableYearHelper.getItemTimetableYear(item)) ??
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

  private syncTimetableCalendarArtifacts(refTrainId: string | undefined): void {
    if (!refTrainId) {
      return;
    }
    this.planLinks?.syncTimetableCalendarArtifacts(refTrainId);
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

  private updateItem(
    itemId: string,
    updater: (item: OrderItem) => OrderItem,
  ): void {
    this.store.updateItem(itemId, updater);
  }

  timetableYearOptions(): string[] {
    return this.timetableYearHelper.timetableYearOptions();
  }

  getItemTimetableYear(item: OrderItem): string | null {
    return this.timetableYearHelper.getItemTimetableYear(item);
  }

  private ensureOrderTimetableYear(orderId: string, label?: string | null) {
    this.store.ensureOrderTimetableYear(orderId, label);
  }

  private markSimulationMerged(orderId: string, simId: string, targetId: string, status: 'applied' | 'proposed') {
    this.store.markSimulationMerged(orderId, simId, targetId, status);
  }

  private initializeFactories() {
    const timetableYearHelper = new OrderTimetableYearHelper(
      this.trafficPeriodService,
      this.timetableYearService,
      () => this._orders(),
    );

    let planHub: OrderPlanHubHelper;
    const timetableFactory = new OrderTimetableFactory({
      timetableService: this.timetableService,
      trainPlanService: this.trainPlanService,
      publishPlanToHub: (plan, item, section) => planHub?.publishPlanToHub(plan, item, section),
      resolveHubSectionForItem: (item) => this.resolveHubSectionForItem(item),
      updateItem: (itemId, updater) => this.updateItem(itemId, updater),
    });

    planHub = new OrderPlanHubHelper({
      timetableHubService: this.timetableHubService,
      timetableYearService: this.timetableYearService,
      getItemTimetableYear: (item) => timetableYearHelper.getItemTimetableYear(item),
      generateTimetableRefId: (plan) => timetableFactory.generateTimetableRefId(plan),
    });

    const itemSplitManager = new OrderItemSplitManager({
      updateOrders: (updater) => this.updateOrders(updater),
      getOrderById: (orderId) => this.getOrderById(orderId),
      trafficPeriodService: this.trafficPeriodService,
      timetableYearService: this.timetableYearService,
      trainPlanService: this.trainPlanService,
      syncTimetableCalendarArtifacts: (ref) => this.syncTimetableCalendarArtifacts(ref),
    });

    const statusManager = new OrderStatusManager({
      updateOrders: (updater) => this.updateOrders(updater),
      updateItem: (itemId, updater) => this.updateItem(itemId, updater),
      getOrderById: (orderId) => this.getOrderById(orderId),
      ordersProvider: () => this._orders(),
      timetableService: this.timetableService,
      trainPlanService: this.trainPlanService,
      planHub,
      resolveHubSectionForItem: (item) => this.resolveHubSectionForItem(item),
    });

    const linkingHelper = new OrderLinkingHelper((itemId, updater) => this.updateItem(itemId, updater));

    const planModificationManager = new OrderPlanModificationManager({
      updateOrders: (updater) => this.updateOrders(updater),
      getOrderById: (orderId) => this.getOrderById(orderId),
      trainPlanService: this.trainPlanService,
      timetableFactory,
      planHub,
      resolveHubSectionForItem: (item) => this.resolveHubSectionForItem(item),
      deriveCalendarForChild: (child, plan) => itemSplitManager.deriveCalendarForChild(child, plan),
    });

    const planFactory = new OrderPlanFactory({
      trainPlanService: this.trainPlanService,
      timetableService: this.timetableService,
      trafficPeriodService: this.trafficPeriodService,
      timetableYearService: this.timetableYearService,
      getOrderById: (orderId) => this.getOrderById(orderId),
      ensureOrderTimetableYear: (orderId, label) => this.ensureOrderTimetableYear(orderId, label),
      applyPlanDetailsToItem: (item, plan) => applyPlanDetailsToItem(item, plan),
      ensureTimetableForPlan: (plan, item, refOverride) =>
        timetableFactory.ensureTimetableForPlan(plan, item, refOverride),
      withTimetableMetadata: (item, timetable) => timetableFactory.withTimetableMetadata(item, timetable),
      linkTrainPlanToItem: (planId, itemId) => this.linkTrainPlanToItem(planId, itemId),
      generateItemId: (orderId) => generateItemId(orderId),
      appendItems: (orderId, items) => this.appendItems(orderId, items),
    });

    return {
      timetableYearHelper,
      planHub,
      timetableFactory,
      itemSplitManager,
      statusManager,
      linkingHelper,
      planModificationManager,
      planFactory,
    };
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
