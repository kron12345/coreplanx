import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom, Subscription } from 'rxjs';
import { PlanningStoreService } from '../../shared/planning-store.service';
import {
  OperationalPoint,
  TopologyImportKind,
  TopologyImportRealtimeEvent,
  TopologyImportResponse,
  TopologyImportStatus,
} from '../../shared/planning-types';
import { CustomAttributeService } from '../../core/services/custom-attribute.service';
import {
  AttributeActionEvent,
  AttributeEntityEditorComponent,
  AttributeEntityRecord,
  BulkApplyEvent,
  EntitySaveEvent,
} from '../../shared/components/attribute-entity-editor/attribute-entity-editor.component';
import { mergeAttributeEntry } from '../../shared/utils/topology-attribute.helpers';
import { TopologyApiService } from '../topology-api.service';

const DEFAULT_FALLBACK = {
  uniqueOpId: '',
  name: '',
  countryCode: '',
  opType: '',
  lat: '',
  lng: '',
  id: 'DE12345',
  notActive: 'false',
  owner: 'DB Netz',
  country: 'DEU',
  type: 'station',
  tdaParkingNode: '',
  language: 'de|en',
  tafTapCountryCodeIso: 'DE',
  tafTapLocationPrimaryCode: '8000001',
  tsiZDeNotRelevantForPathOrdering: 'false',
  latitude: '52.525589',
  longitude: '13.369548',
  tdaUsableLength: '410',
  tdaPlatformHeight: '760',
  tdaKilometer: '10.5',
  tdaLineNational: '6107',
  tdaParentNetNode: '',
  pId: 'a9c42c2b0ef0a7e3b6a6a5d650f3cd21acec39fb',
  url: 'http://data.europa.eu/949/operationalPoints/DE12345',
};

