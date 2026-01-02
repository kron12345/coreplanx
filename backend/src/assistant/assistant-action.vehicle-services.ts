import type { AssistantActionChangeDto } from './assistant.dto';
import type { ActionApplyOutcome, ActionContext, ActionPayload } from './assistant-action.engine.types';
import type { ResourceSnapshot, VehicleService, VehicleServicePool } from '../planning/planning.types';
import { SYSTEM_POOL_IDS } from '../planning/planning-master-data.constants';
import { AssistantActionBase } from './assistant-action.base';

export class AssistantActionVehicleServices extends AssistantActionBase {
  buildVehicleServicePoolPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const poolRaw = payload.pool;
    const poolRecord = this.asRecord(poolRaw) ?? {};
    const payloadRecord = payload as Record<string, unknown>;
    const poolName =
      this.cleanText(typeof poolRaw === 'string' ? poolRaw : poolRecord['name']) ??
      this.cleanText(poolRecord['poolName']) ??
      this.cleanText(payloadRecord['poolName']);
    if (!poolName) {
      return this.buildFeedbackResponse('Poolname fehlt.');
    }

    const services = this.normalizeVehicleServices(
      Array.isArray(payload.services) ? payload.services : [],
    );
    if (!services.length) {
      return this.buildFeedbackResponse('Mindestens ein Dienst wird benötigt.');
    }

    if (this.hasNameCollision(snapshot.vehicleServicePools, poolName)) {
      return this.buildFeedbackResponse(
        `Fahrzeugdienstpool "${poolName}" existiert bereits.`,
      );
    }
    const duplicateNames = this.findDuplicateNames(services.map((service) => service.name));
    if (duplicateNames.length) {
      return this.buildFeedbackResponse(
        `Dienste doppelt angegeben: ${duplicateNames.join(', ')}`,
      );
    }
    const poolId = this.generateId('VSP');
    const serviceEntries: VehicleService[] = services.map((service) => ({
      id: this.generateId('VS'),
      name: service.name,
      description: service.description,
      poolId,
      startTime: service.startTime,
      endTime: service.endTime,
      isOvernight: service.isOvernight,
      primaryRoute: service.primaryRoute,
    }));

