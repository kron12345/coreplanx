import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom, Subscription } from 'rxjs';
import { PlanningStoreService } from '../../shared/planning-store.service';
import {
  SectionOfLine,
  SolNature,
  TopologyImportKind,
  TopologyImportRealtimeEvent,
  TopologyImportResponse,
  TopologyImportStatus,
} from '../../shared/planning-types';
import { CustomAttributeService } from '../../core/services/custom-attribute.service';
import {
  AttributeEntityEditorComponent,
  AttributeEntityRecord,
  BulkApplyEvent,
  EntitySaveEvent,
} from '../../shared/components/attribute-entity-editor/attribute-entity-editor.component';
import { mergeAttributeEntry } from '../../shared/utils/topology-attribute.helpers';
import { TopologyApiService } from '../topology-api.service';

const DEFAULT_FALLBACK = {
  startUniqueOpId: '',
  endUniqueOpId: '',
  lengthKm: '9.8',
  nature: 'REGULAR',
  id: 'DE-SOL-000123',
  name: 'Berlin Hbf – Berlin-Spandau',
  notActive: 'false',
  owner: 'DB Netz',
  country: 'DEU',
  attributeLine: '6107',
  tdaClassOfTrack: 'D4',
  tdaKvCodification: 'KV-G1',
  tdaTrackWidth: '1435',
  tdaMaxSpeed: '200',
  tdaProtectionLegacySystem: 'PZB|LZB',
  tdaCommuicationInfrastructure: 'GSM-R',
  tdaEtcsLevel: 'L2',
  tdaTsiPantographHead: '1950 mm',
  tdaOtherPantographHead: '',
  tdaContactLineSystem: '15kV/16.7Hz',
  tdaContactForcePermitted: '90 N',
  tdaGradientProfile: '0.5%',
  url: 'http://data.europa.eu/949/functionalInfrastructure/sectionsOfLine/DE000123',
};

const SOL_NATURES: SolNature[] = ['REGULAR', 'LINK'];

@Component({
  selector: 'app-section-of-line-editor',
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
          (click)="triggerSectionImport()"
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
        [title]="'Sections of Line'"
        [entities]="entityRecords()"
        [attributeDefinitions]="attributeDefinitions()"
        [defaultFallbackValues]="defaultFallback"
        [numericKeys]="numericKeys"
        [detailError]="error()"
        (saveEntity)="handleSave($event)"
        (deleteEntities)="handleDelete($event)"
        (bulkApply)="handleBulkApply($event)"
      />
    </section>
  `,
  styleUrl: './section-of-line-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SectionOfLineEditorComponent implements OnDestroy {
  private readonly store = inject(PlanningStoreService);
  private readonly customAttributes = inject(CustomAttributeService);
  private readonly topologyApi = inject(TopologyApiService);
  private importSubscription: Subscription | null = null;

  readonly attributeDefinitions = computed(() =>
    this.customAttributes.list('topology-sections-of-line'),
  );
  readonly entityRecords = computed<AttributeEntityRecord[]>(() =>
    this.store.sectionsOfLine().map((sol) => ({
      id: sol.solId,
      label: `${sol.startUniqueOpId} → ${sol.endUniqueOpId}`,
      secondaryLabel: `${sol.nature} · ${sol.lengthKm ?? '—'} km`,
      attributes: sol.attributes ?? [],
      fallbackValues: {
        startUniqueOpId: sol.startUniqueOpId,
        endUniqueOpId: sol.endUniqueOpId,
        lengthKm: sol.lengthKm != null ? String(sol.lengthKm) : '',
        nature: sol.nature,
      },
    })),
  );

  readonly defaultFallback = DEFAULT_FALLBACK;
  readonly numericKeys = ['lengthKm'];
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
    const payload: SectionOfLine = {
      solId: event.entityId ?? uid(),
      startUniqueOpId: core.startUniqueOpId,
      endUniqueOpId: core.endUniqueOpId,
      lengthKm: core.lengthKm,
      nature: core.nature,
      attributes: event.payload.attributes,
    };

    try {
      if (event.entityId) {
        this.store.updateSectionOfLine(payload.solId, payload);
      } else {
        this.store.addSectionOfLine(payload);
      }
      this.error.set(null);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    }
  }

  handleDelete(ids: string[]): void {
    ids.forEach((id) => this.store.removeSectionOfLine(id));
  }

  handleBulkApply(event: BulkApplyEvent): void {
    const definitions = this.attributeDefinitions();
    event.entityIds.forEach((id) => {
      const sol = this.findSection(id);
      if (!sol) {
        return;
      }
      const merged = mergeAttributeEntry(definitions, sol.attributes, {
        key: event.key,
        value: event.value,
        validFrom: event.validFrom || undefined,
      });
      this.store.updateSectionOfLine(id, { ...sol, attributes: merged });
    });
  }

  async triggerSectionImport(): Promise<void> {
    if (this.importState() === 'running') {
      return;
    }
    const kind: TopologyImportKind = 'sections-of-line';
    const startedAt = new Date();
    this.prepareImportUi(kind, startedAt);
    this.listenToImportStream(kind, startedAt.getTime(), () =>
      this.store.refreshSectionsOfLineFromApi(),
    );
    try {
      const response = await firstValueFrom(this.topologyApi.importSectionsOfLine());
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

  private deriveCoreFields(values: Record<string, string>):
    | {
        ok: true;
        startUniqueOpId: string;
        endUniqueOpId: string;
        lengthKm?: number;
        nature: SolNature;
      }
    | { ok: false; error: string } {
    const startUniqueOpId = values['startUniqueOpId']?.trim();
    const endUniqueOpId = values['endUniqueOpId']?.trim();
    if (!startUniqueOpId || !endUniqueOpId) {
      return { ok: false, error: 'Start- und End-OP müssen gesetzt sein.' };
    }
    if (!this.findOperationalPointByUniqueId(startUniqueOpId)) {
      return { ok: false, error: 'Start-OP existiert nicht.' };
    }
    if (!this.findOperationalPointByUniqueId(endUniqueOpId)) {
      return { ok: false, error: 'End-OP existiert nicht.' };
    }
    const natureRaw = values['nature']?.trim().toUpperCase() as SolNature | undefined;
    if (!natureRaw || !SOL_NATURES.includes(natureRaw)) {
      return { ok: false, error: 'Nature ist ungültig.' };
    }
    const lengthRaw = values['lengthKm']?.trim() ?? '';
    const length = lengthRaw ? Number(lengthRaw) : undefined;
    if (lengthRaw && !Number.isFinite(length)) {
      return { ok: false, error: 'Länge muss numerisch sein.' };
    }

    return {
      ok: true,
      startUniqueOpId,
      endUniqueOpId,
      lengthKm: length,
      nature: natureRaw,
    };
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error ?? 'Unbekannter Fehler');
  }

  private findOperationalPointByUniqueId(uniqueOpId: string) {
    return this.store.operationalPoints().find((op) => op.uniqueOpId === uniqueOpId);
  }

  private findSection(id: string): SectionOfLine | null {
    return this.store.sectionsOfLine().find((entry) => entry.solId === id) ?? null;
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
