import { Injectable } from '@nestjs/common';
import type {
  LatLng,
  OperationalPoint,
  SectionOfLine,
  SectionOfLineNature,
  TopologyRouteRequest,
  TopologyRouteResponse,
  TopologyRouteSegment,
  TopologyRouteSegmentedRoute,
} from './planning.types';
import { PlanningMasterDataService } from './planning-master-data.service';

type RouteEdge = {
  from: string;
  to: string;
  section: SectionOfLine;
  distanceKm: number;
};

type RouteGraph = {
  opIndex: Map<string, OperationalPoint>;
  adjacency: Map<string, RouteEdge[]>;
};

type GraphSource = {
  ops: OperationalPoint[];
  sections: SectionOfLine[];
  opIndex: Map<string, OperationalPoint>;
  solCount: number;
  opCount: number;
};

@Injectable()
export class PlanningTopologyRoutingService {
  private cache: GraphSource | null = null;

  constructor(private readonly masterData: PlanningMasterDataService) {}

  planRoute(request: TopologyRouteRequest): TopologyRouteResponse {
    const start = request.startUniqueOpId?.trim();
    const end = request.endUniqueOpId?.trim();
    if (!start || !end) {
      return {
        status: 'invalid',
        startUniqueOpId: request.startUniqueOpId ?? '',
        endUniqueOpId: request.endUniqueOpId ?? '',
        message: 'Missing start or end operational point.',
      };
    }
    if (start === end) {
      return {
        status: 'ok',
        startUniqueOpId: start,
        endUniqueOpId: end,
        totalDistanceKm: 0,
        segments: [],
        geometry: [],
      };
    }

    const graph = this.getGraph(request);
    const result = this.shortestPath(start, end, graph);
    if (!result) {
      return {
        status: 'no_route',
        startUniqueOpId: start,
        endUniqueOpId: end,
        message: 'No SOL route found between the selected operational points.',
      };
    }

    const { edges, totalDistanceKm } = result;
    const segments: TopologyRouteSegment[] = edges.map((edge) => ({
      solId: edge.section.solId,
      startUniqueOpId: edge.from,
      endUniqueOpId: edge.to,
      lengthKm: edge.section.lengthKm ?? edge.distanceKm,
      polyline: this.resolveEdgePolyline(edge, graph.opIndex),
    }));

    const geometry = this.mergePolylines(segments);
    const alternatives = this.buildAlternatives(request, start, end, result.edges, graph);

    return {
      status: 'ok',
      startUniqueOpId: start,
      endUniqueOpId: end,
      totalDistanceKm,
      segments,
      geometry,
      alternatives: alternatives.length ? alternatives : undefined,
    };
  }

  private getGraph(request: TopologyRouteRequest): RouteGraph {
    const source = this.getSourceData();
    const opIndex = source.opIndex;
    const allowedNatures = this.resolveAllowedNatures(request);
    const attributeFilters = request.attributeFilters ?? [];
    const adjacency = new Map<string, RouteEdge[]>();
    const addEdge = (edge: RouteEdge) => {
      const list = adjacency.get(edge.from) ?? [];
      list.push(edge);
      adjacency.set(edge.from, list);
    };

    source.sections.forEach((section) => {
      if (!section.startUniqueOpId || !section.endUniqueOpId) {
        return;
      }
      if (!allowedNatures.has(section.nature)) {
        return;
      }
      if (!this.matchesAttributeFilters(section, attributeFilters)) {
        return;
      }
      const distanceKm = this.resolveSectionDistanceKm(section, opIndex);
      addEdge({
        from: section.startUniqueOpId,
        to: section.endUniqueOpId,
        section,
        distanceKm,
      });
      addEdge({
        from: section.endUniqueOpId,
        to: section.startUniqueOpId,
        section,
        distanceKm,
      });
    });

    return { opIndex, adjacency };
  }

  private getSourceData(): GraphSource {
    const ops = this.masterData.listOperationalPoints();
    const sections = this.masterData.listSectionsOfLine();
    if (this.cache && this.cache.opCount === ops.length && this.cache.solCount === sections.length) {
      return this.cache;
    }
    const opIndex = new Map<string, OperationalPoint>();
    ops.forEach((op) => opIndex.set(op.uniqueOpId, op));
    this.cache = {
      ops,
      sections,
      opIndex,
      solCount: sections.length,
      opCount: ops.length,
    };
    return this.cache;
  }

