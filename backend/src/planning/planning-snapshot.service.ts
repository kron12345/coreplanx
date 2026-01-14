import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Activity } from './planning.types';
import { PlanningStageService } from './planning-stage.service';
import { TemplateService } from '../template/template.service';
import type { TemplatePeriod } from '../template/template.types';
import type { ActivityDto } from '../timeline/timeline.types';

export interface OperationsSnapshotRequest {
  variantId: string;
  templateId: string;
  timetableYearLabel?: string | null;
  replaceExisting?: boolean;
}

export interface OperationsSnapshotResponse {
  variantId: string;
  templateId: string;
  created: number;
  deleted: number;
  version?: string | null;
}

interface ReflectedActivity {
  baseActivityId: string;
  dateIso: string;
  activity: Activity;
}

const DAY_MS = 24 * 3600_000;
const TEMPLATE_PATTERN_KEY = 'template_pattern';

type TemplatePattern = {
  sliceId?: string | null;
  weekday?: number | null;
  startOffsetDays?: number | null;
  startTimeMs?: number | null;
  endOffsetDays?: number | null;
  endTimeMs?: number | null;
};

@Injectable()
export class PlanningSnapshotService {
  private readonly logger = new Logger(PlanningSnapshotService.name);
  private readonly mutationChunkSize = 750;
  private readonly maxGeneratedActivities = 50_000;

  constructor(
    private readonly stageService: PlanningStageService,
    private readonly templateService: TemplateService,
  ) {}

  async snapshotBaseToOperations(
    request: OperationsSnapshotRequest,
  ): Promise<OperationsSnapshotResponse> {
    const variantId = request.variantId?.trim() || 'default';
    const templateId = request.templateId?.trim() || '';
    const timetableYearLabel = request.timetableYearLabel?.trim() || null;
    const replaceExisting = request.replaceExisting ?? false;

    if (!templateId) {
      throw new BadRequestException('templateId fehlt.');
    }
    if (!variantId.startsWith('PROD-')) {
      throw new BadRequestException(
        'Snapshot ist nur für produktive Varianten (PROD-*) erlaubt.',
      );
    }

    const templateSet = await this.templateService.getTemplateSet(
      templateId,
      variantId,
    );
    const effectiveYearLabel =
      timetableYearLabel?.trim() ||
      templateSet.timetableYearLabel?.trim() ||
      null;

    const periods =
      templateSet.periods && templateSet.periods.length
        ? templateSet.periods
        : this.defaultPeriodsFromYear(effectiveYearLabel);
    if (!periods.length) {
      throw new BadRequestException(
        'Template hat keine Zeiträume. Bitte Zeiträume definieren oder timetableYearLabel setzen.',
      );
    }

    const specialDays = new Set(
      (templateSet.specialDays ?? []).map((day) => day.trim()).filter(Boolean),
    );
    const defaultPeriodEnd = this.resolveDefaultPeriodEnd(
      periods,
      effectiveYearLabel,
    );
    if (periods.some((period) => !period.validTo) && !defaultPeriodEnd) {
      throw new BadRequestException(
        'Mindestens ein Zeitraum hat kein Ende (validTo=null). Bitte validTo setzen oder timetableYearLabel übergeben.',
      );
    }

    const baseTimeline = await this.templateService.getTemplateTimeline(
      templateId,
      '1900-01-01T00:00:00Z',
      '9999-12-31T23:59:59Z',
      'activity',
      'base',
      variantId,
    );
    const baseEntries = baseTimeline.activities ?? [];
    const baseActivities = this.mapTimelineActivities(baseEntries);

    const reflected = this.reflectBaseActivities({
      activities: baseActivities,
      periods,
      specialDays,
      defaultPeriodEnd,
    });

    if (reflected.length > this.maxGeneratedActivities) {
      throw new BadRequestException(
        `Snapshot würde ${reflected.length} Aktivitäten erzeugen (Limit ${this.maxGeneratedActivities}). Bitte Zeiträume einschränken.`,
      );
    }

    const existing = await this.stageService.listActivities(
      'operations',
      variantId,
      {},
      effectiveYearLabel ?? null,
    );
    const existingIds = existing.map((activity) => activity.id);

    if (existingIds.length > 0 && !replaceExisting) {
      throw new ConflictException(
        'Betriebsplanung enthält bereits Aktivitäten. Snapshot kann nur mit replaceExisting=true überschreiben.',
      );
    }

    const timestamp = new Date().toISOString();
    const upserts = reflected.map((entry) => ({
      ...entry.activity,
      meta: {
        ...(entry.activity.meta && typeof entry.activity.meta === 'object'
          ? entry.activity.meta
          : {}),
        templatePattern:
          (entry.activity.attributes as Record<string, unknown> | undefined)?.[
            TEMPLATE_PATTERN_KEY
          ] ?? null,
        snapshot: {
          templateId,
          baseActivityId: entry.baseActivityId,
          sliceId:
            (entry.activity.attributes as Record<string, any> | undefined)?.[
              TEMPLATE_PATTERN_KEY
            ]?.sliceId ?? null,
          date: entry.dateIso,
          createdAt: timestamp,
        },
      },
    }));

    let deleted = 0;
    if (replaceExisting && existingIds.length) {
      for (const chunk of this.chunk(existingIds, this.mutationChunkSize)) {
        const result = await this.stageService.mutateActivities(
          'operations',
          variantId,
          { deleteIds: chunk },
          effectiveYearLabel ?? null,
        );
        deleted += result.deletedIds.length;
      }
    }

    let created = 0;
    let version: string | null | undefined;
    for (const chunk of this.chunk(upserts, this.mutationChunkSize)) {
      const result = await this.stageService.mutateActivities(
        'operations',
        variantId,
        { upserts: chunk },
        effectiveYearLabel ?? null,
      );
      created += result.appliedUpserts.length;
      version = result.version;
    }

    this.logger.log(
      `Snapshot base->operations: variant=${variantId} template=${templateId} created=${created} deleted=${deleted}`,
    );

    return {
      variantId,
      templateId,
      created,
      deleted,
      version: version ?? null,
    };
  }

