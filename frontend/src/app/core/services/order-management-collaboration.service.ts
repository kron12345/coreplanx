import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ClientIdentityService } from './client-identity.service';
import {
  OrderManagementCursorUpdate,
  OrderManagementEditUpdate,
  OrderManagementEntityType,
  OrderManagementPresenceSnapshot,
  OrderManagementPresenceUpdate,
  OrderManagementRealtimeService,
  OrderManagementScope,
  OrderManagementSelectionUpdate,
} from './order-management-realtime.service';

type SelectionEntry = OrderManagementSelectionUpdate & { key: string };
type EditEntry = OrderManagementEditUpdate & { key: string };
type CursorEntry = OrderManagementCursorUpdate & { key: string };

@Injectable({ providedIn: 'root' })
export class OrderManagementCollaborationService {
  private readonly realtime = inject(OrderManagementRealtimeService);
  private readonly identity = inject(ClientIdentityService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly activeScope = signal<OrderManagementScope>('orders');
  private readonly activeBoardId = signal<string | null>(null);
  private readonly presenceUsers = signal<OrderManagementPresenceUpdate[]>([]);
  private readonly selections = signal<SelectionEntry[]>([]);
  private readonly edits = signal<EditEntry[]>([]);
  private readonly cursors = signal<CursorEntry[]>([]);

  readonly presence = computed(() => this.presenceUsers());

  constructor() {
    this.realtime
      .presence()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => this.handlePresence(payload));

    this.realtime
      .selections()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => this.handleSelection(payload));

