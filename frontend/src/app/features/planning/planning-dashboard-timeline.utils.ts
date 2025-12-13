import { PlanningTimelineRange } from './planning-data.types';
import { PlanningStageId, PlanningResourceCategory, PlanningStageMeta } from './planning-stage.model';
import { Resource } from '../../models/resource';
import { Activity } from '../../models/activity';
import { TimetableYearBounds } from '../../core/models/timetable-year.model';

export function computeTimelineRange(
  stage: PlanningStageId,
  baseRange: PlanningTimelineRange,
  operationsRange: PlanningTimelineRange,
  selectedYearBounds: TimetableYearBounds[],
): PlanningTimelineRange {
  if (stage === 'base') {
    return baseRange;
  }
  if (!selectedYearBounds.length) {
    return operationsRange;
  }
  const minStart = Math.min(...selectedYearBounds.map((year) => year.start.getTime()));
  const maxEnd = Math.max(...selectedYearBounds.map((year) => year.end.getTime()));
  return {
    start: new Date(minStart),
    end: new Date(maxEnd),
  };
}

export function resourceCategory(resource: Resource): PlanningResourceCategory | null {
  const attributes = resource.attributes as Record<string, unknown> | undefined;
  const category = (attributes?.['category'] ?? null) as string | null;
  if (
    category === 'vehicle-service' ||
    category === 'personnel-service' ||
    category === 'vehicle' ||
    category === 'personnel'
  ) {
    return category;
  }
  if (
    resource.kind === 'vehicle-service' ||
    resource.kind === 'personnel-service' ||
    resource.kind === 'vehicle' ||
    resource.kind === 'personnel'
  ) {
    return resource.kind as PlanningResourceCategory;
  }
  return null;
}

export function computeResourceGroups(
  resources: Resource[],
  configs: Array<{ category: PlanningResourceCategory; label: string; description: string; icon: string }>,
): Array<{ category: PlanningResourceCategory; label: string; description: string; icon: string; resources: Resource[] }> {
  return configs
    .map((config) => {
      const items = resources.filter((resource) => resourceCategory(resource) === config.category);
      if (items.length === 0) {
        return null;
      }
      return {
        ...config,
        resources: items,
      };
    })
    .filter((group): group is { category: PlanningResourceCategory; label: string; description: string; icon: string; resources: Resource[] } => !!group);
}

export function computeMoveTargetOptions(selected: { resource: Resource }[], resources: Resource[]): Resource[] {
  if (selected.length === 0) {
    return [];
  }
  const baseKind = selected[0].resource.kind;
  const isHomogeneous = selected.every((item) => item.resource.kind === baseKind);
  if (!isHomogeneous) {
    return [];
  }
  return resources.filter((resource) => resource.kind === baseKind);
}

export function computeBaseTimelineRange(opts: {
  variant: { timetableYearLabel?: string } | null;
  timetableYearService: { getYearByLabel: (label: string) => TimetableYearBounds; defaultYearBounds: () => TimetableYearBounds };
  queryFrom: string | null;
  queryTo: string | null;
}): PlanningTimelineRange {
  const bounds = opts.variant?.timetableYearLabel
    ? opts.timetableYearService.getYearByLabel(opts.variant.timetableYearLabel)
    : opts.timetableYearService.defaultYearBounds();
  const fromIso = opts.queryFrom ?? bounds.startIso;
  const toIso = opts.queryTo ?? bounds.endIso;
  const start = new Date(`${fromIso}T00:00:00Z`);
  const end = new Date(`${toIso}T23:59:59Z`);
  return { start, end };
}

export function computeStageYearRange(
  selected: TimetableYearBounds[],
  defaultBounds: TimetableYearBounds,
): { startIso: string; endIso: string } | null {
  const source = selected.length > 0 ? selected : [defaultBounds];
  if (!source.length) {
    return null;
  }
  const startIso = source[0].startIso;
  const endIso = source[source.length - 1].endIso;
  return { startIso, endIso };
}
