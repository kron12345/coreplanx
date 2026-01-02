import type { AssistantActionChangeDto } from './assistant.dto';
import type { ActionApplyOutcome, ActionContext, ActionPayload } from './assistant-action.engine.types';
import type { PersonnelService, PersonnelServicePool, ResourceSnapshot } from '../planning/planning.types';
import { SYSTEM_POOL_IDS } from '../planning/planning-master-data.constants';
import { AssistantActionBase } from './assistant-action.base';

export class AssistantActionPersonnelServices extends AssistantActionBase {
  buildPersonnelServicePoolPreview(
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

    const services = this.normalizePersonnelServices(
      Array.isArray(payload.services) ? payload.services : [],
    );
    if (!services.length) {
      return this.buildFeedbackResponse('Mindestens ein Dienst wird benötigt.');
    }

    if (this.hasNameCollision(snapshot.personnelServicePools, poolName)) {
      return this.buildFeedbackResponse(
        `Personaldienstpool "${poolName}" existiert bereits.`,
      );
    }
    const duplicateNames = this.findDuplicateNames(services.map((service) => service.name));
    if (duplicateNames.length) {
      return this.buildFeedbackResponse(
        `Dienste doppelt angegeben: ${duplicateNames.join(', ')}`,
      );
    }
    const depotRef = this.parsePoolReference(
      poolRecord['homeDepotId'] ?? poolRecord['homeDepot'] ?? poolRecord['homeDepotName'],
    );
    let homeDepotId: string | undefined;
    if (depotRef) {
      const resolved = this.resolveHomeDepotIdByReference(snapshot.homeDepots, depotRef, {
        title: `Mehrere Heimatdepots fuer "${depotRef}" gefunden. Welches meinst du?`,
        apply: { mode: 'value', path: ['pool', 'homeDepot'] },
      });
      if (resolved.clarification) {
        return this.buildClarificationResponse(resolved.clarification, context);
      }
      if (resolved.feedback) {
        return this.buildFeedbackResponse(resolved.feedback);
      }
      homeDepotId = resolved.id;
    }
    const poolId = this.generateId('PSP');
    const serviceEntries: PersonnelService[] = services.map((service) => ({
      id: this.generateId('PS'),
      name: service.name,
      description: service.description,
      poolId,
      startTime: service.startTime,
      endTime: service.endTime,
      isNightService: service.isNightService,
      requiredQualifications: service.requiredQualifications,
      maxDailyInstances: service.maxDailyInstances,
      maxResourcesPerInstance: service.maxResourcesPerInstance,
    }));

    const pool: PersonnelServicePool = {
      id: poolId,
      name: poolName,
      description: this.cleanText(poolRecord['description']),
      homeDepotId,
      shiftCoordinator: undefined,
      contactEmail: undefined,
      serviceIds: serviceEntries.map((service) => service.id),
    };

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      personnelServicePools: [...snapshot.personnelServicePools, pool],
      personnelServices: [...snapshot.personnelServices, ...serviceEntries],
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary = `Neuer Personaldienstpool "${poolName}" mit ${serviceEntries.length} Diensten.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'create', entityType: 'personnelServicePool', id: poolId, label: poolName },
      ...serviceEntries.map((service): AssistantActionChangeDto => ({
        kind: 'create',
        entityType: 'personnelService',
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

  buildPersonnelServicePreview(
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
    const services: PersonnelService[] = [];
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
        snapshot.personnelServicePools,
        poolRef,
        'Dienst-Pool',
        { allowSystem: false, systemId: SYSTEM_POOL_IDS.personnelServicePool },
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
      const duplicateInPool = snapshot.personnelServices.find(
        (service) =>
          service.poolId === resolvedPool.id &&
          this.normalizeKey(service.name) === normalizedName,
      );
      if (duplicateInPool) {
        return this.buildFeedbackResponse(
          `Dienst "${name}" existiert bereits im Pool "${resolvedPool.label ?? poolRef}".`,
        );
      }

      const service: PersonnelService = {
        id: this.generateId('PS'),
        name,
        description: this.cleanText(record?.['description']),
        poolId: resolvedPool.id,
        startTime: this.cleanText(record?.['startTime']),
        endTime: this.cleanText(record?.['endTime']),
        isNightService: this.parseBoolean(record?.['isNightService']),
        requiredQualifications: this.parseStringArray(record?.['requiredQualifications']),
        maxDailyInstances: this.parseNumber(record?.['maxDailyInstances']),
        maxResourcesPerInstance: this.parseNumber(record?.['maxResourcesPerInstance']),
      };
      services.push(service);

      const poolLabel = resolvedPool.label ?? poolRef;
      poolNames.add(poolLabel);
      changes.push({
        kind: 'create',
        entityType: 'personnelService',
        id: service.id,
        label: service.name,
        details: `Pool ${poolLabel}`,
      });
    }

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      personnelServices: [...snapshot.personnelServices, ...services],
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary =
      poolNames.size === 1
        ? `Neue Personaldienste (${services.length}) im Pool "${Array.from(poolNames)[0]}".`
        : `Neue Personaldienste (${services.length}).`;

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  buildUpdatePersonnelServicePoolPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, [
      'pool',
      'servicePool',
      'personnelServicePool',
    ]);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Personaldienstpool fehlt.');
    }

    const targetResult = this.findByIdOrName(snapshot.personnelServicePools, targetRecord, {
      label: 'Personaldienstpool',
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
    if (pool.id === SYSTEM_POOL_IDS.personnelServicePool) {
      return this.buildFeedbackResponse('System-Pool kann nicht geändert werden.');
    }

    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const updated: PersonnelServicePool = { ...pool };
    let changed = false;

    if (this.hasOwn(patch, 'name')) {
      const name = this.cleanText(patch['name']);
      if (!name) {
        return this.buildFeedbackResponse('Name darf nicht leer sein.');
      }
      if (this.hasNameCollision(snapshot.personnelServicePools, name, pool.id)) {
        return this.buildFeedbackResponse(`Name "${name}" ist bereits vergeben.`);
      }
      updated.name = name;
      changed = true;
    }

    if (this.hasOwn(patch, 'description')) {
      updated.description = this.cleanText(patch['description']);
      changed = true;
    }

    if (this.hasAnyKey(patch, ['homeDepot', 'homeDepotId', 'homeDepotName'])) {
      const depotRef = this.parsePoolReference(
        patch['homeDepotId'] ?? patch['homeDepot'] ?? patch['homeDepotName'],
      );
      if (depotRef) {
        const resolved = this.resolveHomeDepotIdByReference(snapshot.homeDepots, depotRef, {
          title: `Mehrere Heimatdepots fuer "${depotRef}" gefunden. Welches meinst du?`,
          apply: { mode: 'value', path: ['patch', 'homeDepot'] },
        });
        if (resolved.clarification) {
          return this.buildClarificationResponse(resolved.clarification, context);
        }
        if (resolved.feedback) {
          return this.buildFeedbackResponse(resolved.feedback);
        }
        updated.homeDepotId = resolved.id;
      } else {
        updated.homeDepotId = undefined;
      }
      changed = true;
    }

    if (this.hasOwn(patch, 'shiftCoordinator')) {
      updated.shiftCoordinator = this.cleanText(patch['shiftCoordinator']);
      changed = true;
    }

    if (this.hasOwn(patch, 'contactEmail')) {
      updated.contactEmail = this.cleanText(patch['contactEmail']);
      changed = true;
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    const nextPools = snapshot.personnelServicePools.map((entry) =>
      entry.id === pool.id ? updated : entry,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      personnelServicePools: nextPools,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary = `Personaldienstpool "${updated.name}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'update', entityType: 'personnelServicePool', id: pool.id, label: updated.name },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  buildUpdatePersonnelServicePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['personnelService']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Personaldienst fehlt.');
    }

