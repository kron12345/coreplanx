import { Component, OnInit, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDialog } from '@angular/material/dialog';
import { MATERIAL_IMPORTS } from '../core/material.imports.imports';
import { PlanningStoreService } from '../shared/planning-store.service';
import { TopologyImportDialogComponent } from './components/topology-import-dialog.component';
import type { TopologyImportKind } from '../shared/planning-types';
import { OperationalPointEditorComponent } from './components/operational-point-editor.component';
import { SectionOfLineEditorComponent } from './components/section-of-line-editor.component';
import { StationAreaEditorComponent } from './components/station-area-editor.component';
import { TrackEditorComponent } from './components/track-editor.component';
import { PlatformEdgeEditorComponent } from './components/platform-edge-editor.component';
import { PlatformEditorComponent } from './components/platform-editor.component';
import { SidingEditorComponent } from './components/siding-editor.component';
import { PersonnelSiteEditorComponent } from './components/personnel-site-editor.component';
import { ReplacementStopEditorComponent } from './components/replacement-stop-editor.component';
import { ReplacementRouteEditorComponent } from './components/replacement-route-editor.component';
import { ReplacementEdgeEditorComponent } from './components/replacement-edge-editor.component';
import { OpReplacementStopLinkEditorComponent } from './components/op-replacement-stop-link-editor.component';
import { TransferEdgeEditorComponent } from './components/transfer-edge-editor.component';
import { AssistantUiContextService } from '../core/services/assistant-ui-context.service';

@Component({
    selector: 'app-planning-master',
    imports: [
        CommonModule,
        MatTabsModule,
        OperationalPointEditorComponent,
        SectionOfLineEditorComponent,
        StationAreaEditorComponent,
        TrackEditorComponent,
        PlatformEdgeEditorComponent,
        PlatformEditorComponent,
        SidingEditorComponent,
        PersonnelSiteEditorComponent,
        ReplacementStopEditorComponent,
        ReplacementRouteEditorComponent,
        ReplacementEdgeEditorComponent,
        OpReplacementStopLinkEditorComponent,
        TransferEdgeEditorComponent,
        ...MATERIAL_IMPORTS,
    ],
    templateUrl: './planning-master.component.html',
    styleUrl: './planning-master.component.scss',
})
export class PlanningMasterComponent implements OnInit {
  private readonly store = inject(PlanningStoreService);
  private readonly assistantUiContext = inject(AssistantUiContextService);
  private readonly dialog = inject(MatDialog);

  readonly selectedTabIndex = signal(0);
  private readonly tabLabels = [
    'Operational Points',
    'Sections of Line',
    'Station Areas',
    'Tracks',
    'Platform Edges',
    'Platforms',
    'Sidings',
    'Personnel Sites',
    'Replacement Stops',
    'Replacement Routes',
    'Replacement Edges',
    'OP ↔ Replacement Links',
    'Transfer Edges',
  ];

  private readonly importKinds: { value: TopologyImportKind; label: string }[] = [
    { value: 'operational-points', label: 'Operational Points' },
    { value: 'sections-of-line', label: 'Sections of Line' },
    { value: 'station-areas', label: 'Station Areas' },
    { value: 'tracks', label: 'Tracks' },
    { value: 'platform-edges', label: 'Platform Edges' },
    { value: 'platforms', label: 'Platforms' },
    { value: 'sidings', label: 'Sidings' },
  ];

  private readonly updateAssistantContext = effect(() => {
    const isActive = this.assistantUiContext.docKey() === 'topology';
    if (!isActive) {
      return;
    }

    const label = this.tabLabels[this.selectedTabIndex()] ?? 'Topologie';
    this.assistantUiContext.setDocKey('topology');
    this.assistantUiContext.setDocSubtopic(label);
    this.assistantUiContext.setBreadcrumbs(['Stammdaten', 'Topologie', label]);
    this.assistantUiContext.setDataSummary(this.buildAssistantDataSummary(label));
  });

  ngOnInit(): void {
    this.store.ensureInitialized();
  }

  resetToDefaults(): void {
    if (!this.confirmFactoryReset('Topologie')) {
      return;
    }
    void this.store.resetToDefaults();
  }

  openImportDialog(): void {
    this.dialog.open(TopologyImportDialogComponent, {
      data: { kinds: this.importKinds },
      width: '520px',
    });
  }