    const pool: VehicleServicePool = {
      id: poolId,
      name: poolName,
      description: this.cleanText(poolRecord['description']),
      dispatcher: this.cleanText(poolRecord['dispatcher']),
      serviceIds: serviceEntries.map((service) => service.id),
    };

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicleServicePools: [...snapshot.vehicleServicePools, pool],
      vehicleServices: [...snapshot.vehicleServices, ...serviceEntries],
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary = `Neuer Fahrzeugdienstpool "${poolName}" mit ${serviceEntries.length} Diensten.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'create', entityType: 'vehicleServicePool', id: poolId, label: poolName },
      ...serviceEntries.map((service): AssistantActionChangeDto => ({
        kind: 'create',
        entityType: 'vehicleService',
        id: service.id,
        label: service.name,
        details: `Pool ${poolName}`,
      })),
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  buildVehicleServicePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.services ?? payloadRecord['service'] ?? payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse('Mindestens ein Dienst wird benötigt.');
    }

    const defaultPoolRef = this.parsePoolReference(
      payload.pool ?? payloadRecord['pool'] ?? payloadRecord['poolName'],
    );
    const services: VehicleService[] = [];
    const changes: AssistantActionChangeDto[] = [];
    const poolNames = new Set<string>();
    const seenServiceNames = new Set<string>();

    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const record = this.asRecord(raw);
      const name =
        this.cleanText(
          typeof raw === 'string' ? raw : record?.['name'] ?? record?.['serviceName'],
        ) ?? undefined;
      if (!name) {
        return this.buildFeedbackResponse('Dienstname fehlt.');
      }
      const normalizedName = this.normalizeKey(name);
      if (seenServiceNames.has(normalizedName)) {
        return this.buildFeedbackResponse(`Dienst "${name}" ist doppelt angegeben.`);
      }
      seenServiceNames.add(normalizedName);

      const recordPoolRef = this.parsePoolReference(
        record?.['pool'] ?? record?.['poolName'] ?? record?.['poolId'],
      );
      const poolRef = recordPoolRef ?? defaultPoolRef;
      if (!poolRef) {
        return this.buildFeedbackResponse(`Dienst "${name}": Pool fehlt.`);
      }

      const resolvedPool = this.resolvePoolIdByReference(
        snapshot.vehicleServicePools,
        poolRef,
        'Dienst-Pool',
        { allowSystem: false, systemId: SYSTEM_POOL_IDS.vehicleServicePool },
        {
          title: `Mehrere Dienst-Pools mit Namen "${poolRef}" gefunden. Welchen meinst du?`,
          apply: {
            mode: 'value',
            path: recordPoolRef ? ['services', index, 'pool'] : ['pool'],
          },
        },
      );
      if (resolvedPool.clarification) {
        return this.buildClarificationResponse(resolvedPool.clarification, context);
      }
      if (resolvedPool.feedback) {
        return this.buildFeedbackResponse(
          `Dienst "${name}": ${resolvedPool.feedback}`,
        );
      }
      const duplicateInPool = snapshot.vehicleServices.find(
        (service) =>
          service.poolId === resolvedPool.id &&
          this.normalizeKey(service.name) === normalizedName,
      );
      if (duplicateInPool) {
        return this.buildFeedbackResponse(
          `Dienst "${name}" existiert bereits im Pool "${resolvedPool.label ?? poolRef}".`,
        );
      }

      const service: VehicleService = {
        id: this.generateId('VS'),
        name,
        description: this.cleanText(record?.['description']),
        poolId: resolvedPool.id,
        startTime: this.cleanText(record?.['startTime']),
        endTime: this.cleanText(record?.['endTime']),
        isOvernight: this.parseBoolean(record?.['isOvernight']),
        primaryRoute: this.cleanText(record?.['primaryRoute']),
      };
      services.push(service);

      const poolLabel = resolvedPool.label ?? poolRef;
      poolNames.add(poolLabel);
      changes.push({
        kind: 'create',
        entityType: 'vehicleService',
        id: service.id,
        label: service.name,
        details: `Pool ${poolLabel}`,
      });
    }

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicleServices: [...snapshot.vehicleServices, ...services],
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary =
      poolNames.size === 1
        ? `Neue Fahrzeugdienste (${services.length}) im Pool "${Array.from(poolNames)[0]}".`
        : `Neue Fahrzeugdienste (${services.length}).`;

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  buildUpdateVehicleServicePoolPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, [
      'pool',
      'servicePool',
      'vehicleServicePool',
    ]);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Fahrzeugdienstpool fehlt.');
    }

    const targetResult = this.findByIdOrName(snapshot.vehicleServicePools, targetRecord, {
      label: 'Fahrzeugdienstpool',
      nameKeys: ['name', 'poolName', 'servicePoolName'],
      clarification: { apply: { mode: 'target', path: ['target'] } },
    });
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(targetResult.feedback ?? 'Pool nicht gefunden.');
    }

    const pool = targetResult.item;
    if (pool.id === SYSTEM_POOL_IDS.vehicleServicePool) {
      return this.buildFeedbackResponse('System-Pool kann nicht geändert werden.');
    }

    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const updated: VehicleServicePool = { ...pool };
    let changed = false;

    if (this.hasOwn(patch, 'name')) {
      const name = this.cleanText(patch['name']);
      if (!name) {
        return this.buildFeedbackResponse('Name darf nicht leer sein.');
      }
      if (this.hasNameCollision(snapshot.vehicleServicePools, name, pool.id)) {
        return this.buildFeedbackResponse(`Name "${name}" ist bereits vergeben.`);
      }
      updated.name = name;
      changed = true;
    }

    if (this.hasOwn(patch, 'description')) {
      updated.description = this.cleanText(patch['description']);
      changed = true;
    }

    if (this.hasOwn(patch, 'dispatcher')) {
      updated.dispatcher = this.cleanText(patch['dispatcher']);
      changed = true;
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    const nextPools = snapshot.vehicleServicePools.map((entry) =>
      entry.id === pool.id ? updated : entry,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicleServicePools: nextPools,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const label = updated.name ?? pool.name;
    const summary = `Fahrzeugdienstpool "${label}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'update', entityType: 'vehicleServicePool', id: pool.id, label },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  buildUpdateVehicleServicePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['service', 'vehicleService']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Fahrzeugdienst fehlt.');
    }

    const targetResult = this.findByIdOrName(snapshot.vehicleServices, targetRecord, {
      label: 'Fahrzeugdienst',
      nameKeys: ['name', 'serviceName'],
      clarification: {
        apply: { mode: 'target', path: ['target'] },
        details: (service) => {
          const pool = snapshot.vehicleServicePools.find(
            (entry) => entry.id === service.poolId,
          );
          return pool?.name ? `Pool ${pool.name}` : `Pool ${service.poolId}`;
        },
      },
    });
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(targetResult.feedback ?? 'Dienst nicht gefunden.');
    }

    const service = targetResult.item;
    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const updated: VehicleService = { ...service };
    let changed = false;
    let nameChanged = false;
    let poolChanged = false;

    if (this.hasOwn(patch, 'name')) {
      const name = this.cleanText(patch['name']);
      if (!name) {
        return this.buildFeedbackResponse('Name darf nicht leer sein.');
      }
      updated.name = name;
      changed = true;
      nameChanged = true;
    }

    if (this.hasOwn(patch, 'description')) {
      updated.description = this.cleanText(patch['description']);
      changed = true;
    }

    if (this.hasOwn(patch, 'startTime')) {
      updated.startTime = this.cleanText(patch['startTime']);
      changed = true;
    }

    if (this.hasOwn(patch, 'endTime')) {
      updated.endTime = this.cleanText(patch['endTime']);
      changed = true;
    }

    if (this.hasOwn(patch, 'isOvernight')) {
      updated.isOvernight = this.parseBoolean(patch['isOvernight']);
      changed = true;
    }

    if (this.hasOwn(patch, 'primaryRoute')) {
      updated.primaryRoute = this.cleanText(patch['primaryRoute']);
      changed = true;
    }

    const hasPoolPatch = this.hasAnyKey(patch, ['poolId', 'pool', 'poolName']);
    if (hasPoolPatch) {
      const poolRef = this.extractReference(patch, ['poolId', 'pool', 'poolName']);
      if (!poolRef) {
        return this.buildFeedbackResponse('Dienst-Pool fehlt.');
      }
      const resolved = this.resolvePoolIdByReference(
        snapshot.vehicleServicePools,
        poolRef,
        'Dienst-Pool',
        {
          allowSystem: false,
          systemId: SYSTEM_POOL_IDS.vehicleServicePool,
          systemFeedback: 'System-Pool nur ueber delete nutzen.',
        },
        { apply: { mode: 'value', path: ['patch', 'pool'] } },
      );
      if (resolved.clarification) {
        return this.buildClarificationResponse(resolved.clarification, context);
      }
      if (resolved.feedback) {
        return this.buildFeedbackResponse(resolved.feedback);
      }
      updated.poolId = resolved.id;
      changed = true;
      poolChanged = true;
    }

    if (nameChanged || poolChanged) {
      if (
        updated.name &&
        snapshot.vehicleServices.some(
          (entry) =>
            entry.id !== service.id &&
            entry.poolId === updated.poolId &&
            this.normalizeKey(entry.name) === this.normalizeKey(updated.name),
        )
      ) {
        return this.buildFeedbackResponse(
          `Dienst "${updated.name}" existiert bereits im Ziel-Pool.`,
        );
      }
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    const nextServices = snapshot.vehicleServices.map((entry) =>
      entry.id === service.id ? updated : entry,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicleServices: nextServices,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const label = updated.name ?? service.name;
    const summary = `Fahrzeugdienst "${label}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'update', entityType: 'vehicleService', id: service.id, label },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  buildDeleteVehicleServicePoolPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, [
      'pool',
      'servicePool',
      'vehicleServicePool',
    ]);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Fahrzeugdienstpool fehlt.');
    }

    const targetResult = this.findByIdOrName(snapshot.vehicleServicePools, targetRecord, {
      label: 'Fahrzeugdienstpool',
      nameKeys: ['name', 'poolName', 'servicePoolName'],
      clarification: { apply: { mode: 'target', path: ['target'] } },
    });
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(targetResult.feedback ?? 'Pool nicht gefunden.');
    }

    const pool = targetResult.item;
    if (pool.id === SYSTEM_POOL_IDS.vehicleServicePool) {
      return this.buildFeedbackResponse('System-Pool kann nicht gelöscht werden.');
    }

    const movedServices = snapshot.vehicleServices.filter(
      (service) => service.poolId === pool.id,
    );
    const nextServices = snapshot.vehicleServices.map((service) =>
      service.poolId === pool.id
        ? { ...service, poolId: SYSTEM_POOL_IDS.vehicleServicePool }
        : service,
    );
    const nextPools = snapshot.vehicleServicePools.filter(
      (entry) => entry.id !== pool.id,
    );

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicleServices: nextServices,
      vehicleServicePools: nextPools,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary = `Fahrzeugdienstpool "${pool.name}" gelöscht (${movedServices.length} Dienste in System-Pool).`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'vehicleServicePool',
        id: pool.id,
        label: pool.name,
        details: 'System-Pool',
      },
      ...movedServices.map(
        (service): AssistantActionChangeDto => ({
          kind: 'update',
          entityType: 'vehicleService',
          id: service.id,
          label: service.name,
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

  buildDeleteVehicleServicePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['service', 'vehicleService']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Fahrzeugdienst fehlt.');
    }

    const targetResult = this.findByIdOrName(snapshot.vehicleServices, targetRecord, {
      label: 'Fahrzeugdienst',
      nameKeys: ['name', 'serviceName'],
      clarification: {
        apply: { mode: 'target', path: ['target'] },
        details: (service) => {
          const pool = snapshot.vehicleServicePools.find(
            (entry) => entry.id === service.poolId,
          );
          return pool?.name ? `Pool ${pool.name}` : `Pool ${service.poolId}`;
        },
      },
    });
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(targetResult.feedback ?? 'Dienst nicht gefunden.');
    }

    const service = targetResult.item;
    if (service.poolId === SYSTEM_POOL_IDS.vehicleServicePool) {
      return this.buildFeedbackResponse('Dienst befindet sich bereits im System-Pool.');
    }

    const updated = { ...service, poolId: SYSTEM_POOL_IDS.vehicleServicePool };
    const nextServices = snapshot.vehicleServices.map((entry) =>
      entry.id === service.id ? updated : entry,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicleServices: nextServices,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary = `Fahrzeugdienst "${service.name}" in System-Pool verschoben.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'vehicleService',
        id: service.id,
        label: service.name,
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

  private normalizeVehicleServices(values: unknown[]): Array<{
    name: string;
    description?: string;
    startTime?: string;
    endTime?: string;
    isOvernight?: boolean;
    primaryRoute?: string;
  }> {
    return values
      .map((entry) => {
        if (typeof entry === 'string') {
          const name = this.cleanText(entry);
          return name ? ({ name } as const) : null;
        }
        if (entry && typeof entry === 'object') {
          const record = entry as Record<string, unknown>;
          const name =
            this.cleanText(record['name']) ?? this.cleanText(record['serviceName']);
          if (!name) {
            return null;
          }
          return {
            name,
            description: this.cleanText(record['description']),
            startTime: this.cleanText(record['startTime']),
            endTime: this.cleanText(record['endTime']),
            isOvernight: this.parseBoolean(record['isOvernight']),
            primaryRoute: this.cleanText(record['primaryRoute']),
          };
        }
        return null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => !!entry);
  }
}
