import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  GanttActivityComponent,
  GanttActivityDragData,
  GanttActivitySelectionEvent,
} from './gantt-activity.component';
import { Activity } from '../models/activity';
import { ActivityParticipantCategory } from '../models/activity-ownership';
import { CdkDragMove, CdkDragStart, CdkDragEnd, DragDropModule } from '@angular/cdk/drag-drop';

export interface GanttBar {
  id: string;
  activity: Activity;
  left: number;
  width: number;
  classes?: string[];
  zIndex?: number;
  selected?: boolean;
   primarySelected?: boolean;
  label?: string;
  showRoute?: boolean;
  dragDisabled?: boolean;
  participantResourceId?: string;
  participantCategory?: ActivityParticipantCategory | null;
  isOwner?: boolean;
  isMirror?: boolean;
  roleIcon?: string | null;
  roleLabel?: string | null;
  color?: string | null;
}

export interface GanttBackgroundSegment {
  left: number;
  width: number;
  cssClass: string;
}

export type GanttServiceRangeStatus = 'complete' | 'missing-start' | 'missing-end' | 'missing-both';

export interface GanttServiceRange {
  id: string;
  label: string;
  left: number;
  width: number;
  status: GanttServiceRangeStatus;
}

@Component({
  selector: 'app-gantt-timeline-row',
  standalone: true,
  imports: [CommonModule, GanttActivityComponent, DragDropModule],
  templateUrl: './gantt-timeline-row.component.html',
  styleUrl: './gantt-timeline-row.component.scss',
})
export class GanttTimelineRowComponent {
  @Input({ required: true }) bars: GanttBar[] = [];
  @Input({ required: true }) contentWidth = 0;
  @Input({ required: true }) resourceId!: string;
  @Input() backgroundSegments: GanttBackgroundSegment[] = [];
  @Input() serviceRanges: GanttServiceRange[] = [];
  @Input() nowMarkerLeft: number | null = null;
  @Input() zebra = false;
  @Input() viewMode: 'block' | 'detail' = 'detail';

  @Output() activitySelected = new EventEmitter<Activity>();
  @Output() activityToggleSelection = new EventEmitter<GanttActivitySelectionEvent>();
  @Output() activityDragStarted = new EventEmitter<CdkDragStart<GanttActivityDragData>>();
  @Output() activityDragMoved = new EventEmitter<CdkDragMove<GanttActivityDragData>>();
  @Output() activityDragEnded = new EventEmitter<CdkDragEnd<GanttActivityDragData>>();
}
