import { Injectable, Signal, WritableSignal, computed, inject, signal } from '@angular/core';
import { firstValueFrom, forkJoin, Observable } from 'rxjs';
import {
  OperationalPoint,
  SectionOfLine,
  StationArea,
  Track,
  PlatformEdge,
  Platform,
  Siding,
  PersonnelSite,
  ReplacementStop,
  ReplacementRoute,
  ReplacementEdge,
  OpReplacementStopLink,
  TransferEdge,
  TransferNode,
  PagedResponse,
  PlanningEntitySignals,
} from './planning-types';
import { TopologyApiService } from '../planning/topology-api.service';

const nowIso = () => new Date().toISOString();

@Injectable({
  providedIn: 'root',
})
export class PlanningStoreService {
  private readonly api = inject(TopologyApiService);
  private readonly entities: PlanningEntitySignals = {
    operationalPoints: signal<OperationalPoint[]>([]),
    sectionsOfLine: signal<SectionOfLine[]>([]),
    stationAreas: signal<StationArea[]>([]),
    tracks: signal<Track[]>([]),
    platformEdges: signal<PlatformEdge[]>([]),
    platforms: signal<Platform[]>([]),
    sidings: signal<Siding[]>([]),
    personnelSites: signal<PersonnelSite[]>([]),
    replacementStops: signal<ReplacementStop[]>([]),
    replacementRoutes: signal<ReplacementRoute[]>([]),
    replacementEdges: signal<ReplacementEdge[]>([]),
    opReplacementStopLinks: signal<OpReplacementStopLink[]>([]),
    transferEdges: signal<TransferEdge[]>([]),
  };
  private readonly topologyPageSize = 500;
  private readonly topologyInitialized = signal(false);
  private readonly operationalPointsTotalSignal = signal(0);
  private readonly sectionsOfLineTotalSignal = signal(0);
  private readonly stationAreasTotalSignal = signal(0);
  private readonly tracksTotalSignal = signal(0);
  private readonly platformEdgesTotalSignal = signal(0);
  private readonly platformsTotalSignal = signal(0);
  private readonly sidingsTotalSignal = signal(0);
  private readonly operationalPointsQuerySignal = signal<string | null>(null);
  private readonly sectionsOfLineQuerySignal = signal<string | null>(null);
  private readonly stationAreasQuerySignal = signal<string | null>(null);
  private readonly tracksQuerySignal = signal<string | null>(null);
  private readonly platformEdgesQuerySignal = signal<string | null>(null);
  private readonly platformsQuerySignal = signal<string | null>(null);
  private readonly sidingsQuerySignal = signal<string | null>(null);
  private readonly initialized = signal(false);
  private readonly loadingSignal = signal(false);
  private readonly syncErrorSignal = signal<string | null>(null);

  readonly operationalPoints = this.entities.operationalPoints.asReadonly();
  readonly sectionsOfLine = this.entities.sectionsOfLine.asReadonly();
  readonly stationAreas = this.entities.stationAreas.asReadonly();
  readonly tracks = this.entities.tracks.asReadonly();
  readonly platformEdges = this.entities.platformEdges.asReadonly();
  readonly platforms = this.entities.platforms.asReadonly();
  readonly sidings = this.entities.sidings.asReadonly();
  readonly personnelSites = this.entities.personnelSites.asReadonly();
  readonly replacementStops = this.entities.replacementStops.asReadonly();
  readonly replacementRoutes = this.entities.replacementRoutes.asReadonly();
  readonly replacementEdges = this.entities.replacementEdges.asReadonly();
  readonly opReplacementStopLinks = this.entities.opReplacementStopLinks.asReadonly();
  readonly transferEdges = this.entities.transferEdges.asReadonly();
  readonly loading = this.loadingSignal.asReadonly();
  readonly syncError = this.syncErrorSignal.asReadonly();
  readonly operationalPointsTotal = this.operationalPointsTotalSignal.asReadonly();
  readonly sectionsOfLineTotal = this.sectionsOfLineTotalSignal.asReadonly();
  readonly stationAreasTotal = this.stationAreasTotalSignal.asReadonly();
  readonly tracksTotal = this.tracksTotalSignal.asReadonly();
  readonly platformEdgesTotal = this.platformEdgesTotalSignal.asReadonly();
  readonly platformsTotal = this.platformsTotalSignal.asReadonly();
  readonly sidingsTotal = this.sidingsTotalSignal.asReadonly();

  readonly operationalPointMap: Signal<Map<string, OperationalPoint>> = computed(() => {
    return new Map(this.operationalPoints().map((op) => [op.uniqueOpId, op]));
  });

  readonly replacementStopMap: Signal<Map<string, ReplacementStop>> = computed(() => {
    return new Map(this.replacementStops().map((stop) => [stop.replacementStopId, stop]));
  });

  ensureInitialized(): void {
    if (!this.initialized()) {
      void this.refreshAllFromApi();
    }
  }

  ensureTopologyInitialized(): void {
    if (!this.topologyInitialized()) {
      void this.refreshTopologyFromApi();
    }
  }

  async refreshAllFromApi(): Promise<void> {
    this.loadingSignal.set(true);
    try {
      const data = await firstValueFrom(
        forkJoin({
          operationalPoints: this.api.listOperationalPoints(),
          sectionsOfLine: this.api.listSectionsOfLine(),
          stationAreas: this.api.listStationAreas(),
          tracks: this.api.listTracks(),
          platformEdges: this.api.listPlatformEdges(),
          platforms: this.api.listPlatforms(),
          sidings: this.api.listSidings(),
          personnelSites: this.api.listPersonnelSites(),
          replacementStops: this.api.listReplacementStops(),
          replacementRoutes: this.api.listReplacementRoutes(),
          replacementEdges: this.api.listReplacementEdges(),
          opReplacementStopLinks: this.api.listOpReplacementStopLinks(),
          transferEdges: this.api.listTransferEdges(),
        }),
      );
      this.setOperationalPoints(data.operationalPoints ?? []);
      this.setSectionsOfLine(data.sectionsOfLine ?? []);
      this.setStationAreas(data.stationAreas ?? []);
      this.setTracks(data.tracks ?? []);
      this.setPlatformEdges(data.platformEdges ?? []);
      this.setPlatforms(data.platforms ?? []);
      this.setSidings(data.sidings ?? []);
      this.setPersonnelSites(data.personnelSites ?? []);
      this.setReplacementStops(data.replacementStops ?? []);
      this.setReplacementRoutes(data.replacementRoutes ?? []);
      this.setReplacementEdges(data.replacementEdges ?? []);
      this.setOpReplacementStopLinks(data.opReplacementStopLinks ?? []);
      this.setTransferEdges(data.transferEdges ?? []);
      this.initialized.set(true);
      this.topologyInitialized.set(true);
      this.syncErrorSignal.set(null);
    } catch (error) {
      console.error('[PlanningStoreService] Failed to load topology data', error);
      this.syncErrorSignal.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.loadingSignal.set(false);
    }
  }