  private mapTimelineActivities(entries: ActivityDto[]): Activity[] {
    return entries.map((entry) => ({
      id: entry.id,
      title: entry.label?.trim().length
        ? entry.label
        : (entry.type ?? entry.id),
      start: entry.start,
      end: entry.end ?? null,
      type: entry.type ?? undefined,
      from: entry.from ?? undefined,
      to: entry.to ?? undefined,
      remark: entry.remark ?? undefined,
      serviceId: entry.serviceId ?? undefined,
      serviceRole: entry.serviceRole ?? undefined,
      attributes: entry.attributes ?? undefined,
      participants: (entry.resourceAssignments ?? []).map((assignment) => ({
        resourceId: assignment.resourceId,
        kind: assignment.resourceType,
        role: assignment.role ?? undefined,
      })),
    }));
  }

  private reflectBaseActivities(options: {
    activities: Activity[];
    periods: TemplatePeriod[];
    specialDays: ReadonlySet<string>;
    defaultPeriodEnd: Date | null;
  }): ReflectedActivity[] {
    const { activities, periods, specialDays, defaultPeriodEnd } = options;
    if (!activities.length) {
      return [];
    }
    if (!periods.length) {
      return [];
    }

    const uniqueIds = new Set<string>();
    const reflected: ReflectedActivity[] = [];

    periods.forEach((period) => {
      const periodStart = new Date(period.validFrom);
      const periodEnd = period.validTo
        ? new Date(period.validTo)
        : defaultPeriodEnd;
      if (!periodEnd) {
        return;
      }
      if (
        !Number.isFinite(periodStart.getTime()) ||
        !Number.isFinite(periodEnd.getTime())
      ) {
        return;
      }
      if (periodEnd < periodStart) {
        return;
      }

      activities.forEach((activity) => {
        const pattern = this.readTemplatePattern(activity);
        if (pattern.sliceId && pattern.sliceId !== period.id) {
          return;
        }

        const first = this.alignToWeekday(periodStart, pattern.weekday);
        if (!first || first > periodEnd) {
          return;
        }

        for (
          let cursor = new Date(first.getTime());
          cursor <= periodEnd;
          cursor.setUTCDate(cursor.getUTCDate() + 7)
        ) {
          const iso = cursor.toISOString().slice(0, 10);
          if (specialDays.has(iso)) {
            continue;
          }
          const baseDayMs = Date.UTC(
            cursor.getUTCFullYear(),
            cursor.getUTCMonth(),
            cursor.getUTCDate(),
          );
          const newStart = new Date(
            baseDayMs + pattern.startOffsetDays * DAY_MS + pattern.startTimeMs,
          );
          const newEnd =
            pattern.endOffsetDays !== null && pattern.endTimeMs !== null
              ? new Date(
                  baseDayMs +
                    pattern.endOffsetDays * DAY_MS +
                    pattern.endTimeMs,
                )
              : null;

          const id = `${activity.id}@${iso}`;
          if (uniqueIds.has(id)) {
            throw new BadRequestException(
              `Doppelte Snapshot-ID ${id}. Überlappende Zeiträume?`,
            );
          }
          uniqueIds.add(id);
          reflected.push({
            baseActivityId: activity.id,
            dateIso: iso,
            activity: {
              ...activity,
              id,
              start: newStart.toISOString(),
              end: newEnd ? newEnd.toISOString() : null,
              serviceId:
                this.rewriteServiceIdForIso(activity.serviceId ?? null, iso) ??
                activity.serviceId ??
                null,
            },
          });
        }
      });
    });

    return reflected;
  }

