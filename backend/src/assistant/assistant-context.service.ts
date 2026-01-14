import { Injectable } from '@nestjs/common';
import type { AssistantUiContextDto } from './assistant.dto';
import {
  AssistantSystemMessage,
  truncateText,
} from './assistant-context-budget';
import { AssistantContextSerializer } from './assistant-context.serializer';
import type {
  AssistantContextQuery,
  AssistantContextResource,
  AssistantContextResult,
} from './assistant-context.types';
import {
  RESOURCE_FIELDS,
  RESOURCE_LABELS,
} from './assistant-context.resources';
import { PlanningService } from '../planning/planning.service';
import type { ResourceSnapshot } from '../planning/planning.types';
import { SYSTEM_POOL_IDS } from '../planning/planning-master-data.constants';
import { TimetableYearService } from '../variants/timetable-year.service';
import type { PlanningVariantRecord } from '../variants/variants.repository';

const CONTEXT_REQUEST_PATTERN =
  /<CONTEXT_REQUEST>([\s\S]+?)<\/CONTEXT_REQUEST>/i;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 80;

@Injectable()
export class AssistantContextService {
  private readonly serializer: AssistantContextSerializer;

  constructor(
    private readonly planning: PlanningService,
    private readonly timetableYears: TimetableYearService,
  ) {
    this.serializer = new AssistantContextSerializer();
  }

  async prefetch(
    prompt: string,
    uiContext?: AssistantUiContextDto,
  ): Promise<AssistantContextResult | null> {
    const snapshot = this.planning.getResourceSnapshot();
    const resource = this.inferResource(prompt, uiContext);
    if (!resource) {
      return null;
    }
    if (!this.isPoolResource(resource)) {
      return null;
    }
    const pool = this.findPoolMatch(snapshot, resource, prompt);
    if (!pool) {
      return null;
    }
    if (this.isSystemPool(resource, pool.id)) {
      return null;
    }
    return this.fetchContext(
      { resource, poolId: pool.id, poolName: pool.name },
      snapshot,
    );
  }

