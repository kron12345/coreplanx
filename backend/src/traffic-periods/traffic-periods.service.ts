import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TrafficPeriod, TrafficPeriodRule } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  RailMlTrafficPeriodPayload,
  SingleDayTrafficPeriodPayload,
  TrafficPeriodCreatePayload,
  TrafficPeriodDto,
  TrafficPeriodExclusionPayload,
  TrafficPeriodRuleDto,
  TrafficPeriodRulePayload,
  TrafficPeriodVariantPayload,
} from './traffic-periods.types';

type TimetableYearBounds = {
  label: string;
  start: Date;
  end: Date;
  startIso: string;
  endIso: string;
  startYear: number;
  endYear: number;
};

@Injectable()
export class TrafficPeriodsService {
  private idCounter = 0;

  constructor(private readonly prisma: PrismaService) {}

  async listPeriods(): Promise<TrafficPeriodDto[]> {
    const records = await this.prisma.trafficPeriod.findMany({
      include: { rules: true },
      orderBy: { updatedAt: 'desc' },
    });
    return records.map((record) => this.mapRecord(record, record.rules));
  }

  async getPeriodById(periodId: string): Promise<TrafficPeriodDto | null> {
    const trimmed = periodId?.trim();
    if (!trimmed) {
      return null;
    }
    const record = await this.prisma.trafficPeriod.findUnique({
      where: { id: trimmed },
      include: { rules: true },
    });
    return record ? this.mapRecord(record, record.rules) : null;
  }

  async upsertPeriod(payload: TrafficPeriodDto): Promise<TrafficPeriodDto> {
    const id = payload?.id?.trim();
    if (!id) {
      throw new BadRequestException('period.id ist erforderlich.');
    }
    if (!payload.name?.trim()) {
      throw new BadRequestException('period.name ist erforderlich.');
    }
    if (!payload.type?.trim()) {
      throw new BadRequestException('period.type ist erforderlich.');
    }

    const data: Prisma.TrafficPeriodUncheckedCreateInput = {
      id,
      name: payload.name.trim(),
      type: payload.type,
      description: payload.description ?? null,
      responsible: payload.responsible ?? null,
      timetableYearLabel: payload.timetableYearLabel ?? null,
      tags: payload.tags ?? [],
      updatedAt: new Date(),
    };
    const updateData: Prisma.TrafficPeriodUncheckedUpdateInput = { ...data };
    delete (updateData as { id?: string }).id;

    await this.prisma.$transaction(async (tx) => {
      await tx.trafficPeriod.upsert({
        where: { id },
        create: data,
        update: updateData,
      });

      await tx.trafficPeriodRule.deleteMany({ where: { periodId: id } });

      const rules = payload.rules ?? [];
      if (rules.length) {
        await tx.trafficPeriodRule.createMany({
          data: rules.map((rule) => this.mapRuleInput(id, rule)),
        });
      }
    });

    const record = await this.prisma.trafficPeriod.findUnique({
      where: { id },
      include: { rules: true },
    });
    if (!record) {
      throw new BadRequestException(`Kalender ${id} wurde nicht gefunden.`);
    }
    return this.mapRecord(record, record.rules);
  }

  async deletePeriod(id: string): Promise<void> {
    const trimmed = id?.trim();
    if (!trimmed) {
      throw new BadRequestException('period id ist erforderlich.');
    }
    await this.prisma.trafficPeriod.delete({ where: { id: trimmed } });
  }

  async createFromPayload(payload: TrafficPeriodCreatePayload): Promise<TrafficPeriodDto> {
    if (!payload?.name?.trim()) {
      throw new BadRequestException('name ist erforderlich.');
    }
    if (!payload?.type?.trim()) {
      throw new BadRequestException('type ist erforderlich.');
    }

    const filteredRules = (payload.rules ?? []).filter(
      (rule) => Array.isArray(rule.selectedDates) && rule.selectedDates.length,
    );
    if (!filteredRules.length) {
      throw new BadRequestException('Kalender enthält keine Fahrtage.');
    }

    const yearInfo = this.resolveTimetableYear(filteredRules, payload.timetableYearLabel);
    const tags = new Set(this.normalizeTags(payload.tags) ?? []);
    tags.add(`timetable-year:${yearInfo.label}`);

    const now = new Date().toISOString();
    const periodId = this.generatePeriodId();
    const period: TrafficPeriodDto = {
      id: periodId,
      name: payload.name.trim(),
      type: payload.type,
      description: payload.description,
      responsible: payload.responsible,
      timetableYearLabel: yearInfo.label,
      createdAt: now,
      updatedAt: now,
      rules: this.buildRulesFromPayload(periodId, filteredRules, undefined, yearInfo),
      tags: Array.from(tags),
    };

    return this.upsertPeriod(period);
  }