  async refreshTopologyFromApi(): Promise<void> {
    this.loadingSignal.set(true);
    try {
      this.resetTopologyQueries();
      const pageSize = this.topologyPageSize;
      const data = await firstValueFrom(
        forkJoin({
          operationalPoints: this.api.listOperationalPointsPaged(0, pageSize),
          sectionsOfLine: this.api.listSectionsOfLinePaged(0, pageSize),
          stationAreas: this.api.listStationAreasPaged(0, pageSize),
          tracks: this.api.listTracksPaged(0, pageSize),
          platformEdges: this.api.listPlatformEdgesPaged(0, pageSize),
          platforms: this.api.listPlatformsPaged(0, pageSize),
          sidings: this.api.listSidingsPaged(0, pageSize),
          personnelSites: this.api.listPersonnelSites(),
          replacementStops: this.api.listReplacementStops(),
          replacementRoutes: this.api.listReplacementRoutes(),
          replacementEdges: this.api.listReplacementEdges(),
          opReplacementStopLinks: this.api.listOpReplacementStopLinks(),
          transferEdges: this.api.listTransferEdges(),
        }),
      );
      this.applyPagedResponse(data.operationalPoints, (items, total) =>
        this.setOperationalPoints(items, total),
      );
      this.applyPagedResponse(data.sectionsOfLine, (items, total) =>
        this.setSectionsOfLine(items, total),
      );
      this.applyPagedResponse(data.stationAreas, (items, total) =>
        this.setStationAreas(items, total),
      );
      this.applyPagedResponse(data.tracks, (items, total) =>
        this.setTracks(items, total),
      );
      this.applyPagedResponse(data.platformEdges, (items, total) =>
        this.setPlatformEdges(items, total),
      );
      this.applyPagedResponse(data.platforms, (items, total) =>
        this.setPlatforms(items, total),
      );
      this.applyPagedResponse(data.sidings, (items, total) =>
        this.setSidings(items, total),
      );
      this.setPersonnelSites(data.personnelSites ?? []);
      this.setReplacementStops(data.replacementStops ?? []);
      this.setReplacementRoutes(data.replacementRoutes ?? []);
      this.setReplacementEdges(data.replacementEdges ?? []);
      this.setOpReplacementStopLinks(data.opReplacementStopLinks ?? []);
      this.setTransferEdges(data.transferEdges ?? []);
      this.topologyInitialized.set(true);
      this.syncErrorSignal.set(null);
    } catch (error) {
      console.error('[PlanningStoreService] Failed to load paged topology data', error);
      this.syncErrorSignal.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.loadingSignal.set(false);
    }
  }

  async resetToDefaults(): Promise<void> {
    try {
      await firstValueFrom(this.api.resetToDefaults());
      await this.refreshAllFromApi();
    } catch (error) {
      console.error('[PlanningStoreService] Failed to reset topology defaults', error);
      this.syncErrorSignal.set(error instanceof Error ? error.message : String(error));
    }
  }

  async refreshOperationalPointsFromApi(): Promise<void> {
    await this.loadEntity(
      this.api.listOperationalPoints(),
      (items) => this.setOperationalPoints(items ?? []),
      'operational points',
    );
  }

  async refreshSectionsOfLineFromApi(): Promise<void> {
    await this.loadEntity(
      this.api.listSectionsOfLine(),
      (items) => this.setSectionsOfLine(items ?? []),
      'sections of line',
    );
  }

  async refreshStationAreasFromApi(): Promise<void> {
    await this.loadEntity(
      this.api.listStationAreas(),
      (items) => this.setStationAreas(items ?? []),
      'station areas',
    );
  }

  async refreshTracksFromApi(): Promise<void> {
    await this.loadEntity(
      this.api.listTracks(),
      (items) => this.setTracks(items ?? []),
      'tracks',
    );
  }

  async refreshPlatformEdgesFromApi(): Promise<void> {
    await this.loadEntity(
      this.api.listPlatformEdges(),
      (items) => this.setPlatformEdges(items ?? []),
      'platform edges',
    );
  }

  async refreshPlatformsFromApi(): Promise<void> {
    await this.loadEntity(
      this.api.listPlatforms(),
      (items) => this.setPlatforms(items ?? []),
      'platforms',
    );
  }

  async refreshSidingsFromApi(): Promise<void> {
    await this.loadEntity(
      this.api.listSidings(),
      (items) => this.setSidings(items ?? []),
      'sidings',
    );
  }

  async loadMoreOperationalPoints(): Promise<void> {
    await this.loadMorePagedEntity(
      () => this.entities.operationalPoints(),
      this.operationalPointsTotalSignal,
      this.operationalPointsQuerySignal,
      (offset, limit, query) => this.api.listOperationalPointsPaged(offset, limit, query),
      (items, total) => this.setOperationalPoints(items, total),
      'operational points',
    );
  }

  async loadMoreSectionsOfLine(): Promise<void> {
    await this.loadMorePagedEntity(
      () => this.entities.sectionsOfLine(),
      this.sectionsOfLineTotalSignal,
      this.sectionsOfLineQuerySignal,
      (offset, limit, query) => this.api.listSectionsOfLinePaged(offset, limit, query),
      (items, total) => this.setSectionsOfLine(items, total),
      'sections of line',
    );
  }

  async loadMoreStationAreas(): Promise<void> {
    await this.loadMorePagedEntity(
      () => this.entities.stationAreas(),
      this.stationAreasTotalSignal,
      this.stationAreasQuerySignal,
      (offset, limit, query) => this.api.listStationAreasPaged(offset, limit, query),
      (items, total) => this.setStationAreas(items, total),
      'station areas',
    );
  }

  async loadMoreTracks(): Promise<void> {
    await this.loadMorePagedEntity(
      () => this.entities.tracks(),
      this.tracksTotalSignal,
      this.tracksQuerySignal,
      (offset, limit, query) => this.api.listTracksPaged(offset, limit, query),
      (items, total) => this.setTracks(items, total),
      'tracks',
    );
  }

