import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild } from '@angular/core';
import * as L from 'leaflet';
import type { RouteSegment, RouteStop } from '../../core/models/timetable-draft.model';
import type { OperationalPoint } from '../../shared/planning-types';

@Component({
  selector: 'app-timetable-route-map',
  standalone: true,
  template: '<div #map class="route-map"></div>',
  styleUrl: './timetable-route-map.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimetableRouteMapComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('map', { static: true }) private readonly mapEl?: ElementRef<HTMLDivElement>;
  @Input() stops: RouteStop[] = [];
  @Input() segments: RouteSegment[] = [];
  @Input() operationalPoints: OperationalPoint[] = [];
  @Input() minOpZoom = 9;
  @Input() maxOpMarkers = 400;
  @Output() operationalPointSelected = new EventEmitter<OperationalPoint>();
  @Output() viewportChanged = new EventEmitter<{
    minLat: number;
    minLng: number;
    maxLat: number;
    maxLng: number;
    zoom: number;
  }>();

  private map?: L.Map;
  private layerGroup?: L.LayerGroup;
  private opLayerGroup?: L.LayerGroup;
  private resizeObserver?: ResizeObserver;
  private mapMoveHandler?: () => void;

  ngAfterViewInit(): void {
    if (!this.mapEl) {
      return;
    }
    delete (L.Icon.Default.prototype as { _getIconUrl?: string })._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'assets/leaflet/marker-icon-2x.png',
      iconUrl: 'assets/leaflet/marker-icon.png',
      shadowUrl: 'assets/leaflet/marker-shadow.png',
    });
    this.map = L.map(this.mapEl.nativeElement, {
      zoomControl: true,
      attributionControl: true,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(this.map);
    this.layerGroup = L.layerGroup().addTo(this.map);
    this.opLayerGroup = L.layerGroup().addTo(this.map);
    this.updateLayers();
    this.resizeObserver = new ResizeObserver(() => this.map?.invalidateSize());
    this.resizeObserver.observe(this.mapEl.nativeElement);
    setTimeout(() => this.map?.invalidateSize(), 0);
    this.mapMoveHandler = () => {
      this.updateOperationalPoints();
      this.emitViewportChanged();
    };
    this.map.on('zoomend', this.mapMoveHandler);
    this.map.on('moveend', this.mapMoveHandler);
    this.emitViewportChanged();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['stops'] || changes['segments']) {
      this.updateLayers();
    }
    if (changes['operationalPoints']) {
      this.updateOperationalPoints();
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    if (this.map && this.mapMoveHandler) {
      this.map.off('zoomend', this.mapMoveHandler);
      this.map.off('moveend', this.mapMoveHandler);
    }
    this.map?.remove();
  }

  focusOnCoordinates(lat: number, lng: number): void {
    if (!this.map || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return;
    }
    const nextZoom = Math.max(this.map.getZoom(), 9);
    this.map.setView([lat, lng], nextZoom, { animate: true });
  }

  private updateLayers(): void {
    if (!this.layerGroup || !this.map) {
      return;
    }
    this.layerGroup.clearLayers();
    const bounds = L.latLngBounds([]);
    const addCoords = (lat: number, lon: number) => {
      bounds.extend([lat, lon]);
    };
    this.segments.forEach((segment) => {
      if (!segment.geometry?.length) {
        return;
      }
      const latlngs: L.LatLngTuple[] = segment.geometry.map((coord) => [coord[0], coord[1]]);
      const line = L.polyline(latlngs, {
        color: '#1e88e5',
        weight: 4,
        opacity: 0.7,
      });
      line.addTo(this.layerGroup as L.LayerGroup);
      latlngs.forEach((coord) => addCoords(coord[0], coord[1]));
    });
    this.stops.forEach((stop) => {
      const lat = stop.op?.lat;
      const lon = stop.op?.lon;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return;
      }
      const color =
        stop.kind === 'origin'
          ? '#2e7d32'
          : stop.kind === 'destination'
            ? '#c62828'
            : '#6d4c41';
      const marker = L.circleMarker([lat as number, lon as number], {
        radius: 6,
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.9,
      }).bindTooltip(stop.op?.name ?? stop.stopId, { direction: 'top' });
      marker.addTo(this.layerGroup as L.LayerGroup);
      addCoords(lat as number, lon as number);
    });
    if (bounds.isValid()) {
      this.map.fitBounds(bounds.pad(0.2));
    } else {
      this.map.setView([51.2, 10.4], 6);
    }
    this.map.invalidateSize();
    this.updateOperationalPoints();
    this.emitViewportChanged();
  }

  private updateOperationalPoints(): void {
    if (!this.opLayerGroup || !this.map) {
      return;
    }
    this.opLayerGroup.clearLayers();
    const zoom = this.map.getZoom();
    if (zoom < this.minOpZoom) {
      return;
    }
    const bounds = this.map.getBounds();
    const candidates = this.operationalPoints.filter((op) =>
      op.position && bounds.contains([op.position.lat, op.position.lng]),
    );
    if (!candidates.length) {
      return;
    }
    const stride = Math.max(1, Math.ceil(candidates.length / this.maxOpMarkers));
    for (let index = 0; index < candidates.length; index += stride) {
      const op = candidates[index];
      const position = op.position;
      if (!position) {
        continue;
      }
      const marker = L.circleMarker([position.lat, position.lng], {
        radius: 3,
        color: '#0f172a',
        weight: 1,
        fillColor: '#38bdf8',
        fillOpacity: 0.7,
      }).bindTooltip(op.name ?? op.uniqueOpId, { direction: 'top', opacity: 0.9 });
      marker.on('click', () => this.operationalPointSelected.emit(op));
      marker.addTo(this.opLayerGroup as L.LayerGroup);
    }
  }

  private emitViewportChanged(): void {
    if (!this.map) {
      return;
    }
    const bounds = this.map.getBounds();
    this.viewportChanged.emit({
      minLat: bounds.getSouth(),
      minLng: bounds.getWest(),
      maxLat: bounds.getNorth(),
      maxLng: bounds.getEast(),
      zoom: this.map.getZoom(),
    });
  }
}
