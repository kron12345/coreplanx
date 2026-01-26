import { Order } from '../../models/order.model';
import { OrderItem } from '../../models/order-item.model';
import { TrainPlan } from '../../models/train-plan.model';
import { TrainPlanService } from '../train-plan.service';
import { findProductiveBase, mergeItemFields } from './order-variants.utils';

export type OrderVariantMergeResult =
  | { type: 'updated'; target: OrderItem }
  | { type: 'created'; target: OrderItem }
  | { type: 'modification'; target: OrderItem };

type UpdateOrderItemsFn = (orderId: string, updater: (order: Order) => Order) => void;
type AppendItemsFn = (orderId: string, items: OrderItem[]) => void;
type MarkMergedFn = (orderId: string, simId: string, targetId: string, status: 'applied' | 'proposed') => void;
type GenerateItemIdFn = (orderId: string) => string;
type ApplyPlanDetailsFn = (item: OrderItem, plan: TrainPlan) => OrderItem;
type LinkPlanFn = (planId: string, itemId: string) => void;
type GetOrderFn = (orderId: string) => Order | undefined;

interface OrderVariantDeps {
  trainPlanService: TrainPlanService;
  updateOrder: UpdateOrderItemsFn;
  appendItems: AppendItemsFn;
  markSimulationMerged: MarkMergedFn;
  generateItemId: GenerateItemIdFn;
  applyPlanDetailsToItem: ApplyPlanDetailsFn;
  linkTrainPlanToItem: LinkPlanFn;
  getOrderById: GetOrderFn;
}

export class OrderVariantsManager {
  constructor(private readonly deps: OrderVariantDeps) {}

  async createSimulationVariant(orderId: string, itemId: string, label?: string): Promise<OrderItem | null> {
    const order = this.deps.getOrderById(orderId);
    if (!order) {
      throw new Error('Auftrag nicht gefunden.');
    }
    const baseItem = order.items.find((it) => it.id === itemId);
    if (!baseItem) {
      throw new Error('Auftragsposition nicht gefunden.');
    }
    if (baseItem.variantType === 'simulation') {
      throw new Error('Simulationen können nicht weiter verzweigt werden.');
    }
    const variantGroupId = baseItem.variantGroupId ?? baseItem.id;
    const variantLabel = label ?? 'Simulation';

    let clonedPlanId: string | undefined;
    if (baseItem.linkedTrainPlanId) {
      const clone = await this.deps.trainPlanService.createPlanVariant(
        baseItem.linkedTrainPlanId,
        'simulation',
        variantLabel,
      );
      clonedPlanId = clone.id;
    }

    const newItem: OrderItem = {
      ...baseItem,
      id: this.deps.generateItemId(orderId),
      name: `${baseItem.name} · ${variantLabel}`,
      variantType: 'simulation',
      variantOfItemId: baseItem.id,
      variantGroupId,
      variantLabel,
      linkedTrainPlanId: clonedPlanId ?? baseItem.linkedTrainPlanId,
      timetablePhase: 'bedarf',
      linkedBusinessIds: baseItem.linkedBusinessIds ? [...baseItem.linkedBusinessIds] : undefined,
      mergeStatus: 'open',
    };
    delete (newItem as Partial<OrderItem>).generatedTimetableRefId;

    this.deps.appendItems(orderId, [newItem]);
    return newItem;
  }

  promoteSimulationToProductive(orderId: string, variantItemId: string): OrderItem | null {
    const order = this.deps.getOrderById(orderId);
    if (!order) {
      throw new Error('Auftrag nicht gefunden.');
    }
    const candidate = order.items.find((it) => it.id === variantItemId);
    if (!candidate || candidate.variantType !== 'simulation') {
      throw new Error('Nur Simulationen können promotet werden.');
    }
    const groupId = candidate.variantGroupId ?? candidate.variantOfItemId ?? candidate.id;
    const phase = candidate.timetablePhase ?? 'bedarf';
    if (phase !== 'bedarf') {
      throw new Error('Promote ist nur im Draft möglich.');
    }

    const updatedItems: OrderItem[] = order.items.map((item) => {
      if (item.variantGroupId === groupId && (item.variantType ?? 'productive') === 'productive') {
        return { ...item, variantType: 'simulation' as const, variantOfItemId: candidate.id };
      }
      if (item.id === candidate.id) {
        return {
          ...item,
          variantType: 'productive' as const,
          variantOfItemId: undefined,
          variantLabel: candidate.variantLabel ?? 'Produktiv',
        };
      }
      return item;
    });

    let promoted: OrderItem | null = null;
    this.deps.updateOrder(orderId, (ord) => {
      if (ord.id !== orderId) {
        return ord;
      }
      const next = { ...ord, items: updatedItems };
      promoted = updatedItems.find((it) => it.id === candidate.id) ?? null;
      return next;
    });

    return promoted;
  }

