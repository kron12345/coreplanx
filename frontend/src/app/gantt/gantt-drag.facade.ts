import { signal } from '@angular/core';
import { CdkDragEnd, CdkDragMove, CdkDragStart } from '@angular/cdk/drag-drop';
import type { Activity } from '../models/activity';
import type { ActivityParticipantCategory } from '../models/activity-ownership';
import { participantCategoryFromKind } from '../models/activity-ownership';
import type { Resource } from '../models/resource';
import type { TimeScaleService } from '../core/services/time-scale.service';
import type { ActivityRepositionEventPayload } from './gantt.models';
import type { GanttActivityDragData } from './gantt-activity.component';
import type { GanttDragStatus } from './gantt-status-bar.component';

type DragFeedbackState = GanttDragStatus['state'];

interface ActivityDragState {
  activity: Activity;
  sourceResourceId: string;
  sourceResourceKind: Resource['kind'] | null;
  participantResourceId: string;
  participantCategory: ActivityParticipantCategory | null;
  isOwnerSlot: boolean;
  hasEnd: boolean;
  mode: 'move' | 'copy';
  pointerOffsetPx: number | null;
  durationMs: number;
  sourceCell: HTMLElement | null;
  hoverCell: HTMLElement | null;
  hoverRow: HTMLElement | null;
  pendingTarget: {
    resourceId: string;
    resourceKind: Resource['kind'] | null;
    start: Date;
    end: Date | null;
    leftPx: number;
    participantCategory: ActivityParticipantCategory | null;
  } | null;
}

export class GanttDragFacade {
  private readonly dragFeedbackSignal = signal<GanttDragStatus>({ state: 'idle', message: '' });
  readonly dragStatus = this.dragFeedbackSignal.asReadonly();

