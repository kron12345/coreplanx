import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import { ScheduleTemplateService } from '../../core/services/schedule-template.service';
import { BusinessTemplateService } from '../../core/services/business-template.service';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-templates-landing',
  standalone: true,
  imports: [CommonModule, ...MATERIAL_IMPORTS, RouterLink],
  templateUrl: './templates-landing.component.html',
  styleUrl: './templates-landing.component.scss',
})
export class TemplatesLandingComponent {
  private readonly scheduleService = inject(ScheduleTemplateService);
  private readonly businessTemplateService = inject(BusinessTemplateService);

  readonly scheduleStats = computed(() => {
    const templates = this.scheduleService.templates();
    const total = templates.length;
    const active = templates.filter((tpl) => tpl.status === 'active').length;
    const drafts = templates.filter((tpl) => tpl.status === 'draft').length;
    const categories = new Map<string, number>();
    templates.forEach((tpl) => {
      categories.set(tpl.category, (categories.get(tpl.category) ?? 0) + 1);
    });
    const topCategory = Array.from(categories.entries()).sort(
      (a, b) => b[1] - a[1],
    )[0]?.[0];
    const multiStage = templates.filter((tpl) => (tpl.recurrence?.days?.length ?? 0) > 3).length;
    return { total, active, drafts, topCategory, multiStage };
  });

  readonly businessStats = computed(() => {
    const templates = this.businessTemplateService.templates();
    const automations = this.businessTemplateService.automationRules();
    const total = templates.length;
    const automationCount = automations.length;
    const withAutomation = templates.filter((tpl) =>
      automations.some((auto) => auto.templateId === tpl.id),
    ).length;
    const multiStage = automations.filter((auto) => !!auto.nextTemplateId).length;
    return { total, automationCount, withAutomation, multiStage };
  });

  readonly recentAutomations = computed(() =>
    this.businessTemplateService.automationRules().slice(0, 3),
  );

  readonly highlightedTemplates = computed(() =>
    this.businessTemplateService.templates().slice(0, 3),
  );
}