  async mergeSimulationIntoProductive(orderId: string, simulationItemId: string): Promise<OrderVariantMergeResult> {
    const order = this.deps.getOrderById(orderId);
    if (!order) {
      throw new Error('Auftrag nicht gefunden.');
    }
    const sim = order.items.find((it) => it.id === simulationItemId);
    if (!sim || sim.variantType !== 'simulation') {
      throw new Error('Nur Simulationen können abgeglichen werden.');
    }

    const base = findProductiveBase(order, sim);
    if (!base) {
      const created = await this.copySimulationAsProductive(orderId, sim);
      this.deps.markSimulationMerged(orderId, sim.id, created.id, 'applied');
      return { type: 'created', target: created };
    }

    const phase = base.timetablePhase ?? 'bedarf';
    if (phase === 'bedarf') {
      const updated = await this.updateProductiveFromSimulation(orderId, base, sim);
      this.deps.markSimulationMerged(orderId, sim.id, updated.id, 'applied');
      return { type: 'updated', target: updated };
    }

    const modification = await this.createModificationFromSimulation(orderId, base, sim);
    this.deps.markSimulationMerged(orderId, sim.id, modification.id, 'proposed');
    return { type: 'modification', target: modification };
  }

  private async updateProductiveFromSimulation(orderId: string, base: OrderItem, simulation: OrderItem): Promise<OrderItem> {
    let updatedItem: OrderItem | null = null;
    let clonedPlan: TrainPlan | null = null;
    if (simulation.linkedTrainPlanId) {
      const clone = await this.deps.trainPlanService.createPlanVariant(
        simulation.linkedTrainPlanId,
        'productive',
        base.variantLabel ?? 'Produktiv',
      );
      clonedPlan = clone;
      this.deps.linkTrainPlanToItem(clone.id, base.id);
    }
    this.deps.updateOrder(orderId, (ord) => {
      if (ord.id !== orderId) {
        return ord;
      }
      const items = ord.items.map((item) => {
        if (item.id !== base.id) {
          return item;
        }
        const merged = mergeItemFields(item, simulation);
        const enriched = clonedPlan ? this.deps.applyPlanDetailsToItem(merged, clonedPlan) : merged;
        updatedItem = enriched;
        return enriched;
      });
      return { ...ord, items };
    });
    if (!updatedItem) {
      throw new Error('Merge fehlgeschlagen.');
    }
    return updatedItem;
  }

  private async createModificationFromSimulation(orderId: string, base: OrderItem, simulation: OrderItem): Promise<OrderItem> {
    const plan = base.linkedTrainPlanId ? this.deps.trainPlanService.getById(base.linkedTrainPlanId) : null;
    const simPlan = simulation.linkedTrainPlanId
      ? this.deps.trainPlanService.getById(simulation.linkedTrainPlanId)
      : null;
    let modificationPlanId: string | undefined;
    if (plan && simPlan) {
      const mod = await this.deps.trainPlanService.createPlanModification({
        originalPlanId: plan.id,
        title: simPlan.title,
        trainNumber: simPlan.trainNumber,
        responsibleRu: simPlan.responsibleRu,
        calendar: simPlan.calendar,
        trafficPeriodId: simPlan.trafficPeriodId,
        notes: simPlan.notes,
        stops: simPlan.stops.map((stop, index) => ({
          sequence: stop.sequence ?? index + 1,
          type: stop.type,
          locationCode: stop.locationCode,
          locationName: stop.locationName,
          countryCode: stop.countryCode,
          arrivalTime: stop.arrivalTime,
          departureTime: stop.departureTime,
          arrivalOffsetDays: stop.arrivalOffsetDays,
          departureOffsetDays: stop.departureOffsetDays,
          dwellMinutes: stop.dwellMinutes,
          activities: stop.activities,
          platform: stop.platform,
          notes: stop.notes,
        })),
        planVariantType: 'productive',
        variantLabel: 'Modification',
        simulationId: simPlan.simulationId,
        simulationLabel: simPlan.simulationLabel,
      });
      modificationPlanId = mod.id;
    }

    const newItem: OrderItem = {
      ...simulation,
      id: this.deps.generateItemId(orderId),
      variantType: 'productive',
      variantLabel: base.variantLabel ?? 'Produktiv',
      variantOfItemId: base.id,
      variantGroupId: base.variantGroupId ?? base.id,
      parentItemId: base.id,
      childItemIds: [],
      timetablePhase: 'bedarf',
      linkedTrainPlanId: modificationPlanId ?? base.linkedTrainPlanId,
      mergeStatus: undefined,
      mergeTargetId: undefined,
      simulationId: undefined,
      simulationLabel: undefined,
    };
    delete (newItem as Partial<OrderItem>).generatedTimetableRefId;

    this.deps.appendItems(orderId, [newItem]);
    return newItem;
  }

  private async copySimulationAsProductive(orderId: string, simulation: OrderItem): Promise<OrderItem> {
    let clonedPlanId: string | undefined;
    if (simulation.linkedTrainPlanId) {
      const clone = await this.deps.trainPlanService.createPlanVariant(
        simulation.linkedTrainPlanId,
        'productive',
        simulation.variantLabel ?? 'Produktiv',
      );
      clonedPlanId = clone.id;
    }
    const newItem: OrderItem = {
      ...simulation,
      id: this.deps.generateItemId(orderId),
      variantType: 'productive',
      variantLabel: 'Produktiv',
      variantGroupId: simulation.variantGroupId ?? simulation.id,
      variantOfItemId: undefined,
      mergeStatus: undefined,
      mergeTargetId: undefined,
      linkedTrainPlanId: clonedPlanId ?? simulation.linkedTrainPlanId,
      timetablePhase: 'bedarf',
      simulationId: undefined,
      simulationLabel: undefined,
    };
    this.deps.appendItems(orderId, [newItem]);
    return newItem;
  }
}
