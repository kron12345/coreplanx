import { computed, signal } from '@angular/core';
import type { Activity } from '../models/activity';
import type { Resource } from '../models/resource';
import type {
  ActivitySelectionEventPayload,
  ActivitySelectionMode,
  ActivitySlotSelection,
  NormalizedRect,
  SelectionBox,
} from './gantt.models';
import type { GanttActivitySelectionEvent } from './gantt-activity.component';

export function encodeSelectionSlot(activityId: string, resourceId: string): string {
  return `${activityId}:::${resourceId}`;
}

function decodeSelectionSlot(key: string): ActivitySlotSelection {
  const [activityId, resourceId] = key.split(':::', 2);
  return {
    activityId,
    resourceId: resourceId ?? '',
  };
}

export class GanttSelectionFacade {
  private readonly lassoActivationThreshold = 6;
  private lassoFrameHandle: number | null = null;
  private lassoState: {
    pointerId: number;
    originX: number;
    originY: number;
    currentX: number;
    currentY: number;
    additive: boolean;
  } | null = null;
  private lassoPointerContainer: HTMLElement | null = null;
  private lassoHits = new Map<string, Set<string>>();
  private lassoCandidateCache: {
    candidates: Array<{
      activityId: string;
      resourceId: string;
      left: number;
      top: number;
      right: number;
      bottom: number;
    }>;
    baseScrollLeft: number;
    baseScrollTop: number;
  } | null = null;

  private readonly selectedActivityIdsSignal = signal<Set<string>>(new Set());
  readonly selectedActivityIds = this.selectedActivityIdsSignal.asReadonly();

  private readonly primarySelectionSlotsSignal = signal<Set<string>>(new Set());
  readonly primarySelectionSlots = this.primarySelectionSlotsSignal.asReadonly();

  private readonly lassoPreviewSelectionSignal = signal<Set<string>>(new Set());
  readonly lassoPreviewSelection = this.lassoPreviewSelectionSignal.asReadonly();

  private readonly lassoBoxSignal = signal<SelectionBox | null>(null);
  readonly lassoBox = this.lassoBoxSignal.asReadonly();

  readonly displayedSelectionIds = computed<ReadonlySet<string>>(() => {
    const base = this.selectedActivityIdsSignal();
    const preview = this.lassoPreviewSelectionSignal();
    if (!preview.size) {
      return base;
    }
    const combined = new Set(base);
    preview.forEach((id) => combined.add(id));
    return combined;
  });

  constructor(
    private readonly deps: {
      host: () => HTMLElement;
      getResourceById: (id: string) => Resource | undefined;
      getActivityById: (id: string) => Activity | undefined;
      emitSelectionToggle: (payload: ActivitySelectionEventPayload) => void;
      suppressNextTimelineClick: () => void;
    },
  ) {}

  isLassoActive(): boolean {
    return this.lassoState !== null;
  }

  refreshLassoVisual(): void {
    if (!this.lassoState) {
      return;
    }
    this.updateLassoVisual();
  }

  setSelectedActivityIds(value: string[] | null | undefined): void {
    const next = new Set(value ?? []);
    this.selectedActivityIdsSignal.set(next);
    this.prunePrimarySelectionSlots(next);
  }

  handleActivitySelectionToggle(resource: Resource, event: GanttActivitySelectionEvent): void {
    if (event.selectionMode === 'set') {
      this.setPrimarySelectionSlots([{ activityId: event.activity.id, resourceId: resource.id }]);
      return;
    }
    const currentlySelected = this.selectedActivityIdsSignal().has(event.activity.id);
    if (currentlySelected) {
      this.removePrimarySelectionSlot(event.activity.id, resource.id);
    } else {
      this.addPrimarySelectionSlots([{ activityId: event.activity.id, resourceId: resource.id }]);
    }
  }

  shouldStartLasso(event: PointerEvent, host: HTMLElement | null, isActivityTarget: boolean): boolean {
    if (!host || isActivityTarget) {
      return false;
    }
    if (!host.dataset['resourceId']) {
      return false;
    }
    return event.shiftKey || event.altKey || event.metaKey || event.ctrlKey;
  }

