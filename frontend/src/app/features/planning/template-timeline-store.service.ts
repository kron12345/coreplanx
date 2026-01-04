import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { catchError, EMPTY, take, tap } from 'rxjs';
import { TimelineApiService } from '../../core/api/timeline-api.service';
import { TemplateSetDto } from '../../core/api/timeline-api.types';
import { PlanningApiContext } from '../../core/api/planning-api-context';
import { PlanningDataService } from './planning-data.service';
import { TimetableYearService } from '../../core/services/timetable-year.service';

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
  private readonly planningData = inject(PlanningDataService);
  private readonly timetableYear = inject(TimetableYearService);
  private readonly planningVariant = this.planningData.planningVariant();
  private readonly state = signal<TemplateStoreState>({ ...INITIAL_STATE });
  private templatesLoaded = false;
  private lastSelectedId: string | null = null;
  private activeVariantId: string = 'default';
  private readonly selectedTemplatePerVariant = new Map<string, string | null>();

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

  constructor() {
    effect(() => {
      const variant = this.planningVariant();
      const nextVariantId = variant?.id?.trim() || 'default';
      if (nextVariantId === this.activeVariantId) {
        return;
      }
      this.selectedTemplatePerVariant.set(this.activeVariantId, this.state().selectedTemplateId);
      this.activeVariantId = nextVariantId;
      this.templatesLoaded = false;
      this.lastSelectedId = null;
      this.setState({
        templates: [],
        selectedTemplateId: this.selectedTemplatePerVariant.get(nextVariantId) ?? null,
        loading: false,
        error: null,
      });
      this.loadTemplates(true);
    });
  }

  loadTemplates(force = false): void {
    if (!force && (this.templatesLoaded || this.state().loading)) {
      return;
    }
    this.setState({ loading: true, error: null });
    this.api
      .listTemplateSets(this.currentApiContext())
      .pipe(
        take(1),
        tap((templates) => {
          this.templatesLoaded = true;
          if (templates.length === 0) {
            this.setState({ templates: [], selectedTemplateId: null, loading: false, error: null });
            this.ensureDefaultTemplateForVariant();
            return;
          }
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
          .createTemplate(template, this.currentApiContext())
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
                  .updateTemplate(template, this.currentApiContext())
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
      .updateTemplate(template, this.currentApiContext())
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
      .getTemplate(templateId, this.currentApiContext())
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

  private ensureDefaultTemplateForVariant(): void {
    const variant = this.planningVariant();
    const variantId = variant?.id?.trim() || 'default';
    const safeVariant = variantId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const templateId = `default-${safeVariant}`;
    if (this.state().templates.some((entry) => entry.id === templateId)) {
      this.setState({ selectedTemplateId: templateId });
      return;
    }
    if (this.syntheticTemplate?.id === templateId) {
      const current = this.state();
      const templates = current.templates.some((entry) => entry.id === templateId)
        ? current.templates
        : [this.syntheticTemplate, ...current.templates];
      this.setState({ templates, selectedTemplateId: templateId });
      return;
    }
    const timetableYearLabel = variant?.timetableYearLabel?.trim() || null;
    const yearBounds = this.resolveDefaultYearBounds(timetableYearLabel);
    this.setSyntheticTemplate({
      id: templateId,
      name: 'Default',
      description: 'Standard-Fahrplanjahr',
      tableName: `template_${templateId}`,
      variantId,
      timetableYearLabel,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      periods: [
        {
          id: `default-${yearBounds.label}`,
          validFrom: yearBounds.startIso,
          validTo: yearBounds.endIso,
        },
      ],
      specialDays: [],
    });
  }

  private resolveDefaultYearBounds(label: string | null) {
    if (label) {
      try {
        return this.timetableYear.getYearByLabel(label);
      } catch {
        // fall back to default bounds
      }
    }
    return this.timetableYear.defaultYearBounds();
  }

  private currentApiContext(): PlanningApiContext {
    const variant = this.planningVariant();
    return {
      variantId: variant?.id ?? 'default',
      timetableYearLabel: variant?.timetableYearLabel ?? null,
    };
  }
}