  async loadMorePlatformEdges(): Promise<void> {
    await this.loadMorePagedEntity(
      () => this.entities.platformEdges(),
      this.platformEdgesTotalSignal,
      this.platformEdgesQuerySignal,
      (offset, limit, query) => this.api.listPlatformEdgesPaged(offset, limit, query),
      (items, total) => this.setPlatformEdges(items, total),
      'platform edges',
    );
  }

  async loadMorePlatforms(): Promise<void> {
    await this.loadMorePagedEntity(
      () => this.entities.platforms(),
      this.platformsTotalSignal,
      this.platformsQuerySignal,
      (offset, limit, query) => this.api.listPlatformsPaged(offset, limit, query),
      (items, total) => this.setPlatforms(items, total),
      'platforms',
    );
  }

  async loadMoreSidings(): Promise<void> {
    await this.loadMorePagedEntity(
      () => this.entities.sidings(),
      this.sidingsTotalSignal,
      this.sidingsQuerySignal,
      (offset, limit, query) => this.api.listSidingsPaged(offset, limit, query),
      (items, total) => this.setSidings(items, total),
      'sidings',
    );
  }

  async searchOperationalPoints(query: string): Promise<void> {
    await this.searchPagedEntity(
      this.operationalPointsQuerySignal,
      (offset, limit, term) => this.api.listOperationalPointsPaged(offset, limit, term),
      (items, total) => this.setOperationalPoints(items, total),
      query,
      'operational points',
    );
  }

  async searchSectionsOfLine(query: string): Promise<void> {
    await this.searchPagedEntity(
      this.sectionsOfLineQuerySignal,
      (offset, limit, term) => this.api.listSectionsOfLinePaged(offset, limit, term),
      (items, total) => this.setSectionsOfLine(items, total),
      query,
      'sections of line',
    );
  }

  async searchStationAreas(query: string): Promise<void> {
    await this.searchPagedEntity(
      this.stationAreasQuerySignal,
      (offset, limit, term) => this.api.listStationAreasPaged(offset, limit, term),
      (items, total) => this.setStationAreas(items, total),
      query,
      'station areas',
    );
  }

  async searchTracks(query: string): Promise<void> {
    await this.searchPagedEntity(
      this.tracksQuerySignal,
      (offset, limit, term) => this.api.listTracksPaged(offset, limit, term),
      (items, total) => this.setTracks(items, total),
      query,
      'tracks',
    );
  }

  async searchPlatformEdges(query: string): Promise<void> {
    await this.searchPagedEntity(
      this.platformEdgesQuerySignal,
      (offset, limit, term) => this.api.listPlatformEdgesPaged(offset, limit, term),
      (items, total) => this.setPlatformEdges(items, total),
      query,
      'platform edges',
    );
  }

  async searchPlatforms(query: string): Promise<void> {
    await this.searchPagedEntity(
      this.platformsQuerySignal,
      (offset, limit, term) => this.api.listPlatformsPaged(offset, limit, term),
      (items, total) => this.setPlatforms(items, total),
      query,
      'platforms',
    );
  }

  async searchSidings(query: string): Promise<void> {
    await this.searchPagedEntity(
      this.sidingsQuerySignal,
      (offset, limit, term) => this.api.listSidingsPaged(offset, limit, term),
      (items, total) => this.setSidings(items, total),
      query,
      'sidings',
    );
  }

  addOperationalPoint(op: OperationalPoint): void {
    this.assertUniqueOpId(op.uniqueOpId, op.opId);
    this.entities.operationalPoints.update((list) => [
      ...list,
      this.withAudit(op, true),
    ]);
    this.operationalPointsTotalSignal.set(this.entities.operationalPoints().length);
    this.persistOperationalPoints();
  }

  updateOperationalPoint(opId: string, patch: Partial<OperationalPoint>): void {
    let relinked = false;
    this.entities.operationalPoints.update((list) =>
      list.map((item) => {
        if (item.opId !== opId) {
          return item;
        }
        if (patch.uniqueOpId && patch.uniqueOpId !== item.uniqueOpId) {
          this.assertUniqueOpId(patch.uniqueOpId, opId);
          this.relinkUniqueOpId(item.uniqueOpId, patch.uniqueOpId);
          relinked = true;
        }
        return this.withAudit({ ...item, ...patch, opId }, false);
      }),
    );
    this.persistOperationalPoints();
    if (relinked) {
      this.persistSectionsOfLine();
      this.persistStationAreas();
      this.persistTracks();
      this.persistPlatforms();
      this.persistSidings();
      this.persistPersonnelSites();
      this.persistReplacementStops();
      this.persistOpReplacementStopLinks();
      this.persistTransferEdges();
    }
  }

  removeOperationalPoint(opId: string): void {
    const op = this.entities.operationalPoints().find((item) => item.opId === opId);
    if (!op) {
      return;
    }
    const uniqueId = op.uniqueOpId;
    this.entities.operationalPoints.update((list) => list.filter((item) => item.opId !== opId));
    this.entities.sectionsOfLine.update((list) =>
      list.filter(
        (sol) => sol.startUniqueOpId !== uniqueId && sol.endUniqueOpId !== uniqueId,
      ),
    );
    this.entities.stationAreas.update((list) =>
      list.filter((area) => area.uniqueOpId !== uniqueId),
    );
    const removedTracks = new Set(
      this.entities.tracks().filter((track) => track.uniqueOpId === uniqueId).map((t) => t.trackKey),
    );
    this.entities.tracks.update((list) =>
      list.filter((track) => track.uniqueOpId !== uniqueId),
    );
    this.entities.platformEdges.update((list) =>
      list.filter((edge) => !removedTracks.has(edge.trackKey ?? '')),
    );
    this.entities.platforms.update((list) =>
      list.filter((platform) => platform.uniqueOpId !== uniqueId),
    );
    this.entities.sidings.update((list) =>
      list.filter((siding) => siding.uniqueOpId !== uniqueId),
    );
    this.entities.personnelSites.update((list) =>
      list.map((site) =>
        site.uniqueOpId === uniqueId ? { ...site, uniqueOpId: undefined } : site,
      ),
    );
    this.entities.replacementStops.update((list) =>
      list.map((stop) =>
        stop.nearestUniqueOpId === uniqueId ? { ...stop, nearestUniqueOpId: undefined } : stop,
      ),
    );
    this.entities.opReplacementStopLinks.update((list) =>
      list.filter((link) => link.uniqueOpId !== uniqueId),
    );
    this.entities.transferEdges.update((list) =>
      list.filter((edge) => !this.transferNodeMatches(edge.from, { kind: 'OP', uniqueOpId: uniqueId })
        && !this.transferNodeMatches(edge.to, { kind: 'OP', uniqueOpId: uniqueId })),
    );
    this.operationalPointsTotalSignal.set(this.entities.operationalPoints().length);
    this.sectionsOfLineTotalSignal.set(this.entities.sectionsOfLine().length);
    this.stationAreasTotalSignal.set(this.entities.stationAreas().length);
    this.tracksTotalSignal.set(this.entities.tracks().length);
    this.platformEdgesTotalSignal.set(this.entities.platformEdges().length);
    this.platformsTotalSignal.set(this.entities.platforms().length);
    this.sidingsTotalSignal.set(this.entities.sidings().length);
    this.persistOperationalPoints();
    this.persistSectionsOfLine();
    this.persistStationAreas();
    this.persistTracks();
    this.persistPlatformEdges();
    this.persistPlatforms();
    this.persistSidings();
    this.persistPersonnelSites();
    this.persistReplacementStops();
    this.persistOpReplacementStopLinks();
    this.persistTransferEdges();
  }

