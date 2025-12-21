import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged, of } from 'rxjs';
import { catchError, finalize, take } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import { PlanningTimetableApiService } from '../../core/api/planning-timetable-api.service';
import type { TimetableStageId, TrainServicePartRecordDto } from '../../core/api/planning-timetable-api.types';
import type { TrainRun, TrainSegment } from '../../models/train';
import { SimulationService } from '../../core/services/simulation.service';
import { ClientIdentityService } from '../../core/services/client-identity.service';

interface SplitCandidate {
  segmentId: string;
  label: string;
}

@Component({
  selector: 'app-planning-timetable-editor',
  imports: [CommonModule, ReactiveFormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './planning-timetable-editor.component.html',
  styleUrl: './planning-timetable-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanningTimetableEditorComponent {
  private readonly api = inject(PlanningTimetableApiService);
  private readonly simulations = inject(SimulationService);
  private readonly identity = inject(ClientIdentityService);

  readonly variants = computed(() => this.simulations.records());
  readonly selectedVariantId = signal<string>('default');
  readonly stageId = signal<TimetableStageId>('base');

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly message = signal<string | null>(null);
  readonly dirty = signal(false);

  readonly trainRuns = signal<TrainRun[]>([]);
  readonly trainSegments = signal<TrainSegment[]>([]);

  readonly runSearchControl = new FormControl('', { nonNullable: true });
  private readonly runSearchTerm = signal('');
  readonly selectedRunId = signal<string | null>(null);
  readonly selectedSegmentId = signal<string | null>(null);

  readonly servicePartsLoading = signal(false);
  readonly servicePartsError = signal<string | null>(null);
  readonly serviceParts = signal<TrainServicePartRecordDto[]>([]);
  readonly selectedServicePartId = signal<string | null>(null);
  readonly splitAfterSegmentId = signal<string | null>(null);

  readonly filteredTrainRuns = computed(() => {
    const term = this.runSearchTerm().trim().toLowerCase();
    const runs = this.trainRuns();
    if (!term) {
      return runs;
    }
    return runs.filter((run) => {
      const haystack = `${run.trainNumber} ${run.id}`.toLowerCase();
      return haystack.includes(term);
    });
  });

  readonly selectedTrainRun = computed(() => {
    const id = this.selectedRunId();
    if (!id) {
      return null;
    }
    return this.trainRuns().find((run) => run.id === id) ?? null;
  });

  readonly segmentsForSelectedRun = computed(() => {
    const runId = this.selectedRunId();
    if (!runId) {
      return [];
    }
    return this.trainSegments()
      .filter((seg) => seg.trainRunId === runId)
      .slice()
      .sort((a, b) => a.sectionIndex - b.sectionIndex);
  });

  readonly selectedSegment = computed(() => {
    const segId = this.selectedSegmentId();
    if (!segId) {
      return null;
    }
    return this.trainSegments().find((seg) => seg.id === segId) ?? null;
  });

  readonly servicePartsForSelectedRun = computed(() => {
    const runId = this.selectedRunId();
    const parts = this.serviceParts();
    const filtered = runId ? parts.filter((part) => part.trainRunId === runId) : parts;
    return filtered.slice().sort((a, b) => a.startTime.localeCompare(b.startTime));
  });

  readonly selectedServicePart = computed(() => {
    const partId = this.selectedServicePartId();
    if (!partId) {
      return null;
    }
    return this.serviceParts().find((part) => part.id === partId) ?? null;
  });

  readonly segmentsForSelectedPart = computed(() => {
    const part = this.selectedServicePart();
    if (!part) {
      return [];
    }
    const byId = new Map(this.trainSegments().map((seg) => [seg.id, seg] as const));
    const segments = part.segmentIds
      .map((id) => byId.get(id))
      .filter((seg): seg is TrainSegment => !!seg);
    if (segments.length !== part.segmentIds.length) {
      return segments.slice().sort((a, b) => a.sectionIndex - b.sectionIndex);
    }
    return segments;
  });

  readonly splitCandidates = computed<SplitCandidate[]>(() => {
    const segments = this.segmentsForSelectedPart();
    if (segments.length < 2) {
      return [];
    }
    return segments.slice(0, -1).map((seg) => ({
      segmentId: seg.id,
      label: `#${seg.sectionIndex} ${seg.fromLocationId}→${seg.toLocationId} (${seg.startTime} – ${seg.endTime})`,
    }));
  });

  readonly canMergePrevious = computed(() => {
    const selected = this.selectedServicePartId();
    if (!selected) {
      return false;
    }
    const list = this.servicePartsForSelectedRun();
    const idx = list.findIndex((part) => part.id === selected);
    return idx > 0;
  });

  readonly canMergeNext = computed(() => {
    const selected = this.selectedServicePartId();
    if (!selected) {
      return false;
    }
    const list = this.servicePartsForSelectedRun();
    const idx = list.findIndex((part) => part.id === selected);
    return idx >= 0 && idx < list.length - 1;
  });

  constructor() {
    this.runSearchControl.valueChanges
      .pipe(debounceTime(150), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((term) => this.runSearchTerm.set(term));

    effect(() => {
      const variants = this.variants();
      const current = this.selectedVariantId().trim();
      const isStillValid = current && variants.some((variant) => variant.id === current);
      if (isStillValid) {
        return;
      }
      const fallback = variants.find((variant) => variant.productive) ?? variants[0];
      this.selectedVariantId.set(fallback?.id ?? 'default');
    });
  }

  setVariant(variantId: string): void {
    const trimmed = variantId?.trim() || 'default';
    if (trimmed === this.selectedVariantId()) {
      return;
    }
    this.selectedVariantId.set(trimmed);
    this.resetSnapshot();
  }

  setStage(stageId: TimetableStageId): void {
    if (stageId === this.stageId()) {
      return;
    }
    this.stageId.set(stageId);
    this.resetSnapshot();
  }

  loadSnapshot(): void {
    if (this.loading()) {
      return;
    }
    const variantId = this.selectedVariantId().trim() || 'default';
    const stageId = this.stageId();
    this.loading.set(true);
    this.error.set(null);
    this.message.set(null);
    this.api
      .getSnapshot(variantId, stageId)
      .pipe(
        take(1),
        finalize(() => this.loading.set(false)),
        catchError((error) => {
          console.warn('[PlanningTimetableEditor] Failed to load timetable snapshot', error);
          this.error.set('Fahrplan-Snapshot konnte nicht geladen werden.');
          return of(null);
        }),
      )
      .subscribe((snapshot) => {
        if (!snapshot) {
          return;
        }
        this.trainRuns.set(snapshot.trainRuns ?? []);
        this.trainSegments.set(snapshot.trainSegments ?? []);
        this.dirty.set(false);
        this.selectedRunId.set(snapshot.trainRuns?.[0]?.id ?? null);
        this.selectedSegmentId.set(null);
        this.message.set(`Geladen: ${snapshot.trainRuns.length} Zugläufe, ${snapshot.trainSegments.length} Segmente.`);
        this.loadServiceParts();
      });
  }

  saveSnapshot(): void {
    if (this.loading() || !this.dirty()) {
      return;
    }
    const variantId = this.selectedVariantId().trim() || 'default';
    const stageId = this.stageId();
    const revisionMessage = this.promptRevisionMessageIfNeeded(variantId);
    if (revisionMessage === undefined) {
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.message.set(null);
    this.api
      .replaceSnapshot({
        variantId,
        stageId,
        trainRuns: this.trainRuns(),
        trainSegments: this.trainSegments(),
        revisionMessage,
        createdBy: this.identity.userId(),
      })
      .pipe(
        take(1),
        finalize(() => this.loading.set(false)),
        catchError((error) => {
          console.warn('[PlanningTimetableEditor] Failed to save timetable snapshot', error);
          this.error.set('Speichern fehlgeschlagen.');
          return of(null);
        }),
      )
      .subscribe((result) => {
        if (!result) {
          return;
        }
        this.dirty.set(false);
        this.message.set(
          `Gespeichert: ${result.applied.trainRuns} Zugläufe, ${result.applied.trainSegments} Segmente.`,
        );
        this.serviceParts.set([]);
        this.selectedServicePartId.set(null);
      });
  }

  downloadSnapshot(): void {
    const runs = this.trainRuns();
    const segments = this.trainSegments();
    const blob = new Blob([JSON.stringify({ trainRuns: runs, trainSegments: segments }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `timetable-${this.selectedVariantId()}-${this.stageId()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  importSnapshotFile(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] ?? null;
    if (!file) {
      return;
    }
    file
      .text()
      .then((text) => JSON.parse(text))
      .then((payload) => this.applyImportedSnapshot(payload))
      .catch((error) => {
        console.warn('[PlanningTimetableEditor] Failed to import snapshot', error);
        this.error.set('Import fehlgeschlagen (ungültiges JSON).');
      })
      .finally(() => {
        if (input) {
          input.value = '';
        }
      });
  }

  selectRun(runId: string): void {
    if (this.selectedRunId() === runId) {
      return;
    }
    this.selectedRunId.set(runId);
    this.selectedSegmentId.set(null);
    this.selectedServicePartId.set(null);
    this.splitAfterSegmentId.set(null);
  }

  selectSegment(segmentId: string): void {
    if (this.selectedSegmentId() === segmentId) {
      this.selectedSegmentId.set(null);
      return;
    }
    this.selectedSegmentId.set(segmentId);
  }

  addTrainRun(): void {
    const newRun: TrainRun = {
      id: this.createId('tr'),
      trainNumber: 'NEW',
      timetableId: null,
      attributes: {},
    };
    this.trainRuns.set([...this.trainRuns(), newRun]);
    this.selectedRunId.set(newRun.id);
    this.selectedSegmentId.set(null);
    this.dirty.set(true);
  }

  deleteSelectedRun(): void {
    const runId = this.selectedRunId();
    if (!runId) {
      return;
    }
    if (!confirm('Zuglauf löschen? Alle zugehörigen Segmente werden entfernt.')) {
      return;
    }
    this.trainRuns.set(this.trainRuns().filter((run) => run.id !== runId));
    this.trainSegments.set(this.trainSegments().filter((seg) => seg.trainRunId !== runId));
    this.selectedRunId.set(this.trainRuns()[0]?.id ?? null);
    this.selectedSegmentId.set(null);
    this.dirty.set(true);
  }

  updateTrainRun(runId: string, patch: Partial<TrainRun>): void {
    this.trainRuns.set(
      this.trainRuns().map((run) => (run.id === runId ? { ...run, ...patch } : run)),
    );
    this.dirty.set(true);
  }

  addSegment(trainRunId: string): void {
    const segments = this.trainSegments().filter((seg) => seg.trainRunId === trainRunId);
    const nextIndex = segments.length ? Math.max(...segments.map((seg) => seg.sectionIndex)) + 1 : 0;
    const now = new Date();
    const startTime = now.toISOString();
    const endTime = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
    const segment: TrainSegment = {
      id: this.createId('ts'),
      trainRunId,
      sectionIndex: nextIndex,
      startTime,
      endTime,
      fromLocationId: 'FROM',
      toLocationId: 'TO',
      pathId: null,
      distanceKm: null,
      attributes: {},
    };
    this.trainSegments.set([...this.trainSegments(), segment]);
    this.selectedSegmentId.set(segment.id);
    this.dirty.set(true);
  }

  deleteSelectedSegment(): void {
    const segId = this.selectedSegmentId();
    if (!segId) {
      return;
    }
    if (!confirm('Segment löschen?')) {
      return;
    }
    this.trainSegments.set(this.trainSegments().filter((seg) => seg.id !== segId));
    this.selectedSegmentId.set(null);
    this.dirty.set(true);
  }

  updateSegment(segmentId: string, patch: Partial<TrainSegment>): void {
    this.trainSegments.set(
      this.trainSegments().map((seg) => (seg.id === segmentId ? { ...seg, ...patch } : seg)),
    );
    this.dirty.set(true);
  }

  loadServiceParts(): void {
    if (this.servicePartsLoading()) {
      return;
    }
    const variantId = this.selectedVariantId().trim() || 'default';
    const stageId = this.stageId();
    this.servicePartsLoading.set(true);
    this.servicePartsError.set(null);
    this.api
      .listServiceParts(variantId, stageId)
      .pipe(
        take(1),
        finalize(() => this.servicePartsLoading.set(false)),
        catchError((error) => {
          console.warn('[PlanningTimetableEditor] Failed to load service parts', error);
          this.servicePartsError.set('Zugleistungen konnten nicht geladen werden.');
          return of([] as TrainServicePartRecordDto[]);
        }),
      )
      .subscribe((parts) => {
        this.serviceParts.set(parts ?? []);
        const selected = this.selectedServicePartId();
        if (selected && !parts.some((part) => part.id === selected)) {
          this.selectedServicePartId.set(parts[0]?.id ?? null);
          this.splitAfterSegmentId.set(null);
        }
      });
  }

  rebuildServiceParts(): void {
    const variantId = this.selectedVariantId().trim() || 'default';
    const stageId = this.stageId();
    if (!confirm('Auto Zerlegung ausführen? Vorhandene Zugleistungen werden überschrieben.')) {
      return;
    }
    this.servicePartsLoading.set(true);
    this.servicePartsError.set(null);
    this.api
      .rebuildServiceParts(variantId, stageId)
      .pipe(
        take(1),
        finalize(() => this.servicePartsLoading.set(false)),
        catchError((error) => {
          console.warn('[PlanningTimetableEditor] Failed to rebuild service parts', error);
          this.servicePartsError.set('Auto Zerlegung fehlgeschlagen.');
          return of(null);
        }),
      )
      .subscribe((result) => {
        if (!result) {
          return;
        }
        this.message.set(`Auto Zerlegung: ${result.parts} Zugleistungen erzeugt.`);
        this.loadServiceParts();
      });
  }

  selectServicePart(partId: string): void {
    const part = this.serviceParts().find((entry) => entry.id === partId) ?? null;
    this.selectedServicePartId.set(partId);
    this.splitAfterSegmentId.set(null);
    if (part && this.selectedRunId() !== part.trainRunId) {
      this.selectedRunId.set(part.trainRunId);
      this.selectedSegmentId.set(null);
    }
  }

  splitSelectedServicePart(): void {
    const part = this.selectedServicePart();
    const splitAfter = this.splitAfterSegmentId();
    if (!part || !splitAfter) {
      return;
    }
    const variantId = this.selectedVariantId().trim() || 'default';
    const stageId = this.stageId();
    this.servicePartsLoading.set(true);
    this.servicePartsError.set(null);
    this.api
      .splitServicePart({
        variantId,
        stageId,
        partId: part.id,
        splitAfterSegmentId: splitAfter,
      })
      .pipe(
        take(1),
        finalize(() => this.servicePartsLoading.set(false)),
        catchError((error) => {
          console.warn('[PlanningTimetableEditor] Failed to split service part', error);
          this.servicePartsError.set('Split fehlgeschlagen.');
          return of(null);
        }),
      )
      .subscribe((result) => {
        if (!result) {
          return;
        }
        this.message.set('Zugleistung wurde gesplittet.');
        this.selectedServicePartId.set(result.leftPartId);
        this.splitAfterSegmentId.set(null);
        this.loadServiceParts();
      });
  }

  mergeWithPrevious(): void {
    const selected = this.selectedServicePartId();
    if (!selected) {
      return;
    }
    const list = this.servicePartsForSelectedRun();
    const idx = list.findIndex((part) => part.id === selected);
    if (idx <= 0) {
      return;
    }
    this.mergeParts(list[idx - 1].id, selected);
  }

  mergeWithNext(): void {
    const selected = this.selectedServicePartId();
    if (!selected) {
      return;
    }
    const list = this.servicePartsForSelectedRun();
    const idx = list.findIndex((part) => part.id === selected);
    if (idx < 0 || idx >= list.length - 1) {
      return;
    }
    this.mergeParts(selected, list[idx + 1].id);
  }

  private mergeParts(leftPartId: string, rightPartId: string): void {
    const variantId = this.selectedVariantId().trim() || 'default';
    const stageId = this.stageId();
    this.servicePartsLoading.set(true);
    this.servicePartsError.set(null);
    this.api
      .mergeServiceParts({ variantId, stageId, leftPartId, rightPartId })
      .pipe(
        take(1),
        finalize(() => this.servicePartsLoading.set(false)),
        catchError((error) => {
          console.warn('[PlanningTimetableEditor] Failed to merge service parts', error);
          this.servicePartsError.set('Merge fehlgeschlagen.');
          return of(null);
        }),
      )
      .subscribe((result) => {
        if (!result) {
          return;
        }
        this.message.set('Zugleistungen wurden gemerged.');
        this.selectedServicePartId.set(result.mergedPartId);
        this.loadServiceParts();
      });
  }

  private resetSnapshot(): void {
    this.trainRuns.set([]);
    this.trainSegments.set([]);
    this.dirty.set(false);
    this.selectedRunId.set(null);
    this.selectedSegmentId.set(null);
    this.serviceParts.set([]);
    this.selectedServicePartId.set(null);
    this.splitAfterSegmentId.set(null);
    this.error.set(null);
    this.message.set(null);
    this.servicePartsError.set(null);
  }

  private promptRevisionMessageIfNeeded(variantId: string): string | null | undefined {
    if (!variantId.trim().toUpperCase().startsWith('PROD-')) {
      return null;
    }
    const value = prompt('Revision-Message (PROD wird revisioniert):', 'update');
    if (value === null) {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }

  private applyImportedSnapshot(payload: any): void {
    const trainRuns = Array.isArray(payload?.trainRuns) ? payload.trainRuns : Array.isArray(payload) ? payload : [];
    const trainSegments = Array.isArray(payload?.trainSegments) ? payload.trainSegments : [];
    if (!Array.isArray(trainRuns) || !Array.isArray(trainSegments)) {
      this.error.set('Import erwartet { trainRuns: [...], trainSegments: [...] }.');
      return;
    }
    this.trainRuns.set(trainRuns);
    this.trainSegments.set(trainSegments);
    this.dirty.set(true);
    this.selectedRunId.set(trainRuns[0]?.id ?? null);
    this.selectedSegmentId.set(null);
    this.message.set(`Importiert: ${trainRuns.length} Zugläufe, ${trainSegments.length} Segmente.`);
  }

  private createId(prefix: string): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}:${crypto.randomUUID()}`;
    }
    return `${prefix}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