@Component({
  selector: 'app-operational-point-editor',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    AttributeEntityEditorComponent,
  ],
  template: `
    <section class="topology-editor">
      <header class="topology-editor__toolbar">
        <button
          mat-stroked-button
          color="primary"
          type="button"
          (click)="triggerOperationalPointImport()"
          [disabled]="importState() === 'running'"
        >
          <mat-icon fontIcon="cloud_download"></mat-icon>
          Importieren
          <mat-progress-spinner
            *ngIf="importState() === 'running'"
            diameter="16"
            mode="indeterminate"
          ></mat-progress-spinner>
        </button>
        <button
          mat-button
          type="button"
          *ngIf="canToggleConsole()"
          (click)="toggleImportConsole()"
          [disabled]="importState() === 'running'"
        >
          {{ importConsoleOpen() ? 'Konsole schließen' : 'Konsole anzeigen' }}
        </button>
      </header>

      <div class="topology-editor__console" *ngIf="importConsoleVisible()">
        <header>
          <span>Import-Log</span>
          <button
            mat-icon-button
            type="button"
            (click)="hideImportConsole()"
            [disabled]="importState() === 'running'"
          >
            <mat-icon>close</mat-icon>
          </button>
        </header>
        <pre>{{ importLogs().join('\n') }}</pre>
      </div>

      <app-attribute-entity-editor
        [title]="'Operational Points'"
        [entities]="entityRecords()"
        [attributeDefinitions]="attributeDefinitions()"
        [defaultFallbackValues]="defaultFallback"
        [numericKeys]="numericKeys"
        [actionKeys]="actionKeys"
        [detailError]="error()"
        (saveEntity)="handleSave($event)"
        (deleteEntities)="handleDelete($event)"
        (bulkApply)="handleBulkApply($event)"
        (actionTriggered)="handleAction($event)"
      />
    </section>
  `,
  styleUrl: './operational-point-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OperationalPointEditorComponent implements OnDestroy {
  private readonly store = inject(PlanningStoreService);
  private readonly customAttributes = inject(CustomAttributeService);
  private readonly topologyApi = inject(TopologyApiService);
  private importSubscription: Subscription | null = null;

  readonly attributeDefinitions = computed(() =>
    this.customAttributes.list('topology-operational-points'),
  );
  readonly entityRecords = computed<AttributeEntityRecord[]>(() =>
    this.store.operationalPoints().map((op) => ({
      id: op.opId,
      label: op.name,
      secondaryLabel: `${op.uniqueOpId} · ${op.countryCode}`,
      attributes: op.attributes ?? [],
      fallbackValues: {
        uniqueOpId: op.uniqueOpId,
        name: op.name,
        countryCode: op.countryCode,
        opType: op.opType,
        lat: String(op.position.lat ?? ''),
        lng: String(op.position.lng ?? ''),
      },
    })),
  );

  readonly defaultFallback = DEFAULT_FALLBACK;
  readonly numericKeys = ['lat', 'lng'];
  readonly actionKeys = ['lat', 'lng'];
  readonly error = signal<string | null>(null);
  readonly importLogs = signal<string[]>([]);
  readonly importState = signal<'idle' | 'running' | 'success' | 'error'>('idle');
  readonly importConsoleOpen = signal(false);
  readonly importConsoleVisible = computed(
    () => this.importState() === 'running' || this.importConsoleOpen(),
  );
  readonly canToggleConsole = computed(
    () => this.importLogs().length > 0 || this.importState() !== 'idle',
  );

  ngOnDestroy(): void {
    this.teardownImportSubscription();
  }

  handleSave(event: EntitySaveEvent): void {
    const core = this.deriveCoreFields(event.payload.values);
    if (!core.ok) {
      this.error.set(core.error);
      return;
    }
    const payload: OperationalPoint = {
      opId: event.entityId ?? uid(),
      uniqueOpId: core.uniqueOpId,
      name: core.name,
      countryCode: core.countryCode,
      opType: core.opType,
      position: { lat: core.lat, lng: core.lng },
      attributes: event.payload.attributes,
    };

    try {
      if (event.entityId) {
        this.store.updateOperationalPoint(payload.opId, payload);
      } else {
        this.store.addOperationalPoint(payload);
      }
      this.error.set(null);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    }
  }

  handleDelete(ids: string[]): void {
    ids.forEach((id) => this.store.removeOperationalPoint(id));
  }

  handleBulkApply(event: BulkApplyEvent): void {
    const definitions = this.attributeDefinitions();
    event.entityIds.forEach((id) => {
      const op = this.findOperationalPoint(id);
      if (!op) {
        return;
      }
      const merged = mergeAttributeEntry(definitions, op.attributes, {
        key: event.key,
        value: event.value,
        validFrom: event.validFrom || undefined,
      });
      this.store.updateOperationalPoint(id, {
        ...op,
        attributes: merged,
      });
    });
  }

  async triggerOperationalPointImport(): Promise<void> {
    if (this.importState() === 'running') {
      return;
    }
    const kind: TopologyImportKind = 'operational-points';
    const startedAt = new Date();
    this.prepareImportUi(kind, startedAt);
    this.listenToImportStream(kind, startedAt.getTime(), () =>
      this.store.refreshOperationalPointsFromApi(),
    );
    try {
      const response = await firstValueFrom(this.topologyApi.importOperationalPoints());
      this.logImportAcknowledgement(response);
    } catch (error) {
      this.handleImportStartError(error);
    }
  }

  toggleImportConsole(): void {
    if (this.importState() === 'running') {
      return;
    }
    this.importConsoleOpen.set(!this.importConsoleOpen());
  }

  hideImportConsole(): void {
    if (this.importState() === 'running') {
      return;
    }
    this.importConsoleOpen.set(false);
  }

  handleAction(event: AttributeActionEvent): void {
    if (event.key !== 'lat' && event.key !== 'lng') {
      return;
    }
    const lat = event.values['lat'];
    const lng = event.values['lng'];
    if (!this.isValidNumber(lat) || !this.isValidNumber(lng)) {
      this.error.set('Bitte gültige Koordinaten eingeben.');
      return;
    }
    window.open(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}&zoom=16`, '_blank');
  }

  private deriveCoreFields(values: Record<string, string>):
    | {
        ok: true;
        uniqueOpId: string;
        name: string;
        countryCode: string;
        opType: string;
        lat: number;
        lng: number;
      }
    | { ok: false; error: string } {
    const uniqueOpId = values['uniqueOpId']?.trim();
    if (!uniqueOpId) {
      return { ok: false, error: 'Unique OP ID ist erforderlich.' };
    }
    const name = values['name']?.trim();
    if (!name) {
      return { ok: false, error: 'Name ist erforderlich.' };
    }
    const countryCode = values['countryCode']?.trim();
    if (!countryCode) {
      return { ok: false, error: 'Country Code ist erforderlich.' };
    }
    const opType = values['opType']?.trim();
    if (!opType) {
      return { ok: false, error: 'OP-Typ ist erforderlich.' };
    }
    const latRaw = values['lat']?.trim() ?? '';
    const lngRaw = values['lng']?.trim() ?? '';
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { ok: false, error: 'Latitude und Longitude müssen numerisch sein.' };
    }

    return {
      ok: true,
      uniqueOpId,
      name,
      countryCode,
      opType,
      lat,
      lng,
    };
  }

  private isValidNumber(value: string | undefined): boolean {
    if (value == null || value === '') {
      return false;
    }
    return Number.isFinite(Number(value));
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error ?? 'Unbekannter Fehler');
  }

  private findOperationalPoint(id: string): OperationalPoint | null {
    return this.store.operationalPoints().find((entry) => entry.opId === id) ?? null;
  }

  private prepareImportUi(kind: TopologyImportKind, startedAt: Date): void {
    this.importState.set('running');
    this.importConsoleOpen.set(true);
    this.importLogs.set([
      `[${this.formatTimestamp(startedAt)}] Import für ${this.describeImportKind(kind)} gestartet …`,
    ]);
  }

  private listenToImportStream(
    kind: TopologyImportKind,
    sinceMs: number,
    refresh: () => Promise<void>,
  ): void {
    this.teardownImportSubscription();
    this.importSubscription = this.topologyApi.streamTopologyImportEvents().subscribe({
      next: (event) => this.handleImportEvent(event, kind, sinceMs, refresh),
      error: (error) => this.handleImportStreamError(error),
    });
  }

  private handleImportEvent(
    event: TopologyImportRealtimeEvent,
    kind: TopologyImportKind,
    sinceMs: number,
    refresh: () => Promise<void>,
  ): void {
    if (!this.eventMatchesKind(event, kind) || !this.isEventRecent(event, sinceMs)) {
      return;
    }
    this.importLogs.update((lines) => [...lines, this.formatImportEvent(event)]);
    if (this.isTerminalStatus(event.status)) {
      if (event.status === 'succeeded' || event.status === 'ignored') {
        this.importState.set('success');
        void refresh();
      } else {
        this.importState.set('error');
      }
      this.teardownImportSubscription();
    }
  }

  private logImportAcknowledgement(response: TopologyImportResponse | null | undefined): void {
    if (!response) {
      return;
    }
    const kinds = response.requestedKinds?.length
      ? response.requestedKinds.join(', ')
      : 'Topologie';
    const suffix = response.message ? ` – ${response.message}` : '';
    this.importLogs.update((lines) => [
      ...lines,
      `[${this.formatTimestamp(response.startedAt)}] Importauftrag registriert (${kinds})${suffix}`,
    ]);
  }

  private handleImportStartError(error: unknown): void {
    this.importLogs.update((lines) => [
      ...lines,
      `Fehler beim Importstart: ${this.describeError(error)}`,
    ]);
    this.importState.set('error');
    this.teardownImportSubscription();
  }

  private handleImportStreamError(error: unknown): void {
    this.importLogs.update((lines) => [
      ...lines,
      `Stream-Fehler: ${this.describeError(error)}`,
    ]);
    this.importState.set('error');
    this.teardownImportSubscription();
  }

  private isTerminalStatus(status: TopologyImportStatus): boolean {
    return status === 'succeeded' || status === 'failed' || status === 'ignored';
  }

  private eventMatchesKind(event: TopologyImportRealtimeEvent, kind: TopologyImportKind): boolean {
    if (!event.kinds || event.kinds.length === 0) {
      return true;
    }
    return event.kinds.includes(kind);
  }

  private isEventRecent(event: TopologyImportRealtimeEvent, sinceMs: number): boolean {
    if (!event.timestamp) {
      return true;
    }
    const timestamp = Date.parse(event.timestamp);
    if (Number.isNaN(timestamp)) {
      return true;
    }
    return timestamp >= sinceMs;
  }

  private describeImportKind(kind: TopologyImportKind): string {
    switch (kind) {
      case 'operational-points':
        return 'Operational Points';
      case 'sections-of-line':
        return 'Sections of Line';
      default:
        return kind;
    }
  }

  private formatImportEvent(event: TopologyImportRealtimeEvent): string {
    const kinds = event.kinds?.length ? ` (${event.kinds.join(', ')})` : '';
    const message = event.message ? ` – ${event.message}` : '';
    const source = event.source ? ` – Quelle: ${event.source}` : '';
    return `[${this.formatTimestamp(event.timestamp)}] ${event.status}${kinds}${message}${source}`;
  }

  private formatTimestamp(value: string | Date): string {
    const date = typeof value === 'string' ? new Date(value) : value;
    if (Number.isNaN(date.getTime())) {
      return new Date().toLocaleTimeString();
    }
    return date.toLocaleTimeString();
  }

  private teardownImportSubscription(): void {
    if (this.importSubscription) {
      this.importSubscription.unsubscribe();
      this.importSubscription = null;
    }
  }
}

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
