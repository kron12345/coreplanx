import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { API_CONFIG } from '../core/config/api-config';
import {
  OpReplacementStopLink,
  OperationalPoint,
  Platform,
  PlatformEdge,
  PersonnelSite,
  ReplacementEdge,
  ReplacementRoute,
  ReplacementStop,
  SectionOfLine,
  Siding,
  StationArea,
  Track,
  TransferEdge,
  TopologyImportKind,
  TopologyImportRealtimeEvent,
  TopologyImportResponse,
} from '../shared/planning-types';

type ListPayload<T> = { items: T[] };

@Injectable({ providedIn: 'root' })
export class TopologyApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CONFIG);

  listOperationalPoints(): Observable<OperationalPoint[]> {
    return this.getList('/planning/topology/operational-points', [] as OperationalPoint[]);
  }

  saveOperationalPoints(items: OperationalPoint[]): Observable<OperationalPoint[]> {
    return this.putList('/planning/topology/operational-points', items);
  }

  listSectionsOfLine(): Observable<SectionOfLine[]> {
    return this.getList('/planning/topology/sections-of-line', [] as SectionOfLine[]);
  }

  saveSectionsOfLine(items: SectionOfLine[]): Observable<SectionOfLine[]> {
    return this.putList('/planning/topology/sections-of-line', items);
  }

  listStationAreas(): Observable<StationArea[]> {
    return this.getList('/planning/topology/station-areas', [] as StationArea[]);
  }

  saveStationAreas(items: StationArea[]): Observable<StationArea[]> {
    return this.putList('/planning/topology/station-areas', items);
  }

  listTracks(): Observable<Track[]> {
    return this.getList('/planning/topology/tracks', [] as Track[]);
  }

  saveTracks(items: Track[]): Observable<Track[]> {
    return this.putList('/planning/topology/tracks', items);
  }

  listPlatformEdges(): Observable<PlatformEdge[]> {
    return this.getList('/planning/topology/platform-edges', [] as PlatformEdge[]);
  }

  savePlatformEdges(items: PlatformEdge[]): Observable<PlatformEdge[]> {
    return this.putList('/planning/topology/platform-edges', items);
  }

  listPlatforms(): Observable<Platform[]> {
    return this.getList('/planning/topology/platforms', [] as Platform[]);
  }

  savePlatforms(items: Platform[]): Observable<Platform[]> {
    return this.putList('/planning/topology/platforms', items);
  }

  listSidings(): Observable<Siding[]> {
    return this.getList('/planning/topology/sidings', [] as Siding[]);
  }

  saveSidings(items: Siding[]): Observable<Siding[]> {
    return this.putList('/planning/topology/sidings', items);
  }

  listPersonnelSites(): Observable<PersonnelSite[]> {
    return this.getList('/planning/topology/personnel-sites', [] as PersonnelSite[]);
  }

  savePersonnelSites(items: PersonnelSite[]): Observable<PersonnelSite[]> {
    return this.putList('/planning/topology/personnel-sites', items);
  }

  listReplacementStops(): Observable<ReplacementStop[]> {
    return this.getList('/planning/topology/replacement-stops', [] as ReplacementStop[]);
  }

  saveReplacementStops(items: ReplacementStop[]): Observable<ReplacementStop[]> {
    return this.putList('/planning/topology/replacement-stops', items);
  }

  listReplacementRoutes(): Observable<ReplacementRoute[]> {
    return this.getList('/planning/topology/replacement-routes', [] as ReplacementRoute[]);
  }

  saveReplacementRoutes(items: ReplacementRoute[]): Observable<ReplacementRoute[]> {
    return this.putList('/planning/topology/replacement-routes', items);
  }

  listReplacementEdges(): Observable<ReplacementEdge[]> {
    return this.getList('/planning/topology/replacement-edges', [] as ReplacementEdge[]);
  }

  saveReplacementEdges(items: ReplacementEdge[]): Observable<ReplacementEdge[]> {
    return this.putList('/planning/topology/replacement-edges', items);
  }

  listOpReplacementStopLinks(): Observable<OpReplacementStopLink[]> {
    return this.getList('/planning/topology/op-replacement-links', [] as OpReplacementStopLink[]);
  }

  saveOpReplacementStopLinks(items: OpReplacementStopLink[]): Observable<OpReplacementStopLink[]> {
    return this.putList('/planning/topology/op-replacement-links', items);
  }

  listTransferEdges(): Observable<TransferEdge[]> {
    return this.getList('/planning/topology/transfer-edges', [] as TransferEdge[]);
  }

  saveTransferEdges(items: TransferEdge[]): Observable<TransferEdge[]> {
    return this.putList('/planning/topology/transfer-edges', items);
  }

  resetToDefaults(): Observable<{ ok: true }> {
    return this.http.post<{ ok: true }>(this.url('/planning/topology/reset'), {});
  }

  importOperationalPoints(): Observable<TopologyImportResponse> {
    return this.triggerTopologyImport(['operational-points']);
  }

  importSectionsOfLine(): Observable<TopologyImportResponse> {
    return this.triggerTopologyImport(['sections-of-line']);
  }

  triggerTopologyImport(kinds: TopologyImportKind[]): Observable<TopologyImportResponse> {
    const payload = kinds.length > 0 ? { kinds } : {};
    return this.http
      .post<TopologyImportResponse>(this.url('/planning/topology/import'), payload)
      .pipe(map((response) => this.normalizeImportResponse(response)));
  }

  uploadTopologyImportFile(
    kind: TopologyImportKind,
    file: File,
  ): Observable<{ ok: true; kind: TopologyImportKind; fileName: string; storedAt: string }> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    formData.append('kind', kind);
    return this.http.post<{ ok: true; kind: TopologyImportKind; fileName: string; storedAt: string }>(
      this.url('/planning/topology/import/upload'),
      formData,
    );
  }

  streamTopologyImportEvents(): Observable<TopologyImportRealtimeEvent> {
    return new Observable<TopologyImportRealtimeEvent>((observer) => {
      if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
        observer.complete();
        return;
      }

      const eventSource = new EventSource(this.url('/planning/topology/import/events'), {
        withCredentials: true,
      });

      const handleMessage = (event: MessageEvent<string>) => {
        if (!event.data) {
          return;
        }
        try {
          const payload = JSON.parse(event.data) as TopologyImportRealtimeEvent;
          observer.next(payload);
        } catch (error) {
          console.warn('[TopologyApiService] Failed to parse import event payload', error);
        }
      };

      const handleError = (error: Event) => {
        observer.error(error);
      };

      eventSource.addEventListener('message', handleMessage as EventListener);
      eventSource.addEventListener('error', handleError as EventListener);

      return () => {
        eventSource.removeEventListener('message', handleMessage as EventListener);
        eventSource.removeEventListener('error', handleError as EventListener);
        eventSource.close();
      };
    });
  }

  private getList<T>(path: string, fallback: T[]): Observable<T[]> {
    return this.http
      .get<unknown>(this.url(path))
      .pipe(map((response) => this.normalizeListResponse(response, fallback)));
  }

  private putList<T>(path: string, items: T[]): Observable<T[]> {
    return this.http
      .put<unknown>(this.url(path), this.buildPayload(items))
      .pipe(map((response) => this.normalizeListResponse(response, items)));
  }

  private buildPayload<T>(items: T[]): ListPayload<T> {
    return { items };
  }

  private url(path: string): string {
    const base = this.config.baseUrl.replace(/\/$/, '');
    return `${base}${path}`;
  }

  private normalizeListResponse<T>(response: unknown, fallback: T[]): T[] {
    if (Array.isArray(response)) {
      return response as T[];
    }
    if (response && typeof response === 'object') {
      const value = (response as { items?: unknown }).items;
      if (Array.isArray(value)) {
        return value as T[];
      }
    }
    return fallback;
  }

  private normalizeImportResponse(
    response: TopologyImportResponse | null | undefined,
  ): TopologyImportResponse {
    const startedAt = response?.startedAt ?? new Date().toISOString();
    const kinds = response?.requestedKinds;
    const requestedKinds = Array.isArray(kinds) ? kinds : [];
    const message = response?.message ?? undefined;
    return { startedAt, requestedKinds, message };
  }
}
