import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import type { Business } from '../../core/models/business.model';
import type { BusinessStatus } from '../../core/models/business.model';
import type {
  AssignmentInsight,
  BusinessInsightContext,
  BusinessMetricFilterKind,
  StatusBreakdownEntry,
  TagInsightStat,
} from './business-list.types';

const INSIGHTS_STORAGE_KEY = 'business.insightsCollapsed.v1';

@Component({
  selector: 'app-business-insights',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule],
  templateUrl: './business-insights.component.html',
  styleUrl: './business-insights.component.scss',
})
export class BusinessInsightsComponent {
  private readonly document = inject(DOCUMENT);

  @Input({ required: true }) context!: BusinessInsightContext;
  @Input({ required: true }) topTagInsights: TagInsightStat[] = [];
  @Input({ required: true }) topAssignments: AssignmentInsight[] = [];
  @Input({ required: true }) statusBreakdown: StatusBreakdownEntry[] = [];
  @Input({ required: true }) dueSoonHighlights: Business[] = [];

  @Output() applyTag = new EventEmitter<string>();
  @Output() applyAssignment = new EventEmitter<string>();
  @Output() applyStatus = new EventEmitter<BusinessStatus>();
  @Output() focusDueSoon = new EventEmitter<void>();
  @Output() metricFilterSelected = new EventEmitter<BusinessMetricFilterKind>();
  @Output() selectBusiness = new EventEmitter<Business>();

  readonly collapsed = signal(this.loadCollapsed());

  toggleCollapsed(): void {
    this.collapsed.update((current) => {
      const next = !current;
      this.persistCollapsed(next);
      return next;
    });
  }

  formatTagLabel(tag: string): string {
    return tag.startsWith('#') ? tag : `#${tag}`;
  }

  dueDateState(business: Business): 'overdue' | 'today' | 'upcoming' | 'none' {
    if (!business.dueDate) {
      return 'none';
    }
    const due = new Date(business.dueDate);
    const today = new Date();
    if (this.isBeforeDay(due, today)) {
      return 'overdue';
    }
    if (this.isSameDay(due, today)) {
      return 'today';
    }
    return 'upcoming';
  }

  private loadCollapsed(): boolean {
    try {
      const storage = this.document?.defaultView?.localStorage;
      if (!storage) {
        return false;
      }
      return storage.getItem(INSIGHTS_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  private persistCollapsed(value: boolean): void {
    try {
      const storage = this.document?.defaultView?.localStorage;
      storage?.setItem(INSIGHTS_STORAGE_KEY, String(value));
    } catch {
      // ignore storage issues
    }
  }

  private isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  private isBeforeDay(a: Date, b: Date): boolean {
    const startA = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    const startB = new Date(b.getFullYear(), b.getMonth(), b.getDate());
    return startA.getTime() < startB.getTime();
  }
}