  beginLassoSelection(event: PointerEvent, host: HTMLElement): void {
    this.lassoState = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      additive: event.metaKey || event.shiftKey,
    };
    this.lassoPointerContainer = host;
    this.lassoHits = new Map<string, Set<string>>();
    this.captureLassoCandidates();
    this.lassoPreviewSelectionSignal.set(new Set());
    this.lassoBoxSignal.set(null);
    host.setPointerCapture?.(event.pointerId);
  }

  handlePointerMove(event: PointerEvent): boolean {
    if (!this.lassoState || event.pointerId !== this.lassoState.pointerId) {
      return false;
    }
    this.lassoState.currentX = event.clientX;
    this.lassoState.currentY = event.clientY;
    this.scheduleLassoVisualUpdate();
    event.preventDefault();
    return true;
  }

  handlePointerUp(event: PointerEvent): boolean {
    if (!this.lassoState || event.pointerId !== this.lassoState.pointerId) {
      return false;
    }
    const rect = this.computeLassoRect();
    const target = (event.currentTarget as HTMLElement | null) ?? this.lassoPointerContainer;
    if (target?.hasPointerCapture?.(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    const hits = new Map<string, Set<string>>();
    this.lassoHits.forEach((set, activityId) => hits.set(activityId, new Set(set)));
    const additive = this.lassoState.additive;
    this.resetLassoState();
    this.deps.suppressNextTimelineClick();
    if (!rect) {
      event.preventDefault();
      return true;
    }
    if (hits.size === 0) {
      event.preventDefault();
      return true;
    }
    this.applyLassoSelection(hits, additive);
    event.preventDefault();
    return true;
  }

  private updateLassoVisual(): void {
    const rect = this.computeLassoRect();
    if (!rect) {
      this.lassoBoxSignal.set(null);
      this.lassoPreviewSelectionSignal.set(new Set());
      this.lassoHits = new Map<string, Set<string>>();
      return;
    }
    const hostRect = this.deps.host().getBoundingClientRect();
    const box: SelectionBox = {
      left: rect.left - hostRect.left,
      top: rect.top - hostRect.top,
      width: rect.width,
      height: rect.height,
    };
    this.lassoBoxSignal.set(box);
    this.updateLassoHits(rect);
  }

  private scheduleLassoVisualUpdate(): void {
    if (this.lassoFrameHandle !== null) {
      return;
    }
    const flush = () => {
      this.lassoFrameHandle = null;
      if (!this.lassoState) {
        return;
      }
      this.updateLassoVisual();
    };
    if (typeof requestAnimationFrame === 'function') {
      this.lassoFrameHandle = requestAnimationFrame(flush);
      return;
    }
    this.lassoFrameHandle = window.setTimeout(flush, 16);
  }

  private computeLassoRect(): NormalizedRect | null {
    if (!this.lassoState) {
      return null;
    }
    const { originX, originY, currentX, currentY } = this.lassoState;
    const width = Math.abs(currentX - originX);
    const height = Math.abs(currentY - originY);
    if (width < this.lassoActivationThreshold && height < this.lassoActivationThreshold) {
      return null;
    }
    const left = Math.min(originX, currentX);
    const top = Math.min(originY, currentY);
    return {
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
    };
  }

  private updateLassoHits(rect: NormalizedRect): void {
    const hits = new Map<string, Set<string>>();
    const preview = new Set<string>();
    const candidates = this.lassoCandidateCache?.candidates ?? [];
    const scrollLeft = this.lassoPointerContainer?.scrollLeft ?? 0;
    const scrollTop = this.viewportScrollTop();
    const baseScrollLeft = this.lassoCandidateCache?.baseScrollLeft ?? scrollLeft;
    const baseScrollTop = this.lassoCandidateCache?.baseScrollTop ?? scrollTop;
    const dx = scrollLeft - baseScrollLeft;
    const dy = scrollTop - baseScrollTop;

    if (!candidates.length) {
      const elements = this.deps.host().querySelectorAll('.gantt-activity[data-activity-id]');
      elements.forEach((element: Element) => {
        const activityElement = element as HTMLElement;
        if (activityElement.dataset['preview'] === 'true') {
          return;
        }
        const activityId = activityElement.dataset['activityId'] ?? '';
        const resourceId = activityElement.dataset['resourceId'] ?? '';
        if (!activityId || !resourceId) {
          return;
        }
        const targetRect = activityElement.getBoundingClientRect();
        if (!this.rectanglesOverlap(rect, targetRect)) {
          return;
        }
        let record = hits.get(activityId);
        if (!record) {
          record = new Set<string>();
          hits.set(activityId, record);
        }
        record.add(resourceId);
        preview.add(activityId);
      });
    } else {
      candidates.forEach((candidate) => {
        const adjusted = {
          left: candidate.left - dx,
          right: candidate.right - dx,
          top: candidate.top - dy,
          bottom: candidate.bottom - dy,
        };
        if (!this.rectanglesOverlap(rect, adjusted as DOMRect)) {
          return;
        }
        let record = hits.get(candidate.activityId);
        if (!record) {
          record = new Set<string>();
          hits.set(candidate.activityId, record);
        }
        record.add(candidate.resourceId);
        preview.add(candidate.activityId);
      });
    }

    this.lassoHits = hits;
    this.lassoPreviewSelectionSignal.set(preview);
  }

  private viewportScrollTop(): number {
    const viewport = this.deps.host().querySelector('.gantt__viewport') as HTMLElement | null;
    return viewport?.scrollTop ?? 0;
  }

  private captureLassoCandidates(): void {
    const host = this.deps.host();
    const elements = host.querySelectorAll('.gantt-activity[data-activity-id]');
    const candidates: Array<{
      activityId: string;
      resourceId: string;
      left: number;
      top: number;
      right: number;
      bottom: number;
    }> = [];
    elements.forEach((element: Element) => {
      const activityElement = element as HTMLElement;
      if (activityElement.dataset['preview'] === 'true') {
        return;
      }
      const activityId = activityElement.dataset['activityId'] ?? '';
      const resourceId = activityElement.dataset['resourceId'] ?? '';
      if (!activityId || !resourceId) {
        return;
      }
      const rect = activityElement.getBoundingClientRect();
      candidates.push({
        activityId,
        resourceId,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      });
    });
    this.lassoCandidateCache = {
      candidates,
      baseScrollLeft: this.lassoPointerContainer?.scrollLeft ?? 0,
      baseScrollTop: this.viewportScrollTop(),
    };
  }

  private rectanglesOverlap(a: NormalizedRect, b: DOMRect): boolean {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  private resetLassoState(): void {
    if (this.lassoFrameHandle !== null) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.lassoFrameHandle);
      } else {
        clearTimeout(this.lassoFrameHandle);
      }
      this.lassoFrameHandle = null;
    }
    this.lassoPointerContainer = null;
    this.lassoState = null;
    this.lassoHits = new Map<string, Set<string>>();
    this.lassoCandidateCache = null;
    this.lassoPreviewSelectionSignal.set(new Set());
    this.lassoBoxSignal.set(null);
  }

  private prunePrimarySelectionSlots(validActivityIds: ReadonlySet<string>): void {
    const current = this.primarySelectionSlotsSignal();
    if (validActivityIds.size === 0 || current.size === 0) {
      this.primarySelectionSlotsSignal.set(new Set());
      return;
    }
    const next = new Set<string>();
    current.forEach((key) => {
      const { activityId } = decodeSelectionSlot(key);
      if (validActivityIds.has(activityId)) {
        next.add(key);
      }
    });
    this.primarySelectionSlotsSignal.set(next);
  }

  private setPrimarySelectionSlots(slots: Iterable<ActivitySlotSelection>): void {
    const next = new Set<string>();
    for (const slot of slots) {
      next.add(encodeSelectionSlot(slot.activityId, slot.resourceId));
    }
    this.primarySelectionSlotsSignal.set(next);
  }

  private addPrimarySelectionSlots(slots: Iterable<ActivitySlotSelection>): void {
    const next = new Set(this.primarySelectionSlotsSignal());
    for (const slot of slots) {
      next.add(encodeSelectionSlot(slot.activityId, slot.resourceId));
    }
    this.primarySelectionSlotsSignal.set(next);
  }

  private removePrimarySelectionSlot(activityId: string, resourceId: string): void {
    const key = encodeSelectionSlot(activityId, resourceId);
    const current = this.primarySelectionSlotsSignal();
    if (!current.has(key)) {
      return;
    }
    const next = new Set(current);
    next.delete(key);
    this.primarySelectionSlotsSignal.set(next);
  }

  private applyLassoSelection(hits: Map<string, Set<string>>, additive: boolean): void {
    const entries = Array.from(hits.entries());
    if (!entries.length) {
      return;
    }
    const slots: ActivitySlotSelection[] = [];
    entries.forEach(([activityId, resourceIds]) => {
      resourceIds.forEach((resourceId) => {
        slots.push({ activityId, resourceId });
      });
    });
    if (!slots.length) {
      return;
    }
    if (additive) {
      this.addPrimarySelectionSlots(slots);
    } else {
      this.setPrimarySelectionSlots(slots);
    }
    entries.forEach(([activityId, resourceIds], index) => {
      const iterator = resourceIds.values().next();
      if (iterator.done) {
        return;
      }
      const resourceId = iterator.value;
      const resource = this.deps.getResourceById(resourceId);
      const activity = this.deps.getActivityById(activityId);
      if (!resource || !activity) {
        return;
      }
      const mode: ActivitySelectionMode = !additive && index === 0 ? 'set' : 'toggle';
      this.deps.emitSelectionToggle({
        resource,
        activity,
        selectionMode: mode,
      });
    });
  }
}