  addSectionOfLine(sol: SectionOfLine): void {
    this.ensureOperationalPointExists(sol.startUniqueOpId);
    this.ensureOperationalPointExists(sol.endUniqueOpId);
    if (sol.startUniqueOpId === sol.endUniqueOpId) {
      throw new Error('Section of line cannot start and end at the same operational point.');
    }
    this.entities.sectionsOfLine.update((list) => [...list, this.withAudit(sol, true)]);
    this.sectionsOfLineTotalSignal.set(this.entities.sectionsOfLine().length);
    this.persistSectionsOfLine();
  }

  updateSectionOfLine(solId: string, patch: Partial<SectionOfLine>): void {
    this.entities.sectionsOfLine.update((list) =>
      list.map((item) => {
        if (item.solId !== solId) {
          return item;
        }
        const merged = { ...item, ...patch, solId };
        if (merged.startUniqueOpId === merged.endUniqueOpId) {
          throw new Error('Section of line cannot form a loop.');
        }
        this.ensureOperationalPointExists(merged.startUniqueOpId);
        this.ensureOperationalPointExists(merged.endUniqueOpId);
        return this.withAudit(merged, false);
      }),
    );
    this.persistSectionsOfLine();
  }

  removeSectionOfLine(solId: string): void {
    this.entities.sectionsOfLine.update((list) => list.filter((item) => item.solId !== solId));
    this.sectionsOfLineTotalSignal.set(this.entities.sectionsOfLine().length);
    this.persistSectionsOfLine();
  }

  addStationArea(area: StationArea): void {
    if (area.uniqueOpId) {
      this.ensureOperationalPointExists(area.uniqueOpId);
    }
    this.entities.stationAreas.update((list) => [...list, this.withAudit(area, true)]);
    this.stationAreasTotalSignal.set(this.entities.stationAreas().length);
    this.persistStationAreas();
  }

  updateStationArea(stationAreaId: string, patch: Partial<StationArea>): void {
    this.entities.stationAreas.update((list) =>
      list.map((item) => {
        if (item.stationAreaId !== stationAreaId) {
          return item;
        }
        const merged = { ...item, ...patch, stationAreaId };
        if (merged.uniqueOpId) {
          this.ensureOperationalPointExists(merged.uniqueOpId);
        }
        return this.withAudit(merged, false);
      }),
    );
    this.persistStationAreas();
  }

  removeStationArea(stationAreaId: string): void {
    this.entities.stationAreas.update((list) =>
      list.filter((item) => item.stationAreaId !== stationAreaId),
    );
    this.stationAreasTotalSignal.set(this.entities.stationAreas().length);
    this.persistStationAreas();
  }

  addTrack(track: Track): void {
    if (track.uniqueOpId) {
      this.ensureOperationalPointExists(track.uniqueOpId);
    }
    this.entities.tracks.update((list) => [...list, this.withAudit(track, true)]);
    this.tracksTotalSignal.set(this.entities.tracks().length);
    this.persistTracks();
  }

  updateTrack(trackKey: string, patch: Partial<Track>): void {
    this.entities.tracks.update((list) =>
      list.map((item) => {
        if (item.trackKey !== trackKey) {
          return item;
        }
        const merged = { ...item, ...patch, trackKey };
        if (merged.uniqueOpId) {
          this.ensureOperationalPointExists(merged.uniqueOpId);
        }
        return this.withAudit(merged, false);
      }),
    );
    this.persistTracks();
  }

  removeTrack(trackKey: string): void {
    this.entities.tracks.update((list) => list.filter((item) => item.trackKey !== trackKey));
    this.entities.platformEdges.update((list) =>
      list.filter((edge) => edge.trackKey !== trackKey),
    );
    this.tracksTotalSignal.set(this.entities.tracks().length);
    this.platformEdgesTotalSignal.set(this.entities.platformEdges().length);
    this.persistTracks();
    this.persistPlatformEdges();
  }

  addPlatformEdge(edge: PlatformEdge): void {
    if (edge.trackKey) {
      this.ensureTrackExists(edge.trackKey);
    }
    this.entities.platformEdges.update((list) => [...list, this.withAudit(edge, true)]);
    this.platformEdgesTotalSignal.set(this.entities.platformEdges().length);
    this.persistPlatformEdges();
  }

  updatePlatformEdge(platformEdgeId: string, patch: Partial<PlatformEdge>): void {
    this.entities.platformEdges.update((list) =>
      list.map((item) => {
        if (item.platformEdgeId !== platformEdgeId) {
          return item;
        }
        const merged = { ...item, ...patch, platformEdgeId };
        if (merged.trackKey) {
          this.ensureTrackExists(merged.trackKey);
        }
        return this.withAudit(merged, false);
      }),
    );
    this.persistPlatformEdges();
  }

  removePlatformEdge(platformEdgeId: string): void {
    this.entities.platformEdges.update((list) =>
      list.filter((item) => item.platformEdgeId !== platformEdgeId),
    );
    this.entities.platforms.update((list) =>
      list.map((platform) => ({
        ...platform,
        platformEdgeIds: (platform.platformEdgeIds ?? []).filter((id) => id !== platformEdgeId),
      })),
    );
    this.entities.tracks.update((list) =>
      list.map((track) => ({
        ...track,
        platformEdgeIds: (track.platformEdgeIds ?? []).filter((id) => id !== platformEdgeId),
      })),
    );
    this.platformEdgesTotalSignal.set(this.entities.platformEdges().length);
    this.persistPlatformEdges();
    this.persistPlatforms();
    this.persistTracks();
  }

