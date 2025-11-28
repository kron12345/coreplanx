import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import { BusinessTemplateService } from '../../core/services/business-template.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { OrderTimelineReference } from '../../core/services/order.service';
import { AutomationCondition, BusinessTemplate } from '../../core/models/business-template.model';
import { MatDialog } from '@angular/material/dialog';
import { BusinessTemplateEditDialogComponent } from './business-template-edit-dialog.component';
import { BusinessPhaseDialogComponent } from './business-phase-dialog.component';
import { OrderService, OrderTtrPhase } from '../../core/services/order.service';
import { TimetablePhase } from '../../core/models/timetable.model';

@Component({
  selector: 'app-business-template-panel',
  standalone: true,
  imports: [CommonModule, ...MATERIAL_IMPORTS],
  templateUrl: './business-template-panel.component.html',
  styleUrl: './business-template-panel.component.scss',
})
export class BusinessTemplatePanelComponent {
  private readonly templateService = inject(BusinessTemplateService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly orderService = inject(OrderService);
  private readonly timetablePhaseLabels: Record<TimetablePhase, string> = {
    bedarf: 'Draft',
    path_request: 'Path Request',
    offer: 'Offered',
    contract: 'Booked',
    operational: 'Used',
    archived: 'Cancelled',
  };

  readonly phaseTemplates = this.templateService.phaseTemplates;
  readonly automationRules = this.templateService.automationRules;
  readonly templates = this.templateService.templates;

  togglePhaseAutomation(phaseId: string | null, enabled: boolean) {
    if (!phaseId) {
      return;
    }
    this.templateService.setPhaseAutomation(phaseId, enabled);
    this.snackBar.open(
      enabled ? 'Automatische Erstellung aktiviert.' : 'Automatische Erstellung deaktiviert.',
      'OK',
      { duration: 2000 },
    );
  }

  openCreatePhase() {
    this.dialog.open(BusinessPhaseDialogComponent, {
      width: '640px',
    });
  }

  instantiateTemplate(templateId: string) {
    const business = this.templateService.instantiateTemplate(templateId, {
      targetDate: new Date(),
    });
    this.snackBar.open(`Geschäft "${business.title}" erstellt.`, 'OK', { duration: 2000 });
  }

  dueRuleLabel(template: BusinessTemplate): string {
    return template.dueRule.label;
  }

  editPhase(phase: {
    id: string;
    template: BusinessTemplate;
    window: { unit: string; start: number; end: number; bucket: string; label: string };
    timelineReference: OrderTimelineReference | 'fpYear';
    conditions: AutomationCondition[];
  }) {
    this.dialog.open(BusinessTemplateEditDialogComponent, {
      width: '520px',
      data: {
        template: phase.template,
        phaseId: phase.id,
        window: phase.window,
        timelineReference: phase.timelineReference,
        conditions: phase.conditions,
      },
    });
  }

  deletePhase(phaseId: string) {
    const confirmed =
      typeof window === 'undefined' ? true : window.confirm('Eigene Phase löschen?');
    if (!confirmed) {
      return;
    }
    this.templateService.deleteCustomPhaseTemplate(phaseId);
    this.snackBar.open('Phase gelöscht.', 'OK', { duration: 2000 });
  }

  conditionLabel(condition: AutomationCondition): string {
    switch (condition.field) {
      case 'itemTag':
        return condition.operator === 'excludes'
          ? `Tag enthält nicht ${condition.value}`
          : `Tag enthält ${condition.value}`;
      case 'itemType':
        return condition.operator === 'notEquals'
          ? `Typ ≠ ${this.itemTypeLabel(condition.value)}`
          : `Typ = ${this.itemTypeLabel(condition.value)}`;
      case 'ttrPhase': {
        const label = this.ttrPhaseLabel(condition.value as OrderTtrPhase);
        return condition.operator === 'notEquals' ? `TTR ≠ ${label}` : `TTR = ${label}`;
      }
      case 'timetablePhase': {
        const label = this.timetablePhaseLabels[condition.value as TimetablePhase] ?? condition.value;
        return condition.operator === 'notEquals' ? `Bestellphase ≠ ${label}` : `Bestellphase = ${label}`;
      }
      default:
        return `${condition.field} ${condition.operator} ${condition.value}`;
    }
  }

  private itemTypeLabel(value: string): string {
    return value === 'Fahrplan' ? 'Fahrplan' : 'Leistung';
  }

  private ttrPhaseLabel(phase: OrderTtrPhase): string {
    try {
      return this.orderService.getTtrPhaseMeta(phase).label;
    } catch {
      return phase;
    }
  }
}
