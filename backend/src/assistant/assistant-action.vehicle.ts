import type { AssistantActionClarificationApply } from './assistant-action-clarification.store';
import type { AssistantActionChangeDto } from './assistant.dto';
import type {
  ActionApplyOutcome,
  ActionContext,
  ActionPayload,
  ClarificationRequest,
} from './assistant-action.engine.types';
import type {
  ResourceSnapshot,
  Vehicle,
  VehiclePool,
  VehicleService,
} from '../planning/planning.types';
import { SYSTEM_POOL_IDS } from '../planning/planning-master-data.constants';
import { AssistantActionBase } from './assistant-action.base';

export class AssistantActionVehicle extends AssistantActionBase {
  buildVehiclePoolPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const poolSource =
      payload.pool ?? payloadRecord['vehiclePool'] ?? payloadRecord['pool'];
    const poolRecord = this.asRecord(poolSource);
    const poolName =
      this.cleanText(
        typeof poolSource === 'string' ? poolSource : poolRecord?.['name'],
      ) ??
      this.cleanText(poolRecord?.['poolName']) ??
      this.cleanText(payloadRecord['poolName']);
    if (!poolName) {
      return this.buildFeedbackResponse('Poolname fehlt.');
    }

    if (this.hasNameCollision(snapshot.vehiclePools, poolName)) {
      return this.buildFeedbackResponse(
        `Fahrzeugpool "${poolName}" existiert bereits.`,
      );
    }

