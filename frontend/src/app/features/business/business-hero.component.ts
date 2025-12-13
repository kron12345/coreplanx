import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import type { BusinessMetricFilterKind, MetricTrend, PipelineMetrics } from './business-list.types';

@Component({
  selector: 'app-business-hero',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule],
  templateUrl: './business-hero.component.html',
  styleUrl: './business-hero.component.scss',
})
export class BusinessHeroComponent {
  @Input({ required: true }) metrics!: PipelineMetrics;
  @Input({ required: true }) trends!: MetricTrend;

  @Output() openCommandPalette = new EventEmitter<void>();
  @Output() resetFilters = new EventEmitter<void>();
  @Output() createBusiness = new EventEmitter<void>();
  @Output() metricFilterSelected = new EventEmitter<BusinessMetricFilterKind>();
}

