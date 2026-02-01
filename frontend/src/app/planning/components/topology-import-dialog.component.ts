import { CommonModule } from '@angular/common';
import { Component, OnDestroy, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Subscription, firstValueFrom } from 'rxjs';
import { TopologyApiService } from '../topology-api.service';
import {
  TopologyImportRealtimeEvent,
  TopologyImportStatus,
  TopologyImportKind,
} from '../../shared/planning-types';
import { PlanningStoreService } from '../../shared/planning-store.service';

export interface TopologyImportDialogData {
  kinds: { value: TopologyImportKind; label: string }[];
}

export interface TopologyImportDialogResult {
  kind: TopologyImportKind;
  file: File;
}

interface PreviewDiff {
  id: string;
  changes: { field: string; before: string; after: string }[];
}

interface PreviewState {
  ready: boolean;
  total: number;
  existing: number;
  newCount: number;
  updateCount: number;
  unchangedCount: number;
  duplicateCount: number;
  invalidCount: number;
  duplicates: string[];
  invalidIds: string[];
  diffs: PreviewDiff[];
  blocked: boolean;
}

@Component({
  selector: 'app-topology-import-dialog',
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatSelectModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './topology-import-dialog.component.html',
  styleUrl: './topology-import-dialog.component.scss',
})
export class TopologyImportDialogComponent implements OnDestroy {
  private readonly dialogRef =
    inject<MatDialogRef<TopologyImportDialogComponent, TopologyImportDialogResult | undefined>>(
      MatDialogRef,
    );
  private readonly data = inject<TopologyImportDialogData>(MAT_DIALOG_DATA);
  private readonly topologyApi = inject(TopologyApiService);
  private readonly store = inject(PlanningStoreService);

  readonly kinds = this.data.kinds;
  readonly selectedKind = signal<TopologyImportKind>(this.kinds[0]?.value ?? 'operational-points');
  readonly fileName = signal<string>('');
  readonly importLogs = signal<string[]>([]);
  readonly importStatus = signal<TopologyImportStatus | null>(null);
  readonly isBusy = signal(false);
  readonly preview = signal<PreviewState>({
    ready: false,
    total: 0,
    existing: 0,
    newCount: 0,
    updateCount: 0,
    unchangedCount: 0,
    duplicateCount: 0,
    invalidCount: 0,
    duplicates: [],
    invalidIds: [],
    diffs: [],
    blocked: false,
  });
  private file: File | null = null;
  private importSubscription: Subscription | null = null;

