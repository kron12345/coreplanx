import { Component, computed, effect, inject, signal } from '@angular/core';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import { ScheduleTemplateListComponent } from '../schedule-templates/schedule-template-list.component';
import { ScheduleTemplateService } from '../../core/services/schedule-template.service';
import { BusinessTemplateService } from '../../core/services/business-template.service';
import {
  ScheduleTemplateCreateDialogComponent,
  ScheduleTemplateDialogResult,
} from '../schedule-templates/schedule-template-create-dialog.component';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';

@Component({
  selector: 'app-schedule-template-hub',
  standalone: true,
  imports: [...MATERIAL_IMPORTS, ScheduleTemplateListComponent, RouterLink],
  templateUrl: './schedule-template-hub.component.html',
  styleUrl: './schedule-template-hub.component.scss',
})
export class ScheduleTemplateHubComponent {
  private readonly scheduleService = inject(ScheduleTemplateService);
  private readonly businessTemplateService = inject(BusinessTemplateService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly highlightId = signal<string | null>(null);

  readonly templateHighlight = computed(() => this.highlightId());
  readonly scheduleStats = computed(() => {
    const templates = this.scheduleService.templates();
    const active = templates.filter((tpl) => tpl.status === 'active').length;
    const drafts = templates.filter((tpl) => tpl.status === 'draft').length;
    const archived = templates.filter((tpl) => tpl.status === 'archived').length;
    return {
      total: templates.length,
      active,
      drafts,
      archived,
    };
  });
  readonly businessStats = computed(() => ({
    total: this.businessTemplateService.templates().length,
    automations: this.businessTemplateService.automationRules().length,
  }));

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const highlight = params.get('highlightTemplate');
      if (highlight) {
        this.highlightId.set(highlight);
      }
    });

    effect(() => {
      const highlight = this.templateHighlight();
      if (!highlight) {
        return;
      }
      window.setTimeout(() => {
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { highlightTemplate: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }, 2000);
    });
  }

  openCreateDialog(): void {
    const dialogRef = this.dialog.open<
      ScheduleTemplateCreateDialogComponent,
      undefined,
      ScheduleTemplateDialogResult | undefined
    >(ScheduleTemplateCreateDialogComponent, {
      width: '95vw',
      maxWidth: '1200px',
      maxHeight: '95vh',
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (!result) {
        return;
      }
      if (result.mode === 'edit') {
        this.scheduleService.updateTemplateFromPayload(result.templateId, result.payload);
      } else {
        this.scheduleService.createTemplate(result.payload);
      }
    });
  }
}
