import { OrderItem } from '../../models/order-item.model';
import { TrainPlan } from '../../models/train-plan.model';
import {
  TimetableHubRouteMetadata,
  TimetableHubSectionKey,
  TimetableHubService,
  TimetableHubStopSummary,
  TimetableHubTechnicalSummary,
} from '../timetable-hub.service';
import { TimetableYearService } from '../timetable-year.service';

type GetItemTimetableYearFn = (item: OrderItem) => string | null;
type GenerateTimetableRefIdFn = (plan: TrainPlan) => string;

export interface PlanHubDeps {
  timetableHubService: TimetableHubService;
  timetableYearService: TimetableYearService;
  getItemTimetableYear: GetItemTimetableYearFn;
  generateTimetableRefId: GenerateTimetableRefIdFn;
}

export class OrderPlanHubHelper {
  constructor(private readonly deps: PlanHubDeps) {}

  publishPlanToHub(plan: TrainPlan, item: OrderItem, section: TimetableHubSectionKey): void {
    const calendarDays = this.collectPlanCalendarDays(plan);
    if (!calendarDays.length) {
      return;
    }
    const timetableYearLabel =
      item.timetableYearLabel ??
      this.deps.getItemTimetableYear(item) ??
      this.deps.timetableYearService.getYearBounds(
        plan.calendar?.validFrom ?? calendarDays[0],
      ).label;
    const stops = this.planStopsToSummaries(plan);
    this.deps.timetableHubService.registerPlanUpdate({
      refTrainId: this.deps.generateTimetableRefId(plan),
      trainNumber: plan.trainNumber,
      title: plan.title,
      timetableYearLabel,
      calendarDays,
      section,
      stops,
      notes: plan.notes,
      vehicles: plan.rollingStock,
      technical: this.toHubTechnicalSummary(plan.technical),
      routeMetadata: this.toHubRouteMetadata(plan.routeMetadata),
    });
  }

  private collectPlanCalendarDays(plan: TrainPlan): string[] {
    const validFrom =
      plan.calendar?.validFrom ?? this.extractPlanStart(plan)?.slice(0, 10);
    if (!validFrom) {
      return [];
    }
    const validTo = plan.calendar?.validTo ?? validFrom;
    const daysBitmap = plan.calendar?.daysBitmap ?? '1111111';
    return this.expandPlanCalendarDays(validFrom, validTo, daysBitmap);
  }

  private expandPlanCalendarDays(validFrom: string, validTo: string, bitmap: string): string[] {
    const start = new Date(validFrom);
    const end = new Date(validTo);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return [];
    }
    const normalized = bitmap.padEnd(7, '1').slice(0, 7);
    const result: string[] = [];
    const cursor = new Date(start);
    while (cursor <= end && result.length <= 1096) {
      const weekday = cursor.getDay() === 0 ? 6 : cursor.getDay() - 1;
      if (normalized[weekday] === '1') {
        result.push(cursor.toISOString().slice(0, 10));
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return result;
  }

  private planStopsToSummaries(plan: TrainPlan): TimetableHubStopSummary[] {
    let lastHoldReason = plan.stops[0]?.holdReason?.trim() || 'Planhalt';
    let lastResponsible = plan.responsibleRu ?? 'TTT';
    let lastVehicleInfo = plan.rollingStock?.designation ?? 'n/a';
    return plan.stops.map((stop) => {
      const holdReason = stop.holdReason?.trim() || lastHoldReason;
      const responsible = stop.responsibleRu?.trim() || lastResponsible;
      const vehicleInfo = stop.vehicleInfo?.trim() || lastVehicleInfo;
      lastHoldReason = holdReason;
      lastResponsible = responsible;
      lastVehicleInfo = vehicleInfo;
      return {
        sequence: stop.sequence ?? 0,
        locationName: stop.locationName ?? stop.locationCode ?? 'Unbekannt',
        type: stop.type,
        arrivalTime: stop.arrivalTime,
        departureTime: stop.departureTime,
        commercialArrivalTime: stop.arrivalTime,
        commercialDepartureTime: stop.departureTime,
        operationalArrivalTime: stop.arrivalTime,
        operationalDepartureTime: stop.departureTime,
        holdReason,
        responsibleRu: responsible,
        vehicleInfo,
      };
    });
  }

  private toHubTechnicalSummary(
    technical?: TrainPlan['technical'],
  ): TimetableHubTechnicalSummary | undefined {
    if (!technical) {
      return undefined;
    }
    const summary: TimetableHubTechnicalSummary = {
      trainType: technical.trainType,
      maxSpeed: technical.maxSpeed,
      lengthMeters: technical.lengthMeters,
      weightTons: technical.weightTons,
      traction: technical.traction,
      energyType: technical.energyType,
      brakeType: technical.brakeType,
      etcsLevel: technical.etcsLevel,
    };
    const hasValue = Object.values(summary).some((value) => {
      if (typeof value === 'number') {
        return !Number.isNaN(value);
      }
      return Boolean(value && value.toString().trim().length);
    });
    return hasValue ? summary : undefined;
  }

  private toHubRouteMetadata(
    metadata?: TrainPlan['routeMetadata'],
  ): TimetableHubRouteMetadata | undefined {
    if (!metadata) {
      return undefined;
    }
    const normalized: TimetableHubRouteMetadata = {
      originBorderPoint: metadata.originBorderPoint?.trim() || undefined,
      destinationBorderPoint: metadata.destinationBorderPoint?.trim() || undefined,
      borderNotes: metadata.borderNotes?.trim() || undefined,
    };
    if (
      !normalized.originBorderPoint &&
      !normalized.destinationBorderPoint &&
      !normalized.borderNotes
    ) {
      return undefined;
    }
    return normalized;
  }

  private extractPlanStart(plan: TrainPlan): string | undefined {
    const sorted = [...plan.stops].sort((a, b) => a.sequence - b.sequence);
    for (const stop of sorted) {
      if (stop.departureTime) {
        return stop.departureTime;
      }
      if (stop.arrivalTime) {
        return stop.arrivalTime;
      }
    }
    return undefined;
  }
}
