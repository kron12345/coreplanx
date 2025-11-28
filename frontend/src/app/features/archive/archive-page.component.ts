import { Component, computed, effect, inject, signal } from '@angular/core';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import { TrainPlanListComponent } from '../train-plans/train-plan-list.component';
import { TrafficPeriodListComponent } from '../traffic-periods/traffic-period-list.component';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-archive-page',
  standalone: true,
  imports: [...MATERIAL_IMPORTS, TrainPlanListComponent, TrafficPeriodListComponent],
  templateUrl: './archive-page.component.html',
  styleUrl: './archive-page.component.scss',
})
export class ArchivePageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly selectedTabIndex = signal(0);
  private readonly periodHighlightId = signal<string | null>(null);

  readonly selectedIndex = computed(() => this.selectedTabIndex());
  readonly periodHighlight = computed(() => this.periodHighlightId());

  constructor() {
    this.route.queryParamMap
      .pipe(takeUntilDestroyed())
      .subscribe((params) => {
        const highlight = params.get('highlightPeriod');
        const view = params.get('view');
        if (highlight) {
          this.selectedTabIndex.set(1);
        } else {
          this.selectedTabIndex.set(view === 'calendars' ? 1 : 0);
        }
        this.periodHighlightId.set(highlight);
      });

    effect(() => {
      const highlight = this.periodHighlight();
      if (!highlight) {
        return;
      }
      window.setTimeout(() => {
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { highlightPeriod: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }, 2000);
    });
  }

  onTabChange(index: number) {
    this.selectedTabIndex.set(index);
    const view = index === 1 ? 'calendars' : 'plans';
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { view },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
