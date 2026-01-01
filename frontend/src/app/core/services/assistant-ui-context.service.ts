import { Injectable, signal } from '@angular/core';
import { AssistantUiContextDto } from '../models/assistant-chat.model';

@Injectable({ providedIn: 'root' })
export class AssistantUiContextService {
  readonly route = signal<string | null>(null);
  readonly docKey = signal<string | null>(null);
  readonly docSubtopic = signal<string | null>(null);
  readonly breadcrumbs = signal<string[]>([]);
  readonly dataSummary = signal<string | null>(null);

  snapshot(): AssistantUiContextDto {
    const route = this.route()?.trim();
    const docKey = this.docKey()?.trim();
    const docSubtopic = this.docSubtopic()?.trim();
    const breadcrumbs = this.breadcrumbs();
    const dataSummary = this.dataSummary()?.trim();
    return {
      ...(route ? { route } : {}),
      ...(docKey ? { docKey } : {}),
      ...(docSubtopic ? { docSubtopic } : {}),
      ...(breadcrumbs.length ? { breadcrumbs } : {}),
      ...(dataSummary ? { dataSummary } : {}),
    };
  }

  setRoute(route: string | null | undefined): void {
    const normalized = route?.trim() || null;
    if (this.route() === normalized) {
      return;
    }
    this.route.set(normalized);
  }

  setDocKey(docKey: string | null | undefined): void {
    const normalized = docKey?.trim() || null;
    if (this.docKey() === normalized) {
      return;
    }
    this.docKey.set(normalized);
  }

  setDocSubtopic(docSubtopic: string | null | undefined): void {
    const normalized = docSubtopic?.trim() || null;
    if (this.docSubtopic() === normalized) {
      return;
    }
    this.docSubtopic.set(normalized);
  }

  setBreadcrumbs(breadcrumbs: string[]): void {
    const normalized = (breadcrumbs ?? [])
      .map((entry) => entry?.trim?.() ?? '')
      .filter((entry) => entry.length > 0)
      .slice(0, 20);
    const current = this.breadcrumbs();
    if (
      current.length === normalized.length &&
      current.every((value, index) => value === normalized[index])
    ) {
      return;
    }
    this.breadcrumbs.set(normalized);
  }

  setDataSummary(summary: string | null | undefined): void {
    const normalized = summary?.trim();
    if (!normalized) {
      if (this.dataSummary() === null) {
        return;
      }
      this.dataSummary.set(null);
      return;
    }
    const clipped = normalized.slice(0, 8000);
    if (this.dataSummary() === clipped) {
      return;
    }
    this.dataSummary.set(clipped);
  }
}
