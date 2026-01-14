import type { AssistantContextResource } from './assistant-context.types';
import type {
  HomeDepot,
  OperationalPoint,
  OpReplacementStopLink,
  Personnel,
  PersonnelPool,
  PersonnelSite,
  PersonnelService,
  PersonnelServicePool,
  ReplacementEdge,
  ReplacementRoute,
  ReplacementStop,
  SectionOfLine,
  TemporalValue,
  TransferEdge,
  Vehicle,
  VehicleComposition,
  VehiclePool,
  VehicleService,
  VehicleServicePool,
  VehicleType,
} from '../planning/planning.types';
import type { PlanningVariantRecord } from '../variants/variants.repository';

export class AssistantContextSerializer {
  serializeEntry(
    resource: AssistantContextResource,
    entry: unknown,
  ): Record<string, unknown> {
    switch (resource) {
      case 'personnelServicePools': {
        const pool = entry as PersonnelServicePool;
        return {
          name: pool.name,
          description: pool.description,
          homeDepotId: pool.homeDepotId ?? undefined,
          serviceCount: Array.isArray(pool.serviceIds)
            ? pool.serviceIds.length
            : undefined,
          shiftCoordinator: pool.shiftCoordinator ?? undefined,
          contactEmail: pool.contactEmail ?? undefined,
        };
      }
      case 'personnelServices': {
        const service = entry as PersonnelService;
        return {
          name: service.name,
          startTime: service.startTime,
          endTime: service.endTime,
          isNightService: service.isNightService,
          maxDailyInstances: service.maxDailyInstances,
          maxResourcesPerInstance: service.maxResourcesPerInstance,
        };
      }
      case 'personnelPools': {
        const pool = entry as PersonnelPool;
        return {
          name: pool.name,
          description: pool.description,
          homeDepotId: pool.homeDepotId ?? undefined,
          locationCode: pool.locationCode ?? undefined,
          personnelCount: Array.isArray(pool.personnelIds)
            ? pool.personnelIds.length
            : undefined,
        };
      }
      case 'homeDepots': {
        const depot = entry as HomeDepot;
        return {
          name: depot.name,
          description: depot.description,
          siteCount: Array.isArray(depot.siteIds)
            ? depot.siteIds.length
            : undefined,
          breakSiteCount: Array.isArray(depot.breakSiteIds)
            ? depot.breakSiteIds.length
            : undefined,
          shortBreakSiteCount: Array.isArray(depot.shortBreakSiteIds)
            ? depot.shortBreakSiteIds.length
            : undefined,
          overnightSiteCount: Array.isArray(depot.overnightSiteIds)
            ? depot.overnightSiteIds.length
            : undefined,
        };
      }
      case 'vehicleServices': {
        const service = entry as VehicleService;
        return {
          name: service.name,
          startTime: service.startTime,
          endTime: service.endTime,
          isOvernight: service.isOvernight,
          primaryRoute: service.primaryRoute,
        };
      }
      case 'vehicleServicePools': {
        const pool = entry as VehicleServicePool;
        return {
          name: pool.name,
          description: pool.description,
          dispatcher: pool.dispatcher ?? undefined,
          serviceCount: Array.isArray(pool.serviceIds)
            ? pool.serviceIds.length
            : undefined,
        };
      }
      case 'vehiclePools': {
        const pool = entry as VehiclePool;
        return {
          name: pool.name,
          description: pool.description,
          depotManager: pool.depotManager ?? undefined,
          vehicleCount: Array.isArray(pool.vehicleIds)
            ? pool.vehicleIds.length
            : undefined,
        };
      }
      case 'personnel': {
        const person = entry as Personnel;
        const firstName = this.resolveTemporalString(person.firstName);
        const lastName = person.lastName ?? '';
        const fullName =
          this.cleanText([firstName, lastName].filter(Boolean).join(' ')) ??
          this.cleanText(person.name) ??
          person.id;
        return {
          fullName,
          qualifications: person.qualifications,
          serviceCount: Array.isArray(person.serviceIds)
            ? person.serviceIds.length
            : undefined,
          poolId: person.poolId ?? undefined,
        };
      }
      case 'vehicles': {
        const vehicle = entry as Vehicle;
        return {
          vehicleNumber:
            this.cleanText(vehicle.vehicleNumber ?? vehicle.name) ?? vehicle.id,
          typeId: vehicle.typeId ?? undefined,
          depot: vehicle.depot ?? undefined,
          description: vehicle.description,
          serviceCount: Array.isArray(vehicle.serviceIds)
            ? vehicle.serviceIds.length
            : undefined,
          poolId: vehicle.poolId ?? undefined,
        };
      }
      case 'vehicleTypes': {
        const type = entry as VehicleType;
        return {
          label: type.label,
          category: type.category ?? undefined,
          capacity: type.capacity ?? undefined,
          maxSpeed: type.maxSpeed ?? undefined,
          energyType: type.energyType ?? undefined,
          manufacturer: type.manufacturer ?? undefined,
          lengthMeters: type.lengthMeters ?? undefined,
        };
      }
      case 'vehicleCompositions': {
        const composition = entry as VehicleComposition;
        const entries = composition.entries ?? [];
        const entrySummary = entries
          .map((item) => `${item.typeId}x${item.quantity}`)
          .join(', ');
        return {
          name: composition.name,
          entrySummary: entrySummary || undefined,
          entryCount: entries.length || undefined,
          turnaroundBuffer: composition.turnaroundBuffer ?? undefined,
        };
      }
      case 'timetableYears': {
        const record = entry as {
          label?: string;
          simulationCount?: number;
          variantCount?: number;
        };
        return {
          label: record.label,
          simulationCount: record.simulationCount ?? undefined,
          variantCount: record.variantCount ?? undefined,
        };
      }
      case 'simulations': {
        const simulation = entry as PlanningVariantRecord;
        return {
          label: simulation.label,
          timetableYearLabel: simulation.timetableYearLabel,
          description: simulation.description ?? undefined,
        };
      }
      case 'operationalPoints': {
        const point = entry as OperationalPoint;
        return {
          uniqueOpId: point.uniqueOpId,
          name: point.name,
          countryCode: point.countryCode,
          opType: point.opType,
        };
      }
      case 'sectionsOfLine': {
        const section = entry as SectionOfLine;
        return {
          solId: section.solId,
          startUniqueOpId: section.startUniqueOpId,
          endUniqueOpId: section.endUniqueOpId,
          lengthKm: section.lengthKm ?? undefined,
          nature: section.nature,
        };
      }
      case 'personnelSites': {
        const site = entry as PersonnelSite;
        return {
          siteId: site.siteId,
          name: site.name,
          siteType: site.siteType,
          uniqueOpId: site.uniqueOpId ?? undefined,
        };
      }
      case 'replacementStops': {
        const stop = entry as ReplacementStop;
        return {
          replacementStopId: stop.replacementStopId,
          name: stop.name,
          stopCode: stop.stopCode ?? undefined,
          nearestUniqueOpId: stop.nearestUniqueOpId ?? undefined,
        };
      }
      case 'replacementRoutes': {
        const route = entry as ReplacementRoute;
        return {
          replacementRouteId: route.replacementRouteId,
          name: route.name,
          operator: route.operator ?? undefined,
        };
      }
      case 'replacementEdges': {
        const edge = entry as ReplacementEdge;
        return {
          replacementEdgeId: edge.replacementEdgeId,
          replacementRouteId: edge.replacementRouteId,
          fromStopId: edge.fromStopId,
          toStopId: edge.toStopId,
          seq: edge.seq,
          avgDurationSec: edge.avgDurationSec ?? undefined,
        };
      }
      case 'opReplacementStopLinks': {
        const link = entry as OpReplacementStopLink;
        return {
          linkId: link.linkId,
          uniqueOpId: link.uniqueOpId,
          replacementStopId: link.replacementStopId,
          relationType: link.relationType,
        };
      }
      case 'transferEdges': {
        const edge = entry as TransferEdge;
        return {
          transferId: edge.transferId,
          from: this.formatTransferNode(edge.from),
          to: this.formatTransferNode(edge.to),
          mode: edge.mode,
          avgDurationSec: edge.avgDurationSec ?? undefined,
          bidirectional: edge.bidirectional,
        };
      }
      default:
        return {};
    }
  }

  private formatTransferNode(node: TransferEdge['from']): string {
    if (node.kind === 'OP') {
      return `OP:${node.uniqueOpId}`;
    }
    if (node.kind === 'PERSONNEL_SITE') {
      return `SITE:${node.siteId}`;
    }
    return `STOP:${node.replacementStopId}`;
  }

  private resolveTemporalString(
    value?: string | TemporalValue<string>[],
  ): string | undefined {
    if (!value) {
      return undefined;
    }
    if (typeof value === 'string') {
      return value;
    }
    if (!Array.isArray(value)) {
      return undefined;
    }
    for (const entry of value) {
      if (entry && typeof entry.value === 'string') {
        return entry.value;
      }
    }
    return undefined;
  }

  private cleanText(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  }
}