  async updateFromPayload(
    periodId: string,
    payload: TrafficPeriodCreatePayload,
  ): Promise<TrafficPeriodDto> {
    const trimmed = periodId?.trim();
    if (!trimmed) {
      throw new BadRequestException('periodId ist erforderlich.');
    }

    const existing = await this.getPeriodById(trimmed);
    if (!existing) {
      throw new NotFoundException(`Referenzkalender ${trimmed} wurde nicht gefunden.`);
    }

    if (!payload?.name?.trim()) {
      throw new BadRequestException('name ist erforderlich.');
    }
    if (!payload?.type?.trim()) {
      throw new BadRequestException('type ist erforderlich.');
    }

    const filteredRules = (payload.rules ?? []).filter(
      (rule) => Array.isArray(rule.selectedDates) && rule.selectedDates.length,
    );
    if (!filteredRules.length) {
      throw new BadRequestException('Kalender enthält keine Fahrtage.');
    }

    const yearInfo = this.resolveTimetableYear(
      filteredRules,
      payload.timetableYearLabel ?? existing.timetableYearLabel,
    );

    const tags = new Set(this.normalizeTags(payload.tags) ?? []);
    tags.add(`timetable-year:${yearInfo.label}`);

    const updated: TrafficPeriodDto = {
      ...existing,
      id: trimmed,
      name: payload.name.trim(),
      type: payload.type,
      description: payload.description,
      responsible: payload.responsible,
      timetableYearLabel: yearInfo.label,
      updatedAt: new Date().toISOString(),
      tags: Array.from(tags),
      rules: this.buildRulesFromPayload(trimmed, filteredRules, existing.rules, yearInfo),
    };

    return this.upsertPeriod(updated);
  }

  async createSingleDayPeriod(
    payload: SingleDayTrafficPeriodPayload,
  ): Promise<TrafficPeriodDto> {
    const isoDate = payload?.date?.trim().slice(0, 10);
    if (!isoDate) {
      throw new BadRequestException('date ist erforderlich.');
    }
    const yearInfo = this.getYearBounds(isoDate);
    const rules: TrafficPeriodRulePayload[] = [
      {
        name: `${payload.name} ${isoDate}`,
        year: yearInfo.startYear,
        selectedDates: [isoDate],
        variantType: payload.variantType ?? 'special_day',
        appliesTo: payload.appliesTo ?? 'both',
        variantNumber: '00',
        primary: true,
      },
    ];

    return this.createFromPayload({
      name: payload.name,
      type: payload.type ?? 'standard',
      description: payload.description,
      responsible: payload.responsible,
      tags: payload.tags,
      year: yearInfo.startYear,
      timetableYearLabel: yearInfo.label,
      rules,
    });
  }

  async ensureRailMlPeriod(
    payload: RailMlTrafficPeriodPayload,
  ): Promise<TrafficPeriodDto> {
    const sourceId = payload?.sourceId?.trim();
    if (!sourceId) {
      throw new BadRequestException('sourceId ist erforderlich.');
    }
    const sourceTag = `railml:${sourceId}`;
    const existing = await this.prisma.trafficPeriod.findFirst({
      where: { tags: { has: sourceTag } },
      include: { rules: true },
    });
    if (existing) {
      return this.mapRecord(existing, existing.rules);
    }

    const normalizedBitmap = this.normalizeDaysBitmap(payload.daysBitmap);
    const samples = this.expandDates(
      payload.validityStart,
      payload.validityEnd,
      normalizedBitmap,
    );
    const dateSamples = samples.length
      ? samples
      : [payload.validityStart.slice(0, 10)];
    const yearInfo = this.ensureDatesWithinSameYear(dateSamples);

    const rule: TrafficPeriodRulePayload = {
      name: `RailML ${sourceId}`,
      year: yearInfo.startYear,
      selectedDates: dateSamples,
      variantType: 'series',
      appliesTo: payload.scope ?? 'commercial',
      reason: payload.reason ?? payload.description,
      primary: true,
    };

    const tags = new Set(this.normalizeTags(['railml', sourceTag]) ?? []);
    tags.add(`timetable-year:${yearInfo.label}`);

    return this.createFromPayload({
      name: payload.name,
      type: payload.type ?? 'standard',
      description: payload.description,
      responsible: 'RailML Import',
      tags: Array.from(tags),
      year: yearInfo.startYear,
      timetableYearLabel: yearInfo.label,
      rules: [rule],
    });
  }