  private rewriteServiceIdForIso(
    serviceId: string | null,
    iso: string,
  ): string | null {
    const trimmed = (serviceId ?? '').toString().trim();
    if (!trimmed) {
      return null;
    }
    if (!trimmed.startsWith('svc:')) {
      return trimmed;
    }
    const parts = trimmed.split(':');
    if (parts.length < 4) {
      return trimmed;
    }
    const stageId = parts[1] ?? '';
    const ownerId = parts[2] ?? '';
    if (!stageId || !ownerId) {
      return trimmed;
    }
    return `svc:${stageId}:${ownerId}:${iso}`;
  }

  private readTemplatePattern(activity: Activity): {
    sliceId: string | null;
    weekday: number;
    startOffsetDays: number;
    startTimeMs: number;
    endOffsetDays: number | null;
    endTimeMs: number | null;
  } {
    const parsedStartMs = Date.parse(activity.start);
    const startDate = Number.isFinite(parsedStartMs)
      ? new Date(parsedStartMs)
      : null;
    const fallbackWeekday = startDate ? startDate.getUTCDay() : 0;
    const fallbackStartTimeMs = startDate
      ? startDate.getUTCHours() * 3600_000 +
        startDate.getUTCMinutes() * 60_000 +
        startDate.getUTCSeconds() * 1000 +
        startDate.getUTCMilliseconds()
      : 0;

    const serviceMidnightMs = startDate
      ? Date.UTC(
          startDate.getUTCFullYear(),
          startDate.getUTCMonth(),
          startDate.getUTCDate(),
        )
      : NaN;
    const parsedEndMs = activity.end ? Date.parse(activity.end) : NaN;
    const fallbackEndDiff =
      activity.end &&
      Number.isFinite(parsedEndMs) &&
      Number.isFinite(serviceMidnightMs)
        ? parsedEndMs - serviceMidnightMs
        : null;
    let fallbackEndOffsetDays: number | null = null;
    let fallbackEndTimeMs: number | null = null;
    if (fallbackEndDiff !== null) {
      fallbackEndOffsetDays = Math.floor(fallbackEndDiff / DAY_MS);
      fallbackEndTimeMs = fallbackEndDiff - fallbackEndOffsetDays * DAY_MS;
    }

    const attrs = (activity.attributes ?? {}) as Record<string, unknown>;
    const raw = attrs[TEMPLATE_PATTERN_KEY];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {
        sliceId: null,
        weekday: fallbackWeekday,
        startOffsetDays: 0,
        startTimeMs: fallbackStartTimeMs,
        endOffsetDays: fallbackEndOffsetDays,
        endTimeMs: fallbackEndTimeMs,
      };
    }

