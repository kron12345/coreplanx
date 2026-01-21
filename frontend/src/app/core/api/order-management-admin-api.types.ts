export type OrderManagementSeedMode = 'replace' | 'append';

export interface OrderManagementAdminSummary {
  generatedAt: string;
  totals: {
    customers: number;
    businesses: number;
    scheduleTemplates: number;
    orders: number;
    orderItems: number;
  };
}

export interface OrderManagementAdminClearResponse {
  clearedAt: string;
  deleted: {
    customers: number;
    businesses: number;
    scheduleTemplates: number;
    scheduleTemplateStops: number;
    orders: number;
    orderItems: number;
    businessLinks: number;
  };
}

export interface OrderManagementAdminSeedResponse {
  seededAt: string;
  inserted: {
    customers: number;
    businesses: number;
    scheduleTemplates: number;
    scheduleTemplateStops: number;
    orders: number;
    orderItems: number;
    businessLinks: number;
  };
  warnings: string[];
}
