import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, TrainPlan } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleTemplatesService } from '../schedule-templates/schedule-templates.service';
import type { ScheduleTemplateDto, ScheduleTemplateStopDto } from '../schedule-templates/schedule-templates.types';
import { TrafficPeriodsService } from '../traffic-periods/traffic-periods.service';
import type {
  CreateManualPlanPayload,
  CreatePlanModificationPayload,
  CreatePlanVariantPayload,
  CreatePlansFromTemplatePayload,
  TrainPlanDto,
  TrainPlanStopDto,
  TrainPlanTechnicalDto,
} from './train-plans.types';

type StoredStop = {
  id?: string;
  sequence?: number;
  type?: TrainPlanStopDto['type'];
  locationCode?: string;
  locationName?: string;
  countryCode?: string;
  arrivalTime?: string;
  departureTime?: string;
  arrivalOffsetDays?: number;
  departureOffsetDays?: number;
  dwellMinutes?: number;
  activities?: string[];
  platform?: string;
  notes?: string;
  holdReason?: string;
  responsibleRu?: string;
  vehicleInfo?: string;
};

@Injectable()
export class TrainPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: ScheduleTemplatesService,
    private readonly trafficPeriods: TrafficPeriodsService,
  ) {}

  async listPlans(): Promise<TrainPlanDto[]> {
    const records = await this.prisma.trainPlan.findMany({
      orderBy: { updatedAt: 'desc' },
    });
    return records.map((record) => this.mapRecord(record));
  }

  async getPlanById(planId: string): Promise<TrainPlanDto | null> {
    const trimmed = planId?.trim();
    if (!trimmed) {
      return null;
    }
    const record = await this.prisma.trainPlan.findUnique({ where: { id: trimmed } });
    return record ? this.mapRecord(record) : null;
  }

  async createPlansFromTemplate(
    payload: CreatePlansFromTemplatePayload,
  ): Promise<TrainPlanDto[]> {
    const templateId = payload.templateId?.trim();
    if (!templateId) {
      throw new BadRequestException('templateId ist erforderlich.');
    }

    const template = await this.templates.getTemplateById(templateId);
    if (!template) {
      throw new BadRequestException('Vorlage nicht gefunden.');
    }

    const dates = await this.resolveCalendarDates(
      payload.calendarDates,
      payload.trafficPeriodId,
    );
    if (!dates.length) {
      throw new BadRequestException('Referenzkalender enthält keine aktiven Tage.');
    }

    const startMinutes = this.parseTimeToMinutes(payload.startTime);
    if (startMinutes === undefined) {
      throw new BadRequestException('Ungültige Startzeit.');
    }

    const interval = Math.max(1, payload.intervalMinutes);
    const departuresPerDay = Math.max(1, payload.departuresPerDay);

    const calendarRange = {
      start: dates[0],
      end: dates[dates.length - 1] ?? dates[0],
    };
    const baseDate = dates[0];
    const nowIso = new Date().toISOString();
    const planOffsets: number[] = [];

    let minutesWithinDay = startMinutes;
    for (let i = 0; i < departuresPerDay; i += 1) {
      if (minutesWithinDay >= 24 * 60) {
        break;
      }
      planOffsets.push(minutesWithinDay);
      minutesWithinDay += interval;
    }

    if (!planOffsets.length) {
      throw new BadRequestException('Keine Fahrpläne konnten erzeugt werden.');
    }

    const plans = planOffsets.map((offsetMinutes, sequenceIndex) => {
      const departureDate = this.buildDateTime(baseDate, offsetMinutes);
      const trainNumberOverride = this.resolveTrainNumberOverride(
        payload.trainNumberStart,
        payload.trainNumberInterval,
        sequenceIndex,
      );
      return this.buildPlanFromTemplate(
        template,
        payload.trafficPeriodId,
        departureDate,
        sequenceIndex,
        payload.responsibleRu ?? template.responsibleRu,
        nowIso,
        trainNumberOverride,
        calendarRange,
        payload.composition ?? template.composition,
        {
          planVariantType: payload.planVariantType ?? 'productive',
          variantOfPlanId: payload.variantOfPlanId,
          variantLabel: payload.variantLabel,
          simulationId: payload.simulationId,
          simulationLabel: payload.simulationLabel,
        },
      );
    });

    const stored: TrainPlanDto[] = [];
    for (const plan of plans) {
      stored.push(await this.upsertPlan(plan));
    }
    return stored;
  }

  async createManualPlan(payload: CreateManualPlanPayload): Promise<TrainPlanDto> {
    const departureDate = new Date(payload.departure);
    if (Number.isNaN(departureDate.getTime())) {
      throw new BadRequestException('Ungültige Abfahrtszeit für den Fahrplan.');
    }

    const templateId = payload.templateId ?? `TMP-${Date.now().toString(36).toUpperCase()}`;
    const stops = payload.stops.map((stop, index) => this.toTemplateStop(templateId, index, stop));
    if (!stops.length) {
      throw new BadRequestException('Der Fahrplan benötigt mindestens einen Halt.');
    }

    const planStops = this.buildStops(stops, departureDate);
    if (!planStops.length) {
      throw new BadRequestException('Die Haltestellen enthalten keine gültigen Zeiten.');
    }

    const rollingStock = this.buildRollingStockFromComposition(
      payload.composition as ScheduleTemplateDto['composition'] | undefined,
      planStops,
      `${payload.title} – Fahrzeuge`,
    );

    const planId = this.generatePlanId();
    const timestamp = new Date().toISOString();
    const defaultDate = departureDate.toISOString().slice(0, 10);
    const validFrom = payload.validFrom ?? defaultDate;
    const validTo = payload.validTo ?? validFrom;
    const daysBitmap =
      payload.daysBitmap && /^[01]{7}$/.test(payload.daysBitmap)
        ? payload.daysBitmap
        : '1111111';

    const plan: TrainPlanDto = {
      id: planId,
      title: payload.title,
      trainNumber: payload.trainNumber,
      pathRequestId: `PR-${planId}`,
      status: 'not_ordered',
      responsibleRu: payload.responsibleRu,
      calendar: {
        validFrom,
        validTo,
        daysBitmap,
      },
      trafficPeriodId: payload.trafficPeriodId,
      stops: planStops,
      technical: {
        trainType: 'Passenger',
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      source: {
        type: 'external',
        name: payload.sourceName ?? payload.title,
        templateId,
      },
      linkedOrderItemId: undefined,
      notes: payload.notes,
      rollingStock,
      planVariantType: payload.planVariantType ?? 'productive',
      variantOfPlanId: payload.variantOfPlanId,
      variantLabel: payload.variantLabel,
      simulationId: payload.simulationId,
      simulationLabel: payload.simulationLabel,
    };

    return this.upsertPlan(plan);
  }

  async createPlanModification(
    payload: CreatePlanModificationPayload,
  ): Promise<TrainPlanDto> {
    const original = await this.getPlanById(payload.originalPlanId);
    if (!original) {
      throw new BadRequestException('Originalfahrplan nicht gefunden.');
    }

    const timestamp = new Date().toISOString();
    const newPlanId = this.generatePlanId();
    const sourceStops = payload.stops?.length
      ? payload.stops
      : original.stops.map((stop) => ({
          sequence: stop.sequence,
          type: stop.type,
          locationCode: stop.locationCode,
          locationName: stop.locationName,
          countryCode: stop.countryCode,
          arrivalTime: stop.arrivalTime,
          departureTime: stop.departureTime,
          arrivalOffsetDays: stop.arrivalOffsetDays,
          departureOffsetDays: stop.departureOffsetDays,
          dwellMinutes: stop.dwellMinutes,
          activities: [...stop.activities],
          platform: stop.platform,
          notes: stop.notes,
        }));

    const clonedStops: TrainPlanStopDto[] = sourceStops
      .sort((a, b) => a.sequence - b.sequence)
      .map((stop, index) => ({
        id: `${newPlanId}-STOP-${String(index + 1).padStart(3, '0')}`,
        sequence: index + 1,
        type: stop.type,
        locationCode: stop.locationCode,
        locationName: stop.locationName,
        countryCode: stop.countryCode,
        arrivalTime: stop.arrivalTime,
        departureTime: stop.departureTime,
        arrivalOffsetDays: stop.arrivalOffsetDays,
        departureOffsetDays: stop.departureOffsetDays,
        dwellMinutes: stop.dwellMinutes,
        activities: stop.activities,
        platform: stop.platform,
        notes: stop.notes,
      }));

    const plan: TrainPlanDto = {
      ...original,
      id: newPlanId,
      title: payload.title,
      trainNumber: payload.trainNumber,
      pathRequestId: `PR-${newPlanId}`,
      status: 'modification_request',
      responsibleRu: payload.responsibleRu,
      calendar: {
        validFrom: payload.calendar.validFrom,
        validTo: payload.calendar.validTo,
        daysBitmap: payload.calendar.daysBitmap,
      },
      trafficPeriodId: payload.trafficPeriodId,
      referencePlanId: original.referencePlanId ?? original.id,
      stops: clonedStops,
      technical: payload.technical ?? original.technical,
      routeMetadata: payload.routeMetadata ?? original.routeMetadata,
      createdAt: timestamp,
      updatedAt: timestamp,
      linkedOrderItemId: undefined,
      notes: payload.notes ?? original.notes,
      rollingStock: payload.rollingStock ?? original.rollingStock,
      planVariantType: payload.planVariantType ?? original.planVariantType ?? 'productive',
      variantOfPlanId: payload.variantOfPlanId ?? original.variantOfPlanId,
      variantLabel: payload.variantLabel ?? original.variantLabel,
      simulationId: payload.simulationId ?? original.simulationId,
      simulationLabel: payload.simulationLabel ?? original.simulationLabel,
    };

    return this.upsertPlan(plan);
  }

  async createPlanVariant(
    payload: CreatePlanVariantPayload,
  ): Promise<TrainPlanDto> {
    const original = await this.getPlanById(payload.originalPlanId);
    if (!original) {
      throw new BadRequestException('Originalfahrplan nicht gefunden.');
    }

    const timestamp = new Date().toISOString();
    const newPlanId = this.generatePlanId();
    const clonedStops = original.stops.map((stop, index) => ({
      ...stop,
      id: `${newPlanId}-STOP-${String(index + 1).padStart(3, '0')}`,
    }));

    const plan: TrainPlanDto = {
      ...original,
      id: newPlanId,
      pathRequestId: `PR-${newPlanId}`,
      status: 'not_ordered',
      linkedOrderItemId: undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
      stops: clonedStops,
      planVariantType: payload.type,
      variantOfPlanId: original.id,
      variantLabel: payload.label ?? (payload.type === 'simulation' ? 'Simulation' : 'Produktiv'),
      simulationId: original.simulationId,
      simulationLabel: original.simulationLabel,
    };

    return this.upsertPlan(plan);
  }

  async upsertPlan(payload: TrainPlanDto): Promise<TrainPlanDto> {
    const id = payload?.id?.trim();
    if (!id) {
      throw new BadRequestException('plan.id ist erforderlich.');
    }
    if (!payload.title?.trim()) {
      throw new BadRequestException('plan.title ist erforderlich.');
    }
    if (!payload.trainNumber?.trim()) {
      throw new BadRequestException('plan.trainNumber ist erforderlich.');
    }

    const calendar = payload.calendar;
    if (!calendar?.validFrom) {
      throw new BadRequestException('plan.calendar.validFrom ist erforderlich.');
    }

    const data: Prisma.TrainPlanUncheckedCreateInput = {
      id,
      title: payload.title.trim(),
      description: null,
      trainNumber: payload.trainNumber.trim(),
      status: payload.status ?? 'not_ordered',
      responsibleRu: payload.responsibleRu?.trim() || 'Unbekannt',
      participants: this.normalizeJsonInput(payload.participants),
      calendarValidFrom: this.parseDateOnly(calendar.validFrom),
      calendarValidTo: calendar.validTo
        ? this.parseDateOnly(calendar.validTo)
        : null,
      calendarDaysBitmap: calendar.daysBitmap?.trim() || '1111111',
      trafficPeriodId: payload.trafficPeriodId ?? null,
      referencePlanId: payload.referencePlanId ?? null,
      stops: (payload.stops ?? []) as unknown as Prisma.InputJsonValue,
      technical: this.normalizeJsonInput(payload.technical),
      routeMetadata: this.normalizeJsonInput(payload.routeMetadata),
      sourceType: payload.source?.type ?? 'external',
      sourceName: payload.source?.name ?? payload.title,
      sourceTemplateId: payload.source?.templateId ?? null,
      sourceSystemId: payload.source?.systemId ?? null,
      linkedOrderItemId: payload.linkedOrderItemId ?? null,
      notes: payload.notes ?? null,
      rollingStock: this.normalizeJsonInput(payload.rollingStock),
      planVariantType: payload.planVariantType ?? null,
      variantOfPlanId: payload.variantOfPlanId ?? null,
      variantLabel: payload.variantLabel ?? null,
      simulationId: payload.simulationId ?? null,
      simulationLabel: payload.simulationLabel ?? null,
      updatedAt: new Date(),
    };
    const updateData: Prisma.TrainPlanUncheckedUpdateInput = { ...data };
    delete (updateData as { id?: string }).id;

    const record = await this.prisma.trainPlan.upsert({
      where: { id },
      create: data,
      update: updateData,
    });

    return this.mapRecord(record);
  }

  async deletePlan(id: string): Promise<void> {
    const trimmed = id?.trim();
    if (!trimmed) {
      throw new BadRequestException('plan id ist erforderlich.');
    }
    await this.prisma.trainPlan.delete({ where: { id: trimmed } });
  }

  private mapRecord(record: TrainPlan): TrainPlanDto {
    const stops = this.mapStops(record.stops, record.id);
    const calendarValidFrom = this.formatDateOnly(record.calendarValidFrom as Date);
    const calendarValidTo = record.calendarValidTo
      ? this.formatDateOnly(record.calendarValidTo as Date)
      : undefined;

    const technical = this.normalizeTechnical(record.technical as TrainPlanTechnicalDto | null | undefined);

    return {
      id: record.id,
      title: record.title,
      trainNumber: record.trainNumber,
      pathRequestId: `PR-${record.id}`,
      status: record.status as TrainPlanDto['status'],
      responsibleRu: record.responsibleRu,
      participants: this.normalizeArray(record.participants) as TrainPlanDto['participants'],
      calendar: {
        validFrom: calendarValidFrom,
        validTo: calendarValidTo ?? undefined,
        daysBitmap: record.calendarDaysBitmap ?? '1111111',
      },
      trafficPeriodId: record.trafficPeriodId ?? undefined,
      referencePlanId: record.referencePlanId ?? undefined,
      stops,
      technical,
      routeMetadata: this.normalizeObject(record.routeMetadata) as TrainPlanDto['routeMetadata'],
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      source: {
        type: this.normalizeSourceType(record.sourceType),
        name: record.sourceName ?? record.title,
        templateId: record.sourceTemplateId ?? undefined,
        systemId: record.sourceSystemId ?? undefined,
      },
      linkedOrderItemId: record.linkedOrderItemId ?? undefined,
      notes: record.notes ?? undefined,
      rollingStock: this.normalizeObject(record.rollingStock),
      planVariantType: (record.planVariantType as TrainPlanDto['planVariantType']) ?? undefined,
      variantOfPlanId: record.variantOfPlanId ?? undefined,
      variantLabel: record.variantLabel ?? undefined,
      simulationId: record.simulationId ?? undefined,
      simulationLabel: record.simulationLabel ?? undefined,
    };
  }

  private mapStops(raw: Prisma.InputJsonValue | null | undefined, planId: string): TrainPlanStopDto[] {
    const list = Array.isArray(raw) ? (raw as StoredStop[]) : [];
    if (!list.length) {
      return [];
    }
    const sorted = [...list].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    const lastIndex = sorted.length - 1;
    return sorted.map((stop, index) => {
      const sequence = stop.sequence ?? index + 1;
      const type =
        stop.type ??
        (index === 0
          ? 'origin'
          : index === lastIndex
            ? 'destination'
            : 'intermediate');
      const locationName = this.normalizeString(stop.locationName) ?? `Halt ${sequence}`;
      const locationCode =
        this.normalizeString(stop.locationCode) ??
        this.normalizeString(locationName) ??
        `LOC-${sequence}`;
      return {
        id: stop.id ?? `${planId}-STOP-${String(sequence).padStart(3, '0')}`,
        sequence,
        type,
        locationCode,
        locationName,
        countryCode: stop.countryCode ?? undefined,
        arrivalTime: stop.arrivalTime ?? undefined,
        departureTime: stop.departureTime ?? undefined,
        arrivalOffsetDays: stop.arrivalOffsetDays ?? undefined,
        departureOffsetDays: stop.departureOffsetDays ?? undefined,
        dwellMinutes: stop.dwellMinutes ?? undefined,
        activities: Array.isArray(stop.activities) ? stop.activities : [],
        platform: stop.platform ?? undefined,
        notes: stop.notes ?? undefined,
        holdReason: stop.holdReason ?? undefined,
        responsibleRu: stop.responsibleRu ?? undefined,
        vehicleInfo: stop.vehicleInfo ?? undefined,
      };
    });
  }

  private buildPlanFromTemplate(
    template: ScheduleTemplateDto,
    trafficPeriodId: string | undefined,
    departureDate: Date,
    sequence: number,
    responsibleRu: string,
    timestamp: string,
    trainNumberOverride?: string,
    calendarRange?: { start: string; end: string },
    compositionOverride?: ScheduleTemplateDto['composition'],
    variant?: {
      planVariantType?: 'productive' | 'simulation';
      variantOfPlanId?: string;
      variantLabel?: string;
      simulationId?: string;
      simulationLabel?: string;
    },
  ): TrainPlanDto {
    const planId = this.generatePlanId();
    const trainNumber =
      trainNumberOverride ?? this.generateTrainNumber(template.trainNumber, sequence);
    const stops = this.buildStops(template.stops, departureDate);
    const rollingStock = this.buildRollingStockFromComposition(
      compositionOverride ?? template.composition,
      stops,
      `${template.title} – Fahrzeuge`,
    );
    const calendarStart = calendarRange?.start ?? departureDate.toISOString().slice(0, 10);
    const calendarEnd = calendarRange?.end ?? calendarStart;

    return {
      id: planId,
      title: `${template.title} ${calendarStart} ${this.formatTimeLabel(departureDate)}`,
      trainNumber,
      pathRequestId: `PR-${planId}`,
      status: 'not_ordered',
      responsibleRu,
      calendar: {
        validFrom: calendarStart,
        validTo: calendarEnd,
        daysBitmap: '1111111',
      },
      trafficPeriodId,
      stops,
      technical: {
        trainType: 'Passenger',
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      source: {
        type: 'rollout',
        name: template.title,
        templateId: template.id,
      },
      linkedOrderItemId: undefined,
      notes: undefined,
      rollingStock,
      planVariantType: variant?.planVariantType ?? 'productive',
      variantOfPlanId: variant?.variantOfPlanId,
      variantLabel: variant?.variantLabel,
      simulationId: variant?.simulationId,
      simulationLabel: variant?.simulationLabel,
    };
  }

  private buildRollingStockFromComposition(
    composition: ScheduleTemplateDto['composition'] | undefined,
    stops: TrainPlanStopDto[],
    designation?: string,
  ): unknown {
    if (!composition?.base?.length) {
      return undefined;
    }

    const segments = composition.base.map((unit, index) => ({
      position: index + 1,
      vehicleTypeId: unit.type,
      count: unit.count,
      setId: `SET-${index + 1}`,
      setLabel: unit.label ?? unit.type,
      remarks: unit.note ?? undefined,
    }));

    const operations =
      composition.changes?.map((change, opIndex) => {
        const stop = stops.find((entry) => entry.sequence === change.stopIndex);
        const stopId = stop?.id;
        if (!stopId) {
          return null;
        }
        const vehicleLabel = change.vehicles
          .map((vehicle) => `${vehicle.count}× ${vehicle.type}`)
          .join(', ');
        return {
          stopId,
          type: change.action === 'attach' ? 'join' : 'split',
          setIds: [`SET-${opIndex + 1}`],
          remarks: change.note ?? vehicleLabel,
        };
      }) ?? [];
    const normalizedOperations = operations.filter((entry) => !!entry);

    const remarks =
      composition.changes?.length
        ? composition.changes
            .map((change) => this.describeCompositionChange(change, stops))
            .filter((summary): summary is string => !!summary)
            .join(' | ')
        : undefined;

    return {
      designation: designation ?? 'Fahrzeuge',
      remarks,
      segments,
      operations: normalizedOperations.length ? normalizedOperations : undefined,
    };
  }

  private describeCompositionChange(
    change: NonNullable<ScheduleTemplateDto['composition']>['changes'][number],
    stops: TrainPlanStopDto[],
  ): string | undefined {
    if (!change.vehicles.length) {
      return undefined;
    }
    const stop = stops.find((entry) => entry.sequence === change.stopIndex);
    const stopLabel = stop?.locationName ?? `Halt ${change.stopIndex}`;
    const actionLabel = change.action === 'attach' ? 'Ankuppeln' : 'Abkuppeln';
    const vehicles = change.vehicles
      .map((vehicle) => `${vehicle.count}× ${vehicle.type}`)
      .join(', ');
    const note = change.note ? ` – ${change.note}` : '';
    return `${actionLabel}: ${vehicles} @ ${stopLabel}${note}`;
  }

  private async resolveCalendarDates(
    overrideDates: string[] | undefined,
    trafficPeriodId: string | undefined,
  ): Promise<string[]> {
    if (overrideDates?.length) {
      return Array.from(
        new Set(
          overrideDates
            .map((date) => date?.trim())
            .filter((date): date is string => !!date),
        ),
      ).sort();
    }

    if (!trafficPeriodId) {
      return [];
    }

    const period = await this.trafficPeriods.getPeriodById(trafficPeriodId);
    if (!period) {
      throw new BadRequestException('Referenzkalender nicht gefunden');
    }

    return Array.from(
      new Set(period.rules.flatMap((rule) => rule.includesDates ?? [])),
    )
      .filter((date): date is string => !!date)
      .sort();
  }

  private toTemplateStop(
    templateId: string,
    index: number,
    stop: CreateManualPlanPayload['stops'][number] | ScheduleTemplateStopDto,
  ): ScheduleTemplateStopDto {
    if ('id' in stop && 'sequence' in stop) {
      return stop as ScheduleTemplateStopDto;
    }

    const payload = stop as CreateManualPlanPayload['stops'][number];
    return {
      id: `${templateId}-ST-${String(index + 1).padStart(3, '0')}`,
      sequence: index + 1,
      type: payload.type,
      locationCode: payload.locationCode,
      locationName: payload.locationName,
      countryCode: payload.countryCode,
      arrival:
        payload.arrivalEarliest || payload.arrivalLatest
          ? {
              earliest: payload.arrivalEarliest,
              latest: payload.arrivalLatest,
            }
          : undefined,
      departure:
        payload.departureEarliest || payload.departureLatest
          ? {
              earliest: payload.departureEarliest,
              latest: payload.departureLatest,
            }
          : undefined,
      offsetDays: payload.offsetDays,
      dwellMinutes: payload.dwellMinutes,
      activities:
        payload.activities && payload.activities.length
          ? payload.activities
          : ['0001'],
      platformWish: payload.platformWish,
      notes: payload.notes,
    };
  }

  private buildStops(stops: ScheduleTemplateStopDto[], departureDate: Date): TrainPlanStopDto[] {
    const baseMinutes = this.extractReferenceMinutes(stops) ?? 0;
    return stops.map((stop) => {
      const arrivalMinutes = this.extractTime(stop.arrival?.earliest ?? stop.arrival?.latest);
      const departureMinutes = this.extractTime(
        stop.departure?.earliest ?? stop.departure?.latest,
      );

      const arrival =
        arrivalMinutes !== undefined
          ? this.addMinutes(departureDate, arrivalMinutes - baseMinutes)
          : undefined;
      const departure =
        departureMinutes !== undefined
          ? this.addMinutes(departureDate, departureMinutes - baseMinutes)
          : undefined;

      return {
        id: this.generateStopId(stop, arrival ?? departure ?? departureDate),
        sequence: stop.sequence,
        type: stop.type,
        locationCode: stop.locationCode,
        locationName: stop.locationName,
        countryCode: stop.countryCode,
        arrivalTime: arrival ? arrival.toISOString() : undefined,
        departureTime: departure ? departure.toISOString() : undefined,
        arrivalOffsetDays: arrival ? this.offsetDays(departureDate, arrival) : undefined,
        departureOffsetDays: departure
          ? this.offsetDays(departureDate, departure)
          : undefined,
        dwellMinutes: stop.dwellMinutes,
        activities: stop.activities,
        platform: stop.platformWish,
        notes: stop.notes,
      };
    });
  }

  private extractReferenceMinutes(stops: ScheduleTemplateStopDto[]): number | undefined {
    for (const stop of stops) {
      const time = this.extractTime(stop.departure?.earliest ?? stop.arrival?.earliest);
      if (time !== undefined) {
        return time;
      }
    }
    return undefined;
  }

  private extractTime(time: string | undefined): number | undefined {
    if (!time) {
      return undefined;
    }
    return this.parseTimeToMinutes(time);
  }

  private parseTimeToMinutes(time: string): number | undefined {
    const match = /^([0-9]{1,2}):([0-9]{2})$/.exec(time);
    if (!match) {
      return undefined;
    }
    const hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2], 10);
    return hours * 60 + minutes;
  }

  private buildDateTime(dateIso: string, minutes: number): Date {
    const [year, month, day] = dateIso.split('-').map(Number);
    const result = new Date(year, month - 1, day, 0, 0, 0, 0);
    result.setMinutes(minutes);
    return result;
  }

  private addMinutes(reference: Date, delta: number): Date {
    const result = new Date(reference.getTime());
    result.setMinutes(result.getMinutes() + delta);
    return result;
  }

  private offsetDays(base: Date, target: Date): number | undefined {
    const diff = target.getTime() - base.getTime();
    const days = Math.round(diff / 86400000);
    return days === 0 ? undefined : days;
  }

  private generatePlanId(): string {
    return `TP-${Date.now().toString(36).toUpperCase()}-${Math.random()
      .toString(36)
      .slice(2, 6)
      .toUpperCase()}`;
  }

  private generateTrainNumber(base: string, sequence: number): string {
    const suffix = (sequence + 1).toString().padStart(3, '0');
    return `${base}-${suffix}`;
  }

  private resolveTrainNumberOverride(
    start?: number,
    interval?: number,
    sequenceIndex = 0,
  ): string | undefined {
    if (typeof start !== 'number' || Number.isNaN(start)) {
      return undefined;
    }
    const step = Math.max(1, interval ?? 1);
    const value = start + sequenceIndex * step;
    return value.toString();
  }

  private generateStopId(stop: ScheduleTemplateStopDto, date: Date): string {
    return `${stop.locationCode}-${date.getTime()}`;
  }

  private formatTimeLabel(date: Date): string {
    return date.toTimeString().slice(0, 5);
  }

  private normalizeTechnical(value?: TrainPlanTechnicalDto | null): TrainPlanTechnicalDto {
    if (value && typeof value === 'object') {
      return {
        trainType: value.trainType || 'Passenger',
        maxSpeed: value.maxSpeed ?? undefined,
        weightTons: value.weightTons ?? undefined,
        lengthMeters: value.lengthMeters ?? undefined,
        traction: value.traction ?? undefined,
        energyType: value.energyType ?? undefined,
        brakeType: value.brakeType ?? undefined,
        etcsLevel: value.etcsLevel ?? undefined,
      };
    }
    return { trainType: 'Passenger' };
  }

  private normalizeString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }

  private normalizeSourceType(value: string | null): TrainPlanDto['source']['type'] {
    switch (value) {
      case 'rollout':
      case 'ttt':
      case 'external':
        return value;
      default:
        return 'external';
    }
  }

  private normalizeJsonInput(
    value: unknown | null | undefined,
  ): Prisma.InputJsonValue | Prisma.JsonNullValueInput | undefined {
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

  private normalizeObject(value: unknown): unknown | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }
    if (typeof value !== 'object') {
      return undefined;
    }
    return value as Record<string, unknown>;
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
