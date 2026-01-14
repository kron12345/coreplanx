import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { TemplateRepository } from './template.repository';
import { TemplateTableUtil } from './template.util';
import {
  ActivityTemplateSet,
  CreateTemplateSetPayload,
  UpdateTemplateSetPayload,
} from './template.types';
import {
  ActivityDto,
  Lod,
  TimelineResponse,
  TimelineServiceDto,
} from '../timeline/timeline.types';
import type {
  Activity,
  ActivityParticipant,
  StageId,
} from '../planning/planning.types';
import { DutyAutopilotService } from '../planning/duty-autopilot.service';
import { PlanningMasterDataService } from '../planning/planning-master-data.service';
import { DebugStreamService } from '../debug/debug-stream.service';

@Injectable()
export class TemplateService {
  private readonly logger = new Logger(TemplateService.name);
  private readonly dbEnabled: boolean;
  private loggedDbWarning = false;

  constructor(
    private readonly repository: TemplateRepository,
    private readonly tableUtil: TemplateTableUtil,
    private readonly dutyAutopilot: DutyAutopilotService,
    @Optional()
    @Inject(PlanningMasterDataService)
    private readonly masterData?: PlanningMasterDataService,
    @Optional()
    @Inject(DebugStreamService)
    private readonly debugStream?: DebugStreamService,
  ) {
    this.dbEnabled = this.repository.isEnabled;
    if (!this.dbEnabled) {
      this.logger.warn(
        'Template endpoints are running without a database. Returning empty data for reads; writes are disabled.',
      );
      this.loggedDbWarning = true;
    }
  }

  private ensureDbForWrites(): void {
    if (!this.dbEnabled) {
      throw new ServiceUnavailableException(
        'Database connection is required for templates.',
      );
    }
  }

  async listTemplateSets(
    variantId?: string,
    includeArchived = false,
  ): Promise<ActivityTemplateSet[]> {
    if (!this.dbEnabled) {
      return [];
    }
    return this.repository.listTemplateSets(variantId, includeArchived);
  }

  async getTemplateSet(
    id: string,
    variantId?: string,
  ): Promise<ActivityTemplateSet> {
    if (!this.dbEnabled) {
      throw new NotFoundException(
        `Template ${id} not found (database disabled).`,
      );
    }
    const set = await this.repository.getTemplateSet(id, variantId);
    if (!set) {
      throw new NotFoundException(`Template ${id} not found`);
    }
    return set;
  }