  private readonly dragTimeFormat = new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });

  private dragState: ActivityDragState | null = null;
  private dragOriginCell: HTMLElement | null = null;
  private dragOriginRow: HTMLElement | null = null;
  private dragBadgeElement: HTMLElement | null = null;

  private dragEditBlockUntil = 0;
  private dragEditBlockGlobalUntil = 0;
  private dragEditBlockActivityId: string | null = null;

  constructor(
    private readonly deps: {
      host: () => HTMLElement;
      viewportReady: () => boolean;
      timeScale: TimeScaleService;
      resourceMap: () => Map<string, Resource>;
      resourceKindMap: () => Map<string, Resource['kind']>;
      suppressNextTimelineClick: () => void;
      emitReposition: (payload: ActivityRepositionEventPayload) => void;
      emitCopy: (payload: ActivityRepositionEventPayload) => void;
    },
  ) {}

  cleanup(): void {
    this.updateDragBadge(null);
  }

  shouldBlockEdit(activityId: string): boolean {
    if (Date.now() < this.dragEditBlockGlobalUntil) {
      return true;
    }
    if (this.dragState && this.dragState.activity.id === activityId) {
      return true;
    }
    if (!this.dragEditBlockActivityId || this.dragEditBlockActivityId !== activityId) {
      return false;
    }
    if (Date.now() < this.dragEditBlockUntil) {
      return true;
    }
    this.dragEditBlockActivityId = null;
    this.dragEditBlockUntil = 0;
    this.dragEditBlockGlobalUntil = 0;
    return false;
  }

  handleDragStarted(event: CdkDragStart<GanttActivityDragData>): void {
    if (!this.deps.viewportReady()) {
      this.setDragFeedback('invalid', 'Zeitachse nicht bereit.');
      return;
    }
    this.deps.suppressNextTimelineClick();
    this.blockActivityEdit(event.source.data.activity.id);
    const activity = event.source.data.activity;
    const sourceCell = this.findTimelineCellForElement(event.source.element.nativeElement);
    const sourceResourceKind = this.deps.resourceKindMap().get(event.source.data.resourceId) ?? null;
    const participantCategory =
      event.source.data.participantCategory ?? participantCategoryFromKind(sourceResourceKind ?? undefined);
    this.dragState = {
      activity,
      sourceResourceId: event.source.data.resourceId,
      sourceResourceKind,
      participantResourceId: event.source.data.participantResourceId ?? event.source.data.resourceId,
      participantCategory,
      isOwnerSlot: event.source.data.isOwnerSlot ?? true,
      mode: event.source.data.mode ?? 'move',
      hasEnd: !!activity.end,
      pointerOffsetPx: null,
      durationMs:
        activity.end && activity.end.length > 0
          ? new Date(activity.end).getTime() - new Date(activity.start).getTime()
          : 0,
      sourceCell,
      hoverCell: null,
      hoverRow: null,
      pendingTarget: null,
    };
    this.deps.host().classList.add('gantt--dragging');
    this.setDragOriginCell(sourceCell);
    this.applyDragHoverCell(sourceCell);
    this.setDragFeedback('info', 'Leistung wird verschoben …');
  }

  handleDragMoved(event: CdkDragMove<GanttActivityDragData>): void {
    if (!this.deps.viewportReady() || !this.dragState) {
      return;
    }
    const pointer = event.pointerPosition;
    const pointerCell = this.findResourceCellAtPoint(pointer.x, pointer.y);
    const positionCell = pointerCell ?? this.dragState.sourceCell;
    if (!positionCell) {
      this.dragState.pendingTarget = null;
      this.applyDragHoverCell(null);
      this.updateDragBadge('Außerhalb Bereich', pointer);
      this.setDragFeedback('invalid', 'Zeiger außerhalb der Ressourcen.');
      return;
    }
    if (pointerCell !== this.dragState.hoverCell) {
      this.applyDragHoverCell(pointerCell);
    }
    if (this.dragState.pointerOffsetPx === null) {
      const rect = positionCell.getBoundingClientRect();
      const pointerRelativeX = pointer.x - rect.left + positionCell.scrollLeft;
      const barLeft = event.source.data.initialLeft;
      this.dragState.pointerOffsetPx = pointerRelativeX - barLeft;
    }
    const pointerOffset = this.dragState.pointerOffsetPx ?? 0;
    const rect = positionCell.getBoundingClientRect();
    const relativeX = pointer.x - rect.left + positionCell.scrollLeft;
    const targetLeft = relativeX - pointerOffset;
    const clampedLeft = this.clampTimelineLeftPx(targetLeft);
    const pointerResourceId = pointerCell?.dataset['resourceId'] ?? null;
    const pointerResourceKind = pointerResourceId ? this.deps.resourceKindMap().get(pointerResourceId) ?? null : null;
    const fallbackResourceId = this.dragState.pendingTarget?.resourceId ?? this.dragState.sourceResourceId;
    const targetResourceId = pointerResourceId ?? fallbackResourceId;
    let targetResourceKind =
      pointerResourceKind ??
      (targetResourceId === this.dragState.sourceResourceId
        ? this.dragState.sourceResourceKind
        : this.dragState.pendingTarget?.resourceKind ?? null);
    const sameResource = targetResourceId === this.dragState.sourceResourceId;
    const sourceKind = this.deps.resourceKindMap().get(this.dragState.sourceResourceId) ?? this.dragState.sourceResourceKind;
    this.dragState.sourceResourceKind = sourceKind ?? this.dragState.sourceResourceKind ?? null;
    const requiredCategory = this.dragState.participantCategory;
    const pointerCategory = pointerResourceKind ? participantCategoryFromKind(pointerResourceKind ?? undefined) : null;
    const categoryMismatch = (candidate: ActivityParticipantCategory | null) => {
      if (!requiredCategory || requiredCategory === 'other') {
        return false;
      }
      if (!candidate || candidate === 'other') {
        return true;
      }
      return candidate !== requiredCategory;
    };
    if (!sameResource) {
      if (pointerResourceId && pointerResourceId !== this.dragState.sourceResourceId) {
        if (categoryMismatch(pointerCategory)) {
          this.dragState.pendingTarget = null;
          this.applyDragHoverCell(pointerCell);
          this.updateDragBadge(`Nur ${this.describeParticipantCategory(requiredCategory)}`, pointer);
          this.setDragFeedback(
            'invalid',
            `Nur ${this.describeParticipantCategory(requiredCategory)} können dieses Element aufnehmen.`,
          );
          return;
        }
        targetResourceKind = pointerResourceKind;
      } else {
        if (!this.dragState.pendingTarget || this.dragState.pendingTarget.resourceId === this.dragState.sourceResourceId) {
          this.dragState.pendingTarget = null;
          this.applyDragHoverCell(pointerCell);
          this.updateDragBadge('Kein Ziel', pointer);
          this.setDragFeedback('invalid', 'Kein gültiger Zielbereich ausgewählt.');
          return;
        }
        targetResourceKind = this.dragState.pendingTarget.resourceKind;
      }
    } else if (pointerResourceId && categoryMismatch(pointerCategory)) {
      this.dragState.pendingTarget = null;
      this.applyDragHoverCell(pointerCell);
      this.updateDragBadge(`Nur ${this.describeParticipantCategory(requiredCategory)}`, pointer);
      this.setDragFeedback(
        'invalid',
        `Nur ${this.describeParticipantCategory(requiredCategory)} können dieses Element aufnehmen.`,
      );
      return;
    }

    let startTime = this.deps.timeScale.pxToTime(clampedLeft);
    let endTime =
      this.dragState.hasEnd && this.dragState.durationMs > 0
        ? new Date(startTime.getTime() + this.dragState.durationMs)
        : null;
    if (!sameResource) {
      startTime = new Date(this.dragState.activity.start);
      endTime =
        this.dragState.hasEnd && this.dragState.activity.end ? new Date(this.dragState.activity.end) : null;
    }

    this.dragState.pendingTarget = {
      resourceId: targetResourceId,
      resourceKind: targetResourceKind ?? null,
      start: startTime,
      end: endTime,
      leftPx: clampedLeft,
      participantCategory: pointerCategory ?? this.dragState.participantCategory ?? null,
    };

    const badgeLabel = sameResource
      ? `${this.formatTimeLabel(startTime)}`
      : `${this.getResourceName(targetResourceId)} • ${this.formatTimeLabel(startTime)}`;
    this.updateDragBadge(badgeLabel, pointer);
    if (sameResource) {
      const verb = this.dragState.mode === 'copy' ? 'kopiert' : 'verschoben';
      this.setDragFeedback('valid', `Loslassen ${verb} Start auf ${this.formatTimeLabel(startTime)}.`);
    } else {
      const verb = this.dragState.mode === 'copy' ? 'kopiert' : 'verschiebt';
      this.setDragFeedback('valid', `Loslassen ${verb} auf "${this.getResourceName(targetResourceId)}".`);
    }
  }

  handleDragEnded(event: CdkDragEnd<GanttActivityDragData>): void {
    if (!this.dragState) {
      return;
    }
    this.blockActivityEdit(this.dragState.activity.id);
    this.deps.host().classList.remove('gantt--dragging');
    this.applyDragHoverCell(null);
    this.setDragOriginCell(null);
    this.updateDragBadge(null);
    const pending = this.dragState.pendingTarget;
    const activity = this.dragState.activity;
    const originalStartMs = new Date(activity.start).getTime();
    const originalEndMs = this.dragState.hasEnd && activity.end ? new Date(activity.end).getTime() : null;
    if (!pending) {
      this.setDragFeedback('invalid', 'Keine gültige Zielposition – Aktion verworfen.');
      event.source.reset();
      this.dragState = null;
      return;
    }
    const pendingEndMs = pending.end ? pending.end.getTime() : null;
    const changedStart = pending.start.getTime() !== originalStartMs;
    const changedDuration = pendingEndMs !== originalEndMs;
    const resourceChanged = pending.resourceId !== this.dragState.sourceResourceId;
    if (resourceChanged || changedStart || changedDuration) {
      const emitEnd =
        this.dragState.hasEnd && pending.end ? pending.end : this.dragState.hasEnd ? new Date(pending.start) : null;
      const payload: ActivityRepositionEventPayload = {
        activity,
        start: pending.start,
        end: emitEnd,
        targetResourceId: pending.resourceId,
        sourceResourceId: this.dragState.sourceResourceId,
        participantCategory: this.dragState.participantCategory,
        participantResourceId: this.dragState.participantResourceId,
        isOwnerSlot: this.dragState.isOwnerSlot,
      };
      if (this.dragState.mode === 'copy') {
        this.deps.emitCopy(payload);
        if (resourceChanged) {
          this.setDragFeedback('info', `Leistung auf "${this.getResourceName(pending.resourceId)}" kopiert.`);
        } else {
          this.setDragFeedback('info', `Kopie bei ${this.formatTimeLabel(pending.start)} erstellt.`);
        }
      } else {
        this.deps.emitReposition(payload);
        if (resourceChanged) {
          this.setDragFeedback('info', `Leistung auf "${this.getResourceName(pending.resourceId)}" verschoben.`);
        } else if (changedStart || changedDuration) {
          this.setDragFeedback('info', `Startzeit aktualisiert (${this.formatTimeLabel(pending.start)}).`);
        }
      }
    } else {
      this.setDragFeedback('info', 'Keine Änderung – ursprüngliche Position bleibt erhalten.');
    }
    event.source.reset();
    this.dragState = null;
  }

  private blockActivityEdit(activityId: string): void {
    this.dragEditBlockActivityId = activityId;
    this.dragEditBlockUntil = Date.now() + 1500;
    this.dragEditBlockGlobalUntil = this.dragEditBlockUntil;
  }

  private setDragFeedback(state: DragFeedbackState, message: string): void {
    this.dragFeedbackSignal.set({ state, message });
  }

  private getResourceName(id: string | null): string {
    if (!id) {
      return '';
    }
    return this.deps.resourceMap().get(id)?.name ?? id;
  }

  private formatTimeLabel(date: Date): string {
    return this.dragTimeFormat.format(date);
  }

  private describeParticipantCategory(category: ActivityParticipantCategory | null): string {
    switch (category) {
      case 'vehicle':
        return 'Fahrzeugressourcen';
      case 'personnel':
        return 'Personalressourcen';
      default:
        return 'passende Ressourcen';
    }
  }

  private setDragOriginCell(cell: HTMLElement | null): void {
    if (this.dragOriginCell === cell) {
      return;
    }
    this.dragOriginCell?.classList.remove('gantt__timeline-cell--drag-origin');
    this.dragOriginRow?.classList.remove('gantt__row--drag-origin');
    if (cell) {
      cell.classList.add('gantt__timeline-cell--drag-origin');
      const row = this.findRowForCell(cell);
      row?.classList.add('gantt__row--drag-origin');
      this.dragOriginRow = row;
    } else {
      this.dragOriginRow = null;
    }
    this.dragOriginCell = cell;
  }

  private applyDragHoverCell(cell: HTMLElement | null): void {
    if (!this.dragState) {
      return;
    }
    if (this.dragState.hoverCell === cell) {
      return;
    }
    this.dragState.hoverCell?.classList.remove('gantt__timeline-cell--drag-hover');
    this.dragState.hoverRow?.classList.remove('gantt__row--drag-hover');
    if (cell) {
      cell.classList.add('gantt__timeline-cell--drag-hover');
      const row = this.findRowForCell(cell);
      if (row) {
        row.classList.add('gantt__row--drag-hover');
      }
      this.dragState.hoverRow = row ?? null;
    } else {
      this.dragState.hoverRow = null;
    }
    this.dragState.hoverCell = cell;
  }

  private findRowForCell(cell: HTMLElement | null): HTMLElement | null {
    if (!cell) {
      return null;
    }
    return cell.closest('.gantt__row') as HTMLElement | null;
  }

  private updateDragBadge(label: string | null, pointer?: { x: number; y: number } | null): void {
    if (!label) {
      if (this.dragBadgeElement) {
        this.dragBadgeElement.remove();
        this.dragBadgeElement = null;
      }
      return;
    }
    if (!this.dragBadgeElement) {
      const badge = document.createElement('div');
      badge.className = 'gantt-drag-badge';
      document.body.appendChild(badge);
      this.dragBadgeElement = badge;
    }
    this.dragBadgeElement.textContent = label;
    if (pointer) {
      const offsetX = 0;
      const offsetY = -30;
      this.dragBadgeElement.style.left = `${pointer.x + offsetX}px`;
      this.dragBadgeElement.style.top = `${pointer.y + offsetY}px`;
    }
  }

  private findTimelineCellForElement(element: HTMLElement | null): HTMLElement | null {
    if (!element) {
      return null;
    }
    return element.closest('.gantt__timeline-cell') as HTMLElement | null;
  }

  private findResourceCellAtPoint(x: number, y: number): HTMLElement | null {
    const host = this.deps.host();
    const stack = document.elementsFromPoint(x, y) as HTMLElement[];
    for (const element of stack) {
      if (!host.contains(element)) {
        continue;
      }
      const cell = this.findTimelineCellForElement(element);
      if (cell && cell.dataset['resourceId']) {
        return cell;
      }
    }
    return null;
  }

  private clampTimelineLeftPx(value: number): number {
    const width = this.deps.timeScale.contentWidth();
    if (!Number.isFinite(width) || width <= 0) {
      return Math.max(0, value);
    }
    return Math.min(Math.max(0, value), width);
  }
}
