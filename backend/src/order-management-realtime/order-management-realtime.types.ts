export type OrderManagementScope = 'orders' | 'business' | 'customers' | 'templates';

export type OrderManagementEntityType =
  | 'order'
  | 'orderItem'
  | 'business'
  | 'customer'
  | 'scheduleTemplate'
  | 'businessTemplate';

export type OrderManagementRealtimeAction = 'upsert' | 'delete';

export interface OrderManagementRealtimeEvent {
  scope: OrderManagementScope;
  entityType: OrderManagementEntityType;
  entityId: string;
  action: OrderManagementRealtimeAction;
  payload?: unknown;
  at?: string;
  sourceConnectionId?: string | null;
}

export interface OrderManagementSessionHello {
  userId?: string | null;
  name?: string | null;
  color?: string | null;
}

export interface OrderManagementPresenceUpdate {
  scope?: OrderManagementScope | null;
  boardId?: string | null;
}

export interface OrderManagementPresenceSnapshot {
  scope: OrderManagementScope;
  boardId?: string | null;
  users: Array<{
    userId: string;
    name?: string | null;
    color?: string | null;
    tabCount: number;
  }>;
  at?: string;
}

export interface OrderManagementSelectionUpdate {
  scope: OrderManagementScope;
  entityType: OrderManagementEntityType;
  entityIds: string[];
  primaryId?: string | null;
  userId: string;
  name?: string | null;
  color?: string | null;
  mode?: 'select' | 'edit';
  sourceConnectionId?: string | null;
  at?: string;
}

export interface OrderManagementSelectionSnapshot {
  scope: OrderManagementScope;
  selections: OrderManagementSelectionUpdate[];
  at?: string;
}

export interface OrderManagementEditUpdate {
  scope: OrderManagementScope;
  entityType: OrderManagementEntityType;
  entityId: string;
  userId: string;
  name?: string | null;
  color?: string | null;
  field?: string | null;
  value?: unknown;
  state?: 'start' | 'focus' | 'change' | 'blur' | 'end';
  fields?: Record<string, unknown>;
  sourceConnectionId?: string | null;
  at?: string;
}

export interface OrderManagementEditSnapshot {
  scope: OrderManagementScope;
  edits: OrderManagementEditUpdate[];
  at?: string;
}

export interface OrderManagementCursorUpdate {
  scope: OrderManagementScope;
  entityType?: OrderManagementEntityType | null;
  entityId?: string | null;
  userId: string;
  name?: string | null;
  color?: string | null;
  sourceConnectionId?: string | null;
  at?: string;
}