  addPlatform(platform: Platform): void {
    if (platform.uniqueOpId) {
      this.ensureOperationalPointExists(platform.uniqueOpId);
    }
    this.entities.platforms.update((list) => [...list, this.withAudit(platform, true)]);
    this.platformsTotalSignal.set(this.entities.platforms().length);
    this.persistPlatforms();
  }

  updatePlatform(platformKey: string, patch: Partial<Platform>): void {
    this.entities.platforms.update((list) =>
      list.map((item) => {
        if (item.platformKey !== platformKey) {
          return item;
        }
        const merged = { ...item, ...patch, platformKey };
        if (merged.uniqueOpId) {
          this.ensureOperationalPointExists(merged.uniqueOpId);
        }
        return this.withAudit(merged, false);
      }),
    );
    this.persistPlatforms();
  }

  removePlatform(platformKey: string): void {
    this.entities.platforms.update((list) =>
      list.filter((item) => item.platformKey !== platformKey),
    );
    this.platformsTotalSignal.set(this.entities.platforms().length);
    this.persistPlatforms();
  }

  addSiding(siding: Siding): void {
    if (siding.uniqueOpId) {
      this.ensureOperationalPointExists(siding.uniqueOpId);
    }
    this.entities.sidings.update((list) => [...list, this.withAudit(siding, true)]);
    this.sidingsTotalSignal.set(this.entities.sidings().length);
    this.persistSidings();
  }

  updateSiding(sidingKey: string, patch: Partial<Siding>): void {
    this.entities.sidings.update((list) =>
      list.map((item) => {
        if (item.sidingKey !== sidingKey) {
          return item;
        }
        const merged = { ...item, ...patch, sidingKey };
        if (merged.uniqueOpId) {
          this.ensureOperationalPointExists(merged.uniqueOpId);
        }
        return this.withAudit(merged, false);
      }),
    );
    this.persistSidings();
  }

  removeSiding(sidingKey: string): void {
    this.entities.sidings.update((list) => list.filter((item) => item.sidingKey !== sidingKey));
    this.sidingsTotalSignal.set(this.entities.sidings().length);
    this.persistSidings();
  }

  addPersonnelSite(site: PersonnelSite): void {
    if (site.uniqueOpId) {
      this.ensureOperationalPointExists(site.uniqueOpId);
    }
    this.entities.personnelSites.update((list) => [...list, this.withAudit(site, true)]);
    this.persistPersonnelSites();
  }

  updatePersonnelSite(siteId: string, patch: Partial<PersonnelSite>): void {
    this.entities.personnelSites.update((list) =>
      list.map((item) => {
        if (item.siteId !== siteId) {
          return item;
        }
        const merged = { ...item, ...patch, siteId };
        if (merged.uniqueOpId) {
          this.ensureOperationalPointExists(merged.uniqueOpId);
        }
        return this.withAudit(merged, false);
      }),
    );
    this.persistPersonnelSites();
  }

  removePersonnelSite(siteId: string): void {
    this.entities.personnelSites.update((list) => list.filter((item) => item.siteId !== siteId));
    this.entities.transferEdges.update((list) =>
      list.filter(
        (edge) =>
          !this.transferNodeMatches(edge.from, { kind: 'PERSONNEL_SITE', siteId }) &&
          !this.transferNodeMatches(edge.to, { kind: 'PERSONNEL_SITE', siteId }),
      ),
    );
    this.persistPersonnelSites();
    this.persistTransferEdges();
  }

  addReplacementStop(stop: ReplacementStop): void {
    if (stop.nearestUniqueOpId) {
      this.ensureOperationalPointExists(stop.nearestUniqueOpId);
    }
    this.entities.replacementStops.update((list) => [...list, this.withAudit(stop, true)]);
    this.persistReplacementStops();
  }

  updateReplacementStop(stopId: string, patch: Partial<ReplacementStop>): void {
    this.entities.replacementStops.update((list) =>
      list.map((item) => {
        if (item.replacementStopId !== stopId) {
          return item;
        }
        const merged = { ...item, ...patch, replacementStopId: stopId };
        if (merged.nearestUniqueOpId) {
          this.ensureOperationalPointExists(merged.nearestUniqueOpId);
        }
        return this.withAudit(merged, false);
      }),
    );
    this.persistReplacementStops();
  }

  removeReplacementStop(stopId: string): void {
    this.entities.replacementStops.update((list) =>
      list.filter((item) => item.replacementStopId !== stopId),
    );
    this.entities.replacementEdges.update((list) =>
      list.filter((edge) => edge.fromStopId !== stopId && edge.toStopId !== stopId),
    );
    this.entities.opReplacementStopLinks.update((list) =>
      list.filter((link) => link.replacementStopId !== stopId),
    );
    this.entities.transferEdges.update((list) =>
      list.filter(
        (edge) =>
          !this.transferNodeMatches(edge.from, { kind: 'REPLACEMENT_STOP', replacementStopId: stopId }) &&
          !this.transferNodeMatches(edge.to, { kind: 'REPLACEMENT_STOP', replacementStopId: stopId }),
      ),
    );
    this.persistReplacementStops();
    this.persistReplacementEdges();
    this.persistOpReplacementStopLinks();
    this.persistTransferEdges();
  }

  addReplacementRoute(route: ReplacementRoute): void {
    this.entities.replacementRoutes.update((list) => [...list, this.withAudit(route, true)]);
    this.persistReplacementRoutes();
  }

  updateReplacementRoute(routeId: string, patch: Partial<ReplacementRoute>): void {
    this.entities.replacementRoutes.update((list) =>
      list.map((item) =>
        item.replacementRouteId === routeId
          ? this.withAudit({ ...item, ...patch, replacementRouteId: routeId }, false)
          : item,
      ),
    );
    this.persistReplacementRoutes();
  }

  removeReplacementRoute(routeId: string): void {
    this.entities.replacementRoutes.update((list) =>
      list.filter((item) => item.replacementRouteId !== routeId),
    );
    this.entities.replacementEdges.update((list) =>
      list.filter((edge) => edge.replacementRouteId !== routeId),
    );
    this.persistReplacementRoutes();
    this.persistReplacementEdges();
  }

