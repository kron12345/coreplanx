import { Order, OrderProcessStatus } from '../../models/order.model';
import { OrderItem } from '../../models/order-item.model';
import { TimetableYearService } from '../timetable-year.service';
import { CustomerService } from '../customer.service';
import { deriveOrderTimetableYear } from './order-timetable.utils';
import { ensureItemDefaults, normalizeItemsAfterChange } from './order-normalize.utils';

export interface OrderInitDeps {
  customerService: CustomerService;
  timetableYearService: TimetableYearService;
  getItemTimetableYear: (item: OrderItem) => string | null;
}

export function resolveCustomerName(
  customerService: CustomerService,
  customerId: string | undefined,
  fallback?: string,
): string | undefined {
  if (customerId) {
    const customer = customerService.getById(customerId);
    if (customer) {
      return customer.name;
    }
  }
  const trimmed = fallback?.trim();
  return trimmed?.length ? trimmed : undefined;
}

export function initializeOrder(order: Order, deps: OrderInitDeps): Order {
  const prepared = order.items.map((item) => ensureItemDefaults(item));
  const customer = resolveCustomerName(deps.customerService, order.customerId, order.customer);
  const timetableYearLabel =
    order.timetableYearLabel ??
    deriveOrderTimetableYear(prepared, (item) => deps.getItemTimetableYear(item)) ??
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

export function generateOrderId(): string {
  return `A-${Date.now().toString(36).toUpperCase()}`;
}

export function generateItemId(orderId: string): string {
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${orderId}-OP-${suffix}`;
}
