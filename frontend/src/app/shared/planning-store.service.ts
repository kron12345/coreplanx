import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { firstValueFrom, forkJoin, Observable } from 'rxjs';
import {
  OperationalPoint,
  SectionOfLine,
  PersonnelSite,
  ReplacementStop,
  ReplacementRoute,
  ReplacementEdge,
  OpReplacementStopLink,
  TransferEdge,
  TransferNode,
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
    personnelSites: signal<PersonnelSite[]>([]),
    replacementStops: signal<ReplacementStop[]>([]),
    replacementRoutes: signal<ReplacementRoute[]>([]),
    replacementEdges: signal<ReplacementEdge[]>([]),
    opReplacementStopLinks: signal<OpReplacementStopLink[]>([]),
    transferEdges: signal<TransferEdge[]>([]),
  };
  private readonly initialized = signal(false);
  private readonly loadingSignal = signal(false);
  private readonly syncErrorSignal = signal<string | null>(null);

  readonly operationalPoints = this.entities.operationalPoints.asReadonly();
  readonly sectionsOfLine = this.entities.sectionsOfLine.asReadonly();
  readonly personnelSites = this.entities.personnelSites.asReadonly();
  readonly replacementStops = this.entities.replacementStops.asReadonly();
  readonly replacementRoutes = this.entities.replacementRoutes.asReadonly();
  readonly replacementEdges = this.entities.replacementEdges.asReadonly();
  readonly opReplacementStopLinks = this.entities.opReplacementStopLinks.asReadonly();
  readonly transferEdges = this.entities.transferEdges.asReadonly();
  readonly loading = this.loadingSignal.asReadonly();
  readonly syncError = this.syncErrorSignal.asReadonly();

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

  async refreshAllFromApi(): Promise<void> {
    this.loadingSignal.set(true);
    try {
      const data = await firstValueFrom(
        forkJoin({
          operationalPoints: this.api.listOperationalPoints(),
          sectionsOfLine: this.api.listSectionsOfLine(),
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
      this.setPersonnelSites(data.personnelSites ?? []);
      this.setReplacementStops(data.replacementStops ?? []);
      this.setReplacementRoutes(data.replacementRoutes ?? []);
      this.setReplacementEdges(data.replacementEdges ?? []);
      this.setOpReplacementStopLinks(data.opReplacementStopLinks ?? []);
      this.setTransferEdges(data.transferEdges ?? []);
      this.initialized.set(true);
      this.syncErrorSignal.set(null);
    } catch (error) {
      console.error('[PlanningStoreService] Failed to load topology data', error);
      this.syncErrorSignal.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.loadingSignal.set(false);
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

  addOperationalPoint(op: OperationalPoint): void {
    this.assertUniqueOpId(op.uniqueOpId, op.opId);
    this.entities.operationalPoints.update((list) => [
      ...list,
      this.withAudit(op, true),
    ]);
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
    this.persistOperationalPoints();
    this.persistSectionsOfLine();
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
    this.persistSectionsOfLine();
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
  }

  private setOperationalPoints(items: OperationalPoint[]): void {
    this.entities.operationalPoints.set(this.cloneList(items));
  }

  private setSectionsOfLine(items: SectionOfLine[]): void {
    this.entities.sectionsOfLine.set(this.cloneList(items));
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