    const poolId = this.generateId('VP');
    const pool: VehiclePool = {
      id: poolId,
      name: poolName,
      description: this.cleanText(poolRecord?.['description']),
      depotManager: this.cleanText(poolRecord?.['depotManager']),
      vehicleIds: [],
    };

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehiclePools: [...snapshot.vehiclePools, pool],
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary = `Neuer Fahrzeugpool "${poolName}".`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'create',
        entityType: 'vehiclePool',
        id: poolId,
        label: poolName,
      },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  buildVehiclePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.vehicles ?? payloadRecord['vehicle'] ?? payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse(
        'Mindestens ein Fahrzeug wird benötigt.',
      );
    }

    const defaultPoolRef = this.parsePoolReference(
      payload.pool ?? payloadRecord['pool'] ?? payloadRecord['poolName'],
    );
    const servicePoolLabels = new Map(
      snapshot.vehicleServicePools.map((pool) => [pool.id, pool.name]),
    );
    const vehicles: Vehicle[] = [];
    const changes: AssistantActionChangeDto[] = [];
    const poolNames = new Set<string>();
    const usedNumbers = new Set<string>();

    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const record = this.asRecord(raw);
      const vehicleNumber =
        this.cleanText(
          typeof raw === 'string'
            ? raw
            : (record?.['vehicleNumber'] ??
                record?.['number'] ??
                record?.['name']),
        ) ?? undefined;
      if (!vehicleNumber) {
        return this.buildFeedbackResponse('Fahrzeugnummer fehlt.');
      }

      const normalizedNumber = this.normalizeKey(vehicleNumber);
      if (usedNumbers.has(normalizedNumber)) {
        return this.buildFeedbackResponse(
          `Fahrzeugnummer "${vehicleNumber}" ist doppelt im Request.`,
        );
      }
      const existing = snapshot.vehicles.find(
        (entry) =>
          this.normalizeKey(
            entry.vehicleNumber ?? entry.name ?? entry.id ?? '',
          ) === normalizedNumber,
      );
      if (existing) {
        return this.buildFeedbackResponse(
          `Fahrzeugnummer "${vehicleNumber}" existiert bereits.`,
        );
      }
      usedNumbers.add(normalizedNumber);

      const typeRef = this.cleanText(
        record?.['typeId'] ??
          record?.['type'] ??
          record?.['typeLabel'] ??
          record?.['vehicleType'],
      );
      if (!typeRef) {
        return this.buildFeedbackResponse(
          `Fahrzeug "${vehicleNumber}": Typ fehlt.`,
        );
      }
      const typeResult = this.resolveVehicleTypeIdByReference(
        snapshot.vehicleTypes,
        typeRef,
        { apply: { mode: 'value', path: ['vehicles', index, 'typeId'] } },
      );
      if (typeResult.clarification) {
        return this.buildClarificationResponse(
          typeResult.clarification,
          context,
        );
      }
      if (typeResult.feedback) {
        return this.buildFeedbackResponse(
          `Fahrzeug "${vehicleNumber}": ${typeResult.feedback}`,
        );
      }

      const recordPoolRef = this.parsePoolReference(
        record?.['pool'] ?? record?.['poolName'] ?? record?.['poolId'],
      );
      const poolRef = recordPoolRef ?? defaultPoolRef;
      let poolId: string | undefined;
      let poolLabel: string | undefined;
      if (poolRef) {
        const resolvedPool = this.resolvePoolIdByReference(
          snapshot.vehiclePools,
          poolRef,
          'Fahrzeugpool',
          { allowSystem: false, systemId: SYSTEM_POOL_IDS.vehiclePool },
          {
            apply: {
              mode: 'value',
              path: recordPoolRef ? ['vehicles', index, 'pool'] : ['pool'],
            },
          },
        );
        if (resolvedPool.clarification) {
          return this.buildClarificationResponse(
            resolvedPool.clarification,
            context,
          );
        }
        if (resolvedPool.feedback) {
          return this.buildFeedbackResponse(
            `Fahrzeug "${vehicleNumber}": ${resolvedPool.feedback}`,
          );
        }
        poolId = resolvedPool.id;
        poolLabel = resolvedPool.label ?? poolRef;
        poolNames.add(poolLabel);
      }

      const serviceNames = this.parseStringArray(
        record?.['services'] ??
          record?.['serviceNames'] ??
          record?.['serviceIds'],
      );
      const serviceResult = this.resolveVehicleServiceIds(
        snapshot.vehicleServices,
        serviceNames,
        serviceNames?.length
          ? {
              applyPath: ['vehicles', index, 'services'],
              poolLabelById: servicePoolLabels,
            }
          : undefined,
      );
      if (serviceResult.clarification) {
        return this.buildClarificationResponse(
          serviceResult.clarification,
          context,
        );
      }
      if (serviceResult.feedback) {
        return this.buildFeedbackResponse(
          `Fahrzeug "${vehicleNumber}": ${serviceResult.feedback}`,
        );
      }

      const vehicle: Vehicle = {
        id: this.generateId('V'),
        vehicleNumber,
        typeId: typeResult.id,
        poolId,
        serviceIds: serviceResult.ids,
        description: this.cleanText(record?.['description']),
        depot: this.cleanText(record?.['depot']),
      };
      vehicles.push(vehicle);

      changes.push({
        kind: 'create',
        entityType: 'vehicle',
        id: vehicle.id,
        label: vehicleNumber,
        details: poolLabel ? `Pool ${poolLabel}` : undefined,
      });
    }

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicles: [...snapshot.vehicles, ...vehicles],
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    let summary = `Neue Fahrzeuge (${vehicles.length}).`;
    if (poolNames.size === 1) {
      summary = `Neue Fahrzeuge (${vehicles.length}) im Pool "${Array.from(poolNames)[0]}".`;
    }

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  buildUpdateVehiclePoolPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, [
      'pool',
      'vehiclePool',
    ]);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Fahrzeugpool fehlt.');
    }

    const targetResult = this.findByIdOrName(
      snapshot.vehiclePools,
      targetRecord,
      {
        label: 'Fahrzeugpool',
        nameKeys: ['name', 'poolName'],
        clarification: { apply: { mode: 'target', path: ['target'] } },
      },
    );
    if (targetResult.clarification) {
      return this.buildClarificationResponse(
        targetResult.clarification,
        context,
      );
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(
        targetResult.feedback ?? 'Pool nicht gefunden.',
      );
    }

    const pool = targetResult.item;
    if (pool.id === SYSTEM_POOL_IDS.vehiclePool) {
      return this.buildFeedbackResponse(
        'System-Pool kann nicht geändert werden.',
      );
    }

    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const updated: VehiclePool = { ...pool };
    let changed = false;

    if (this.hasOwn(patch, 'name')) {
      const name = this.cleanText(patch['name']);
      if (!name) {
        return this.buildFeedbackResponse('Name darf nicht leer sein.');
      }
      if (this.hasNameCollision(snapshot.vehiclePools, name, pool.id)) {
        return this.buildFeedbackResponse(
          `Name "${name}" ist bereits vergeben.`,
        );
      }
      updated.name = name;
      changed = true;
    }

    if (this.hasOwn(patch, 'description')) {
      updated.description = this.cleanText(patch['description']);
      changed = true;
    }

    if (this.hasOwn(patch, 'depotManager')) {
      updated.depotManager = this.cleanText(patch['depotManager']);
      changed = true;
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    const nextPools = snapshot.vehiclePools.map((entry) =>
      entry.id === pool.id ? updated : entry,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehiclePools: nextPools,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const label = updated.name ?? pool.name;
    const summary = `Fahrzeugpool "${label}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'update', entityType: 'vehiclePool', id: pool.id, label },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  buildUpdateVehiclePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, [
      'vehicle',
      'vehicles',
    ]);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Fahrzeug fehlt.');
    }

    const poolLabels = new Map(
      snapshot.vehiclePools.map((pool) => [pool.id, pool.name]),
    );
    const targetResult = this.resolveVehicleTarget(
      snapshot.vehicles,
      targetRecord,
      {
        clarification: { apply: { mode: 'target', path: ['target'] } },
        poolLabelById: poolLabels,
      },
    );
    if (targetResult.clarification) {
      return this.buildClarificationResponse(
        targetResult.clarification,
        context,
      );
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(
        targetResult.feedback ?? 'Fahrzeug nicht gefunden.',
      );
    }

    const vehicle = targetResult.item;
    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const updated: Vehicle = { ...vehicle };
    let changed = false;
    const servicePoolLabels = new Map(
      snapshot.vehicleServicePools.map((pool) => [pool.id, pool.name]),
    );

    if (this.hasOwn(patch, 'vehicleNumber')) {
      const number = this.cleanText(patch['vehicleNumber']);
      if (!number) {
        return this.buildFeedbackResponse(
          'Fahrzeugnummer darf nicht leer sein.',
        );
      }
      const normalized = this.normalizeKey(number);
      const existing = snapshot.vehicles.find(
        (entry) =>
          entry.id !== vehicle.id &&
          this.normalizeKey(
            entry.vehicleNumber ?? entry.name ?? entry.id ?? '',
          ) === normalized,
      );
      if (existing) {
        return this.buildFeedbackResponse(
          `Fahrzeugnummer "${number}" existiert bereits.`,
        );
      }
      updated.vehicleNumber = number;
      changed = true;
    }

    const hasTypePatch = this.hasAnyKey(patch, [
      'typeId',
      'type',
      'typeLabel',
      'vehicleType',
    ]);
    if (hasTypePatch) {
      const typeRef = this.extractFirstText(patch, [
        'typeId',
        'type',
        'typeLabel',
        'vehicleType',
      ]);
      if (!typeRef) {
        return this.buildFeedbackResponse('Fahrzeugtyp fehlt.');
      }
      const typeResult = this.resolveVehicleTypeIdByReference(
        snapshot.vehicleTypes,
        typeRef,
        { apply: { mode: 'value', path: ['patch', 'typeId'] } },
      );
      if (typeResult.clarification) {
        return this.buildClarificationResponse(
          typeResult.clarification,
          context,
        );
      }
      if (typeResult.feedback) {
        return this.buildFeedbackResponse(typeResult.feedback);
      }
      updated.typeId = typeResult.id;
      changed = true;
    }

    const hasPoolPatch = this.hasAnyKey(patch, ['poolId', 'pool', 'poolName']);
    if (hasPoolPatch) {
      const poolRef = this.extractReference(patch, [
        'poolId',
        'pool',
        'poolName',
      ]);
      if (poolRef) {
        const resolved = this.resolvePoolIdByReference(
          snapshot.vehiclePools,
          poolRef,
          'Fahrzeugpool',
          {
            allowSystem: false,
            systemId: SYSTEM_POOL_IDS.vehiclePool,
            systemFeedback: 'System-Pool nur ueber delete nutzen.',
          },
          { apply: { mode: 'value', path: ['patch', 'pool'] } },
        );
        if (resolved.clarification) {
          return this.buildClarificationResponse(
            resolved.clarification,
            context,
          );
        }
        if (resolved.feedback) {
          return this.buildFeedbackResponse(resolved.feedback);
        }
        updated.poolId = resolved.id;
      } else {
        updated.poolId = undefined;
      }
      changed = true;
    }

    const hasServicePatch = this.hasAnyKey(patch, [
      'services',
      'serviceNames',
      'serviceIds',
    ]);
    if (hasServicePatch) {
      const serviceNames = this.parseStringArray(
        patch['services'] ?? patch['serviceNames'] ?? patch['serviceIds'],
      );
      const serviceResult = this.resolveVehicleServiceIds(
        snapshot.vehicleServices,
        serviceNames,
        {
          applyPath: ['patch', 'services'],
          poolLabelById: servicePoolLabels,
        },
      );
      if (serviceResult.clarification) {
        return this.buildClarificationResponse(
          serviceResult.clarification,
          context,
        );
      }
      if (serviceResult.feedback) {
        return this.buildFeedbackResponse(serviceResult.feedback);
      }
      updated.serviceIds = serviceNames?.length ? serviceResult.ids : [];
      changed = true;
    }

    if (this.hasOwn(patch, 'description')) {
      updated.description = this.cleanText(patch['description']);
      changed = true;
    }

    if (this.hasOwn(patch, 'depot')) {
      updated.depot = this.cleanText(patch['depot']);
      changed = true;
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    const nextVehicles = snapshot.vehicles.map((entry) =>
      entry.id === vehicle.id ? updated : entry,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicles: nextVehicles,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const label = this.formatVehicleLabel(updated);
    const summary = `Fahrzeug "${label}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'update', entityType: 'vehicle', id: vehicle.id, label },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  buildDeleteVehiclePoolPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, [
      'pool',
      'vehiclePool',
    ]);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Fahrzeugpool fehlt.');
    }

    const targetResult = this.findByIdOrName(
      snapshot.vehiclePools,
      targetRecord,
      {
        label: 'Fahrzeugpool',
        nameKeys: ['name', 'poolName'],
        clarification: { apply: { mode: 'target', path: ['target'] } },
      },
    );
    if (targetResult.clarification) {
      return this.buildClarificationResponse(
        targetResult.clarification,
        context,
      );
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(
        targetResult.feedback ?? 'Pool nicht gefunden.',
      );
    }

    const pool = targetResult.item;
    if (pool.id === SYSTEM_POOL_IDS.vehiclePool) {
      return this.buildFeedbackResponse(
        'System-Pool kann nicht gelöscht werden.',
      );
    }

    const movedVehicles = snapshot.vehicles.filter(
      (vehicle) => vehicle.poolId === pool.id,
    );
    const nextVehicles = snapshot.vehicles.map((vehicle) =>
      vehicle.poolId === pool.id
        ? { ...vehicle, poolId: SYSTEM_POOL_IDS.vehiclePool }
        : vehicle,
    );
    const nextPools = snapshot.vehiclePools.filter(
      (entry) => entry.id !== pool.id,
    );

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicles: nextVehicles,
      vehiclePools: nextPools,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary = `Fahrzeugpool "${pool.name}" gelöscht (${movedVehicles.length} Fahrzeuge in System-Pool).`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'vehiclePool',
        id: pool.id,
        label: pool.name,
        details: 'System-Pool',
      },
      ...movedVehicles.map(
        (vehicle): AssistantActionChangeDto => ({
          kind: 'update',
          entityType: 'vehicle',
          id: vehicle.id,
          label: this.formatVehicleLabel(vehicle),
          details: 'System-Pool',
        }),
      ),
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  buildDeleteVehiclePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, [
      'vehicle',
      'vehicles',
    ]);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Fahrzeug fehlt.');
    }

    const poolLabels = new Map(
      snapshot.vehiclePools.map((pool) => [pool.id, pool.name]),
    );
    const targetResult = this.resolveVehicleTarget(
      snapshot.vehicles,
      targetRecord,
      {
        clarification: { apply: { mode: 'target', path: ['target'] } },
        poolLabelById: poolLabels,
      },
    );
    if (targetResult.clarification) {
      return this.buildClarificationResponse(
        targetResult.clarification,
        context,
      );
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(
        targetResult.feedback ?? 'Fahrzeug nicht gefunden.',
      );
    }

    const vehicle = targetResult.item;
    if (vehicle.poolId === SYSTEM_POOL_IDS.vehiclePool) {
      return this.buildFeedbackResponse(
        'Fahrzeug befindet sich bereits im System-Pool.',
      );
    }

    const updated = { ...vehicle, poolId: SYSTEM_POOL_IDS.vehiclePool };
    const nextVehicles = snapshot.vehicles.map((entry) =>
      entry.id === vehicle.id ? updated : entry,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicles: nextVehicles,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const label = this.formatVehicleLabel(vehicle);
    const summary = `Fahrzeug "${label}" in System-Pool verschoben.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'vehicle',
        id: vehicle.id,
        label,
        details: 'System-Pool',
      },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private resolveVehicleServiceIds(
    services: VehicleService[],
    serviceNames?: string[],
    clarification?: {
      applyPath: Array<string | number>;
      title?: (name: string) => string;
      poolLabelById?: Map<string, string>;
    },
  ): {
    ids?: string[];
    feedback?: string;
    clarification?: ClarificationRequest;
  } {
    if (!serviceNames || !serviceNames.length) {
      return { ids: undefined };
    }
    const poolFiltered = services.filter(
      (service) => service.poolId !== SYSTEM_POOL_IDS.vehicleServicePool,
    );
    const ids: string[] = [];
    const missing: string[] = [];
    const seenNames = new Set<string>();
    const seenIds = new Set<string>();

    for (let index = 0; index < serviceNames.length; index += 1) {
      const rawName = serviceNames[index];
      const name = this.cleanText(rawName) ?? '';
      if (!name) {
        continue;
      }
      const direct = poolFiltered.find((service) => service.id === name);
      if (direct) {
        if (!seenIds.has(direct.id)) {
          ids.push(direct.id);
          seenIds.add(direct.id);
        }
        continue;
      }

      const normalized = this.normalizeKey(name);
      if (seenNames.has(normalized)) {
        continue;
      }
      const matches = poolFiltered.filter(
        (service) => this.normalizeKey(service.name) === normalized,
      );
      if (!matches.length) {
        missing.push(name);
        continue;
      }
      if (matches.length > 1) {
        if (clarification) {
          const title =
            clarification.title?.(name) ??
            `Fahrzeugdienst "${name}" ist nicht eindeutig. Welchen meinst du?`;
          return {
            clarification: {
              title,
              options: matches.map((service) => ({
                id: service.id,
                label: service.name,
                details: service.poolId
                  ? `Pool ${clarification.poolLabelById?.get(service.poolId) ?? service.poolId}`
                  : undefined,
              })),
              apply: {
                mode: 'value',
                path: [...clarification.applyPath, index],
              },
            },
          };
        }
        return {
          feedback: `Fahrzeugdienst "${name}" ist nicht eindeutig. ${this.describeCandidates(
            matches.map((service) => service.name),
          )}`,
        };
      }
      const match = matches[0];
      seenNames.add(normalized);
      if (!seenIds.has(match.id)) {
        ids.push(match.id);
        seenIds.add(match.id);
      }
    }

    if (missing.length) {
      return {
        feedback: `Fahrzeugdienst(e) nicht gefunden: ${missing.join(', ')}`,
      };
    }
    return { ids };
  }

  private formatVehicleLabel(vehicle: Vehicle): string {
    return (
      this.cleanText(vehicle.vehicleNumber) ||
      this.cleanText(vehicle.name) ||
      vehicle.id
    );
  }

  private resolveVehicleTarget(
    vehicles: Vehicle[],
    target: Record<string, unknown>,
    options?: {
      clarification?: {
        title?: string;
        apply: AssistantActionClarificationApply;
      };
      poolLabelById?: Map<string, string>;
    },
  ): {
    item?: Vehicle;
    feedback?: string;
    clarification?: ClarificationRequest;
  } {
    const id = this.extractFirstText(target, ['id', 'vehicleId']);
    if (id) {
      const match = vehicles.find((entry) => entry.id === id);
      if (!match) {
        return { feedback: `Fahrzeug mit ID "${id}" nicht gefunden.` };
      }
      return { item: match };
    }

    const number =
      this.cleanText(target['vehicleNumber']) ??
      this.cleanText(target['number']);
    const name =
      number ??
      this.cleanText(target['name']) ??
      this.cleanText(target['label']);
    if (!name) {
      return { feedback: 'Fahrzeugname fehlt.' };
    }
    const normalized = this.normalizeKey(name);
    const matches = vehicles.filter(
      (entry) =>
        this.normalizeKey(
          entry.vehicleNumber ?? entry.name ?? entry.id ?? '',
        ) === normalized,
    );
    if (!matches.length) {
      return { feedback: `Fahrzeug "${name}" nicht gefunden.` };
    }
    if (matches.length > 1) {
      if (options?.clarification) {
        const title =
          options.clarification.title ??
          `Fahrzeug "${name}" ist nicht eindeutig. Welches meinst du?`;
        return {
          clarification: {
            title,
            options: matches.map((entry) => ({
              id: entry.id,
              label: this.formatVehicleLabel(entry),
              details: entry.poolId
                ? `Pool ${options.poolLabelById?.get(entry.poolId) ?? entry.poolId}`
                : undefined,
            })),
            apply: options.clarification.apply,
          },
        };
      }
      return {
        feedback: `Fahrzeug "${name}" ist nicht eindeutig. ${this.describeCandidates(
          matches.map((entry) => this.formatVehicleLabel(entry)),
        )}`,
      };
    }
    return { item: matches[0] };
  }
}