  addReplacementEdge(edge: ReplacementEdge): void {
    if (edge.fromStopId === edge.toStopId) {
      throw new Error('Replacement edge cannot connect the same stop.');
    }
    this.ensureReplacementRouteExists(edge.replacementRouteId);
    this.ensureReplacementStopExists(edge.fromStopId);
    this.ensureReplacementStopExists(edge.toStopId);
    this.assertUniqueReplacementEdgeSeq(edge.replacementRouteId, edge.seq, edge.replacementEdgeId);
    this.entities.replacementEdges.update((list) => [...list, this.withAudit(edge, true)]);
    this.persistReplacementEdges();
  }

  updateReplacementEdge(edgeId: string, patch: Partial<ReplacementEdge>): void {
    this.entities.replacementEdges.update((list) =>
      list.map((item) => {
        if (item.replacementEdgeId !== edgeId) {
          return item;
        }
        const merged = { ...item, ...patch, replacementEdgeId: edgeId };
        if (merged.fromStopId === merged.toStopId) {
          throw new Error('Replacement edge cannot connect the same stop.');
        }
        this.ensureReplacementRouteExists(merged.replacementRouteId);
        this.ensureReplacementStopExists(merged.fromStopId);
        this.ensureReplacementStopExists(merged.toStopId);
        this.assertUniqueReplacementEdgeSeq(
          merged.replacementRouteId,
          merged.seq,
          merged.replacementEdgeId,
        );
        return this.withAudit(merged, false);
      }),
    );
    this.persistReplacementEdges();
  }

  removeReplacementEdge(edgeId: string): void {
    this.entities.replacementEdges.update((list) =>
      list.filter((item) => item.replacementEdgeId !== edgeId),
    );
    this.persistReplacementEdges();
  }

  addOpReplacementStopLink(link: OpReplacementStopLink): void {
    this.ensureOperationalPointExists(link.uniqueOpId);
    this.ensureReplacementStopExists(link.replacementStopId);
    this.assertUniqueOpReplacementLink(link.uniqueOpId, link.replacementStopId, link.linkId);
    this.entities.opReplacementStopLinks.update((list) => [...list, this.withAudit(link, true)]);
    this.persistOpReplacementStopLinks();
  }

  updateOpReplacementStopLink(linkId: string, patch: Partial<OpReplacementStopLink>): void {
    this.entities.opReplacementStopLinks.update((list) =>
      list.map((item) => {
        if (item.linkId !== linkId) {
          return item;
        }
        const merged = { ...item, ...patch, linkId };
        this.ensureOperationalPointExists(merged.uniqueOpId);
        this.ensureReplacementStopExists(merged.replacementStopId);
        this.assertUniqueOpReplacementLink(
          merged.uniqueOpId,
          merged.replacementStopId,
          merged.linkId,
        );
        return this.withAudit(merged, false);
      }),
    );
    this.persistOpReplacementStopLinks();
  }

  removeOpReplacementStopLink(linkId: string): void {
    this.entities.opReplacementStopLinks.update((list) =>
      list.filter((item) => item.linkId !== linkId),
    );
    this.persistOpReplacementStopLinks();
  }

  addTransferEdge(edge: TransferEdge): void {
    if (this.transferNodesEqual(edge.from, edge.to)) {
      throw new Error('Transfer edge must connect two different nodes.');
    }
    this.validateTransferNode(edge.from);
    this.validateTransferNode(edge.to);
    this.entities.transferEdges.update((list) => [...list, this.withAudit(edge, true)]);
    this.persistTransferEdges();
  }

  updateTransferEdge(transferId: string, patch: Partial<TransferEdge>): void {
    this.entities.transferEdges.update((list) =>
      list.map((item) => {
        if (item.transferId !== transferId) {
          return item;
        }
        const merged = { ...item, ...patch, transferId };
        if (this.transferNodesEqual(merged.from, merged.to)) {
          throw new Error('Transfer edge must connect two different nodes.');
        }
        this.validateTransferNode(merged.from);
        this.validateTransferNode(merged.to);
        return this.withAudit(merged, false);
      }),
    );
    this.persistTransferEdges();
  }

  removeTransferEdge(transferId: string): void {
    this.entities.transferEdges.update((list) =>
      list.filter((item) => item.transferId !== transferId),
    );
    this.persistTransferEdges();
  }

  clear(): void {
    Object.values(this.entities).forEach((sig) => {
      sig.set([]);
    });
    this.initialized.set(false);
    this.topologyInitialized.set(false);
    this.operationalPointsTotalSignal.set(0);
    this.sectionsOfLineTotalSignal.set(0);
    this.stationAreasTotalSignal.set(0);
    this.tracksTotalSignal.set(0);
    this.platformEdgesTotalSignal.set(0);
    this.platformsTotalSignal.set(0);
    this.sidingsTotalSignal.set(0);
    this.resetTopologyQueries();
  }

  private setOperationalPoints(items: OperationalPoint[], total?: number): void {
    this.entities.operationalPoints.set(this.cloneList(items));
    this.operationalPointsTotalSignal.set(
      typeof total === 'number' ? total : items.length,
    );
  }

  private setSectionsOfLine(items: SectionOfLine[], total?: number): void {
    this.entities.sectionsOfLine.set(this.cloneList(items));
    this.sectionsOfLineTotalSignal.set(typeof total === 'number' ? total : items.length);
  }

  private setStationAreas(items: StationArea[], total?: number): void {
    this.entities.stationAreas.set(this.cloneList(items));
    this.stationAreasTotalSignal.set(typeof total === 'number' ? total : items.length);
  }

  private setTracks(items: Track[], total?: number): void {
    this.entities.tracks.set(this.cloneList(items));
    this.tracksTotalSignal.set(typeof total === 'number' ? total : items.length);
  }

  private setPlatformEdges(items: PlatformEdge[], total?: number): void {
    this.entities.platformEdges.set(this.cloneList(items));
    this.platformEdgesTotalSignal.set(
      typeof total === 'number' ? total : items.length,
    );
  }

  private setPlatforms(items: Platform[], total?: number): void {
    this.entities.platforms.set(this.cloneList(items));
    this.platformsTotalSignal.set(typeof total === 'number' ? total : items.length);
  }

  private setSidings(items: Siding[], total?: number): void {
    this.entities.sidings.set(this.cloneList(items));
    this.sidingsTotalSignal.set(typeof total === 'number' ? total : items.length);
  }

  private setPersonnelSites(items: PersonnelSite[]): void {
    this.entities.personnelSites.set(this.cloneList(items));
  }

  private setReplacementStops(items: ReplacementStop[]): void {
    this.entities.replacementStops.set(this.cloneList(items));
  }

