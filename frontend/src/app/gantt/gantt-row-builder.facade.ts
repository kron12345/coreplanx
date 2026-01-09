import type { Activity, ActivityParticipant } from '../models/activity';
import type { Resource } from '../models/resource';
import {
  ActivityParticipantCategory,
  classifyParticipant,
  getActivityOwnersByCategory,
  participantCategoryFromKind,
} from '../models/activity-ownership';
import { LayerGroupService } from '../core/services/layer-group.service';
import { TimeScaleService } from '../core/services/time-scale.service';
import type {
  GanttGroupDefinition,
  PreparedActivity,
  PreparedActivitySlot,
  ServiceRangeAccumulator,
} from './gantt.models';
import type {
  GanttBar,
  GanttServiceRange,
  GanttServiceRangeStatus,
} from './gantt-timeline-row.component';
import { encodeSelectionSlot } from './gantt-selection.facade';

const ALLOWED_RESOURCE_CATEGORIES = new Set([
  'personnel',
  'personnel-service',
  'vehicle',
  'vehicle-service',
]);

export class GanttRowBuilderFacade {
  private readonly serviceLabelFormatter = new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });

  constructor(
    private readonly deps: {
      timeScale: TimeScaleService;
      layerGroups: LayerGroupService;
      activityTypeInfo: () => Record<string, { label: string; showRoute: boolean }>;
    },
  ) {}

  isDisplayableResource(resource: Resource): boolean {
    const category = this.resolveCategory(resource);
    if (category && ALLOWED_RESOURCE_CATEGORIES.has(category)) {
      return true;
    }
    return ALLOWED_RESOURCE_CATEGORIES.has(resource.kind);
  }

  buildParticipantSlots(activity: PreparedActivity): PreparedActivitySlot[] {
    if (!activity.participants || activity.participants.length === 0) {
      return [];
    }
    const owners = getActivityOwnersByCategory(activity);
    return activity.participants
      .filter((participant): participant is ActivityParticipant => !!participant?.resourceId)
      .map((participant, index) => {
        const category = classifyParticipant(participant);
        const ownerMatch =
          (category === 'vehicle' && owners.vehicle?.resourceId === participant.resourceId) ||
          (category === 'personnel' && owners.personnel?.resourceId === participant.resourceId);
        const isOwner =
          ownerMatch || (category === 'other' && index === 0 && !owners.vehicle && !owners.personnel);
        const iconInfo = this.participantRoleIcon(participant, isOwner, category);
        return {
          id: `${activity.id}:${participant.resourceId}`,
          activity,
          participant,
          resourceId: participant.resourceId,
          category,
          isOwner,
          icon: iconInfo.icon,
          iconLabel: iconInfo.label,
        };
      });
  }

  buildGroups(resources: Resource[]): GanttGroupDefinition[] {
    const groups = new Map<string, GanttGroupDefinition>();
    resources.forEach((resource) => {
      const category = this.resolveCategory(resource);
      const poolId = this.resolvePoolId(resource);
      const poolName = this.resolvePoolName(resource);
      const groupId = this.groupIdForParts(category, poolId);
      const label = poolName ?? this.defaultGroupLabel(category, poolId);
      const icon = this.iconForCategory(category);
      const existing = groups.get(groupId);
      if (existing) {
        existing.resources.push(resource);
      } else {
        groups.set(groupId, {
          id: groupId,
          label,
          icon,
          category,
          resources: [resource],
        });
      }
    });

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        resources: [...group.resources].sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => {
        const categoryDiff = this.categorySortKey(a.category) - this.categorySortKey(b.category);
        if (categoryDiff !== 0) {
          return categoryDiff;
        }
        return a.label.localeCompare(b.label);
      });
  }

  buildTimelineData(options: {
    resources: Resource[];
    slotsByResource: Map<string, PreparedActivitySlot[]>;
    pendingActivityId: string | null;
    syncingActivityIds: ReadonlySet<string>;
    viewStart: Date;
    viewEnd: Date;
    selectedIds: ReadonlySet<string>;
    primarySlots: ReadonlySet<string>;
  }): Map<string, { bars: GanttBar[]; services: GanttServiceRange[] }> {
    const map = new Map<string, { bars: GanttBar[]; services: GanttServiceRange[] }>();

    const pendingId = options.pendingActivityId;
    const syncingIds = options.syncingActivityIds;
    const startMs = options.viewStart.getTime();
    const endMs = options.viewEnd.getTime();
    const timeScale = this.deps.timeScale;

    options.resources.forEach((resource) => {
      const slots = options.slotsByResource.get(resource.id) ?? [];
      const bars: GanttBar[] = [];
      const serviceMap = new Map<string, ServiceRangeAccumulator>();
      for (const slot of slots) {
        const activity = slot.activity;
        const isPreview = !!activity.isPreview;
        if (
          activity.endMs < startMs - 2 * 60 * 60 * 1000 ||
          activity.startMs > endMs + 2 * 60 * 60 * 1000
        ) {
          continue;
        }
        const rawLeft = timeScale.timeToPx(activity.startMs);
        const rawRight = timeScale.timeToPx(activity.endMs);
        const displayInfo = this.activityDisplayInfo(activity);
        const isMilestone = !activity.end;
        const left = Math.round(rawLeft);
        const right = Math.round(rawRight);
        let barWidth = Math.max(1, right - left);
        let barLeft = left;
        if (isMilestone) {
          barWidth = 24;
          barLeft = Math.round(rawLeft) - Math.floor(barWidth / 2);
          const contentWidth = timeScale.contentWidth();
          const maxLeft = Math.max(0, contentWidth - barWidth);
          barLeft = Math.min(Math.max(0, barLeft), maxLeft);
        }
        const classes = this.resolveBarClasses(activity, slot.resourceId);
        if (isMilestone) {
          classes.push('gantt-activity--milestone');
        }
        if (syncingIds && syncingIds.has(activity.id) && !isPreview) {
          classes.push('gantt-activity--syncing');
        }
        const attrMap = activity.attributes as Record<string, unknown> | undefined;
        const drawAs = typeof attrMap?.['draw_as'] === 'string' ? (attrMap['draw_as'] as string) : null;
        const layerGroupId =
          typeof attrMap?.['layer_group'] === 'string'
            ? (attrMap['layer_group'] as string)
            : typeof attrMap?.['layer'] === 'string'
              ? (attrMap['layer'] as string)
              : null;
        const layerGroup =
          this.deps.layerGroups.getById(layerGroupId) ?? this.deps.layerGroups.getById('default');
        switch (drawAs) {
          case 'line-above':
            classes.push('gantt-activity--draw-line-above');
            break;
          case 'line-below':
            classes.push('gantt-activity--draw-line-below');
            break;
          case 'shift-up':
            classes.push('gantt-activity--draw-shift-up');
            break;
          case 'shift-down':
            classes.push('gantt-activity--draw-shift-down');
            break;
          case 'dot':
            classes.push('gantt-activity--draw-dot');
            break;
          case 'square':
            classes.push('gantt-activity--draw-square');
            break;
          case 'triangle-up':
            classes.push('gantt-activity--draw-triangle-up');
            break;
          case 'triangle-down':
            classes.push('gantt-activity--draw-triangle-down');
            break;
          case 'thick':
            classes.push('gantt-activity--draw-thick');
            break;
          case 'background':
            classes.push('gantt-activity--draw-background');
            break;
          default:
            break;
        }
        if (layerGroup?.id === 'background') {
          classes.push('gantt-activity--layer-background');
        } else if (layerGroup?.id === 'marker') {
          classes.push('gantt-activity--layer-marker');
        }
        const isPending = pendingId === activity.id;
        if (isPending) {
          classes.push('gantt-activity--ghost', 'gantt-activity--pending');
        }
        const isMirror = !slot.isOwner;
        if (isMirror) {
          classes.push('gantt-activity--mirror');
        }
        const primarySelected = options.primarySlots.has(encodeSelectionSlot(activity.id, slot.resourceId));
        const baseZIndex = layerGroup?.order ?? 0;
        bars.push({
          id: slot.id,
          activity,
          left: barLeft,
          width: barWidth,
          classes,
          color: this.extractActivityColor(activity),
          dragDisabled: isPreview,
          selected: isPreview ? false : options.selectedIds.has(activity.id),
          primarySelected: isPreview ? false : primarySelected,
          label: displayInfo.label,
          showRoute: !isMilestone && displayInfo.showRoute && !!(activity.from || activity.to),
          isMirror,
          zIndex: isPreview ? baseZIndex + 40 : baseZIndex,
          participantResourceId: slot.resourceId,
          participantCategory: slot.category,
          isOwner: slot.isOwner,
          roleIcon: slot.icon,
          roleLabel: slot.iconLabel,
          isPreview,
          serviceWorktimeMs: this.extractServiceWorktimeMs(activity),
        });

        if (isPreview) {
          continue;
        }

        const serviceId = this.serviceIdForSlot(activity, slot.resourceId);
        if (!serviceId) {
          continue;
        }
        const displayStart = isMilestone ? barLeft + Math.round(barWidth / 2) : left;
        const displayEnd = isMilestone ? barLeft + Math.round(barWidth / 2) : right;
        let accumulator = serviceMap.get(serviceId);
        if (!accumulator) {
          accumulator = {
            id: serviceId,
            minLeft: Number.POSITIVE_INFINITY,
            maxRight: Number.NEGATIVE_INFINITY,
            startLeft: null,
            endLeft: null,
            startMs: null,
            endMs: null,
            routeFrom: null,
            routeTo: null,
            routeFromMs: null,
            routeToMs: null,
          };
          serviceMap.set(serviceId, accumulator);
        }
        accumulator.minLeft = Math.min(accumulator.minLeft, displayStart);
        accumulator.maxRight = Math.max(accumulator.maxRight, displayEnd);
        if (this.isServiceStart(activity) && (accumulator.startLeft === null || displayStart < accumulator.startLeft)) {
          accumulator.startLeft = displayStart;
          accumulator.startMs = activity.startMs;
        }
        if (this.isServiceEnd(activity) && (accumulator.endLeft === null || displayEnd > accumulator.endLeft)) {
          accumulator.endLeft = displayEnd;
          accumulator.endMs = activity.endMs;
        }

        if (activity.from && (accumulator.routeFromMs === null || activity.startMs < accumulator.routeFromMs)) {
          accumulator.routeFrom = this.formatServiceLocationLabel(activity.from);
          accumulator.routeFromMs = activity.startMs;
        }
        if (activity.to && (accumulator.routeToMs === null || activity.endMs > accumulator.routeToMs)) {
          accumulator.routeTo = this.formatServiceLocationLabel(activity.to);
          accumulator.routeToMs = activity.endMs;
        }
      }

      const services = Array.from(serviceMap.values())
        .map((entry) => this.createServiceRange(entry, resource))
        .filter((range): range is GanttServiceRange => !!range);
      map.set(resource.id, { bars, services });
    });

    return map;
  }

  resourceCategoryFromKind(kind: Resource['kind'] | null | undefined): ActivityParticipantCategory {
    return participantCategoryFromKind(kind ?? undefined);
  }

  private extractActivityColor(activity: Activity): string | null {
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const keys = ['color', 'bar_color', 'display_color', 'main_color'];
    for (const key of keys) {
      const val = attrs?.[key];
      if (typeof val === 'string' && val.trim().length > 0) {
        return val.trim();
      }
    }
    return null;
  }

  private extractServiceWorktimeMs(activity: Activity): number | null {
    const meta = activity.meta as Record<string, unknown> | undefined;
    const raw = meta?.['service_worktime_ms'];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return raw;
    }
    if (typeof raw === 'string') {
      const parsed = Number.parseFloat(raw);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  }

  private resolveCategory(resource: Resource): string | null {
    const attributes = resource.attributes as Record<string, unknown> | undefined;
    const category = attributes?.['category'];
    return typeof category === 'string' ? category : null;
  }

  private resolvePoolId(resource: Resource): string | null {
    const attributes = resource.attributes as Record<string, unknown> | undefined;
    const poolId = attributes?.['poolId'];
    return typeof poolId === 'string' ? poolId : null;
  }

  private resolvePoolName(resource: Resource): string | null {
    const attributes = resource.attributes as Record<string, unknown> | undefined;
    const poolName = attributes?.['poolName'];
    return typeof poolName === 'string' && poolName.length > 0 ? poolName : null;
  }

  private groupIdForParts(category: string | null, poolId: string | null): string {
    return `${category ?? 'uncategorized'}|${poolId ?? 'none'}`;
  }

  private iconForCategory(category: string | null): string {
    switch (category) {
      case 'vehicle-service':
        return 'route';
      case 'personnel-service':
        return 'badge';
      case 'vehicle':
        return 'directions_transit';
      case 'personnel':
        return 'groups';
      default:
        return 'inventory_2';
    }
  }

  private participantRoleIcon(
    participant: ActivityParticipant,
    isOwner: boolean,
    category: ActivityParticipantCategory,
  ): { icon: string | null; label: string | null } {
    switch (participant.role) {
      case 'teacher':
        return { icon: 'school', label: 'Lehrer' };
      case 'student':
        return { icon: 'face', label: 'Schüler' };
      case 'primary-personnel':
        return { icon: 'workspace_premium', label: 'Hauptpersonal' };
      case 'secondary-personnel':
        return { icon: 'groups', label: 'Begleitpersonal' };
      case 'primary-vehicle':
        return { icon: 'train', label: 'Fahrzeug (Primär)' };
      case 'secondary-vehicle':
        return { icon: 'directions_transit', label: 'Fahrzeug (Sekundär)' };
      default:
        break;
    }
    if (!isOwner) {
      return { icon: 'link', label: 'Verknüpfte Ressource' };
    }
    if (category === 'vehicle') {
      return { icon: 'train', label: 'Fahrzeug' };
    }
    if (category === 'personnel') {
      return { icon: 'badge', label: 'Personal' };
    }
    return { icon: null, label: null };
  }

  private defaultGroupLabel(category: string | null, poolId: string | null): string {
    switch (category) {
      case 'vehicle-service':
        return poolId ? `Fahrzeugdienst-Pool ${poolId}` : 'Fahrzeugdienste';
      case 'personnel-service':
        return poolId ? `Personaldienst-Pool ${poolId}` : 'Personaldienste';
      case 'vehicle':
        return poolId ? `Fahrzeugpool ${poolId}` : 'Fahrzeuge';
      case 'personnel':
        return poolId ? `Personalpool ${poolId}` : 'Personal';
      default:
        return 'Weitere Ressourcen';
    }
  }

  private categorySortKey(category: string | null): number {
    switch (category) {
      case 'vehicle-service':
        return 0;
      case 'personnel-service':
        return 1;
      case 'vehicle':
        return 2;
      case 'personnel':
        return 3;
      default:
        return 99;
    }
  }

  private resolveBarClasses(activity: PreparedActivity, resourceId: string): string[] {
    const classes: string[] = [];
    const serviceId = this.serviceIdForSlot(activity, resourceId);
    if (serviceId) {
      classes.push('gantt-activity--within-service');
      if (this.isServiceStart(activity)) {
        classes.push('gantt-activity--service-boundary', 'gantt-activity--service-boundary-start');
      } else if (this.isServiceEnd(activity)) {
        classes.push('gantt-activity--service-boundary', 'gantt-activity--service-boundary-end');
      }
    } else {
      classes.push('gantt-activity--outside-service');
    }

    const { level, codes } = this.serviceConflictsForSlot(activity, resourceId);
    if (Number.isFinite(level) && level >= 2) {
      classes.push('gantt-activity--conflict-error');
    } else if (Number.isFinite(level) && level >= 1) {
      classes.push('gantt-activity--conflict-warn');
    }

    if (codes.length) {
      const set = new Set(codes);
      classes.push('gantt-activity--conflict-pattern');
      if (set.has('CAPACITY_OVERLAP')) {
        classes.push('gantt-activity--conflict-capacity');
      }
      if (
        set.has('LOCATION_SEQUENCE') ||
        Array.from(set).some(
          (code) =>
            code.startsWith('HOME_DEPOT_') ||
            code.startsWith('WALK_TIME_') ||
            code.endsWith('LOCATION_MISSING'),
        )
      ) {
        classes.push('gantt-activity--conflict-location');
      }
      if (
        Array.from(set).some((code) => code.startsWith('AZG_')) ||
        set.has('MAX_DUTY_SPAN') ||
        set.has('MAX_WORK') ||
        set.has('MAX_CONTINUOUS') ||
        set.has('NO_BREAK_WINDOW')
      ) {
        classes.push('gantt-activity--conflict-worktime');
      }
    }
    return classes;
  }

  private serviceIdForSlot(activity: PreparedActivity, resourceId: string): string | null {
    if (this.isManagedServiceActivity(activity)) {
      return (activity.serviceId ?? null) as string | null;
    }
    const ownerEntry = this.readOwnerServiceEntry(activity, resourceId);
    if (ownerEntry?.serviceId) {
      return ownerEntry.serviceId;
    }
    return (activity.serviceId ?? null) as string | null;
  }

  private serviceConflictsForSlot(
    activity: PreparedActivity,
    resourceId: string,
  ): { level: number; codes: string[] } {
    const ownerEntry = this.readOwnerServiceEntry(activity, resourceId);
    if (ownerEntry) {
      return {
        level: ownerEntry.conflictLevel,
        codes: ownerEntry.conflictCodes,
      };
    }
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const rawLevel = attrs?.['service_conflict_level'];
    const level =
      typeof rawLevel === 'number'
        ? rawLevel
        : typeof rawLevel === 'string'
          ? Number.parseInt(rawLevel, 10)
          : 0;
    const rawCodes = attrs?.['service_conflict_codes'];
    const codes = Array.isArray(rawCodes)
      ? rawCodes.map((entry) => String(entry)).filter((entry) => entry.trim().length > 0)
      : [];
    return { level, codes };
  }

  private isServiceStart(activity: Activity): boolean {
    if (activity.serviceRole === 'start') {
      return true;
    }
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    return this.toBool(attrs?.['is_service_start']);
  }

  private isServiceEnd(activity: Activity): boolean {
    if (activity.serviceRole === 'end') {
      return true;
    }
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    return this.toBool(attrs?.['is_service_end']);
  }

  private toBool(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      return normalized === 'true' || normalized === 'yes' || normalized === '1';
    }
    return false;
  }

  private readOwnerServiceEntry(
    activity: PreparedActivity,
    resourceId: string,
  ): { serviceId: string | null; conflictLevel: number; conflictCodes: string[] } | null {
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const raw = attrs?.['service_by_owner'];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return null;
    }
    const entry = (raw as Record<string, any>)[resourceId];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return null;
    }
    const serviceId = typeof entry.serviceId === 'string' ? entry.serviceId : null;
    const rawLevel = entry.conflictLevel;
    const conflictLevel =
      typeof rawLevel === 'number'
        ? rawLevel
        : typeof rawLevel === 'string'
          ? Number.parseInt(rawLevel, 10)
          : 0;
    const rawCodes = entry.conflictCodes;
    const conflictCodes = Array.isArray(rawCodes)
      ? rawCodes.map((code: any) => String(code)).filter((code: string) => code.trim().length > 0)
      : [];
    return { serviceId, conflictLevel, conflictCodes };
  }

  private isManagedServiceActivity(activity: PreparedActivity): boolean {
    const id = (activity.id ?? '').toString();
    if (
      id.startsWith('svcstart:') ||
      id.startsWith('svcend:') ||
      id.startsWith('svcbreak:') ||
      id.startsWith('svcshortbreak:') ||
      id.startsWith('svccommute:')
    ) {
      return true;
    }
    const role = activity.serviceRole ?? null;
    if (role === 'start' || role === 'end') {
      return true;
    }
    return false;
  }

  private createServiceRange(entry: ServiceRangeAccumulator, resource: Resource): GanttServiceRange | null {
    const hasStart = entry.startLeft !== null;
    const hasEnd = entry.endLeft !== null;
    if (!hasStart && !hasEnd && !Number.isFinite(entry.minLeft) && !Number.isFinite(entry.maxRight)) {
      return null;
    }
    let left: number;
    let right: number;
    if (hasStart && hasEnd) {
      left = Math.min(entry.startLeft!, entry.endLeft!);
      right = Math.max(entry.startLeft!, entry.endLeft!);
    } else {
      const fallbackLeft = Number.isFinite(entry.minLeft)
        ? entry.minLeft
        : entry.endLeft ?? entry.startLeft ?? 0;
      const fallbackRight = Number.isFinite(entry.maxRight)
        ? entry.maxRight
        : entry.startLeft ?? entry.endLeft ?? fallbackLeft;
      left = Math.min(fallbackLeft, fallbackRight);
      right = Math.max(fallbackLeft, fallbackRight);
      if (hasStart && !hasEnd) {
        left = Math.min(left, entry.startLeft!);
        right = Math.max(right, entry.startLeft! + 32);
      } else if (!hasStart && hasEnd) {
        right = Math.max(right, entry.endLeft!);
        left = Math.min(left, entry.endLeft! - 32);
      } else if (!hasStart && !hasEnd) {
        right = Math.max(right, left + 32);
      }
    }
    if (right - left < 12) {
      right = left + 12;
    }
    if (left < 0) {
      right -= left;
      left = 0;
    }
    const status: GanttServiceRangeStatus =
      hasStart && hasEnd ? 'complete' : hasStart ? 'missing-end' : hasEnd ? 'missing-start' : 'missing-both';
    const width = Math.max(4, right - left);
    const label = this.buildServiceRangeLabel({
      resource,
      serviceId: entry.id,
      startMs: entry.startMs,
      endMs: entry.endMs,
      routeFrom: entry.routeFrom,
      routeTo: entry.routeTo,
      status,
      widthPx: width,
    });
    return {
      id: entry.id,
      label,
      left,
      width,
      status,
    };
  }

  private buildServiceRangeLabel(options: {
    resource: Resource;
    serviceId: string;
    startMs: number | null;
    endMs: number | null;
    routeFrom: string | null;
    routeTo: string | null;
    status: GanttServiceRangeStatus;
    widthPx: number;
  }): string {
    const format = (value: number | null) => (value ? this.serviceLabelFormatter.format(new Date(value)) : '—');
    const serviceNo = this.resolveServiceNumber(options.resource, options.serviceId);
    const timeLabel = `${format(options.startMs)}-${format(options.endMs)}`;
    const baseLabel = `${serviceNo} | ${timeLabel}`;

    const routeLabel =
      options.routeFrom && options.routeTo ? `${options.routeFrom}-${options.routeTo}` : null;

    // Rough pixel heuristics: avoid long strings when the service frame is narrow.
    if (options.widthPx < 90) {
      return serviceNo;
    }
    if (options.widthPx < 170 || !routeLabel) {
      return baseLabel;
    }
    return `${baseLabel} | ${routeLabel}`;
  }

  private resolveServiceNumber(resource: Resource, serviceId: string): string {
    const candidate = (resource.id ?? '').toString().trim();
    const knownMatch = candidate.match(/^(PS|VS)-0*(\d+)$/i);
    if (knownMatch) {
      return knownMatch[2];
    }

    const name = (resource.name ?? '').toString().trim();
    const nameMatch = name.match(/\b(\d{1,4})\b/);
    if (nameMatch) {
      return nameMatch[1];
    }

    const ownerId = this.parseOwnerIdFromServiceId(serviceId);
    const ownerMatch = ownerId ? ownerId.match(/^(PS|VS)-0*(\d+)$/i) : null;
    if (ownerMatch) {
      return ownerMatch[2];
    }

    if (candidate.length > 0 && candidate.length <= 12) {
      return candidate;
    }
    if (name.length > 0 && name.length <= 12) {
      return name;
    }
    return ownerId ? ownerId.slice(0, 8) : serviceId.slice(0, 8);
  }

  private parseOwnerIdFromServiceId(serviceId: string): string | null {
    const parts = (serviceId ?? '').toString().split(':');
    if (parts.length < 4 || parts[0] !== 'svc') {
      return null;
    }
    return parts[2] ?? null;
  }

  private formatServiceLocationLabel(raw: string | null | undefined): string {
    const value = (raw ?? '').toString().trim();
    if (!value) {
      return '';
    }
    const upper = value.toUpperCase();
    if (upper.length <= 10 && !upper.includes(' ')) {
      return upper;
    }
    const firstWord = upper.split(/\s+/)[0];
    if (firstWord.length >= 2 && firstWord.length <= 10) {
      return firstWord;
    }
    return upper.slice(0, 10);
  }

  private activityDisplayInfo(activity: Activity): { label: string; showRoute: boolean } {
    const typeId = activity.type ?? '';
    const info = this.deps.activityTypeInfo()[typeId];
    const fallbackLabel = (activity.title ?? '').trim() || 'Aktivität';
    const label = info?.label ?? fallbackLabel;
    const showRoute = info?.showRoute ?? false;
    return { label, showRoute };
  }
}