    const pattern = raw as TemplatePattern;
    const sliceId =
      typeof pattern.sliceId === 'string' && pattern.sliceId.trim().length
        ? pattern.sliceId.trim()
        : null;
    const weekday =
      typeof pattern.weekday === 'number' &&
      Number.isInteger(pattern.weekday) &&
      pattern.weekday >= 0 &&
      pattern.weekday <= 6
        ? pattern.weekday
        : fallbackWeekday;
    const startOffsetDays =
      typeof pattern.startOffsetDays === 'number' &&
      Number.isInteger(pattern.startOffsetDays)
        ? pattern.startOffsetDays
        : 0;
    const startTimeMs =
      typeof pattern.startTimeMs === 'number' &&
      Number.isFinite(pattern.startTimeMs)
        ? pattern.startTimeMs
        : fallbackStartTimeMs;
    const endOffsetDays =
      typeof pattern.endOffsetDays === 'number' &&
      Number.isInteger(pattern.endOffsetDays)
        ? pattern.endOffsetDays
        : fallbackEndOffsetDays;
    const endTimeMs =
      typeof pattern.endTimeMs === 'number' &&
      Number.isFinite(pattern.endTimeMs)
        ? pattern.endTimeMs
        : fallbackEndTimeMs;

    return {
      sliceId,
      weekday,
      startOffsetDays,
      startTimeMs,
      endOffsetDays,
      endTimeMs,
    };
  }

  private alignToWeekday(date: Date, weekday: number): Date | null {
    if (!Number.isFinite(date.getTime())) {
      return null;
    }
    const result = new Date(date.getTime());
    const diff = (weekday - result.getUTCDay() + 7) % 7;
    result.setUTCDate(result.getUTCDate() + diff);
    return result;
  }

  private resolveDefaultPeriodEnd(
    periods: TemplatePeriod[],
    timetableYearLabel: string | null,
  ): Date | null {
    const explicitEnds = periods
      .map((period) => period.validTo)
      .filter(
        (val): val is string =>
          typeof val === 'string' && val.trim().length > 0,
      )
      .map((iso) => new Date(iso))
      .filter((date) => Number.isFinite(date.getTime()))
      .map((date) => date.getTime());
    if (explicitEnds.length) {
      return new Date(Math.max(...explicitEnds));
    }
    if (!timetableYearLabel) {
      return null;
    }
    return this.computeYearBounds(timetableYearLabel).end;
  }

  private defaultPeriodsFromYear(
    timetableYearLabel: string | null,
  ): TemplatePeriod[] {
    if (!timetableYearLabel) {
      return [];
    }
    const bounds = this.computeYearBounds(timetableYearLabel);
    return [
      {
        id: `default-${timetableYearLabel}`,
        validFrom: bounds.start.toISOString().slice(0, 10),
        validTo: bounds.end.toISOString().slice(0, 10),
      },
    ];
  }

  private computeYearBounds(label: string): { start: Date; end: Date } {
    const trimmed = label.trim();
    const match = /^(\d{4})(?:[/-](\d{2}))?$/.exec(trimmed);
    if (!match) {
      throw new BadRequestException(
        `Ungültiges Fahrplanjahr "${label}". Erwartet wird z. B. 2025/26.`,
      );
    }
    const startYear = Number.parseInt(match[1], 10);
    if (!Number.isFinite(startYear)) {
      throw new BadRequestException(`Ungültiges Fahrplanjahr "${label}".`);
    }
    const start = this.buildYearStart(startYear);
    const end = new Date(this.buildYearStart(startYear + 1).getTime() - 1);
    return { start, end };
  }

  private buildYearStart(decemberYear: number): Date {
    const date = new Date(Date.UTC(decemberYear, 11, 10, 0, 0, 0, 0));
    while (date.getUTCDay() !== 0) {
      date.setUTCDate(date.getUTCDate() + 1);
    }
    return date;
  }

  private chunk<T>(items: T[], size: number): T[][] {
    if (items.length <= size) {
      return [items];
    }
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      batches.push(items.slice(i, i + size));
    }
    return batches;
  }
}