  parseContextRequest(content: string): AssistantContextQuery | null {
    const match = CONTEXT_REQUEST_PATTERN.exec(content ?? '');
    if (!match) {
      return null;
    }
    const raw = match[1]?.trim();
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return this.sanitizeQuery(parsed);
    } catch {
      return null;
    }
  }

  async fetchContext(
    query: AssistantContextQuery,
    snapshot: ResourceSnapshot = this.planning.getResourceSnapshot(),
  ): Promise<AssistantContextResult> {
    const limit = this.resolveLimit(query.limit);
    const resolvedQuery: AssistantContextQuery = {
      ...query,
      limit,
    };
    const allowedFields = RESOURCE_FIELDS[resolvedQuery.resource];
    const fields = this.resolveFields(resolvedQuery.fields, allowedFields);

    switch (resolvedQuery.resource) {
      case 'personnelServices':
      case 'vehicleServices':
      case 'personnel':
      case 'vehicles': {
        const poolResult = this.resolvePool(snapshot, resolvedQuery);
        if (poolResult.error || !poolResult.pool) {
          return {
            query: resolvedQuery,
            poolLabel: poolResult.label,
            total: 0,
            items: [],
            truncated: false,
            error: poolResult.error ?? 'Pool nicht gefunden.',
          };
        }
        const pool = poolResult.pool;
        if (this.isSystemPool(resolvedQuery.resource, pool.id)) {
          return {
            query: resolvedQuery,
            poolLabel: pool.name,
            total: 0,
            items: [],
            truncated: false,
            error: 'System-Pool ist ausgeblendet.',
          };
        }
        if (resolvedQuery.resource === 'personnelServices') {
          const services = snapshot.personnelServices.filter(
            (entry) => entry.poolId === pool.id,
          );
          return this.buildResult(
            resolvedQuery,
            pool.name,
            services,
            limit,
            fields,
          );
        }
        if (resolvedQuery.resource === 'vehicleServices') {
          const services = snapshot.vehicleServices.filter(
            (entry) => entry.poolId === pool.id,
          );
          return this.buildResult(
            resolvedQuery,
            pool.name,
            services,
            limit,
            fields,
          );
        }
        if (resolvedQuery.resource === 'personnel') {
          const personnel = snapshot.personnel.filter(
            (entry) => entry.poolId === pool.id,
          );
          return this.buildResult(
            resolvedQuery,
            pool.name,
            personnel,
            limit,
            fields,
          );
        }
        const vehicles = snapshot.vehicles.filter(
          (entry) => entry.poolId === pool.id,
        );
        return this.buildResult(
          resolvedQuery,
          pool.name,
          vehicles,
          limit,
          fields,
        );
      }
      case 'personnelServicePools': {
        const pools = snapshot.personnelServicePools.filter(
          (pool) => pool.id !== SYSTEM_POOL_IDS.personnelServicePool,
        );
        return this.buildResult(resolvedQuery, undefined, pools, limit, fields);
      }
      case 'vehicleServicePools': {
        const pools = snapshot.vehicleServicePools.filter(
          (pool) => pool.id !== SYSTEM_POOL_IDS.vehicleServicePool,
        );
        return this.buildResult(resolvedQuery, undefined, pools, limit, fields);
      }
      case 'personnelPools': {
        const pools = snapshot.personnelPools.filter(
          (pool) => pool.id !== SYSTEM_POOL_IDS.personnelPool,
        );
        return this.buildResult(resolvedQuery, undefined, pools, limit, fields);
      }
      case 'vehiclePools': {
        const pools = snapshot.vehiclePools.filter(
          (pool) => pool.id !== SYSTEM_POOL_IDS.vehiclePool,
        );
        return this.buildResult(resolvedQuery, undefined, pools, limit, fields);
      }
      case 'homeDepots':
        return this.buildResult(
          resolvedQuery,
          undefined,
          snapshot.homeDepots,
          limit,
          fields,
        );
      case 'vehicleTypes':
        return this.buildResult(
          resolvedQuery,
          undefined,
          snapshot.vehicleTypes,
          limit,
          fields,
        );
      case 'vehicleCompositions':
        return this.buildResult(
          resolvedQuery,
          undefined,
          snapshot.vehicleCompositions,
          limit,
          fields,
        );
      case 'operationalPoints':
        return this.buildResult(
          resolvedQuery,
          undefined,
          this.planning.listOperationalPoints(),
          limit,
          fields,
        );
      case 'sectionsOfLine':
        return this.buildResult(
          resolvedQuery,
          undefined,
          this.planning.listSectionsOfLine(),
          limit,
          fields,
        );
      case 'personnelSites':
        return this.buildResult(
          resolvedQuery,
          undefined,
          this.planning.listPersonnelSites(),
          limit,
          fields,
        );
      case 'replacementStops':
        return this.buildResult(
          resolvedQuery,
          undefined,
          this.planning.listReplacementStops(),
          limit,
          fields,
        );
      case 'replacementRoutes':
        return this.buildResult(
          resolvedQuery,
          undefined,
          this.planning.listReplacementRoutes(),
          limit,
          fields,
        );
      case 'replacementEdges':
        return this.buildResult(
          resolvedQuery,
          undefined,
          this.planning.listReplacementEdges(),
          limit,
          fields,
        );
      case 'opReplacementStopLinks':
        return this.buildResult(
          resolvedQuery,
          undefined,
          this.planning.listOpReplacementStopLinks(),
          limit,
          fields,
        );
      case 'transferEdges':
        return this.buildResult(
          resolvedQuery,
          undefined,
          this.planning.listTransferEdges(),
          limit,
          fields,
        );
      case 'timetableYears': {
        try {
          const years = await this.timetableYears.listYears();
          const variants = await this.timetableYears.listVariants();
          const stats = this.groupVariantsByYear(variants);
          const items = years.map((label) => ({
            label,
            simulationCount: stats.get(label)?.simulations ?? 0,
            variantCount: stats.get(label)?.total ?? 0,
          }));
          return this.buildResult(
            resolvedQuery,
            undefined,
            items,
            limit,
            fields,
          );
        } catch (error) {
          return {
            query: resolvedQuery,
            total: 0,
            items: [],
            truncated: false,
            error:
              (error as Error)?.message ??
              'Fahrplanjahre konnten nicht geladen werden.',
          };
        }
      }
      case 'simulations': {
        try {
          const yearFilter = this.cleanText(resolvedQuery.timetableYearLabel);
          const variants = await this.timetableYears.listVariants(yearFilter);
          const simulations = variants.filter(
            (variant) => variant.kind === 'simulation',
          );
          return this.buildResult(
            resolvedQuery,
            undefined,
            simulations,
            limit,
            fields,
          );
        } catch (error) {
          return {
            query: resolvedQuery,
            total: 0,
            items: [],
            truncated: false,
            error:
              (error as Error)?.message ??
              'Simulationen konnten nicht geladen werden.',
          };
        }
      }
      default:
        return {
          query: resolvedQuery,
          total: 0,
          items: [],
          truncated: false,
          error: 'Kontext-Anfrage ungueltig.',
        };
    }
  }

  buildContextMessage(
    result: AssistantContextResult,
    maxChars: number,
  ): AssistantSystemMessage | null {
    if (maxChars <= 0) {
      return null;
    }
    const label = this.describeQuery(result);
    const lines: string[] = [`Kontext: ${label}`];
    if (result.error) {
      lines.push(`Fehler: ${result.error}`);
    } else {
      const shown = result.items.length;
      const summary = result.truncated
        ? `Treffer: ${result.total}, gezeigt: ${shown}`
        : `Treffer: ${result.total}`;
      lines.push(summary);
      for (const item of result.items) {
        lines.push(this.formatItem(item));
      }
    }
    const content = truncateText(lines.join('\n'), maxChars);
    return content ? { role: 'system', content } : null;
  }

  describeStatus(result: AssistantContextResult): string {
    const label = this.describeQuery(result);
    if (result.error) {
      return `Kontext: ${label} (${result.error})`;
    }
    const shown = result.items.length;
    const detail = result.truncated
      ? `${shown}/${result.total}`
      : `${result.total}`;
    return `Kontext: ${label} (${detail})`;
  }

  private inferResource(
    prompt: string,
    uiContext?: AssistantUiContextDto,
  ): AssistantContextResource | null {
    const text = prompt.toLowerCase();
    const docKey = uiContext?.docKey?.toLowerCase();
    const docSubtopic = uiContext?.docSubtopic?.toLowerCase();
    const inferredFromUi = this.inferFromUiContext(docKey, docSubtopic);
    if (inferredFromUi) {
      return inferredFromUi;
    }
    if (text.includes('fahrplanjahr')) {
      return 'timetableYears';
    }
    if (text.includes('simulation')) {
      return 'simulations';
    }
    if (text.includes('topologie') || text.includes('operational point')) {
      return 'operationalPoints';
    }
    if (
      text.includes('section of line') ||
      text.includes('streckenabschnitt')
    ) {
      return 'sectionsOfLine';
    }
    if (text.includes('personnel site') || text.includes('personalstandort')) {
      return 'personnelSites';
    }
    if (text.includes('replacement stop') || text.includes('sev-halt')) {
      return 'replacementStops';
    }
    if (text.includes('replacement route') || text.includes('sev-route')) {
      return 'replacementRoutes';
    }
    if (text.includes('replacement edge') || text.includes('sev-kante')) {
      return 'replacementEdges';
    }
    if (text.includes('transfer edge') || text.includes('umsteigekante')) {
      return 'transferEdges';
    }
    if (text.includes('fahrzeugtyp')) {
      return 'vehicleTypes';
    }
    if (text.includes('komposition')) {
      return 'vehicleCompositions';
    }
    if (text.includes('heimdepot')) {
      return 'homeDepots';
    }
    if (text.includes('personaldienstpools')) {
      return 'personnelServicePools';
    }
    if (text.includes('fahrzeugdienstpools')) {
      return 'vehicleServicePools';
    }
    if (text.includes('dienstpools')) {
      if (docKey === 'personnel') {
        return 'personnelServicePools';
      }
      if (docKey === 'vehicles') {
        return 'vehicleServicePools';
      }
    }
    if (text.includes('personaldienstpool')) {
      return 'personnelServices';
    }
    if (text.includes('fahrzeugdienstpool')) {
      return 'vehicleServices';
    }
    if (text.includes('dienstpool')) {
      if (docKey === 'personnel') {
        return 'personnelServices';
      }
      if (docKey === 'vehicles') {
        return 'vehicleServices';
      }
    }
    if (text.includes('personalpools')) {
      return 'personnelPools';
    }
    if (text.includes('fahrzeugpools')) {
      return 'vehiclePools';
    }
    if (text.includes('personalpool')) {
      return 'personnel';
    }
    if (text.includes('fahrzeugpool')) {
      return 'vehicles';
    }
    if (text.includes('pool')) {
      if (docKey === 'personnel') {
        return 'personnel';
      }
      if (docKey === 'vehicles') {
        return 'vehicles';
      }
    }
    return null;
  }

  private inferFromUiContext(
    docKey?: string | null,
    docSubtopic?: string | null,
  ): AssistantContextResource | null {
    if (!docKey) {
      return null;
    }
    if (docKey === 'timetable-years') {
      return 'timetableYears';
    }
    if (docKey === 'simulations') {
      return 'simulations';
    }
    if (docKey === 'topology') {
      if (!docSubtopic) {
        return 'operationalPoints';
      }
      const normalized = docSubtopic.replace(/[^\x20-\x7e]/g, '');
      if (normalized.includes('operational points')) {
        return 'operationalPoints';
      }
      if (normalized.includes('sections of line')) {
        return 'sectionsOfLine';
      }
      if (normalized.includes('personnel sites')) {
        return 'personnelSites';
      }
      if (normalized.includes('replacement stops')) {
        return 'replacementStops';
      }
      if (normalized.includes('replacement routes')) {
        return 'replacementRoutes';
      }
      if (normalized.includes('replacement edges')) {
        return 'replacementEdges';
      }
      if (normalized.includes('op') && normalized.includes('replacement')) {
        return 'opReplacementStopLinks';
      }
      if (normalized.includes('transfer edges')) {
        return 'transferEdges';
      }
      return 'operationalPoints';
    }
    if (docKey === 'personnel') {
      if (!docSubtopic) {
        return 'personnel';
      }
      if (docSubtopic.includes('dienstpools')) {
        return 'personnelServicePools';
      }
      if (docSubtopic.includes('dienste')) {
        return 'personnelServices';
      }
      if (docSubtopic.includes('personalpools')) {
        return 'personnelPools';
      }
      if (docSubtopic.includes('heimdepots')) {
        return 'homeDepots';
      }
      if (docSubtopic.includes('personal')) {
        return 'personnel';
      }
    }
    if (docKey === 'vehicles') {
      if (!docSubtopic) {
        return 'vehicles';
      }
      if (docSubtopic.includes('fahrzeugdienstpools')) {
        return 'vehicleServicePools';
      }
      if (docSubtopic.includes('fahrzeugdienste')) {
        return 'vehicleServices';
      }
      if (docSubtopic.includes('fahrzeugpools')) {
        return 'vehiclePools';
      }
      if (docSubtopic.includes('fahrzeuge')) {
        return 'vehicles';
      }
      if (docSubtopic.includes('fahrzeugtypen')) {
        return 'vehicleTypes';
      }
      if (docSubtopic.includes('kompositionen')) {
        return 'vehicleCompositions';
      }
    }
    return null;
  }

  private findPoolMatch(
    snapshot: ResourceSnapshot,
    resource: AssistantContextResource,
    prompt: string,
  ): { id: string; name: string } | null {
    const pools = this.selectPoolList(snapshot, resource);
    const normalizedPrompt = this.normalizeKey(prompt);
    let best: { id: string; name: string; score: number } | null = null;
    for (const pool of pools) {
      if (!pool.name) {
        continue;
      }
      const normalizedName = this.normalizeKey(pool.name);
      if (!normalizedName) {
        continue;
      }
      if (!normalizedPrompt.includes(normalizedName)) {
        continue;
      }
      if (!best || normalizedName.length > best.score) {
        best = { id: pool.id, name: pool.name, score: normalizedName.length };
      }
    }
    return best ? { id: best.id, name: best.name } : null;
  }

  private sanitizeQuery(
    raw: Record<string, unknown>,
  ): AssistantContextQuery | null {
    const resource = this.cleanText(raw['resource']);
    if (!resource || !(resource in RESOURCE_LABELS)) {
      return null;
    }
    const poolName = this.cleanText(raw['poolName']);
    const poolId = this.cleanText(raw['poolId']);
    const timetableYearLabel = this.cleanText(raw['timetableYearLabel']);
    const search = this.cleanText(raw['search']);
    const limit = this.parseLimit(raw['limit']);
    const fields = this.parseFields(
      raw['fields'],
      resource as AssistantContextResource,
    );
    const query: AssistantContextQuery = {
      resource: resource as AssistantContextResource,
    };
    if (poolName) {
      query.poolName = poolName;
    }
    if (poolId) {
      query.poolId = poolId;
    }
    if (timetableYearLabel) {
      query.timetableYearLabel = timetableYearLabel;
    }
    if (search) {
      query.search = search;
    }
    if (limit) {
      query.limit = limit;
    }
    if (fields && fields.length) {
      query.fields = fields;
    }
    return query;
  }

  private resolvePool(
    snapshot: ResourceSnapshot,
    query: AssistantContextQuery,
  ): { pool?: { id: string; name?: string }; label?: string; error?: string } {
    const pools = this.selectPoolList(snapshot, query.resource);
    if (query.poolId) {
      const pool = pools.find((entry) => entry.id === query.poolId);
      if (!pool) {
        return { error: `Pool-ID "${query.poolId}" nicht gefunden.` };
      }
      return { pool, label: pool.name ?? query.poolId };
    }
    if (query.poolName) {
      const normalized = this.normalizeKey(query.poolName);
      const exact = pools.filter(
        (entry) => this.normalizeKey(entry.name ?? '') === normalized,
      );
      if (exact.length === 1) {
        return { pool: exact[0], label: exact[0].name ?? query.poolName };
      }
      if (exact.length > 1) {
        return {
          error: `Mehrere Pools mit Name "${query.poolName}" gefunden.`,
        };
      }
      const partial = pools.filter((entry) => {
        const name = this.normalizeKey(entry.name ?? '');
        return name && (name.includes(normalized) || normalized.includes(name));
      });
      if (partial.length === 1) {
        return { pool: partial[0], label: partial[0].name ?? query.poolName };
      }
      if (partial.length > 1) {
        return {
          error: `Mehrere Pools mit Name "${query.poolName}" gefunden.`,
        };
      }
      return { error: `Pool "${query.poolName}" nicht gefunden.` };
    }
    return { error: 'Pool fehlt in Kontext-Anfrage.' };
  }

  private selectPoolList(
    snapshot: ResourceSnapshot,
    resource: AssistantContextResource,
  ): Array<{ id: string; name?: string }> {
    switch (resource) {
      case 'personnelServices':
        return snapshot.personnelServicePools;
      case 'vehicleServices':
        return snapshot.vehicleServicePools;
      case 'personnel':
        return snapshot.personnelPools;
      case 'vehicles':
        return snapshot.vehiclePools;
      default:
        return [];
    }
  }

  private buildResult(
    query: AssistantContextQuery,
    poolLabel: string | undefined,
    entries: unknown[],
    limit: number,
    fields: string[],
  ): AssistantContextResult {
    const filtered = this.filterEntries(query.resource, entries, query.search);
    const limited = filtered.slice(0, limit);
    const items = limited
      .map((entry) => this.serializer.serializeEntry(query.resource, entry))
      .map((entry) => this.pickFields(entry, fields))
      .filter((entry) => Object.keys(entry).length > 0);
    const total = filtered.length;
    return {
      query,
      poolLabel,
      total,
      items,
      truncated: filtered.length > limit,
    };
  }

  private pickFields(
    entry: Record<string, unknown>,
    fields: string[],
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const field of fields) {
      if (
        entry[field] !== undefined &&
        entry[field] !== null &&
        entry[field] !== ''
      ) {
        result[field] = entry[field];
      }
    }
    if (!Object.keys(result).length) {
      const fallback = entry['name'] ?? entry['fullName'];
      if (fallback) {
        result['name'] = fallback;
      }
    }
    return result;
  }

  private resolveFields(
    requested: string[] | undefined,
    allowed: string[],
  ): string[] {
    if (!requested || !requested.length) {
      return allowed;
    }
    const filtered = requested
      .map((entry) => entry?.trim?.() ?? '')
      .filter((entry) => entry.length > 0 && allowed.includes(entry));
    return filtered.length ? filtered : allowed;
  }

  private formatItem(item: Record<string, unknown>): string {
    const entries = Object.entries(item).map(([key, value]) => {
      if (Array.isArray(value)) {
        return `${key}=${value.join(', ')}`;
      }
      if (value && typeof value === 'object') {
        return `${key}=${JSON.stringify(value)}`;
      }
      return `${key}=${String(value)}`;
    });
    return entries.length ? `- ${entries.join(', ')}` : '- (leer)';
  }

  private describeQuery(result: AssistantContextResult): string {
    const label =
      RESOURCE_LABELS[result.query.resource] ?? result.query.resource;
    if (this.isPoolResource(result.query.resource)) {
      const poolLabel =
        result.poolLabel ??
        result.query.poolName ??
        result.query.poolId ??
        'unbekannt';
      return `${label} im Pool "${poolLabel}"`;
    }
    const extras: string[] = [];
    if (result.query.timetableYearLabel) {
      extras.push(`Fahrplanjahr "${result.query.timetableYearLabel}"`);
    }
    if (result.query.search) {
      extras.push(`Suche "${result.query.search}"`);
    }
    return extras.length ? `${label} (${extras.join(', ')})` : label;
  }

  private resolveLimit(value: number | undefined): number {
    if (value === undefined || value === null) {
      return DEFAULT_LIMIT;
    }
    if (!Number.isFinite(value) || value <= 0) {
      return DEFAULT_LIMIT;
    }
    return Math.min(Math.trunc(value), MAX_LIMIT);
  }

  private parseLimit(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.min(Math.trunc(value), MAX_LIMIT);
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        return undefined;
      }
      return Math.min(Math.trunc(parsed), MAX_LIMIT);
    }
    return undefined;
  }

  private filterEntries(
    resource: AssistantContextResource,
    entries: unknown[],
    search: string | undefined,
  ): unknown[] {
    const needle = this.normalizeKey(search ?? '');
    if (!needle) {
      return entries;
    }
    return entries.filter((entry) =>
      this.entryMatchesSearch(resource, entry, needle),
    );
  }

  private entryMatchesSearch(
    resource: AssistantContextResource,
    entry: unknown,
    needle: string,
  ): boolean {
    const serialized = this.serializer.serializeEntry(resource, entry);
    const haystack = Object.values(serialized)
      .map((value) => {
        if (value === null || value === undefined) {
          return '';
        }
        if (Array.isArray(value)) {
          return value.join(' ');
        }
        if (typeof value === 'object') {
          return JSON.stringify(value);
        }
        return String(value);
      })
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  }

  private isPoolResource(resource: AssistantContextResource): boolean {
    return (
      resource === 'personnelServices' ||
      resource === 'vehicleServices' ||
      resource === 'personnel' ||
      resource === 'vehicles'
    );
  }

  private isSystemPool(
    resource: AssistantContextResource,
    poolId: string,
  ): boolean {
    if (!poolId) {
      return false;
    }
    switch (resource) {
      case 'personnelServices':
        return poolId === SYSTEM_POOL_IDS.personnelServicePool;
      case 'vehicleServices':
        return poolId === SYSTEM_POOL_IDS.vehicleServicePool;
      case 'personnel':
        return poolId === SYSTEM_POOL_IDS.personnelPool;
      case 'vehicles':
        return poolId === SYSTEM_POOL_IDS.vehiclePool;
      default:
        return false;
    }
  }

  private groupVariantsByYear(
    variants: PlanningVariantRecord[],
  ): Map<string, { total: number; simulations: number }> {
    const map = new Map<string, { total: number; simulations: number }>();
    for (const variant of variants) {
      const entry = map.get(variant.timetableYearLabel) ?? {
        total: 0,
        simulations: 0,
      };
      entry.total += 1;
      if (variant.kind === 'simulation') {
        entry.simulations += 1;
      }
      map.set(variant.timetableYearLabel, entry);
    }
    return map;
  }

  private parseFields(
    value: unknown,
    resource: AssistantContextResource,
  ): string[] | undefined {
    const allowed = RESOURCE_FIELDS[resource];
    if (!Array.isArray(value)) {
      return undefined;
    }
    const fields = value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry.length > 0 && allowed.includes(entry));
    return fields.length ? fields : undefined;
  }

  private normalizeKey(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private cleanText(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  }
}
