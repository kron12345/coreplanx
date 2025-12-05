import { Injectable, computed, inject, signal } from '@angular/core';
import { catchError, EMPTY, take, tap } from 'rxjs';
import { TimelineApiService } from '../../core/api/timeline-api.service';
import { TemplateSetDto } from '../../core/api/timeline-api.types';

interface TemplateStoreState {
  templates: TemplateSetDto[];
  selectedTemplateId: string | null;
  loading: boolean;
  error: string | null;
  syntheticPersisted: boolean;
}

const INITIAL_STATE: TemplateStoreState = {
  templates: [],
  selectedTemplateId: null,
  loading: false,
  error: null,
  syntheticPersisted: false,
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
  private syntheticTemplate: TemplateSetDto | null = null;
  private syntheticPersisted = false;

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
          this.setState({
            templates,
            selectedTemplateId: nextSelected,
            loading: false,
            syntheticPersisted: templates.length > 0 ? true : this.state().syntheticPersisted,
          });
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

  setSyntheticTemplate(template: TemplateSetDto): void {
    this.syntheticTemplate = template;
    this.syntheticPersisted = false;
    const current = this.state();
    const exists = current.templates.some((t) => t.id === template.id);
    const templates = exists ? current.templates : [template, ...current.templates];
    this.setState({
      templates,
      selectedTemplateId: template.id,
    });
    // Persist sofort, damit Timeline-/Activity-Endpunkte funktionieren.
    this.updateTemplate(template);
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
    if (this.syntheticTemplate && template.id === this.syntheticTemplate.id) {
      if (!this.syntheticPersisted) {
        this.api
          .createTemplate(template)
          .pipe(
            take(1),
            tap((saved) => {
              this.syntheticPersisted = true;
              this.syntheticTemplate = null;
              const templates = this.state().templates.map((entry) => (entry.id === template.id ? saved : entry));
              this.setState({
                templates,
                selectedTemplateId: saved.id,
                error: null,
                syntheticPersisted: true,
              });
            }),
            catchError((error) => {
              console.error('[TemplateTimelineStore] Failed to create template', error);
              // Fallback: try update in case the template already exists
              if (error?.status === 409 || error?.status === 500) {
                return this.api
                  .updateTemplate(template)
                  .pipe(
                    take(1),
                    tap((saved) => {
                      this.syntheticPersisted = true;
                      this.syntheticTemplate = null;
                      const templates = this.state().templates.map((entry) =>
                        entry.id === template.id ? saved : entry,
                      );
                      this.setState({
                        templates,
                        selectedTemplateId: saved.id,
                        error: null,
                        syntheticPersisted: true,
                      });
                    }),
                    catchError((err2) => {
                      console.error('[TemplateTimelineStore] Fallback update failed', err2);
                      this.setState({ error: 'Template konnte nicht gespeichert werden.' });
                      return EMPTY;
                    }),
                  );
              }
              this.setState({ error: 'Template konnte nicht gespeichert werden (Anlegen fehlgeschlagen).' });
              return EMPTY;
            }),
          )
          .subscribe();
        return;
      }
      // Already persisted, fall through to update
    }

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
