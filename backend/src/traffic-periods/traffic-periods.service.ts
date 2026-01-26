import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, TrafficPeriod, TrafficPeriodRule } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TrafficPeriodDto, TrafficPeriodRuleDto } from './traffic-periods.types';

@Injectable()
export class TrafficPeriodsService {
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
}