  handleFileChange(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] ?? null;
    this.file = file;
    this.fileName.set(file?.name ?? '');
    this.preview.set({
      ready: false,
      total: 0,
      existing: 0,
      newCount: 0,
      updateCount: 0,
      unchangedCount: 0,
      duplicateCount: 0,
      invalidCount: 0,
      duplicates: [],
      invalidIds: [],
      diffs: [],
      blocked: false,
    });
    if (file) {
      void this.buildPreview(file, this.selectedKind());
    }
  }

  handleKindChange(kind: TopologyImportKind): void {
    this.selectedKind.set(kind);
    if (this.file) {
      void this.buildPreview(this.file, kind);
    }
  }

  async submit(): Promise<void> {
    if (!this.file || this.isBusy() || this.preview().blocked || !this.preview().ready) {
      return;
    }
    const kind = this.selectedKind();
    const startedAt = new Date();
    this.importLogs.set([
      `[${this.formatTimestamp(startedAt)}] Upload gestartet für ${this.describeImportKind(kind)} …`,
    ]);
    this.importStatus.set('queued');
    this.isBusy.set(true);
    this.listenToImportStream(kind, startedAt.getTime());
    try {
      const response = await firstValueFrom(
        this.topologyApi.uploadTopologyImportFile(kind, this.file),
      );
      const fileLabel = response?.fileName ?? this.file.name;
      this.importLogs.update((lines) => [
        ...lines,
        `[${this.formatTimestamp(new Date())}] Upload gespeichert: ${fileLabel}`,
      ]);
    } catch (error) {
      this.importLogs.update((lines) => [
        ...lines,
        `[${this.formatTimestamp(new Date())}] Fehler: ${this.describeError(error)}`,
      ]);
      this.importStatus.set('failed');
      this.isBusy.set(false);
      this.teardownImportSubscription();
    }
  }

  cancel(): void {
    this.dialogRef.close(undefined);
  }

  closeDialog(): void {
    this.dialogRef.close(undefined);
  }

  ngOnDestroy(): void {
    this.teardownImportSubscription();
  }

  private listenToImportStream(kind: TopologyImportKind, sinceMs: number): void {
    this.teardownImportSubscription();
    this.importSubscription = this.topologyApi.streamTopologyImportEvents().subscribe({
      next: (event) => this.handleImportEvent(event, kind, sinceMs),
      error: (error) => this.handleImportStreamError(error),
    });
  }

  private handleImportEvent(
    event: TopologyImportRealtimeEvent,
    kind: TopologyImportKind,
    sinceMs: number,
  ): void {
    if (!this.eventMatchesKind(event, kind) || !this.isEventRecent(event, sinceMs)) {
      return;
    }
    this.importStatus.set(event.status);
    this.importLogs.update((lines) => [...lines, this.formatImportEvent(event)]);
    if (this.isTerminalStatus(event.status)) {
      this.isBusy.set(false);
      if (event.status === 'succeeded') {
        void this.refreshByKind(kind);
      }
      this.teardownImportSubscription();
    }
  }

  private handleImportStreamError(error: unknown): void {
    this.importLogs.update((lines) => [
      ...lines,
      `[${this.formatTimestamp(new Date())}] Stream-Fehler: ${this.describeError(error)}`,
    ]);
    this.isBusy.set(false);
    this.teardownImportSubscription();
  }

  private isTerminalStatus(status: TopologyImportStatus): boolean {
    return status === 'failed' || status === 'succeeded' || status === 'ignored';
  }

  private eventMatchesKind(event: TopologyImportRealtimeEvent, kind: TopologyImportKind): boolean {
    if (!event.kinds || !event.kinds.length) {
      return false;
    }
    return event.kinds.includes(kind);
  }

  private isEventRecent(event: TopologyImportRealtimeEvent, sinceMs: number): boolean {
    const timestamp = Date.parse(event.timestamp);
    if (Number.isNaN(timestamp)) {
      return true;
    }
    return timestamp >= sinceMs;
  }

  private describeImportKind(kind: TopologyImportKind): string {
    const entry = this.kinds.find((item) => item.value === kind);
    return entry?.label ?? kind;
  }

  private async refreshByKind(kind: TopologyImportKind): Promise<void> {
    switch (kind) {
      case 'operational-points':
        await this.store.refreshOperationalPointsFromApi();
        return;
      case 'sections-of-line':
        await this.store.refreshSectionsOfLineFromApi();
        return;
      case 'station-areas':
        await this.store.refreshStationAreasFromApi();
        return;
      case 'tracks':
        await this.store.refreshTracksFromApi();
        return;
      case 'platform-edges':
        await this.store.refreshPlatformEdgesFromApi();
        return;
      case 'platforms':
        await this.store.refreshPlatformsFromApi();
        return;
      case 'sidings':
        await this.store.refreshSidingsFromApi();
        return;
      default:
        return;
    }
  }

  private formatImportEvent(event: TopologyImportRealtimeEvent): string {
    const status = event.status.toUpperCase();
    const message = event.message ?? 'Status-Update';
    return `[${this.formatTimestamp(event.timestamp)}] ${status}: ${message}`;
  }

  private formatTimestamp(value: string | Date): string {
    const date = typeof value === 'string' ? new Date(value) : value;
    if (Number.isNaN(date.getTime())) {
      return 'unbekannt';
    }
    return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  private describeError(error: unknown): string {
    if (!error) {
      return 'Unbekannter Fehler';
    }
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private teardownImportSubscription(): void {
    if (this.importSubscription) {
      this.importSubscription.unsubscribe();
      this.importSubscription = null;
    }
  }

  private async buildPreview(file: File, kind: TopologyImportKind): Promise<void> {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const items = this.normalizePreviewItems(parsed);
      this.preparePreview(items, kind);
    } catch (error) {
      this.preview.set({
        ready: false,
        total: 0,
        existing: 0,
        newCount: 0,
        updateCount: 0,
        unchangedCount: 0,
        duplicateCount: 0,
        invalidCount: 1,
        duplicates: [],
        invalidIds: ['Datei konnte nicht gelesen oder geparst werden.'],
        diffs: [],
        blocked: true,
      });
      this.importLogs.update((lines) => [
        ...lines,
        `[${this.formatTimestamp(new Date())}] Preview-Fehler: ${this.describeError(error)}`,
      ]);
    }
  }

  private normalizePreviewItems(parsed: unknown): Record<string, unknown>[] {
    if (Array.isArray(parsed)) {
      return parsed.filter((item) => item && typeof item === 'object') as Record<string, unknown>[];
    }
    if (parsed && typeof parsed === 'object') {
      const items = (parsed as { items?: unknown }).items;
      if (Array.isArray(items)) {
        return items.filter((item) => item && typeof item === 'object') as Record<string, unknown>[];
      }
    }
    return [];
  }

  private preparePreview(items: Record<string, unknown>[], kind: TopologyImportKind): void {
    if (items.length === 0) {
      this.preview.set({
        ready: false,
        total: 0,
        existing: 0,
        newCount: 0,
        updateCount: 0,
        unchangedCount: 0,
        duplicateCount: 0,
        invalidCount: 1,
        duplicates: [],
        invalidIds: ['Keine Eintraege im Upload gefunden.'],
        diffs: [],
        blocked: true,
      });
      return;
    }
    const idField = this.getIdField(kind);
    const existingMap = this.getExistingMap(kind);
    const duplicates = new Set<string>();
    const seen = new Set<string>();
    const invalidIds: string[] = [];
    const diffs: PreviewDiff[] = [];
    let newCount = 0;
    let updateCount = 0;
    let unchangedCount = 0;

    items.forEach((item) => {
      const id = this.coerceId(item[idField]);
      if (!id) {
        invalidIds.push(`(missing ${idField})`);
        return;
      }
      if (seen.has(id)) {
        duplicates.add(id);
        return;
      }
      seen.add(id);
      const existing = existingMap.get(id);
      if (!existing) {
        newCount += 1;
        return;
      }
      const changes = this.diffItems(existing as Record<string, unknown>, item);
      if (changes.length === 0) {
        unchangedCount += 1;
      } else {
        updateCount += 1;
        if (diffs.length < 20) {
          diffs.push({ id, changes: changes.slice(0, 8) });
        }
      }
    });

    const duplicateList = Array.from(duplicates).slice(0, 12);
    const blocked = duplicates.size > 0 || invalidIds.length > 0;
    this.preview.set({
      ready: true,
      total: items.length,
      existing: existingMap.size,
      newCount,
      updateCount,
      unchangedCount,
      duplicateCount: duplicates.size,
      invalidCount: invalidIds.length,
      duplicates: duplicateList,
      invalidIds: invalidIds.slice(0, 12),
      diffs,
      blocked,
    });
  }

  private getIdField(kind: TopologyImportKind): string {
    switch (kind) {
      case 'operational-points':
        return 'uniqueOpId';
      case 'sections-of-line':
        return 'solId';
      case 'station-areas':
        return 'stationAreaId';
      case 'tracks':
        return 'trackKey';
      case 'platform-edges':
        return 'platformEdgeId';
      case 'platforms':
        return 'platformKey';
      case 'sidings':
        return 'sidingKey';
      default:
        return 'id';
    }
  }

  private getExistingMap(kind: TopologyImportKind): Map<string, unknown> {
    switch (kind) {
      case 'operational-points':
        return new Map(this.store.operationalPoints().map((item) => [item.uniqueOpId, item]));
      case 'sections-of-line':
        return new Map(this.store.sectionsOfLine().map((item) => [item.solId, item]));
      case 'station-areas':
        return new Map(this.store.stationAreas().map((item) => [item.stationAreaId, item]));
      case 'tracks':
        return new Map(this.store.tracks().map((item) => [item.trackKey, item]));
      case 'platform-edges':
        return new Map(this.store.platformEdges().map((item) => [item.platformEdgeId, item]));
      case 'platforms':
        return new Map(this.store.platforms().map((item) => [item.platformKey, item]));
      case 'sidings':
        return new Map(this.store.sidings().map((item) => [item.sidingKey, item]));
      default:
        return new Map();
    }
  }

  private coerceId(value: unknown): string {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    return '';
  }

  private diffItems(
    existing: Record<string, unknown>,
    incoming: Record<string, unknown>,
  ): { field: string; before: string; after: string }[] {
    const ignored = new Set([
      'createdAt',
      'createdBy',
      'updatedAt',
      'updatedBy',
      'validTo',
      'validToDate',
      'validToUtc',
      'validToTimestamp',
      'validUntil',
    ]);
    const keys = new Set<string>([...Object.keys(existing), ...Object.keys(incoming)]);
    const changes: { field: string; before: string; after: string }[] = [];
    keys.forEach((key) => {
      if (ignored.has(key)) {
        return;
      }
      const beforeValue = this.normalizeValue(existing[key]);
      const afterValue = this.normalizeValue(incoming[key]);
      if (beforeValue !== afterValue) {
        changes.push({ field: key, before: beforeValue, after: afterValue });
      }
    });
    return changes;
  }

  private normalizeValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'string') {
      return value.trim();
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (Array.isArray(value)) {
      return JSON.stringify(value.map((item) => this.normalizeValue(item)));
    }
    if (typeof value === 'object') {
      return this.stableStringify(value as Record<string, unknown>);
    }
    return String(value);
  }

  private stableStringify(value: Record<string, unknown>): string {
    const keys = Object.keys(value).sort();
    const normalized: Record<string, unknown> = {};
    keys.forEach((key) => {
      normalized[key] = value[key];
    });
    return JSON.stringify(normalized);
  }
}