  private setReplacementRoutes(items: ReplacementRoute[]): void {
    this.entities.replacementRoutes.set(this.cloneList(items));
  }

  private setReplacementEdges(items: ReplacementEdge[]): void {
    this.entities.replacementEdges.set(this.cloneList(items));
  }

  private setOpReplacementStopLinks(items: OpReplacementStopLink[]): void {
    this.entities.opReplacementStopLinks.set(this.cloneList(items));
  }

  private setTransferEdges(items: TransferEdge[]): void {
    this.entities.transferEdges.set(this.cloneList(items));
  }

  private cloneList<T>(items: T[]): T[] {
    return items.map((item) => ({ ...(item as Record<string, unknown>) }) as T);
  }

  private resetTopologyQueries(): void {
    this.operationalPointsQuerySignal.set(null);
    this.sectionsOfLineQuerySignal.set(null);
    this.stationAreasQuerySignal.set(null);
    this.tracksQuerySignal.set(null);
    this.platformEdgesQuerySignal.set(null);
    this.platformsQuerySignal.set(null);
    this.sidingsQuerySignal.set(null);
  }

  private normalizeQuery(query: string): string | null {
    const trimmed = query.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private async searchPagedEntity<T>(
    querySignal: WritableSignal<string | null>,
    request: (offset: number, limit: number, query?: string | null) => Observable<PagedResponse<T>>,
    setter: (items: T[], total?: number) => void,
    query: string,
    label: string,
  ): Promise<void> {
    const normalized = this.normalizeQuery(query);
    querySignal.set(normalized);
    try {
      const response = await firstValueFrom(
        request(0, this.topologyPageSize, normalized),
      );
      this.applyPagedResponse(response, setter);
      this.syncErrorSignal.set(null);
    } catch (error) {
      console.error(`[PlanningStoreService] Failed to search ${label}`, error);
      this.syncErrorSignal.set(error instanceof Error ? error.message : String(error));
    }
  }

  private applyPagedResponse<T>(
    response: PagedResponse<T> | null | undefined,
    setter: (items: T[], total?: number) => void,
  ): void {
    const items = response?.items ?? [];
    const total = typeof response?.total === 'number' ? response.total : items.length;
    setter(items, total);
  }

  private async loadMorePagedEntity<T>(
    getCurrent: () => T[],
    totalSignal: WritableSignal<number>,
    querySignal: WritableSignal<string | null>,
    request: (offset: number, limit: number, query?: string | null) => Observable<PagedResponse<T>>,
    setter: (items: T[], total?: number) => void,
    label: string,
  ): Promise<void> {
    const current = getCurrent();
    const total = totalSignal();
    if (total > 0 && current.length >= total) {
      return;
    }
    try {
      const query = querySignal();
      const response = await firstValueFrom(
        request(current.length, this.topologyPageSize, query),
      );
      const items = response?.items ?? [];
      const merged = [...current, ...items];
      const nextTotal =
        typeof response?.total === 'number'
          ? response.total
          : Math.max(total, merged.length);
      setter(merged, nextTotal);
      this.syncErrorSignal.set(null);
    } catch (error) {
      console.error(`[PlanningStoreService] Failed to load more ${label}`, error);
      this.syncErrorSignal.set(error instanceof Error ? error.message : String(error));
    }
  }

  private async loadEntity<T>(
    request$: Observable<T[]>,
    setter: (items: T[]) => void,
    label: string,
  ): Promise<void> {
    try {
      const items = await firstValueFrom(request$);
      setter(items ?? []);
      this.syncErrorSignal.set(null);
    } catch (error) {
      console.error(`[PlanningStoreService] Failed to load ${label}`, error);
      this.syncErrorSignal.set(error instanceof Error ? error.message : String(error));
    }
  }

  private async persistEntity<T>(
    request$: Observable<T[]>,
    setter: (items: T[]) => void,
    label: string,
  ): Promise<void> {
    try {
      const items = await firstValueFrom(request$);
      setter(items ?? []);
      this.syncErrorSignal.set(null);
    } catch (error) {
      console.error(`[PlanningStoreService] Failed to save ${label}`, error);
      this.syncErrorSignal.set(error instanceof Error ? error.message : String(error));
    }
  }

  private persistOperationalPoints(): void {
    void this.persistEntity(
      this.api.saveOperationalPoints(this.entities.operationalPoints()),
      (items) => this.setOperationalPoints(items),
      'operational points',
    );
  }

  private persistSectionsOfLine(): void {
    void this.persistEntity(
      this.api.saveSectionsOfLine(this.entities.sectionsOfLine()),
      (items) => this.setSectionsOfLine(items),
      'sections of line',
    );
  }

  private persistStationAreas(): void {
    void this.persistEntity(
      this.api.saveStationAreas(this.entities.stationAreas()),
      (items) => this.setStationAreas(items),
      'station areas',
    );
  }

  private persistTracks(): void {
    void this.persistEntity(
      this.api.saveTracks(this.entities.tracks()),
      (items) => this.setTracks(items),
      'tracks',
    );
  }

  private persistPlatformEdges(): void {
    void this.persistEntity(
      this.api.savePlatformEdges(this.entities.platformEdges()),
      (items) => this.setPlatformEdges(items),
      'platform edges',
    );
  }

  private persistPlatforms(): void {
    void this.persistEntity(
      this.api.savePlatforms(this.entities.platforms()),
      (items) => this.setPlatforms(items),
      'platforms',
    );
  }

  private persistSidings(): void {
    void this.persistEntity(
      this.api.saveSidings(this.entities.sidings()),
      (items) => this.setSidings(items),
      'sidings',
    );
  }

  private persistPersonnelSites(): void {
    void this.persistEntity(
      this.api.savePersonnelSites(this.entities.personnelSites()),
      (items) => this.setPersonnelSites(items),
      'personnel sites',
    );
  }

  private persistReplacementStops(): void {
    void this.persistEntity(
      this.api.saveReplacementStops(this.entities.replacementStops()),
      (items) => this.setReplacementStops(items),
      'replacement stops',
    );
  }

  private persistReplacementRoutes(): void {
    void this.persistEntity(
      this.api.saveReplacementRoutes(this.entities.replacementRoutes()),
      (items) => this.setReplacementRoutes(items),
      'replacement routes',
    );
  }

  private persistReplacementEdges(): void {
    void this.persistEntity(
      this.api.saveReplacementEdges(this.entities.replacementEdges()),
      (items) => this.setReplacementEdges(items),
      'replacement edges',
    );
  }

  private persistOpReplacementStopLinks(): void {
    void this.persistEntity(
      this.api.saveOpReplacementStopLinks(this.entities.opReplacementStopLinks()),
      (items) => this.setOpReplacementStopLinks(items),
      'OP ↔ Replacement stop links',
    );
  }

  private persistTransferEdges(): void {
    void this.persistEntity(
      this.api.saveTransferEdges(this.entities.transferEdges()),
      (items) => this.setTransferEdges(items),
      'transfer edges',
    );
  }

  private ensureOperationalPointExists(uniqueOpId: string): void {
    if (!this.operationalPointMap().has(uniqueOpId)) {
      throw new Error(`Operational point "${uniqueOpId}" not found.`);
    }
  }

  private ensureReplacementStopExists(stopId: string): void {
    if (!this.replacementStopMap().has(stopId)) {
      throw new Error(`Replacement stop "${stopId}" not found.`);
    }
  }

  private ensureTrackExists(trackKey: string): void {
    if (!this.tracks().some((track) => track.trackKey === trackKey)) {
      throw new Error(`Track "${trackKey}" not found.`);
    }
  }

  private ensureReplacementRouteExists(routeId: string): void {
    if (!this.replacementRoutes().some((route) => route.replacementRouteId === routeId)) {
      throw new Error(`Replacement route "${routeId}" not found.`);
    }
  }

  private assertUniqueOpId(uniqueOpId: string, ignoreOpId?: string): void {
    const conflict = this.operationalPoints().find(
      (op) => op.uniqueOpId === uniqueOpId && op.opId !== ignoreOpId,
    );
    if (conflict) {
      throw new Error(`Operational point with uniqueOpId "${uniqueOpId}" already exists.`);
    }
  }

  private assertUniqueReplacementEdgeSeq(
    routeId: string,
    seq: number,
    ignoreEdgeId?: string,
  ): void {
    const conflict = this.replacementEdges().find(
      (edge) =>
        edge.replacementRouteId === routeId &&
        edge.seq === seq &&
        edge.replacementEdgeId !== ignoreEdgeId,
    );
    if (conflict) {
      throw new Error(
        `Sequence ${seq} is already used for replacement route "${routeId}".`,
      );
    }
  }

  private assertUniqueOpReplacementLink(
    uniqueOpId: string,
    replacementStopId: string,
    ignoreLinkId?: string,
  ): void {
    const conflict = this.opReplacementStopLinks().find(
      (link) =>
        link.uniqueOpId === uniqueOpId &&
        link.replacementStopId === replacementStopId &&
        link.linkId !== ignoreLinkId,
    );
    if (conflict) {
      throw new Error(
        `Link between OP "${uniqueOpId}" and replacement stop "${replacementStopId}" already exists.`,
      );
    }
  }

  private transferNodeMatches(node: TransferNode, target: TransferNode): boolean {
    if (node.kind !== target.kind) {
      return false;
    }
    switch (node.kind) {
      case 'OP':
        return node.uniqueOpId === (target as { uniqueOpId: string }).uniqueOpId;
      case 'PERSONNEL_SITE':
        return node.siteId === (target as { siteId: string }).siteId;
      case 'REPLACEMENT_STOP':
        return (
          node.replacementStopId === (target as { replacementStopId: string }).replacementStopId
        );
    }
  }

  private transferNodesEqual(a: TransferNode, b: TransferNode): boolean {
    return this.transferNodeMatches(a, b);
  }

  private validateTransferNode(node: TransferNode): void {
    switch (node.kind) {
      case 'OP':
        this.ensureOperationalPointExists(node.uniqueOpId);
        break;
      case 'PERSONNEL_SITE':
        if (!this.personnelSites().some((site) => site.siteId === node.siteId)) {
          throw new Error(`Personnel site "${node.siteId}" not found.`);
        }
        break;
      case 'REPLACEMENT_STOP':
        this.ensureReplacementStopExists(node.replacementStopId);
        break;
    }
  }

  private relinkUniqueOpId(oldId: string, newId: string): void {
    this.entities.sectionsOfLine.update((list) =>
      list.map((sol) => ({
        ...sol,
        startUniqueOpId: sol.startUniqueOpId === oldId ? newId : sol.startUniqueOpId,
        endUniqueOpId: sol.endUniqueOpId === oldId ? newId : sol.endUniqueOpId,
      })),
    );
    this.entities.stationAreas.update((list) =>
      list.map((area) =>
        area.uniqueOpId === oldId ? { ...area, uniqueOpId: newId } : area,
      ),
    );
    this.entities.tracks.update((list) =>
      list.map((track) =>
        track.uniqueOpId === oldId ? { ...track, uniqueOpId: newId } : track,
      ),
    );
    this.entities.platforms.update((list) =>
      list.map((platform) =>
        platform.uniqueOpId === oldId ? { ...platform, uniqueOpId: newId } : platform,
      ),
    );
    this.entities.sidings.update((list) =>
      list.map((siding) =>
        siding.uniqueOpId === oldId ? { ...siding, uniqueOpId: newId } : siding,
      ),
    );
    this.entities.personnelSites.update((list) =>
      list.map((site) =>
        site.uniqueOpId === oldId ? { ...site, uniqueOpId: newId } : site,
      ),
    );
    this.entities.replacementStops.update((list) =>
      list.map((stop) =>
        stop.nearestUniqueOpId === oldId ? { ...stop, nearestUniqueOpId: newId } : stop,
      ),
    );
    this.entities.opReplacementStopLinks.update((list) =>
      list.map((link) =>
        link.uniqueOpId === oldId ? { ...link, uniqueOpId: newId } : link,
      ),
    );
    this.entities.transferEdges.update((list) =>
      list.map((edge) => ({
        ...edge,
        from: this.remapTransferNode(edge.from, oldId, newId),
        to: this.remapTransferNode(edge.to, oldId, newId),
      })),
    );
  }

  private remapTransferNode(node: TransferNode, oldId: string, newId: string): TransferNode {
    if (node.kind === 'OP' && node.uniqueOpId === oldId) {
      return { ...node, uniqueOpId: newId };
    }
    return node;
  }

  private withAudit<T extends { createdAt?: string; updatedAt?: string }>(
    entity: T,
    isNew: boolean,
  ): T {
    const timestamp = nowIso();
    return {
      ...entity,
      createdAt: isNew ? entity.createdAt ?? timestamp : entity.createdAt,
      updatedAt: timestamp,
    };
  }
}
