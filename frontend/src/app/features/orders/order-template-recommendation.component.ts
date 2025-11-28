import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import { BusinessTemplateService } from '../../core/services/business-template.service';
import { OrderFilters } from '../../core/services/order.service';

@Component({
  selector: 'app-order-template-recommendation',
  standalone: true,
  imports: [CommonModule, ...MATERIAL_IMPORTS, RouterLink],
  templateUrl: './order-template-recommendation.component.html',
  styleUrl: './order-template-recommendation.component.scss',
})
export class OrderTemplateRecommendationComponent {
  private readonly templateService = inject(BusinessTemplateService);
  private readonly filtersSignal = signal<OrderFilters | null>(null);

  @Input()
  set filters(value: OrderFilters | null) {
    this.filtersSignal.set(value);
  }

  @Output() close = new EventEmitter<void>();

  readonly recommendations = computed(() => {
    const filters = this.filtersSignal();
    if (!filters) {
      return [];
    }
    const tags: string[] = [];
    if (filters.tag !== 'all') {
      tags.push(filters.tag);
    }
    const searchTags = filters.search
      .split(/\s+/)
      .filter((token) => token.startsWith('#'))
      .map((token) => token.toLowerCase());
    tags.push(...searchTags);
    const priority = filters.search.toLowerCase().includes('premium') ? 'premium' : 'standard';
    return this.templateService.recommendationsForContext({
      tags,
      customerPriority: priority,
    });
  });

  closePanel() {
    this.close.emit();
  }
}