  async addVariantRule(
    periodId: string,
    payload: TrafficPeriodVariantPayload,
  ): Promise<TrafficPeriodDto> {
    const period = await this.getPeriodById(periodId);
    if (!period) {
      throw new NotFoundException(`Referenzkalender ${periodId} wurde nicht gefunden.`);
    }

    const normalized = this.normalizeDateList(payload.dates);
    if (!normalized.length) {
      return period;
    }

    const yearInfo = period.timetableYearLabel
      ? this.getYearBoundsForLabel(period.timetableYearLabel)
      : this.ensureDatesWithinSameYear(normalized);

    normalized.forEach((date) => {
      if (!this.isDateWithinYear(date, yearInfo)) {
        throw new BadRequestException(
          `Kalender "${payload.name ?? 'Variante'}" enthält den Fahrtag ${date}, der nicht zum Fahrplanjahr ${yearInfo.label} gehört.`,
        );
      }
    });

    const nextVariantNumber = this.nextVariantNumber(period);
    const rule: TrafficPeriodRuleDto = {
      id: `${periodId}-VAR-${Date.now().toString(36)}`,
      name: payload.name?.trim() || `Variante ${period.rules.length + 1}`,
      daysBitmap: this.buildDaysBitmapFromDates(normalized),
      validityStart: normalized[0],
      validityEnd: normalized[normalized.length - 1],
      includesDates: normalized,
      variantType: payload.variantType ?? 'special_day',
      appliesTo: payload.appliesTo ?? 'both',
      variantNumber: nextVariantNumber,
      reason: payload.reason,
      primary: false,
    };

    const updated: TrafficPeriodDto = {
      ...period,
      updatedAt: new Date().toISOString(),
      rules: [...period.rules, rule],
    };

    return this.upsertPeriod(updated);
  }

  async addExclusionDates(
    periodId: string,
    payload: TrafficPeriodExclusionPayload,
  ): Promise<TrafficPeriodDto> {
    const period = await this.getPeriodById(periodId);
    if (!period) {
      throw new NotFoundException(`Referenzkalender ${periodId} wurde nicht gefunden.`);
    }

    const normalized = this.normalizeDateList(payload.dates);
    if (!normalized.length) {
      return period;
    }

    const rules = period.rules.map((rule, index) => {
      if (!rule.primary && index !== 0) {
        return rule;
      }
      const excludes = new Set(rule.excludesDates ?? []);
      normalized.forEach((date) => excludes.add(date));
      return { ...rule, excludesDates: Array.from(excludes).sort() };
    });

    return this.upsertPeriod({
      ...period,
      updatedAt: new Date().toISOString(),
      rules,
    });
  }

  private mapRuleInput(periodId: string, rule: TrafficPeriodRuleDto): Prisma.TrafficPeriodRuleCreateManyInput {
    return {
      id: rule.id,
      periodId,
      name: rule.name,
      description: rule.description ?? null,
      daysBitmap: rule.daysBitmap ?? '1111111',
      validityStart: this.parseDateOnly(rule.validityStart),
      validityEnd: rule.validityEnd ? this.parseDateOnly(rule.validityEnd) : null,
      includesHolidays: rule.includesHolidays ?? null,
      excludesDates: this.normalizeJsonInput(rule.excludesDates),
      includesDates: this.normalizeJsonInput(rule.includesDates),
      variantType: rule.variantType ?? null,
      appliesTo: rule.appliesTo ?? null,
      variantNumber: rule.variantNumber ?? null,
      reason: rule.reason ?? null,
      isPrimary: rule.primary ?? null,
    };
  }

  private mapRecord(period: TrafficPeriod, rules: TrafficPeriodRule[]): TrafficPeriodDto {
    return {
      id: period.id,
      name: period.name,
      type: period.type as TrafficPeriodDto['type'],
      description: period.description ?? undefined,
      responsible: period.responsible ?? undefined,
      timetableYearLabel: period.timetableYearLabel ?? undefined,
      createdAt: period.createdAt.toISOString(),
      updatedAt: period.updatedAt.toISOString(),
      rules: rules.map((rule) => this.mapRule(rule)),
      tags: period.tags ?? undefined,
    };
  }

