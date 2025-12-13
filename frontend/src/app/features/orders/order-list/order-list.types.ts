import type { Order } from '../../../core/models/order.model';
import type { OrderItem } from '../../../core/models/order-item.model';
import type { OrderFilters } from '../../../core/services/order.service';

export interface OrderSummary {
  order: Order;
  items: OrderItem[];
  itemCount: number;
  upcomingCount: number;
  attentionCount: number;
  tags: string[];
  customer?: string;
  timetableYear?: string;
  responsibles: string[];
}

export interface OrderHeroMetrics {
  totalOrders: number;
  totalItems: number;
  upcomingItems: number;
  attentionItems: number;
  phaseCoverage: number;
  rollingPlanningItems: number;
  shortTermItems: number;
  adHocItems: number;
}

export interface SearchSuggestion {
  label: string;
  value: string;
  icon: string;
  description: string;
}

export interface OrdersHealthInsight {
  tone: 'ok' | 'warn' | 'critical';
  attentionPercent: number;
  upcomingPercent: number;
  summary: string;
  icon: string;
  title: string;
}

export interface CollaborationContext {
  title: string;
  message: string;
  hint: string;
  icon: string;
}

export interface OrderFilterPreset {
  id: string;
  name: string;
  filters: OrderFilters;
}

