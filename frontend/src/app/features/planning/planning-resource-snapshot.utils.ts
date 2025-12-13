import type { ResourceSnapshotDto } from '../../core/api/planning-resource-api.service';
import type { Resource } from '../../models/resource';
import type { TemporalValue } from '../../models/master-data';

export function flattenResourceSnapshot(snapshot: ResourceSnapshotDto): Resource[] {
  const resources: Resource[] = [];
  const personnelPoolNames = buildPoolNameMap(snapshot.personnelPools);
  const personnelServicePoolNames = buildPoolNameMap(snapshot.personnelServicePools);
  const vehiclePoolNames = buildPoolNameMap(snapshot.vehiclePools);
  const vehicleServicePoolNames = buildPoolNameMap(snapshot.vehicleServicePools);

  snapshot.personnelServices.forEach((service) =>
    resources.push(personnelServiceToResource(service, personnelServicePoolNames)),
  );
  snapshot.vehicleServices.forEach((service) =>
    resources.push(vehicleServiceToResource(service, vehicleServicePoolNames)),
  );
  snapshot.personnel.forEach((person) => resources.push(personnelToResource(person, personnelPoolNames)));
  snapshot.vehicles.forEach((vehicle) => resources.push(vehicleToResource(vehicle, vehiclePoolNames)));

  return resources;
}

function buildPoolNameMap<T extends { id: string; name: string | undefined | null }>(entries: T[]): Map<string, string> {
  const map = new Map<string, string>();
  entries.forEach((entry) => {
    if (entry.id) {
      map.set(entry.id, entry.name?.toString() ?? '');
    }
  });
  return map;
}

function personnelServiceToResource(
  service: ResourceSnapshotDto['personnelServices'][number],
  poolNames: Map<string, string>,
): Resource {
  const poolName = resolvePoolName(poolNames, service.poolId);
  return {
    id: service.id,
    name: service.name?.trim().length ? service.name : service.id,
    kind: 'personnel-service',
    dailyServiceCapacity: service.maxDailyInstances ?? undefined,
    attributes: buildResourceAttributes(service, 'personnel-service', poolName),
  };
}

function vehicleServiceToResource(
  service: ResourceSnapshotDto['vehicleServices'][number],
  poolNames: Map<string, string>,
): Resource {
  const poolName = resolvePoolName(poolNames, service.poolId);
  return {
    id: service.id,
    name: service.name?.trim().length ? service.name : service.id,
    kind: 'vehicle-service',
    dailyServiceCapacity: service.maxDailyInstances ?? undefined,
    attributes: buildResourceAttributes(service, 'vehicle-service', poolName),
  };
}

function personnelToResource(
  person: ResourceSnapshotDto['personnel'][number],
  poolNames: Map<string, string>,
): Resource {
  const poolName = resolvePoolName(poolNames, person.poolId);
  return {
    id: person.id,
    name: formatPersonnelName(person),
    kind: 'personnel',
    attributes: buildResourceAttributes(person, 'personnel', poolName),
  };
}

function vehicleToResource(
  vehicle: ResourceSnapshotDto['vehicles'][number],
  poolNames: Map<string, string>,
): Resource {
  const poolName = resolvePoolName(poolNames, vehicle.poolId);
  const displayName = vehicle.vehicleNumber?.trim().length ? vehicle.vehicleNumber : vehicle.id;
  return {
    id: vehicle.id,
    name: displayName ?? vehicle.id,
    kind: 'vehicle',
    attributes: buildResourceAttributes(vehicle, 'vehicle', poolName),
  };
}

function resolvePoolName(poolNames: Map<string, string>, poolId: string | null | undefined): string | undefined {
  if (!poolId) {
    return undefined;
  }
  const name = poolNames.get(poolId);
  return name && name.trim().length ? name : undefined;
}

function buildResourceAttributes<T extends object>(
  source: T,
  category: string,
  poolName?: string,
): Record<string, unknown> {
  const attrs: Record<string, unknown> = {
    ...(source as Record<string, unknown>),
    category,
  };
  if (poolName) {
    attrs['poolName'] = poolName;
  }
  return attrs;
}

function formatPersonnelName(person: ResourceSnapshotDto['personnel'][number]): string {
  const preferred = resolveTemporalValue(person.preferredName);
  const first = resolveTemporalValue(person.firstName);
  const last = typeof person.lastName === 'string' ? person.lastName : '';
  if (preferred) {
    const fallback = [first, last].filter(Boolean).join(' ').trim();
    return fallback ? `${preferred} (${fallback})` : preferred;
  }
  const combined = [first, last].filter(Boolean).join(' ').trim();
  return combined || person.id;
}

function resolveTemporalValue(value: string | TemporalValue<string>[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0]?.value ?? '';
  }
  return value ?? '';
}

