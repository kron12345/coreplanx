import { Injectable, effect, inject } from '@angular/core';
import { OrderService, OrderTimelineReference, OrderTtrPhase } from './order.service';
import { BusinessTemplateService } from './business-template.service';
import { BusinessService } from './business.service';
import { PhaseTemplateDefinition } from '../config/ttr-phase-template.config';
import { OrderItem } from '../models/order-item.model';
import { AutomationCondition } from '../models/business-template.model';

@Injectable({ providedIn: 'root' })
export class TtrBusinessAutomationService {
  private readonly orderService = inject(OrderService);
  private readonly templateService = inject(BusinessTemplateService);
  private readonly businessService = inject(BusinessService);
  private readonly itemPhaseState = new Map<string, OrderTtrPhase>();

  constructor() {
    effect(
      () => {
        const snapshot = this.orderService.itemTtrPhaseIndex();
        snapshot.map.forEach((phase, itemId) => {
          this.handlePhaseChange(itemId, phase, snapshot.reference);
        });
      },
      { allowSignalWrites: true },
    );
  }

  private handlePhaseChange(
    itemId: string,
    phase: OrderTtrPhase,
    reference: OrderTimelineReference,
  ) {
    if (phase === 'unknown') {
      return;
    }
    const previous = this.itemPhaseState.get(itemId);
    if (previous === phase) {
      return;
    }
    this.itemPhaseState.set(itemId, phase);
    const definition = this.templateService.definitionForPhase(phase);
    if (!definition) {
      return;
    }
    if (!this.templateService.isPhaseAutomationEnabled(phase)) {
      return;
    }
    const templateId = definition.template.id;
    const item = this.orderService.getOrderItemById(itemId);
    if (!item) {
      return;
    }
    const targetDate =
      this.orderService.getItemReferenceDate(item, definition.timelineReference) ?? null;
    if (!targetDate) {
      return;
    }
    if (!this.isWithinWindow(definition.window, targetDate, new Date())) {
      return;
    }
    if (!this.passesConditions(definition.conditions ?? [], item, phase)) {
      return;
    }
    const bucketKey = this.buildBucketKey(definition, targetDate, item);
    const templateTag = this.templateService.templateTag(templateId);
    const bucketTag = this.templateService.phaseBucketTag(definition.id, bucketKey);
    const phaseTag = this.templateService.phaseTag(definition.id);

    const existing = this.businessService.findByTags([templateTag, bucketTag]);
    if (existing) {
      const ids = new Set(existing.linkedOrderItemIds ?? []);
      if (!ids.has(itemId)) {
        ids.add(itemId);
        this.businessService.setLinkedOrderItems(existing.id, Array.from(ids) as string[]);
        this.templateService.logAutomationRun(
          `phase-${definition.id}`,
          templateId,
          'success',
          `Position ${itemId} zu bestehendem Geschäft ${existing.id} hinzugefügt.`,
        );
      }
      return;
    }

    const business = this.templateService.instantiateTemplate(templateId, {
      targetDate,
      linkedOrderItemIds: [itemId],
      customTitle: `${definition.template.title} · ${definition.label}`,
      tags: [phaseTag, bucketTag],
    });
    this.templateService.logAutomationRun(
      `phase-${definition.id}`,
      templateId,
      'success',
      `Automatisch aus Phase ${definition.label} für Geschäft ${business.id}`,
    );
  }

  private isWithinWindow(window: PhaseTemplateDefinition['window'], referenceDate: Date, now: Date) {
    const diffMinutes = (referenceDate.getTime() - now.getTime()) / 60000;
    const start = this.toMinutes(window.unit, window.start);
    const end = this.toMinutes(window.unit, window.end);
    const min = Math.min(start, end);
    const max = Math.max(start, end);
    return diffMinutes >= min && diffMinutes <= max;
  }

  private toMinutes(unit: PhaseTemplateDefinition['window']['unit'], value: number): number {
    const factor = unit === 'weeks' ? 7 * 24 * 60 : unit === 'days' ? 24 * 60 : 60;
    return value * factor;
  }

  private buildBucketKey(
    definition: PhaseTemplateDefinition,
    referenceDate: Date,
    item: OrderItem,
  ): string {
    switch (definition.window.bucket) {
      case 'year': {
        return (
          this.orderService.getItemTimetableYear(item) ??
          referenceDate.getFullYear().toString()
        );
      }
      case 'week':
        return this.startOfWeek(referenceDate).toISOString().slice(0, 10);
      case 'hour':
        return referenceDate.toISOString().slice(0, 13);
      default:
        return referenceDate.toISOString().slice(0, 10);
    }
  }

  private startOfWeek(date: Date): Date {
    const result = new Date(date.getTime());
    const day = result.getDay();
    const diff = (day + 6) % 7;
    result.setDate(result.getDate() - diff);
    result.setHours(0, 0, 0, 0);
    return result;
  }

  private passesConditions(
    conditions: AutomationCondition[],
    item: OrderItem,
    phase: OrderTtrPhase,
  ): boolean {
    if (!conditions.length) {
      return true;
    }
    return conditions.every((condition) => this.evaluateCondition(condition, item, phase));
  }

  private evaluateCondition(
    condition: AutomationCondition,
    item: OrderItem,
    phase: OrderTtrPhase,
  ): boolean {
    switch (condition.field) {
      case 'itemTag': {
        const tags = item.tags ?? [];
        const match = tags.some((tag) => tag.toLowerCase() === condition.value.toLowerCase());
        return condition.operator === 'excludes' ? !match : match;
      }
      case 'itemType': {
        const matches = item.type === condition.value;
        return condition.operator === 'notEquals' ? !matches : matches;
      }
      case 'ttrPhase': {
        const matches = phase === (condition.value as OrderTtrPhase);
        return condition.operator === 'notEquals' ? !matches : matches;
      }
      case 'timetablePhase': {
        const matches = (item.timetablePhase ?? '') === condition.value;
        return condition.operator === 'notEquals' ? !matches : matches;
      }
      default:
        return true;
    }
  }
}