  private shortestPath(
    start: string,
    end: string,
    graph: RouteGraph,
    blockedEdges?: Set<string>,
  ): { edges: RouteEdge[]; totalDistanceKm: number } | null {
    const distances = new Map<string, number>();
    const previous = new Map<string, { node: string; edge: RouteEdge }>();
    const queue = new MinPriorityQueue<string>();

    distances.set(start, 0);
    queue.push(start, 0);

    const targetPos = graph.opIndex.get(end)?.position ?? null;

    while (!queue.isEmpty()) {
      const current = queue.pop();
      if (!current) {
        break;
      }
      const currentId = current.value;
      if (currentId === end) {
        break;
      }
      const currentDist = distances.get(currentId);
      if (currentDist === undefined) {
        continue;
      }
      const edges = graph.adjacency.get(currentId) ?? [];
      for (const edge of edges) {
        if (blockedEdges && blockedEdges.has(this.edgeKey(edge))) {
          continue;
        }
        const candidate = currentDist + edge.distanceKm;
        const known = distances.get(edge.to);
        if (known === undefined || candidate < known) {
          distances.set(edge.to, candidate);
          previous.set(edge.to, { node: currentId, edge });
          const heuristic = this.estimateDistance(edge.to, targetPos, graph.opIndex);
          queue.push(edge.to, candidate + heuristic);
        }
      }
    }

    if (!distances.has(end)) {
      return null;
    }

    const edges: RouteEdge[] = [];
    let cursor = end;
    while (cursor !== start) {
      const entry = previous.get(cursor);
      if (!entry) {
        return null;
      }
      edges.push(entry.edge);
      cursor = entry.node;
    }
    edges.reverse();
    const totalDistanceKm = distances.get(end) ?? 0;
    return { edges, totalDistanceKm };
  }

  private buildAlternatives(
    request: TopologyRouteRequest,
    start: string,
    end: string,
    primaryEdges: RouteEdge[],
    graph: RouteGraph,
  ): TopologyRouteSegmentedRoute[] {
    const maxAlternatives = Math.max(0, Math.min(request.maxAlternatives ?? 0, 3));
    if (!maxAlternatives || primaryEdges.length === 0) {
      return [];
    }
    const unique = new Map<string, TopologyRouteSegmentedRoute>();
    primaryEdges.forEach((edge) => {
      const blocked = new Set<string>([this.edgeKey(edge)]);
      const alt = this.shortestPath(start, end, graph, blocked);
      if (!alt) {
        return;
      }
      const segments = alt.edges.map((altEdge) => ({
        solId: altEdge.section.solId,
        startUniqueOpId: altEdge.from,
        endUniqueOpId: altEdge.to,
        lengthKm: altEdge.section.lengthKm ?? altEdge.distanceKm,
        polyline: this.resolveEdgePolyline(altEdge, graph.opIndex),
      }));
      const geometry = this.mergePolylines(segments);
      const signature = segments.map((seg) => `${seg.solId}:${seg.startUniqueOpId}>${seg.endUniqueOpId}`).join('|');
      if (!signature || unique.has(signature)) {
        return;
      }
      unique.set(signature, {
        totalDistanceKm: alt.totalDistanceKm,
        segments,
        geometry,
      });
    });
    return Array.from(unique.values())
      .sort((a, b) => (a.totalDistanceKm ?? 0) - (b.totalDistanceKm ?? 0))
      .slice(0, maxAlternatives);
  }

  private estimateDistance(
    nodeId: string,
    targetPos: LatLng | null,
    opIndex: Map<string, OperationalPoint>,
  ): number {
    if (!targetPos) {
      return 0;
    }
    const position = opIndex.get(nodeId)?.position;
    if (!position) {
      return 0;
    }
    return this.haversineKm(position, targetPos);
  }

  private resolveSectionDistanceKm(
    section: SectionOfLine,
    opIndex: Map<string, OperationalPoint>,
  ): number {
    if (section.lengthKm && section.lengthKm > 0) {
      return section.lengthKm;
    }
    if (section.polyline && section.polyline.length > 1) {
      return this.polylineLengthKm(section.polyline);
    }
    const start = opIndex.get(section.startUniqueOpId)?.position;
    const end = opIndex.get(section.endUniqueOpId)?.position;
    if (start && end) {
      return this.haversineKm(start, end);
    }
    return 1;
  }