    const targetResult = this.findByIdOrName(snapshot.personnelServices, targetRecord, {
      label: 'Dienst',
      nameKeys: ['name', 'serviceName'],
      clarification: { apply: { mode: 'target', path: ['target'] } },
    });
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(targetResult.feedback ?? 'Dienst nicht gefunden.');
    }

    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const service = targetResult.item;
    const updated: PersonnelService = { ...service };
    let changed = false;

    if (this.hasOwn(patch, 'name')) {
      const name = this.cleanText(patch['name']);
      if (!name) {
        return this.buildFeedbackResponse('Name darf nicht leer sein.');
      }
      updated.name = name;
      changed = true;
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

    if (this.hasOwn(patch, 'isNightService')) {
      updated.isNightService = this.parseBoolean(patch['isNightService']);
      changed = true;
    }

    if (this.hasOwn(patch, 'requiredQualifications')) {
      updated.requiredQualifications = this.parseStringArray(patch['requiredQualifications']);
      changed = true;
    }

    if (this.hasOwn(patch, 'maxDailyInstances')) {
      updated.maxDailyInstances = this.parseNumber(patch['maxDailyInstances']);
      changed = true;
    }

    if (this.hasOwn(patch, 'maxResourcesPerInstance')) {
      updated.maxResourcesPerInstance = this.parseNumber(patch['maxResourcesPerInstance']);
      changed = true;
    }

    if (this.hasAnyKey(patch, ['pool', 'poolName', 'poolId'])) {
      const poolRef = this.parsePoolReference(patch['poolId'] ?? patch['pool'] ?? patch['poolName']);
      if (!poolRef) {
        return this.buildFeedbackResponse('Dienst-Pool fehlt.');
      }
      const resolved = this.resolvePoolIdByReference(
        snapshot.personnelServicePools,
        poolRef,
        'Dienst-Pool',
        { allowSystem: false, systemId: SYSTEM_POOL_IDS.personnelServicePool },
        { apply: { mode: 'value', path: ['patch', 'pool'] } },
      );
      if (resolved.clarification) {
        return this.buildClarificationResponse(resolved.clarification, context);
      }
      if (resolved.feedback) {
        return this.buildFeedbackResponse(resolved.feedback);
      }
      updated.poolId = resolved.id ?? updated.poolId;
      changed = true;
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    const nextServices = snapshot.personnelServices.map((entry) =>
      entry.id === service.id ? updated : entry,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      personnelServices: nextServices,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary = `Personaldienst "${updated.name}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'update', entityType: 'personnelService', id: service.id, label: updated.name },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  buildDeletePersonnelServicePoolPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['personnelServicePool']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Personaldienstpool fehlt.');
    }

    const targetResult = this.findByIdOrName(snapshot.personnelServicePools, targetRecord, {
      label: 'Personaldienstpool',
      nameKeys: ['name', 'poolName'],
      clarification: { apply: { mode: 'target', path: ['target'] } },
    });
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(targetResult.feedback ?? 'Pool nicht gefunden.');
    }

    if (targetResult.item.id === SYSTEM_POOL_IDS.personnelServicePool) {
      return this.buildFeedbackResponse('System-Pool kann nicht gelöscht werden.');
    }

    const pool = targetResult.item;
    const systemPool = snapshot.personnelServicePools.find(
      (entry) => entry.id === SYSTEM_POOL_IDS.personnelServicePool,
    );
    if (!systemPool) {
      return this.buildFeedbackResponse('System-Pool nicht gefunden.');
    }

    const affectedServices = snapshot.personnelServices.filter(
      (service) => service.poolId === pool.id,
    );
    const nextServices = snapshot.personnelServices.map((service) =>
      service.poolId === pool.id ? { ...service, poolId: systemPool.id } : service,
    );
    const nextPools = snapshot.personnelServicePools.filter((entry) => entry.id !== pool.id);
    const nextSystemPool = {
      ...systemPool,
      serviceIds: Array.from(new Set([...systemPool.serviceIds, ...pool.serviceIds])),
    };

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      personnelServicePools: nextPools.map((entry) =>
        entry.id === systemPool.id ? nextSystemPool : entry,
      ),
      personnelServices: nextServices,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary = affectedServices.length
      ? `Personaldienstpool "${pool.name}" gelöscht (${affectedServices.length} Dienste verschoben).`
      : `Personaldienstpool "${pool.name}" gelöscht.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'delete', entityType: 'personnelServicePool', id: pool.id, label: pool.name },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  buildDeletePersonnelServicePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['personnelService']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Personaldienst fehlt.');
    }

    const targetResult = this.findByIdOrName(snapshot.personnelServices, targetRecord, {
      label: 'Dienst',
      nameKeys: ['name', 'serviceName'],
      clarification: { apply: { mode: 'target', path: ['target'] } },
    });
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(targetResult.feedback ?? 'Dienst nicht gefunden.');
    }

    const service = targetResult.item;
    if (service.poolId === SYSTEM_POOL_IDS.personnelServicePool) {
      return this.buildFeedbackResponse('Dienst befindet sich bereits im System-Pool.');
    }

    const systemPool = snapshot.personnelServicePools.find(
      (entry) => entry.id === SYSTEM_POOL_IDS.personnelServicePool,
    );
    if (!systemPool) {
      return this.buildFeedbackResponse('System-Pool nicht gefunden.');
    }

    const nextServices = snapshot.personnelServices.map((entry) =>
      entry.id === service.id ? { ...entry, poolId: systemPool.id } : entry,
    );
    const nextPools = snapshot.personnelServicePools.map((entry) => {
      if (entry.id === systemPool.id) {
        return {
          ...entry,
          serviceIds: Array.from(new Set([...entry.serviceIds, service.id])),
        };
      }
      if (entry.id === service.poolId) {
        return { ...entry, serviceIds: entry.serviceIds.filter((id) => id !== service.id) };
      }
      return entry;
    });

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      personnelServicePools: nextPools,
      personnelServices: nextServices,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary = `Personaldienst "${service.name}" gelöscht.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'delete', entityType: 'personnelService', id: service.id, label: service.name },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private normalizePersonnelServices(values: unknown[]): Array<{
    name: string;
    description?: string;
    startTime?: string;
    endTime?: string;
    isNightService?: boolean;
    requiredQualifications?: string[];
    maxDailyInstances?: number;
    maxResourcesPerInstance?: number;
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
            isNightService: this.parseBoolean(record['isNightService']),
            requiredQualifications: this.parseStringArray(record['requiredQualifications']),
            maxDailyInstances: this.parseNumber(record['maxDailyInstances']),
            maxResourcesPerInstance: this.parseNumber(record['maxResourcesPerInstance']),
          };
        }
        return null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => !!entry);
  }
}