    this.realtime
      .editUpdates()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => this.handleEdit(payload));

    this.realtime
      .cursor()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => this.handleCursor(payload));
  }

  setScope(scope: OrderManagementScope, boardId?: string | null): void {
    this.activeScope.set(scope);
    this.activeBoardId.set(boardId ?? null);
    this.presenceUsers.set([]);
    this.selections.set([]);
    this.edits.set([]);
    this.cursors.set([]);
    this.realtime.setScope(scope, boardId ?? null);
  }

  selectionsFor(entityType: OrderManagementEntityType, entityId: string): OrderManagementSelectionUpdate[] {
    return this.selections().filter(
      (entry) =>
        entry.entityType === entityType &&
        entry.entityIds.includes(entityId),
    );
  }

  editsFor(entityType: OrderManagementEntityType, entityId: string): OrderManagementEditUpdate[] {
    return this.edits().filter(
      (entry) => entry.entityType === entityType && entry.entityId === entityId,
    );
  }

  cursorsFor(entityType: OrderManagementEntityType, entityId: string): OrderManagementCursorUpdate[] {
    return this.cursors().filter(
      (entry) => entry.entityType === entityType && entry.entityId === entityId,
    );
  }

  sendSelection(payload: {
    entityType: OrderManagementEntityType;
    entityIds: string[];
    primaryId?: string | null;
    mode?: 'select' | 'edit';
  }): void {
    this.realtime.sendSelection(payload);
  }

  sendEditUpdate(payload: {
    entityType: OrderManagementEntityType;
    entityId: string;
    field?: string | null;
    value?: unknown;
    state?: 'start' | 'focus' | 'change' | 'blur' | 'end';
  }): void {
    this.realtime.sendEditUpdate(payload);
  }

  sendCursor(payload: {
    entityType?: OrderManagementEntityType | null;
    entityId?: string | null;
  }): void {
    this.realtime.sendCursor(payload);
  }

  private handlePresence(
    payload: OrderManagementPresenceSnapshot | OrderManagementPresenceUpdate,
  ): void {
    if (!this.isActiveScope(payload.scope, payload.boardId ?? null)) {
      return;
    }
    if (this.isPresenceSnapshot(payload)) {
      const users = payload.users.map((entry) => ({
        ...entry,
        scope: payload.scope,
        boardId: payload.boardId ?? null,
      }));
      this.presenceUsers.set(users);
      return;
    }
    this.presenceUsers.update((current) => {
      const next = current.filter((entry) => entry.userId !== payload.userId);
      next.push(payload);
      return next;
    });
  }

  private handleSelection(payload: {
    scope: OrderManagementScope;
    selections?: OrderManagementSelectionUpdate[];
    entityIds?: string[];
    primaryId?: string | null;
    sourceConnectionId?: string | null;
  }): void {
    if (!this.isActiveScope(payload.scope, null)) {
      return;
    }
    const connectionId = this.realtime.connectionId();
    if (payload.selections) {
      const next = payload.selections
        .filter((entry) => !this.isSelf(entry.sourceConnectionId, connectionId))
        .map((entry) => ({ ...entry, key: this.selectionKey(entry) }));
      this.selections.set(next);
      return;
    }

    const entry = payload as OrderManagementSelectionUpdate;
    if (this.isSelf(entry.sourceConnectionId, connectionId)) {
      return;
    }
    const key = this.selectionKey(entry);
    const shouldClear = (entry.entityIds?.length ?? 0) === 0 && !entry.primaryId;
    this.selections.update((current) => {
      const next = current.filter((item) => item.key !== key);
      if (!shouldClear) {
        next.push({ ...entry, key });
      }
      return next;
    });
  }

  private handleEdit(payload: {
    scope: OrderManagementScope;
    edits?: OrderManagementEditUpdate[];
    sourceConnectionId?: string | null;
    state?: string;
  }): void {
    if (!this.isActiveScope(payload.scope, null)) {
      return;
    }
    const connectionId = this.realtime.connectionId();
    if (payload.edits) {
      const next = payload.edits
        .filter((entry) => !this.isSelf(entry.sourceConnectionId, connectionId))
        .map((entry) => ({ ...entry, key: this.editKey(entry) }));
      this.edits.set(next);
      return;
    }

    const entry = payload as OrderManagementEditUpdate;
    if (this.isSelf(entry.sourceConnectionId, connectionId)) {
      return;
    }
    const key = this.editKey(entry);
    const shouldClear = entry.state === 'end';
    this.edits.update((current) => {
      const next = current.filter((item) => item.key !== key);
      if (!shouldClear) {
        next.push({ ...entry, key });
      }
      return next;
    });
  }

  private handleCursor(payload: OrderManagementCursorUpdate): void {
    if (!this.isActiveScope(payload.scope, null)) {
      return;
    }
    const connectionId = this.realtime.connectionId();
    if (this.isSelf(payload.sourceConnectionId, connectionId)) {
      return;
    }
    const key = this.cursorKey(payload);
    const shouldClear = !payload.entityId;
    this.cursors.update((current) => {
      const next = current.filter((entry) => entry.key !== key);
      if (!shouldClear) {
        next.push({ ...payload, key });
      }
      return next;
    });
  }

  private isActiveScope(scope: OrderManagementScope, boardId: string | null): boolean {
    if (scope !== this.activeScope()) {
      return false;
    }
    const activeBoard = this.activeBoardId();
    if (!activeBoard && !boardId) {
      return true;
    }
    return (activeBoard ?? null) === (boardId ?? null);
  }

  private isPresenceSnapshot(
    payload: OrderManagementPresenceSnapshot | OrderManagementPresenceUpdate,
  ): payload is OrderManagementPresenceSnapshot {
    return Array.isArray((payload as OrderManagementPresenceSnapshot).users);
  }

  private isSelf(sourceConnectionId: string | null | undefined, connectionId: string | null): boolean {
    if (!sourceConnectionId || !connectionId) {
      return false;
    }
    return sourceConnectionId === connectionId;
  }

  private selectionKey(entry: OrderManagementSelectionUpdate): string {
    return entry.sourceConnectionId ?? entry.userId ?? this.identity.userId();
  }

  private editKey(entry: OrderManagementEditUpdate): string {
    return entry.sourceConnectionId ?? entry.userId ?? this.identity.userId();
  }

  private cursorKey(entry: OrderManagementCursorUpdate): string {
    return entry.sourceConnectionId ?? entry.userId ?? this.identity.userId();
  }
}
