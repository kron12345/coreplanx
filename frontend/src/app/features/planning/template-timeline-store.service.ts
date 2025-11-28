import { Injectable, computed, inject, signal } from '@angular/core';
import { catchError, EMPTY, take, tap } from 'rxjs';
import { TimelineApiService } from '../../core/api/timeline-api.service';
import { TemplateSetDto } from '../../core/api/timeline-api.types';

interface TemplateStoreState {
  templates: TemplateSetDto[];
  selectedTemplateId: string | null;
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: TemplateStoreState = {
  templates: [],
  selectedTemplateId: null,
  loading: false,
  error: null,
};

@Injectable({ providedIn: 'root' })
export class TemplateTimelineStoreService {
  private readonly api = inject(TimelineApiService);
  private readonly state = signal<TemplateStoreState>({ ...INITIAL_STATE });
  private templatesLoaded = false;
  private lastSelectedId: string | null = null;

  readonly templates = computed(() => this.state().templates);
  readonly selectedTemplate = computed(() => {
    const current = this.state();
    return current.templates.find((entry) => entry.id === current.selectedTemplateId) ?? null;
  });
  readonly selectedTemplateWithFallback = computed(() => {
    return this.selectedTemplate() ?? this.templates()[0] ?? null;
  });
  readonly isLoading = computed(() => this.state().loading);
  readonly error = computed(() => this.state().error);

  loadTemplates(force = false): void {
    if (!force && (this.templatesLoaded || this.state().loading)) {
      return;
    }
    this.setState({ loading: true, error: null });
    this.api
      .listTemplateSets()
      .pipe(
        take(1),
        tap((templates) => {
          this.templatesLoaded = true;
          const nextSelected =
            this.state().selectedTemplateId && templates.some((t) => t.id === this.state().selectedTemplateId)
              ? this.state().selectedTemplateId
              : templates[0]?.id ?? null;
          this.setState({ templates, selectedTemplateId: nextSelected, loading: false });
        }),
        catchError((error) => {
          console.error('[TemplateTimelineStore] Failed to load template sets', error);
          this.templatesLoaded = false;
          this.setState({ loading: false, error: 'Templates konnten nicht geladen werden.' });
          return EMPTY;
        }),
      )
      .subscribe();
  }

  selectTemplate(templateId: string | null): void {
    const current = this.state();
    const nextId = templateId ?? current.templates[0]?.id ?? null;
    if (nextId === current.selectedTemplateId) {
      return;
    }
    this.setState({ selectedTemplateId: nextId });
    if (nextId === this.lastSelectedId) {
      return;
    }
    this.lastSelectedId = nextId;
    if (nextId) {
      this.loadTemplateDetail(nextId);
    }
  }

  updateTemplate(template: TemplateSetDto): void {
    this.api
      .updateTemplate(template)
      .pipe(
        take(1),
        tap((saved) => {
          const templates = this.state().templates.map((entry) => (entry.id === saved.id ? saved : entry));
          this.setState({ templates, selectedTemplateId: saved.id });
        }),
        catchError((error) => {
          console.error('[TemplateTimelineStore] Failed to update template', error);
          this.setState({ error: 'Template konnte nicht gespeichert werden.' });
          return EMPTY;
        }),
      )
      .subscribe();
  }

  private setState(patch: Partial<TemplateStoreState>): void {
    this.state.update((current) => ({ ...current, ...patch }));
  }

  private loadTemplateDetail(templateId: string): void {
    this.api
      .getTemplate(templateId)
      .pipe(
        take(1),
        tap((tpl) => {
          const templates = this.state().templates;
          const next = templates.some((entry) => entry.id === tpl.id)
            ? templates.map((entry) => (entry.id === tpl.id ? tpl : entry))
            : [...templates, tpl];
          this.setState({ templates: next, selectedTemplateId: tpl.id });
        }),
        catchError((error) => {
          console.warn('[TemplateTimelineStore] Failed to load template detail', error);
          return EMPTY;
        }),
      )
      .subscribe();
  }
}