  private mapRule(rule: TrafficPeriodRule): TrafficPeriodRuleDto {
    return {
      id: rule.id,
      name: rule.name,
      description: rule.description ?? undefined,
      daysBitmap: rule.daysBitmap,
      validityStart: this.formatDateOnly(rule.validityStart),
      validityEnd: rule.validityEnd ? this.formatDateOnly(rule.validityEnd) : undefined,
      includesHolidays: rule.includesHolidays ?? undefined,
      excludesDates: this.normalizeArray(rule.excludesDates) as string[] | undefined,
      includesDates: this.normalizeArray(rule.includesDates) as string[] | undefined,
      variantType: rule.variantType as TrafficPeriodRuleDto['variantType'] ?? undefined,
      appliesTo: rule.appliesTo as TrafficPeriodRuleDto['appliesTo'] ?? undefined,
      variantNumber: rule.variantNumber ?? undefined,
      reason: rule.reason ?? undefined,
      primary: rule.isPrimary ?? undefined,
    };
  }

  private normalizeJsonInput(
    value: unknown | null | undefined,
  ): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return Prisma.JsonNull;
    }
    return value as Prisma.InputJsonValue;
  }

  private normalizeArray(value: unknown): unknown[] | undefined {
    return Array.isArray(value) ? value : undefined;
  }

  private parseDateOnly(value: string): Date {
    const iso = value.trim().slice(0, 10);
    const parsed = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`Ungültiges Datum: ${value}`);
    }
    return parsed;
  }

  private formatDateOnly(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private generatePeriodId(): string {
    const ts = Date.now().toString(36).toUpperCase();
    this.idCounter = (this.idCounter + 1) % 1679616;
    const suffix = this.idCounter.toString(36).toUpperCase().padStart(4, '0');
    return `TPER-${ts}${suffix}`;
  }

  private normalizeTags(tags?: string[] | null): string[] | undefined {
    if (!tags?.length) {
      return undefined;
    }
    return Array.from(new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length)));
  }

  private normalizeDateList(dates: readonly string[] | null | undefined): string[] {
    if (!dates?.length) {
      return [];
    }
    return Array.from(
      new Set(
        dates
          .map((date) => date?.trim())
          .filter((date): date is string => !!date && /^\d{4}-\d{2}-\d{2}$/.test(date)),
      ),
    ).sort();
  }

  private resolveTimetableYear(
    rules: TrafficPeriodRulePayload[],
    explicitLabel?: string | null,
  ): TimetableYearBounds {
    if (explicitLabel) {
      return this.getYearBoundsForLabel(explicitLabel);
    }
    const dates = rules.flatMap((rule) => rule.selectedDates ?? []);
    if (dates.length) {
      return this.ensureDatesWithinSameYear(dates);
    }
    const fallbackYear = rules[0]?.year ?? new Date().getUTCFullYear();
    return this.getYearBoundsForLabel(
      `${fallbackYear}/${String((fallbackYear + 1) % 100).padStart(2, '0')}`,
    );
  }

  private ensureDatesWithinSameYear(dates: readonly string[]): TimetableYearBounds {
    const normalized = this.normalizeDateList(dates);
    if (!normalized.length) {
      throw new BadRequestException('Es wurden keine Fahrtage angegeben.');
    }
    const first = this.getYearBounds(normalized[0]);
    normalized.forEach((date) => {
      if (!this.isDateWithinYear(date, first)) {
        throw new BadRequestException(
          `Fahrtag ${date} gehört nicht zum Fahrplanjahr ${first.label}. Bitte pro Fahrplanjahr getrennt importieren.`,
        );
      }
    });
    return first;
  }

  private buildRulesFromPayload(
    periodId: string,
    rulePayloads: TrafficPeriodRulePayload[],
    existingRules: TrafficPeriodRuleDto[] = [],
    yearBounds?: TimetableYearBounds,
  ): TrafficPeriodRuleDto[] {
    return rulePayloads.map((payload, index) => {
      const sortedSelectedDates = this.normalizeDateList(payload.selectedDates);
      const sortedExcludedDates = this.normalizeDateList(payload.excludedDates);
      const existingRule = payload.id
        ? existingRules.find((rule) => rule.id === payload.id)
        : existingRules[index];
      const ruleId = payload.id ?? existingRule?.id ?? `${periodId}-R${index + 1}`;
      const defaultStart = yearBounds?.startIso ?? `${payload.year}-01-01`;
      const defaultEnd = yearBounds?.endIso ?? defaultStart;
      const validityStart = sortedSelectedDates[0] ?? defaultStart;
      const validityEnd =
        sortedSelectedDates[sortedSelectedDates.length - 1] ?? defaultEnd;

      if (yearBounds) {
        sortedSelectedDates.forEach((date) => {
          if (!this.isDateWithinYear(date, yearBounds)) {
            throw new BadRequestException(
              `Kalender "${payload.name}" enthält den Fahrtag ${date}, der nicht zum Fahrplanjahr ${yearBounds.label} gehört.`,
            );
          }
        });
      }

      return {
        id: ruleId,
        name: payload.name?.trim() || `Kalender ${payload.year}`,
        daysBitmap: this.buildDaysBitmapFromDates(sortedSelectedDates),
        validityStart,
        validityEnd,
        includesDates: sortedSelectedDates,
        excludesDates: sortedExcludedDates.length ? sortedExcludedDates : undefined,
        variantType: payload.variantType,
        appliesTo: payload.appliesTo,
        variantNumber: payload.variantNumber || '00',
        reason: payload.reason,
        primary: payload.primary ?? index === 0,
      };
    });
  }

  private buildDaysBitmapFromDates(dates: string[]): string {
    if (!dates.length) {
      return '1111111';
    }
    const bits = Array(7).fill('0');
    dates.forEach((iso) => {
      const date = new Date(`${iso}T00:00:00Z`);
      if (Number.isNaN(date.getTime())) {
        return;
      }
      const weekday = date.getUTCDay();
      const index = weekday === 0 ? 6 : weekday - 1;
      bits[index] = '1';
    });
    return bits.join('');
  }

  private nextVariantNumber(period: TrafficPeriodDto): string {
    const numericValues = period.rules
      .map((rule) => Number.parseInt(rule.variantNumber ?? '', 10))
      .filter((value) => Number.isFinite(value));
    const next = numericValues.length ? Math.max(...numericValues) + 1 : 1;
    return next.toString().padStart(2, '0');
  }

  private normalizeDaysBitmap(value: string): string {
    const sanitized = (value ?? '')
      .padEnd(7, '1')
      .slice(0, 7)
      .split('')
      .map((char) => (char === '1' ? '1' : '0'))
      .join('');
    return sanitized.length === 7 ? sanitized : '1111111';
  }

  private expandDates(startIso: string, endIso: string, daysBitmap: string): string[] {
    const start = this.parseDateOnly(startIso);
    const end = this.parseDateOnly(endIso);
    const normalized = this.normalizeDaysBitmap(daysBitmap);
    const dates: string[] = [];
    for (
      let cursor = new Date(start.getTime());
      cursor <= end && dates.length <= 1460;
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    ) {
      const weekday = cursor.getUTCDay();
      const index = weekday === 0 ? 6 : weekday - 1;
      if (normalized[index] === '1') {
        dates.push(cursor.toISOString().slice(0, 10));
      }
    }
    return dates;
  }

  private getYearBounds(value: string | Date): TimetableYearBounds {
    const date = typeof value === 'string' ? this.parseDateOnly(value) : value;
    const decYear = this.resolveDecemberYear(date);
    const start = this.buildYearStart(decYear);
    const end = new Date(this.buildYearStart(decYear + 1).getTime() - 1);
    return this.buildBounds(start, end);
  }

  private getYearBoundsForLabel(label: string): TimetableYearBounds {
    const trimmed = label?.trim();
    const match = /^(\d{4})(?:[/-](\d{2}))?$/.exec(trimmed ?? '');
    if (!match) {
      throw new BadRequestException(`Ungültiges Fahrplanjahr "${label}".`);
    }
    const startYear = Number.parseInt(match[1], 10);
    if (Number.isNaN(startYear)) {
      throw new BadRequestException(`Ungültiges Fahrplanjahr "${label}".`);
    }
    const start = this.buildYearStart(startYear);
    const end = new Date(this.buildYearStart(startYear + 1).getTime() - 1);
    return this.buildBounds(start, end);
  }

  private isDateWithinYear(value: string, year: TimetableYearBounds): boolean {
    const date = this.parseDateOnly(value);
    return date >= year.start && date <= year.end;
  }

  private resolveDecemberYear(date: Date): number {
    const currentYearStart = this.buildYearStart(date.getUTCFullYear());
    if (date >= currentYearStart) {
      return currentYearStart.getUTCFullYear();
    }
    return currentYearStart.getUTCFullYear() - 1;
  }

  private buildYearStart(decemberYear: number): Date {
    const date = new Date(Date.UTC(decemberYear, 11, 10, 0, 0, 0, 0));
    while (date.getUTCDay() !== 0) {
      date.setUTCDate(date.getUTCDate() + 1);
    }
    return date;
  }

  private buildBounds(start: Date, end: Date): TimetableYearBounds {
    const startYear = start.getUTCFullYear();
    const label = `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`;
    return {
      label,
      start,
      end,
      startIso: start.toISOString().slice(0, 10),
      endIso: end.toISOString().slice(0, 10),
      startYear,
      endYear: end.getUTCFullYear(),
    };
  }
}
