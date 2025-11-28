import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Activity } from '../models/activity';
import { DurationPipe } from '../shared/pipes/duration.pipe';
import { CdkDragEnd, CdkDragMove, CdkDragStart, DragDropModule } from '@angular/cdk/drag-drop';
import { ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';
import { MatIconModule } from '@angular/material/icon';
import { ActivityParticipantCategory } from '../models/activity-ownership';

@Component({
  selector: 'app-gantt-activity',
  standalone: true,
  imports: [CommonModule, DurationPipe, DragDropModule, OverlayModule, MatIconModule],
  templateUrl: './gantt-activity.component.html',
  styleUrl: './gantt-activity.component.scss',
})
export class GanttActivityComponent {
  @Input({ required: true }) activity!: Activity;
  @Input({ required: true }) leftPx!: number;
  @Input({ required: true }) widthPx!: number;
  @Input() isSelected = false;
  @Input() classes: string[] = [];
  @Input() displayMode: 'block' | 'detail' = 'detail';
  @Input() displayTitle: string | null = null;
  @Input() showRouteDetails = false;
  @Input() dragDisabled = false;
  @Input() isMirror = false;
  @Input() isPrimarySelection = false;
  @Input() roleIcon: string | null = null;
  @Input() roleLabel: string | null = null;
  @Input() zIndex: number | null = null;
  @Input({ required: true }) dragData!: GanttActivityDragData;
  @Output() activitySelected = new EventEmitter<Activity>();
  @Output() toggleSelection = new EventEmitter<GanttActivitySelectionEvent>();
  @Output() dragStarted = new EventEmitter<CdkDragStart<GanttActivityDragData>>();
  @Output() dragMoved = new EventEmitter<CdkDragMove<GanttActivityDragData>>();
  @Output() dragEnded = new EventEmitter<CdkDragEnd<GanttActivityDragData>>();

  private isDragging = false;
  private dragSuppressUntil = 0;
  private readonly dragSuppressWindowMs = 1500;
  private clickTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly singleClickDelayMs = 220;
  private touchHoldTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly touchHoldDelayMs = 450;
  private touchPointer: { id: number; x: number; y: number } | null = null;
  private readonly touchMoveTolerancePx = 8;
  private suppressNextClick = false;
  protected isPopoverOpen = false;
  private isTriggerHovered = false;
  private isPopoverHovered = false;
  protected dragMode: 'move' | 'copy' = 'move';
  private popoverHideTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly popoverHideDelayMs = 120;

  private readonly dateTime = new Intl.DateTimeFormat('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  private readonly timeOnly = new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
  private readonly durationPipe = new DurationPipe();
  private readonly typeLabels: Record<string, string> = {
    'service-start': 'Dienstbeginn',
    'service-end': 'Dienstende',
    service: 'Dienstleistung',
    break: 'Pause',
    travel: 'Fahrt',
    transfer: 'Transfer',
    other: 'Sonstige',
  };
  private readonly typeShortLabels: Record<string, string> = {
    'service-start': 'Start',
    'service-end': 'Ende',
    service: 'DL',
    break: 'PA',
    travel: 'TR',
    transfer: 'TF',
    other: 'AKT',
  };
  get tooltipText(): string {
    if (!this.activity) {
      return '';
    }
    const lines: string[] = [];
    lines.push(this.effectiveTitle);
    lines.push(`Start: ${this.startLabel}`);
    if (this.activity.end) {
      lines.push(`Ende: ${this.endLabel}`);
    }
    if (this.activity.from) {
      lines.push(`Von: ${this.activity.from}`);
    }
    if (this.activity.to) {
      lines.push(`Nach: ${this.activity.to}`);
    }
    return lines.join('\n');
  }

  readonly popoverPositions: ConnectedPosition[] = [
    {
      originX: 'center',
      originY: 'top',
      overlayX: 'center',
      overlayY: 'bottom',
      offsetY: -8,
    },
    {
      originX: 'center',
      originY: 'bottom',
      overlayX: 'center',
      overlayY: 'top',
      offsetY: 8,
    },
  ];

  get hostClasses(): string[] {
    const classes = ['gantt-activity--service'];
    if (this.activity?.type) {
      classes.push(`gantt-activity--${this.activity.type}`);
    }
    if (this.isMirror) {
      classes.push('gantt-activity--mirror');
    }
    if (this.displayMode === 'block') {
      classes.push('gantt-activity--block');
    }
    if (this.classes?.length) {
      classes.push(...this.classes);
    }
    if (this.isSelected) {
      classes.push(
        this.isPrimarySelection
          ? 'gantt-activity--selected'
          : 'gantt-activity--selected-secondary',
      );
    }
    if (this.widthPx < 80) {
      classes.push('gantt-activity--compact');
    }
    return classes;
  }

  get showTitle(): boolean {
    if (this.displayMode === 'block') {
      return false;
    }
    return this.widthPx >= 54;
  }

  get shouldShowRoute(): boolean {
    if (!this.showRouteDetails) {
      return false;
    }
    if (this.displayMode === 'block') {
      return false;
    }
    return this.widthPx >= 120 && this.hasRoute;
  }

  get typeLabel(): string {
    if (!this.activity) {
      return '';
    }
    return this.typeLabels[this.activity.type ?? 'service'] ?? 'Aktivität';
  }

  get compactTypeLabel(): string {
    if (!this.activity) {
      return '';
    }
    const type = this.activity.type ?? 'service';
    return this.typeShortLabels[type] ?? this.typeLabels[type] ?? 'Aktivität';
  }

  get useCompactLabels(): boolean {
    return this.widthPx < 80;
  }

  get hasRoute(): boolean {
    return !!(this.activity?.from || this.activity?.to);
  }

  get fromLabel(): string {
    return this.formatLocationLabel(this.activity?.from);
  }

  get toLabel(): string {
    return this.formatLocationLabel(this.activity?.to);
  }

  get effectiveTitle(): string {
    const explicit = (this.displayTitle ?? '').trim();
    if (explicit) {
      return explicit;
    }
    return this.useCompactLabels ? this.compactTypeLabel : this.typeLabel;
  }

  get routeLabel(): string {
    if (!this.activity) {
      return '';
    }
    const from = this.activity.from ?? '—';
    const to = this.activity.to ?? '—';
    return `${from} → ${to}`;
  }

  get startLabel(): string {
    if (!this.activity) {
      return '';
    }
    return this.dateTime.format(new Date(this.activity.start));
  }

  get endLabel(): string {
    if (!this.activity?.end) {
      return '';
    }
    return this.dateTime.format(new Date(this.activity.end));
  }

  get shortStartLabel(): string {
    if (!this.activity) {
      return '';
    }
    return this.timeOnly.format(new Date(this.activity.start));
  }

  get shortEndLabel(): string {
    if (!this.activity?.end) {
      return '';
    }
    return this.timeOnly.format(new Date(this.activity.end));
  }

  get durationLabel(): string {
    if (!this.activity?.end) {
      return '—';
    }
    return this.durationPipe.transform(this.activity.start, this.activity.end);
  }

  get ariaLabel(): string {
    if (!this.activity) {
      return '';
    }
    return this.tooltipText.replace(/\n+/g, ', ');
  }

  protected onTriggerMouseEnter(): void {
    this.isTriggerHovered = true;
    this.updatePopoverOpen();
  }

  protected onTriggerMouseLeave(): void {
    this.isTriggerHovered = false;
    this.updatePopoverOpen();
  }

  protected onPopoverMouseEnter(): void {
    this.isPopoverHovered = true;
    this.updatePopoverOpen();
  }

  protected onPopoverMouseLeave(): void {
    this.isPopoverHovered = false;
    this.updatePopoverOpen();
  }

  private updatePopoverOpen(): void {
    // Während eines Drags oder im Kopiermodus keinen Tooltip anzeigen,
    // damit Ziele nicht verdeckt werden.
    if (this.isDragging || this.dragMode === 'copy') {
      if (this.popoverHideTimer !== null) {
        clearTimeout(this.popoverHideTimer);
        this.popoverHideTimer = null;
      }
      this.isPopoverOpen = false;
      return;
    }
    const shouldOpen = this.isTriggerHovered || this.isPopoverHovered;
    if (shouldOpen) {
      if (this.popoverHideTimer !== null) {
        clearTimeout(this.popoverHideTimer);
        this.popoverHideTimer = null;
      }
      this.isPopoverOpen = true;
      return;
    }
    if (this.popoverHideTimer !== null) {
      return;
    }
    this.popoverHideTimer = window.setTimeout(() => {
      this.isPopoverOpen = false;
      this.popoverHideTimer = null;
    }, this.popoverHideDelayMs);
  }

  private formatLocationLabel(raw: string | null | undefined): string {
    const value = (raw ?? '—').toString().trim();
    if (!value || value === '—') {
      return '—';
    }
    const upper = value.toUpperCase();
    if (upper.length <= 10) {
      return upper;
    }
    const firstWord = upper.split(/\s+/)[0];
    if (firstWord.length >= 3 && firstWord.length <= 10) {
      return firstWord;
    }
    return upper.slice(0, 10);
  }

  protected handleClick(event: MouseEvent): void {
    event.stopPropagation();
    event.preventDefault();
    if (!this.activity) {
      return;
    }
    if (this.hasSelectionModifier(event)) {
      this.cancelPendingClick();
      this.toggleSelection.emit({ activity: this.activity, selectionMode: 'toggle' });
      return;
    }
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      this.cancelPendingClick();
      return;
    }
    if (event.detail > 1 || this.shouldSuppressEdit()) {
      this.cancelPendingClick();
      return;
    }
    this.scheduleSingleClick();
  }

  protected handleDoubleClick(event: MouseEvent): void {
    event.stopPropagation();
    event.preventDefault();
    if (!this.activity) {
      return;
    }
    this.cancelPendingClick();
    this.toggleSelection.emit({ activity: this.activity, selectionMode: 'set' });
  }

  protected handleKeyboardActivate(event: KeyboardEvent | Event): void {
    event.stopPropagation();
    event.preventDefault();
    if (!this.activity) {
      return;
    }
    const keyboardEvent = event as KeyboardEvent;
    if (this.hasSelectionModifier(keyboardEvent)) {
      this.toggleSelection.emit({ activity: this.activity, selectionMode: 'toggle' });
      return;
    }
    if (this.shouldSuppressEdit()) {
      return;
    }
    this.activitySelected.emit(this.activity);
  }

  protected handlePointerDown(event: PointerEvent): void {
    if (!this.activity) {
      return;
    }
    // Verwende den aktuell gesetzten Drag-Modus (move/copy),
    // ohne ihn hier zurückzusetzen – so kann der Tooltip den Kopiermodus vorbereiten.
    this.dragData = {
      ...this.dragData,
      mode: this.dragMode,
    };
    if (!this.isTouchPointer(event)) {
      return;
    }
    this.touchPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    this.cancelTouchHold();
    this.touchHoldTimer = window.setTimeout(() => {
      if (!this.activity) {
        return;
      }
      this.toggleSelection.emit({ activity: this.activity, selectionMode: 'toggle' });
      this.suppressNextClick = true;
      this.cancelTouchHold();
    }, this.touchHoldDelayMs);
  }

  protected handlePointerMove(event: PointerEvent): void {
    if (!this.touchPointer || event.pointerId !== this.touchPointer.id) {
      return;
    }
    const dx = event.clientX - this.touchPointer.x;
    const dy = event.clientY - this.touchPointer.y;
    if (Math.hypot(dx, dy) >= this.touchMoveTolerancePx) {
      this.cancelTouchHold();
    }
  }

  protected handlePointerEnd(event: PointerEvent): void {
    if (this.touchPointer && event.pointerId === this.touchPointer.id) {
      this.touchPointer = null;
    }
    this.cancelTouchHold();
  }

  protected onDragStarted(event: CdkDragStart<GanttActivityDragData>): void {
    this.isDragging = true;
    this.isTriggerHovered = false;
    this.isPopoverHovered = false;
    this.updatePopoverOpen();
    // Anchor the drag position to the current viewport coordinates to avoid snapping to (0,0).
    const rect = event.source.element.nativeElement.getBoundingClientRect();
    const el = event.source.element.nativeElement as HTMLElement;
    el.style.setProperty('--drag-start-left', `${rect.left}px`);
    el.style.setProperty('--drag-start-top', `${rect.top}px`);
    // Sicherstellen, dass der aktuelle Modus (move/copy) im Drag-Datenobjekt landet.
    event.source.data = {
      ...event.source.data,
      mode: this.dragMode,
    };
    this.dragStarted.emit(event);
  }

  protected onDragMoved(event: CdkDragMove<GanttActivityDragData>): void {
    this.dragMoved.emit(event);
  }

  protected onDragEnded(event: CdkDragEnd<GanttActivityDragData>): void {
    this.isDragging = false;
    this.dragSuppressUntil = Date.now() + this.dragSuppressWindowMs;
    const el = event.source.element.nativeElement as HTMLElement;
    el.style.removeProperty('--drag-start-left');
    el.style.removeProperty('--drag-start-top');
    this.dragEnded.emit(event);
    // Nach einem Drag-Modus stets zurück auf "move" setzen
    this.dragMode = 'move';
    this.dragData = {
      ...this.dragData,
      mode: this.dragMode,
    };
  }

  private shouldSuppressEdit(): boolean {
    if (this.isDragging) {
      return true;
    }
    if (this.dragSuppressUntil && Date.now() < this.dragSuppressUntil) {
      return true;
    }
    return false;
  }

  private hasSelectionModifier(event: MouseEvent | KeyboardEvent): boolean {
    if (event instanceof MouseEvent) {
      return event.metaKey || event.ctrlKey || event.shiftKey;
    }
    return event.metaKey || event.ctrlKey || event.shiftKey;
  }

  private scheduleSingleClick(): void {
    this.cancelPendingClick();
    this.clickTimer = window.setTimeout(() => {
      if (this.activity) {
        this.activitySelected.emit(this.activity);
      }
      this.clickTimer = null;
    }, this.singleClickDelayMs);
  }

  private cancelPendingClick(): void {
    if (this.clickTimer !== null) {
      clearTimeout(this.clickTimer);
      this.clickTimer = null;
    }
  }

  private isTouchPointer(event: PointerEvent): boolean {
    return event.pointerType === 'touch' || event.pointerType === 'pen';
  }

  private cancelTouchHold(): void {
    if (this.touchHoldTimer !== null) {
      clearTimeout(this.touchHoldTimer);
      this.touchHoldTimer = null;
    }
  }

  protected disableCopyMode(event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    this.dragMode = 'move';
    this.dragData = {
      ...this.dragData,
      mode: this.dragMode,
    };
  }
  protected enableCopyMode(): void {
    if (!this.activity) {
      return;
    }
    this.dragMode = 'copy';
    this.dragData = {
      ...this.dragData,
      mode: this.dragMode,
    };
    this.isTriggerHovered = false;
    this.isPopoverHovered = false;
    this.updatePopoverOpen();
  }
}

export interface GanttActivityDragData {
  activity: Activity;
  resourceId: string;
  participantResourceId: string;
  participantCategory: ActivityParticipantCategory | null;
  isOwnerSlot: boolean;
  initialLeft: number;
  width: number;
  mode?: 'move' | 'copy';
}

export interface GanttActivitySelectionEvent {
  activity: Activity;
  selectionMode: 'set' | 'toggle';
}