  private confirmFactoryReset(scopeLabel: string): boolean {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.confirm(
      `${scopeLabel}: Werkseinstellungen wiederherstellen?\n\nAlle Änderungen in diesem Bereich werden überschrieben.`,
    );
  }

  private buildAssistantDataSummary(label: string): string {
    switch (label) {
      case 'Operational Points':
        return this.formatSummary(
          'Operational Points',
          this.store.operationalPoints(),
          (op) => `${op.uniqueOpId}: ${op.name ?? op.uniqueOpId}`,
        );
      case 'Sections of Line':
        return this.formatSummary(
          'Sections of Line',
          this.store.sectionsOfLine(),
          (sol) => `${sol.solId}: ${sol.startUniqueOpId} → ${sol.endUniqueOpId}`,
        );
      case 'Station Areas':
        return this.formatSummary(
          'Station Areas',
          this.store.stationAreas(),
          (area) => `${area.stationAreaId}: ${area.name ?? area.stationAreaId}`,
        );
      case 'Tracks':
        return this.formatSummary(
          'Tracks',
          this.store.tracks(),
          (track) => `${track.trackKey}: ${track.trackId ?? '—'} (${track.uniqueOpId ?? '—'})`,
        );
      case 'Platform Edges':
        return this.formatSummary(
          'Platform Edges',
          this.store.platformEdges(),
          (edge) => `${edge.platformEdgeId}: ${edge.platformId ?? '—'} (${edge.trackKey ?? '—'})`,
        );
      case 'Platforms':
        return this.formatSummary(
          'Platforms',
          this.store.platforms(),
          (platform) => `${platform.platformKey}: ${platform.platformId ?? platform.name ?? '—'}`,
        );
      case 'Sidings':
        return this.formatSummary(
          'Sidings',
          this.store.sidings(),
          (siding) => `${siding.sidingKey}: ${siding.sidingId ?? '—'} (${siding.uniqueOpId ?? '—'})`,
        );
      case 'Personnel Sites':
        return this.formatSummary(
          'Personnel Sites',
          this.store.personnelSites(),
          (site) => `${site.siteId}: ${site.name ?? site.siteId} (${site.siteType ?? '—'})`,
        );
      case 'Replacement Stops':
        return this.formatSummary(
          'Replacement Stops',
          this.store.replacementStops(),
          (stop) => `${stop.replacementStopId}: ${stop.name ?? stop.replacementStopId}`,
        );
      case 'Replacement Routes':
        return this.formatSummary(
          'Replacement Routes',
          this.store.replacementRoutes(),
          (route) => `${route.replacementRouteId}: ${route.name ?? route.replacementRouteId}`,
        );
      case 'Replacement Edges':
        return this.formatSummary(
          'Replacement Edges',
          this.store.replacementEdges(),
          (edge) =>
            `${edge.replacementEdgeId}: ${edge.fromStopId} → ${edge.toStopId} (seq ${edge.seq})`,
        );
      case 'OP ↔ Replacement Links':
        return this.formatSummary(
          'OP ↔ Replacement Links',
          this.store.opReplacementStopLinks(),
          (link) => `${link.uniqueOpId} ↔ ${link.replacementStopId}`,
        );
      case 'Transfer Edges':
        return this.formatSummary(
          'Transfer Edges',
          this.store.transferEdges(),
          (edge) => {
            const minutes = edge.avgDurationSec
              ? Math.max(1, Math.round(edge.avgDurationSec / 60))
              : null;
            const duration = minutes ? `${minutes} min` : '—';
            return `${edge.transferId}: ${edge.from.kind} → ${edge.to.kind} (${duration}, ${edge.mode})`;
          },
        );
      default:
        return '';
    }
  }

  private formatSummary<T>(
    title: string,
    items: readonly T[],
    formatItem: (item: T) => string,
  ): string {
    const limit = 8;
    const lines = items.slice(0, limit).map((item) => `- ${formatItem(item)}`);
    const remaining = items.length > limit ? `\n- … (+${items.length - limit} weitere)` : '';
    return `Aktuelle Liste: ${title}\nAnzahl: ${items.length}${lines.length ? `\n${lines.join('\n')}${remaining}` : ''}`;
  }
}