  private resolveEdgePolyline(edge: RouteEdge, opIndex: Map<string, OperationalPoint>): LatLng[] {
    const polyline = edge.section.polyline ? [...edge.section.polyline] : [];
    if (polyline.length > 1) {
      const needsReverse =
        edge.from === edge.section.endUniqueOpId &&
        edge.to === edge.section.startUniqueOpId;
      return needsReverse ? polyline.reverse() : polyline;
    }
    const from = opIndex.get(edge.from)?.position;
    const to = opIndex.get(edge.to)?.position;
    if (from && to) {
      return [{ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }];
    }
    return [];
  }

  private resolveAllowedNatures(request: TopologyRouteRequest): Set<SectionOfLineNature> {
    if (request.allowedNatures && request.allowedNatures.length) {
      return new Set(request.allowedNatures);
    }
    if (request.includeLinkSections === false) {
      return new Set<SectionOfLineNature>(['REGULAR']);
    }
    return new Set<SectionOfLineNature>(['REGULAR', 'LINK']);
  }

  private matchesAttributeFilters(
    section: SectionOfLine,
    filters: Array<{ key: string; values?: string[] }>,
  ): boolean {
    if (!filters.length) {
      return true;
    }
    const attributes = section.attributes ?? [];
    return filters.every((filter) => {
      const key = filter.key?.trim();
      if (!key) {
        return true;
      }
      const candidates = attributes.filter(
        (attr) => attr.key?.toLowerCase() === key.toLowerCase(),
      );
      if (!candidates.length) {
        return false;
      }
      if (!filter.values || !filter.values.length) {
        return true;
      }
      const targetValues = filter.values.map((value) => value.toLowerCase());
      return candidates.some((attr) =>
        typeof attr.value === 'string' &&
        targetValues.includes(attr.value.toLowerCase()),
      );
    });
  }

  private mergePolylines(segments: TopologyRouteSegment[]): LatLng[] {
    const merged: LatLng[] = [];
    segments.forEach((segment) => {
      const polyline = segment.polyline ?? [];
      if (!polyline.length) {
        return;
      }
      if (!merged.length) {
        merged.push(...polyline);
        return;
      }
      const last = merged[merged.length - 1];
      const first = polyline[0];
      if (this.samePoint(last, first)) {
        merged.push(...polyline.slice(1));
        return;
      }
      merged.push(...polyline);
    });
    return merged;
  }

  private edgeKey(edge: RouteEdge): string {
    return `${edge.section.solId}:${edge.from}>${edge.to}`;
  }

  private samePoint(a: LatLng, b: LatLng): boolean {
    return Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6;
  }

  private polylineLengthKm(polyline: LatLng[]): number {
    let total = 0;
    for (let i = 1; i < polyline.length; i += 1) {
      total += this.haversineKm(polyline[i - 1], polyline[i]);
    }
    return total;
  }

  private haversineKm(a: LatLng, b: LatLng): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const value =
      sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
    const c = 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
    return 6371 * c;
  }
}

class MinPriorityQueue<T> {
  private heap: Array<{ value: T; priority: number }> = [];

  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  push(value: T, priority: number) {
    this.heap.push({ value, priority });
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): { value: T; priority: number } | null {
    if (this.heap.length === 0) {
      return null;
    }
    const top = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length && last) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  private bubbleUp(index: number) {
    let idx = index;
    while (idx > 0) {
      const parent = Math.floor((idx - 1) / 2);
      if (this.heap[parent].priority <= this.heap[idx].priority) {
        break;
      }
      const tmp = this.heap[parent];
      this.heap[parent] = this.heap[idx];
      this.heap[idx] = tmp;
      idx = parent;
    }
  }

  private bubbleDown(index: number) {
    let idx = index;
    const length = this.heap.length;
    while (true) {
      const left = idx * 2 + 1;
      const right = idx * 2 + 2;
      let smallest = idx;
      if (left < length && this.heap[left].priority < this.heap[smallest].priority) {
        smallest = left;
      }
      if (right < length && this.heap[right].priority < this.heap[smallest].priority) {
        smallest = right;
      }
      if (smallest === idx) {
        break;
      }
      const tmp = this.heap[idx];
      this.heap[idx] = this.heap[smallest];
      this.heap[smallest] = tmp;
      idx = smallest;
    }
  }
}
