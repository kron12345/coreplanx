import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { ScheduleTemplate } from '../../../core/models/schedule-template.model';
import { PlanGenerationPreview, PlanTemplateStats } from './plan-preview.models';

@Component({
  selector: 'app-order-plan-preview',
  standalone: true,
  imports: [CommonModule, MatChipsModule, MatIconModule],
  templateUrl: './order-plan-preview.component.html',
  styleUrl: './order-plan-preview.component.scss',
})
export class OrderPlanPreviewComponent {
  @Input() template: ScheduleTemplate | undefined;
  @Input() stats: PlanTemplateStats | null = null;
  @Input() preview: PlanGenerationPreview | null = null;
}