  async createTemplateSet(
    payload: CreateTemplateSetPayload,
    variantId?: string,
    timetableYearLabel?: string | null,
  ): Promise<ActivityTemplateSet> {
    this.ensureDbForWrites();
    const now = new Date().toISOString();
    const tableName = this.tableUtil.sanitize(`template_${payload.id}`);
    const normalizedVariantId = variantId?.trim().length
      ? variantId.trim()
      : 'default';
    const set: ActivityTemplateSet = {
      id: payload.id || randomUUID(),
      name: payload.name,
      description: payload.description ?? undefined,
      tableName,
      variantId: normalizedVariantId,
      timetableYearLabel: timetableYearLabel ?? null,
      createdAt: now,
      updatedAt: now,
      periods: payload.periods ?? [],
      specialDays: payload.specialDays ?? [],
      attributes: payload.attributes,
    };
    try {
      await this.repository.createTemplateSet(set);
      return set;
    } catch (error) {
      const code = error?.code;
      if (code === '23505') {
        this.logger.warn(
          `Template ${set.id} existiert bereits – vorhandenen Datensatz verwenden.`,
        );
        const existing = await this.repository.getTemplateSet(
          set.id,
          normalizedVariantId,
        );
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  async updateTemplateSet(
    id: string,
    payload: UpdateTemplateSetPayload,
    variantId?: string,
  ): Promise<ActivityTemplateSet> {
    this.ensureDbForWrites();
    const existing = await this.getTemplateSet(id, variantId);
    const updated: ActivityTemplateSet = {
      ...existing,
      name: payload.name ?? existing.name,
      description: payload.description ?? existing.description,
      periods: payload.periods ?? existing.periods ?? [],
      specialDays: payload.specialDays ?? existing.specialDays ?? [],
      attributes: payload.attributes ?? existing.attributes,
      updatedAt: new Date().toISOString(),
    };
    await this.repository.updateTemplateSet(updated);
    return updated;
  }

  async deleteTemplateSet(id: string, variantId?: string): Promise<void> {
    this.ensureDbForWrites();
    await this.repository.deleteTemplateSet(id, variantId);
  }

  async publishTemplateSet(options: {
    templateId: string;
    sourceVariantId?: string;
    targetVariantId?: string;
    timetableYearLabel?: string | null;
  }): Promise<ActivityTemplateSet> {
    this.ensureDbForWrites();
    const sourceVariantId = options.sourceVariantId?.trim().length
      ? options.sourceVariantId.trim()
      : 'default';
    let targetVariantId = options.targetVariantId?.trim().length
      ? options.targetVariantId.trim()
      : '';
    const yearLabel = options.timetableYearLabel?.trim().length
      ? options.timetableYearLabel.trim()
      : '';
    if (!targetVariantId) {
      if (!yearLabel) {
        throw new Error(
          'Either targetVariantId or timetableYearLabel must be provided.',
        );
      }
      targetVariantId = `PROD-${yearLabel}`;
    }
    if (targetVariantId === sourceVariantId) {
      throw new Error('Source and target variants must be different.');
    }

    const source = await this.getTemplateSet(
      options.templateId,
      sourceVariantId,
    );
    const now = new Date().toISOString();
    const newId = randomUUID();
    const tableName = this.tableUtil.sanitize(`template_${newId}`);
    const sourceAttributes =
      source.attributes &&
      typeof source.attributes === 'object' &&
      !Array.isArray(source.attributes)
        ? source.attributes
        : {};
    const target: ActivityTemplateSet = {
      ...source,
      id: newId,
      tableName,
      variantId: targetVariantId,
      timetableYearLabel: yearLabel || source.timetableYearLabel || null,
      createdAt: now,
      updatedAt: now,
      publishedFromVariantId: sourceVariantId,
      publishedFromTemplateId: source.id,
      publishedAt: now,
      attributes: {
        ...sourceAttributes,
        publishedFrom: {
          variantId: sourceVariantId,
          templateId: source.id,
          publishedAt: now,
        },
      },
      isArchived: false,
      archivedAt: null,
      archivedReason: null,
    };

    await this.repository.publishTemplateSet({
      sourceTableName: source.tableName,
      target,
      archiveReason: `published from ${sourceVariantId}`,
    });

    return target;
  }

  async upsertTemplateActivity(
    templateId: string,
    activity: ActivityDto,
    variantId?: string,
  ): Promise<ActivityDto> {
    this.ensureDbForWrites();
    const set = await this.getTemplateSet(templateId, variantId);
    const normalized = await this.normalizeManagedTemplateActivity(
      activity,
      set.tableName,
    );
    const saved = await this.repository.upsertActivity(
      set.tableName,
      normalized.activity,
    );
    if (normalized.deletedId) {
      await this.repository.deleteActivity(set.tableName, normalized.deletedId);
    }
    return saved;
  }

  async deleteTemplateActivity(
    templateId: string,
    activityId: string,
    variantId?: string,
  ): Promise<void> {
    this.ensureDbForWrites();
    if (this.isDeletionBlockedServiceActivityId(activityId)) {
      throw new BadRequestException({
        message: 'Systemvorgaben können nicht gelöscht werden.',
        error: 'ValidationError',
        statusCode: 400,
        violations: [
          {
            activityId,
            code: 'MANAGED_DELETE_FORBIDDEN',
            message: 'Systemvorgaben dürfen nicht gelöscht werden.',
          },
        ],
      });
    }
    const set = await this.getTemplateSet(templateId, variantId);
    await this.repository.deleteActivity(set.tableName, activityId);
  }

  async getTemplateTimeline(
    templateId: string,
    from: string,
    to: string,
    lod: Lod,
    stage: 'base' | 'operations',
    variantId?: string,
  ): Promise<TimelineResponse> {
    if (!this.dbEnabled) {
      if (!this.loggedDbWarning) {
        this.logger.warn(
          `Template timeline requested without database connection. Returning empty ${lod}.`,
        );
        this.loggedDbWarning = true;
      }
      return lod === 'activity'
        ? { lod, activities: [] }
        : { lod, services: [] };
    }
    const set = await this.getTemplateSet(templateId, variantId);
    if (lod === 'activity') {
      const activities = await this.repository.listActivities(
        set.tableName,
        from,
        to,
        stage,
        stage === 'base',
      );
      const enriched = await this.applyTemplateWorktimeCompliance(
        stage,
        set.variantId,
        set.id,
        activities,
      );
      return { lod, activities: enriched };
    }
    const services = await this.repository.listAggregatedServices(
      set.tableName,
      from,
      to,
      stage,
    );
    return { lod, services };
  }

  private async applyTemplateWorktimeCompliance(
    stageId: StageId,
    variantId: string,
    templateId: string,
    activities: ActivityDto[],
  ): Promise<ActivityDto[]> {
    if (!activities.length) {
      return activities;
    }
    const mapped = activities.map((activity) =>
      this.mapTimelineActivity(activity),
    );
    const updates = await this.dutyAutopilot.applyWorktimeCompliance(
      stageId,
      variantId,
      mapped,
    );
    const updatedById = new Map(
      updates.map((activity) => [activity.id, activity]),
    );
    this.logHomeDepotConflicts({
      stageId,
      variantId,
      templateId,
      activities: mapped.map((activity) => updatedById.get(activity.id) ?? activity),
    });
    if (!updates.length) {
      return activities;
    }
    return activities.map((dto) => {
      const updated = updatedById.get(dto.id);
      if (!updated) {
        return dto;
      }
      const nextServiceId =
        dto.serviceId && dto.serviceId.trim().length
          ? dto.serviceId
          : (updated.serviceId ?? null);
      return {
        ...dto,
        serviceId: nextServiceId,
        attributes: (updated.attributes ?? null) as ActivityDto['attributes'],
      };
    });
  }

  private mapTimelineActivity(activity: ActivityDto): Activity {
    const participants: ActivityParticipant[] = (
      activity.resourceAssignments ?? []
    )
      .filter((assignment) => !!assignment?.resourceId)
      .map((assignment) => ({
        resourceId: assignment.resourceId,
        kind: assignment.resourceType,
        role: assignment.role ?? null,
      }));
    return {
      id: activity.id,
      title:
        typeof activity.label === 'string' && activity.label.trim().length
          ? activity.label
          : activity.type,
      start: activity.start,
      end: activity.end ?? null,
      type: activity.type,
      from: activity.from ?? null,
      to: activity.to ?? null,
      remark: activity.remark ?? null,
      serviceId: activity.serviceId ?? null,
      serviceRole: activity.serviceRole ?? null,
      participants: participants.length ? participants : undefined,
      attributes: activity.attributes ?? undefined,
    };
  }

  private logHomeDepotConflicts(options: {
    stageId: StageId;
    variantId: string;
    templateId: string;
    activities: Activity[];
  }): void {
    if (!this.debugStream?.isEnabled()) {
      return;
    }
    if (!options.activities.length) {
      return;
    }

    const isHomeDepotCode = (code: string) =>
      code.startsWith('HOME_DEPOT_') || code.startsWith('WALK_TIME_');
    const normalize = (value: string | null | undefined) =>
      (value ?? '').trim();
    const normalizeUpper = (value: string | null | undefined) =>
      normalize(value).toUpperCase();

    const readCodes = (activity: Activity): string[] => {
      const attrs = activity.attributes as Record<string, unknown> | undefined;
      const raw = attrs?.['service_conflict_codes'];
      if (!Array.isArray(raw)) {
        return [];
      }
      return raw
        .map((entry) => `${entry ?? ''}`.trim())
        .filter((entry) => entry.length > 0);
    };

    const readDetails = (activity: Activity): Record<string, string[]> => {
      const attrs = activity.attributes as Record<string, unknown> | undefined;
      const raw = attrs?.['service_conflict_details'];
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return {};
      }
      const details: Record<string, string[]> = {};
      Object.entries(raw as Record<string, unknown>).forEach(
        ([code, entries]) => {
          if (!Array.isArray(entries)) {
            return;
          }
          const cleaned = entries
            .map((entry) => `${entry ?? ''}`.trim())
            .filter((entry) => entry.length > 0);
          if (cleaned.length) {
            details[code] = cleaned;
          }
        },
      );
      return details;
    };

    const readStartLocation = (activity: Activity): string | null => {
      const locId = normalize(activity.locationId ?? '');
      if (locId) {
        return locId;
      }
      const from = normalize(activity.from ?? '');
      if (from) {
        return from;
      }
      const label = normalize(activity.locationLabel ?? '');
      if (label) {
        return label;
      }
      const to = normalize(activity.to ?? '');
      return to || null;
    };

    const readEndLocation = (activity: Activity): string | null => {
      const locId = normalize(activity.locationId ?? '');
      if (locId) {
        return locId;
      }
      const to = normalize(activity.to ?? '');
      if (to) {
        return to;
      }
      const label = normalize(activity.locationLabel ?? '');
      if (label) {
        return label;
      }
      const from = normalize(activity.from ?? '');
      return from || null;
    };

    const snapshot = this.masterData?.getResourceSnapshot() ?? null;
    const personnelSites = this.masterData?.listPersonnelSites() ?? [];
    const personnelSitesById = new Map(
      personnelSites.map((site) => [site.siteId, site]),
    );
    const personnelById = new Map(
      snapshot?.personnel?.map((entry) => [entry.id, entry]) ?? [],
    );
    const personnelServicesById = new Map(
      snapshot?.personnelServices?.map((entry) => [entry.id, entry]) ?? [],
    );
    const personnelPoolsById = new Map(
      snapshot?.personnelPools?.map((entry) => [entry.id, entry]) ?? [],
    );
    const personnelServicePoolsById = new Map(
      snapshot?.personnelServicePools?.map((entry) => [entry.id, entry]) ?? [],
    );
    const homeDepotsById = new Map(
      snapshot?.homeDepots?.map((entry) => [entry.id, entry]) ?? [],
    );

    const resolvePersonnelSiteId = (value: string | null): string | null => {
      const trimmed = normalize(value);
      if (!trimmed) {
        return null;
      }
      if (personnelSitesById.has(trimmed)) {
        return trimmed;
      }
      const normalized = normalizeUpper(trimmed);
      const idMatches = Array.from(personnelSitesById.keys()).filter(
        (siteId) => normalizeUpper(siteId) === normalized,
      );
      if (idMatches.length === 1) {
        return idMatches[0];
      }
      const nameMatches = Array.from(personnelSitesById.entries()).filter(
        ([, site]) =>
          normalizeUpper(site?.name ?? '') === normalized,
      );
      if (nameMatches.length === 1) {
        return nameMatches[0][0];
      }
      return null;
    };

    const resolveOwnerKind = (
      ownerId: string | null,
    ): 'personnel' | 'personnel-service' | null => {
      if (!ownerId) {
        return null;
      }
      if (personnelServicesById.has(ownerId)) {
        return 'personnel-service';
      }
      if (personnelById.has(ownerId)) {
        return 'personnel';
      }
      return null;
    };

    const resolveHomeDepotId = (
      ownerId: string | null,
      ownerKind: 'personnel' | 'personnel-service' | null,
    ): string | null => {
      if (!ownerId) {
        return null;
      }
      const resolveFromPersonnelService = (): string | null => {
        const service = personnelServicesById.get(ownerId);
        const poolId = service?.poolId ?? null;
        const pool = poolId ? personnelServicePoolsById.get(poolId) : null;
        return typeof pool?.homeDepotId === 'string' ? pool.homeDepotId : null;
      };
      const resolveFromPersonnel = (): string | null => {
        const personnel = personnelById.get(ownerId);
        const poolId = personnel?.poolId ?? null;
        const pool = poolId ? personnelPoolsById.get(poolId) : null;
        return typeof pool?.homeDepotId === 'string' ? pool.homeDepotId : null;
      };

      let homeDepotId: string | null = null;
      if (ownerKind === 'personnel-service') {
        homeDepotId = resolveFromPersonnelService();
        if (!homeDepotId) {
          homeDepotId = resolveFromPersonnel();
        }
      } else if (ownerKind === 'personnel') {
        homeDepotId = resolveFromPersonnel();
        if (!homeDepotId) {
          homeDepotId = resolveFromPersonnelService();
        }
      } else {
        homeDepotId = resolveFromPersonnelService() ?? resolveFromPersonnel();
      }
      const trimmed = normalize(homeDepotId ?? '');
      return trimmed.length ? trimmed : null;
    };

    const parseOwnerIdFromServiceId = (
      serviceId: string | null | undefined,
    ): string | null => {
      const raw = normalize(serviceId);
      if (!raw) {
        return null;
      }
      const parts = raw.split(':');
      if (parts.length < 3 || parts[0] !== 'svc') {
        return null;
      }
      const ownerId = normalize(parts[2]);
      return ownerId.length ? ownerId : null;
    };

    const collectServiceIds = (activity: Activity): string[] => {
      const ids = new Set<string>();
      const direct = normalize(activity.serviceId ?? '');
      if (direct) {
        ids.add(direct);
      }
      const attrs = activity.attributes as Record<string, unknown> | undefined;
      const map = attrs?.['service_by_owner'];
      if (map && typeof map === 'object' && !Array.isArray(map)) {
        Object.values(map as Record<string, any>).forEach((entry) => {
          const candidate = normalize(entry?.serviceId ?? '');
          if (candidate) {
            ids.add(candidate);
          }
        });
      }
      if (ids.size === 0) {
        const rawId = normalize(activity.id ?? '');
        if (rawId.startsWith('svcstart:')) {
          ids.add(normalize(rawId.slice('svcstart:'.length)));
        } else if (rawId.startsWith('svcend:')) {
          ids.add(normalize(rawId.slice('svcend:'.length)));
        } else if (rawId.startsWith('svcbreak:')) {
          const rest = rawId.slice('svcbreak:'.length);
          const idx = rest.indexOf(':');
          if (idx > 0) {
            ids.add(normalize(rest.slice(0, idx)));
          }
        } else if (rawId.startsWith('svcshortbreak:')) {
          const rest = rawId.slice('svcshortbreak:'.length);
          const idx = rest.indexOf(':');
          if (idx > 0) {
            ids.add(normalize(rest.slice(0, idx)));
          }
        }
      }
      return Array.from(ids);
    };

    const serviceEntries = new Map<
      string,
      Array<{
        activityId: string;
        type: string | null;
        serviceRole: string | null;
        locations: {
          locationId: string | null;
          locationLabel: string | null;
          from: string | null;
          to: string | null;
          start: string | null;
          end: string | null;
          startSiteId: string | null;
          endSiteId: string | null;
        };
        conflictCodes: string[];
        conflictDetails: Record<string, string[]>;
      }>
    >();

    for (const activity of options.activities) {
      const codes = readCodes(activity).filter(isHomeDepotCode);
      if (!codes.length) {
        continue;
      }
      const serviceIds = collectServiceIds(activity);
      if (!serviceIds.length) {
        continue;
      }
      const detailsRaw = readDetails(activity);
      const conflictDetails: Record<string, string[]> = {};
      codes.forEach((code) => {
        const entries = detailsRaw[code] ?? [];
        if (entries.length) {
          conflictDetails[code] = entries.slice(0, 6);
        }
      });
      const start = readStartLocation(activity);
      const end = readEndLocation(activity);
      const entry = {
        activityId: activity.id,
        type: activity.type ?? null,
        serviceRole: activity.serviceRole ?? null,
        locations: {
          locationId: activity.locationId ?? null,
          locationLabel: activity.locationLabel ?? null,
          from: activity.from ?? null,
          to: activity.to ?? null,
          start,
          end,
          startSiteId: resolvePersonnelSiteId(start),
          endSiteId: resolvePersonnelSiteId(end),
        },
        conflictCodes: codes,
        conflictDetails,
      };
      serviceIds.forEach((serviceId) => {
        const list = serviceEntries.get(serviceId) ?? [];
        list.push(entry);
        serviceEntries.set(serviceId, list);
      });
    }

    if (!serviceEntries.size) {
      return;
    }

    serviceEntries.forEach((entries, serviceId) => {
      const ownerId = parseOwnerIdFromServiceId(serviceId);
      const ownerKind = resolveOwnerKind(ownerId);
      const homeDepotId = resolveHomeDepotId(ownerId, ownerKind);
      const depot = homeDepotId ? homeDepotsById.get(homeDepotId) : null;
      const siteLabels: Record<string, string> = {};
      const recordSiteLabels = (ids: string[] | null | undefined) => {
        (ids ?? []).forEach((siteId) => {
          const site = personnelSitesById.get(siteId);
          if (site?.name) {
            siteLabels[siteId] = site.name;
          }
        });
      };
      recordSiteLabels(depot?.siteIds ?? []);
      recordSiteLabels(depot?.breakSiteIds ?? []);
      recordSiteLabels(depot?.shortBreakSiteIds ?? []);

      this.debugStream?.log(
        'info',
        'planning',
        'Heimdepot-Konflikte (Template)',
        {
          stageId: options.stageId,
          variantId: options.variantId,
          templateId: options.templateId,
          serviceId,
          ownerId,
          ownerKind,
          homeDepot: depot
            ? {
                depotId: depot.id,
                name: depot.name ?? null,
                siteIds: depot.siteIds ?? [],
                breakSiteIds: depot.breakSiteIds ?? [],
                shortBreakSiteIds: depot.shortBreakSiteIds ?? [],
                siteLabels,
              }
            : null,
          activityCount: entries.length,
          activities: entries.slice(0, 20),
          truncated: entries.length > 20,
        },
        {
          stageId: options.stageId,
        },
      );
    });
  }

  private async normalizeManagedTemplateActivity(
    activity: ActivityDto,
    tableName: string,
  ): Promise<{ activity: ActivityDto; deletedId: string | null }> {
    const isShortBreak = this.isShortBreakActivity(activity);
    const isBreak = this.isBreakActivity(activity);
    const normalizedActivity =
      isBreak || isShortBreak
        ? this.stripServiceBoundaryFlags(activity)
        : activity;
    const role =
      !isBreak && !isShortBreak
        ? this.resolveServiceRole(normalizedActivity)
        : null;
    if (!role && !isBreak && !isShortBreak) {
      return { activity: normalizedActivity, deletedId: null };
    }

    const owners = this.resolveServiceOwners(normalizedActivity);
    if (owners.length === 0) {
      throw new BadRequestException({
        message: 'Dienstgrenzen/Pausen benötigen genau einen Dienst.',
        error: 'ValidationError',
        statusCode: 400,
        violations: [
          {
            activityId: activity.id,
            code: 'MISSING_SERVICE_OWNER',
            message:
              'Dienstgrenzen und Pausen benötigen einen Personaldienst oder Fahrzeugdienst.',
          },
        ],
      });
    }
    if (owners.length > 1) {
      throw new BadRequestException({
        message: 'Dienstgrenzen/Pausen benötigen genau einen Dienst.',
        error: 'ValidationError',
        statusCode: 400,
        violations: [
          {
            activityId: activity.id,
            code: 'MULTIPLE_SERVICE_OWNERS',
            message:
              'Dienstgrenzen und Pausen dürfen nur einem Dienst zugeordnet sein.',
          },
        ],
      });
    }
    const ownerId = owners[0];
    const serviceId = this.computeServiceId(
      normalizedActivity.stage,
      ownerId,
      normalizedActivity.start,
    );
    if (!role && (isBreak || isShortBreak)) {
      const shouldBind = await this.shouldBindBreakToService(
        tableName,
        serviceId,
        normalizedActivity.start,
      );
      if (!shouldBind) {
        const prefix = isShortBreak ? 'svcshortbreak' : 'svcbreak';
        const managedId = (normalizedActivity.id ?? '')
          .toString()
          .startsWith(`${prefix}:`);
        const cleanedId = managedId
          ? this.normalizeManagedBreakSuffix(
              prefix,
              serviceId,
              normalizedActivity.id,
            )
          : normalizedActivity.id;
        const cleaned: ActivityDto = {
          ...normalizedActivity,
          id: cleanedId,
          serviceId: null,
          serviceRole: null,
        };
        return {
          activity: cleaned,
          deletedId:
            managedId && cleanedId !== normalizedActivity.id
              ? normalizedActivity.id
              : null,
        };
      }
    }
    let targetId = normalizedActivity.id;
    if (role) {
      targetId = `${role === 'start' ? 'svcstart' : 'svcend'}:${serviceId}`;
    } else {
      const prefix = isShortBreak ? 'svcshortbreak' : 'svcbreak';
      const suffix = this.normalizeManagedBreakSuffix(
        prefix,
        serviceId,
        normalizedActivity.id,
      );
      targetId = `${prefix}:${serviceId}:${suffix}`;
    }

    const next: ActivityDto = {
      ...normalizedActivity,
      id: targetId,
      serviceId,
      serviceRole: role ?? normalizedActivity.serviceRole ?? null,
    };
    if (targetId === normalizedActivity.id) {
      return { activity: next, deletedId: null };
    }
    return { activity: next, deletedId: normalizedActivity.id };
  }

  private stripServiceBoundaryFlags(activity: ActivityDto): ActivityDto {
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const hasRole =
      activity.serviceRole !== null && activity.serviceRole !== undefined;
    if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) {
      return hasRole ? { ...activity, serviceRole: null } : activity;
    }
    if (!('is_service_start' in attrs) && !('is_service_end' in attrs)) {
      return hasRole ? { ...activity, serviceRole: null } : activity;
    }
    const nextAttrs = { ...attrs };
    delete nextAttrs['is_service_start'];
    delete nextAttrs['is_service_end'];
    return { ...activity, attributes: nextAttrs, serviceRole: null };
  }

  private resolveServiceOwners(activity: ActivityDto): string[] {
    const assignments = activity.resourceAssignments ?? [];
    const owners = assignments
      .filter(
        (assignment) => assignment?.resourceId && assignment?.resourceType,
      )
      .filter(
        (assignment) =>
          assignment.resourceType === 'personnel-service' ||
          assignment.resourceType === 'vehicle-service',
      )
      .map((assignment) => assignment.resourceId);
    return Array.from(new Set(owners));
  }

  private resolveServiceRole(activity: ActivityDto): 'start' | 'end' | null {
    if (activity.serviceRole === 'start' || activity.serviceRole === 'end') {
      return activity.serviceRole;
    }
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const toBool = (val: unknown) =>
      typeof val === 'boolean'
        ? val
        : typeof val === 'string'
          ? val.toLowerCase() === 'true'
          : false;
    if (attrs) {
      if (toBool((attrs as any)['is_service_start'])) {
        return 'start';
      }
      if (toBool((attrs as any)['is_service_end'])) {
        return 'end';
      }
    }
    return null;
  }

  private isBreakActivity(activity: ActivityDto): boolean {
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const toBool = (val: unknown) =>
      typeof val === 'boolean'
        ? val
        : typeof val === 'string'
          ? val.toLowerCase() === 'true'
          : false;
    const isBreak = toBool(attrs?.['is_break']);
    const isShort = toBool(attrs?.['is_short_break']);
    return isBreak && !isShort;
  }

  private isShortBreakActivity(activity: ActivityDto): boolean {
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const raw = attrs?.['is_short_break'];
    if (typeof raw === 'boolean') {
      return raw;
    }
    if (typeof raw === 'string') {
      const normalized = raw.trim().toLowerCase();
      return (
        normalized === 'true' ||
        normalized === 'yes' ||
        normalized === '1' ||
        normalized === 'ja'
      );
    }
    return false;
  }

  private sanitizeManagedSuffix(value: string): string {
    return (value ?? '').toString().replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  private normalizeManagedBreakSuffix(
    prefix: 'svcbreak' | 'svcshortbreak',
    serviceId: string,
    rawId: string,
  ): string {
    const stripped = this.stripManagedBreakId(rawId);
    let suffix = this.sanitizeManagedSuffix(stripped);
    const serviceToken = this.sanitizeManagedSuffix(serviceId);
    const nestedPrefix = `${prefix}_${serviceToken}_`;
    while (suffix.startsWith(nestedPrefix)) {
      suffix = suffix.slice(nestedPrefix.length);
    }
    return suffix || 'auto';
  }

  private computeServiceId(
    stage: 'base' | 'operations',
    ownerId: string,
    startIso: string,
  ): string {
    const date = new Date(startIso);
    const y = date.getUTCFullYear();
    const m = `${date.getUTCMonth() + 1}`.padStart(2, '0');
    const d = `${date.getUTCDate()}`.padStart(2, '0');
    return `svc:${stage}:${ownerId}:${y}-${m}-${d}`;
  }

  private isManagedServiceActivityId(id: string): boolean {
    return (
      id.startsWith('svcstart:') ||
      id.startsWith('svcend:') ||
      id.startsWith('svcbreak:') ||
      id.startsWith('svcshortbreak:') ||
      id.startsWith('svccommute:')
    );
  }

  private isDeletionBlockedServiceActivityId(id: string): boolean {
    return id.startsWith('svccommute:');
  }

  private async shouldBindBreakToService(
    tableName: string,
    serviceId: string,
    activityStart: string,
  ): Promise<boolean> {
    const window = await this.repository.getManagedServiceWindow(
      tableName,
      serviceId,
    );
    if (!window.start || !window.end) {
      return false;
    }
    const startMs = Date.parse(activityStart);
    const windowStart = Date.parse(window.start);
    const windowEnd = Date.parse(window.end);
    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(windowStart) ||
      !Number.isFinite(windowEnd)
    ) {
      return false;
    }
    return startMs >= windowStart && startMs <= windowEnd;
  }

  private stripManagedBreakId(id: string): string {
    const value = (id ?? '').toString();
    if (value.startsWith('svcbreak:')) {
      const rest = value.slice('svcbreak:'.length);
      const idx = rest.lastIndexOf(':');
      const suffix = idx >= 0 ? rest.slice(idx + 1) : rest;
      return suffix || value;
    }
    if (value.startsWith('svcshortbreak:')) {
      const rest = value.slice('svcshortbreak:'.length);
      const idx = rest.lastIndexOf(':');
      const suffix = idx >= 0 ? rest.slice(idx + 1) : rest;
      return suffix || value;
    }
    return value;
  }

  async rolloutTemplate(
    templateId: string,
    targetStage: 'base' | 'operations',
    anchorStart?: string,
    variantId?: string,
  ): Promise<ActivityDto[]> {
    this.ensureDbForWrites();
    const set = await this.getTemplateSet(templateId, variantId);
    const created = await this.repository.rolloutToPlanning(
      set.tableName,
      targetStage,
      anchorStart,
      variantId,
    );
    this.logger.log(
      `Rolled out template ${templateId} to stage ${targetStage} with ${created.length} activities.`,
    );
    return created;
  }
}
