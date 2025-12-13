import { Order } from '../../core/models/order.model';

export interface OrderPositionDialogData {
  order: Order;
}

export type OrderPositionMode = 'service' | 'plan' | 'manualPlan' | 'import';

export type SimulationMode = 'plan' | 'manual' | 'import';

export interface ImportFilterValues {
  search: string;
  start: string;
  end: string;
  templateId: string;
  irregularOnly: boolean;
  minDeviation: number;
  deviationSort: 'none' | 'asc' | 'desc';
}

export interface RailMlOperatingPeriod {
  id: string;
  description?: string;
  operatingCode: string;
  startDate?: string;
  endDate?: string;
}

export interface RailMlTimetablePeriod {
  id: string;
  startDate?: string;
  endDate?: string;
}
