import type { AssistantActionClarificationApply } from './assistant-action-clarification.store';
import type { AssistantActionChangeDto } from './assistant.dto';
import type {
  ActionApplyOutcome,
  ActionContext,
  ActionPayload,
  ClarificationRequest,
} from './assistant-action.engine.types';
import type {
  Personnel,
  PersonnelPool,
  PersonnelService,
  ResourceSnapshot,
  TemporalValue,
} from '../planning/planning.types';
import { SYSTEM_POOL_IDS } from '../planning/planning-master-data.constants';
import { AssistantActionBase } from './assistant-action.base';

export class AssistantActionPersonnel extends AssistantActionBase {
  buildPersonnelPoolPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const poolSource =
      payload.pool ?? payloadRecord['personnelPool'] ?? payloadRecord['pool'];
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

    if (this.hasNameCollision(snapshot.personnelPools, poolName)) {
      return this.buildFeedbackResponse(
        `Personalpool "${poolName}" existiert bereits.`,
      );
    }

    const depotRef = this.parsePoolReference(
      poolRecord?.['homeDepotId'] ??
        poolRecord?.['homeDepot'] ??
        poolRecord?.['homeDepotName'],
    );
    let homeDepotId: string | undefined;
    if (depotRef) {
      const resolved = this.resolveHomeDepotIdByReference(
        snapshot.homeDepots,
        depotRef,
        {
          title: `Mehrere Heimatdepots fuer "${depotRef}" gefunden. Welches meinst du?`,
          apply: { mode: 'value', path: ['pool', 'homeDepot'] },
        },
      );
      if (resolved.clarification) {
        return this.buildClarificationResponse(resolved.clarification, context);
      }
      if (resolved.feedback) {
        return this.buildFeedbackResponse(resolved.feedback);
      }
      homeDepotId = resolved.id;
    }

    const poolId = this.generateId('PP');
    const pool: PersonnelPool = {
      id: poolId,
      name: poolName,
      description: this.cleanText(poolRecord?.['description']),
      homeDepotId,
      locationCode: this.cleanText(poolRecord?.['locationCode']),
      personnelIds: [],
    };

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      personnelPools: [...snapshot.personnelPools, pool],
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary = `Neuer Personalpool "${poolName}".`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'create',
        entityType: 'personnelPool',
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

  buildPersonnelPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.personnel ??
        payloadRecord['person'] ??
        payloadRecord['people'] ??
        payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse(
        'Mindestens eine Person wird benötigt.',
      );
    }

    const defaultPoolRef = this.parsePoolReference(
      payload.pool ?? payloadRecord['pool'] ?? payloadRecord['poolName'],
    );
    const servicePoolLabels = new Map(
      snapshot.personnelServicePools.map((pool) => [pool.id, pool.name]),
    );
    const personnel: Personnel[] = [];
    const changes: AssistantActionChangeDto[] = [];
    const poolNames = new Set<string>();
    const seenPersonnelNames = new Set<string>();

    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const record = this.asRecord(raw);
      let firstName = this.cleanText(record?.['firstName']);
      let lastName = this.cleanText(record?.['lastName']);

      if (!firstName || !lastName) {
        const fullName =
          this.cleanText(
            typeof raw === 'string'
              ? raw
              : (record?.['name'] ?? record?.['fullName'] ?? record?.['label']),
          ) ?? undefined;
        if (fullName) {
          const parsed = this.splitFullName(fullName);
          firstName = firstName ?? parsed.firstName;
          lastName = lastName ?? parsed.lastName;
        }
      }

      if (!firstName || !lastName) {
        return this.buildFeedbackResponse('Vor- und Nachname fehlen.');
      }
      const fullName = `${firstName} ${lastName}`;
      const normalizedName = this.normalizeKey(fullName);
      if (seenPersonnelNames.has(normalizedName)) {
        return this.buildFeedbackResponse(
          `Personal "${fullName}" ist doppelt angegeben.`,
        );
      }
      seenPersonnelNames.add(normalizedName);

      const recordPoolRef = this.parsePoolReference(
        record?.['pool'] ?? record?.['poolName'] ?? record?.['poolId'],
      );
      const poolRef = recordPoolRef ?? defaultPoolRef;
      if (!poolRef) {
        return this.buildFeedbackResponse(
          `Personal "${firstName} ${lastName}": Pool fehlt.`,
        );
      }

      const resolvedPool = this.resolvePoolIdByReference(
        snapshot.personnelPools,
        poolRef,
        'Personalpool',
        { allowSystem: false, systemId: SYSTEM_POOL_IDS.personnelPool },
        {
          title: `Mehrere Personalpools mit Namen "${poolRef}" gefunden. Welchen meinst du?`,
          apply: {
            mode: 'value',
            path: recordPoolRef ? ['personnel', index, 'pool'] : ['pool'],
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
          `Personal "${firstName} ${lastName}": ${resolvedPool.feedback}`,
        );
      }

      const serviceNames = this.parseStringArray(
        record?.['services'] ??
          record?.['serviceNames'] ??
          record?.['serviceIds'],
      );
      const serviceResult = this.resolvePersonnelServiceIds(
        snapshot.personnelServices,
        serviceNames,
        serviceNames?.length
          ? {
              applyPath: ['personnel', index, 'services'],
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
          `Personal "${firstName} ${lastName}": ${serviceResult.feedback}`,
        );
      }

      const person: Personnel = {
        id: this.generateId('P'),
        firstName,
        lastName,
        preferredName: this.cleanText(record?.['preferredName']),
        qualifications: this.parseStringArray(record?.['qualifications']),
        serviceIds: serviceResult.ids,
        poolId: resolvedPool.id,
        homeStation: this.cleanText(record?.['homeStation']),
        availabilityStatus: this.cleanText(record?.['availabilityStatus']),
        qualificationExpires: this.cleanText(record?.['qualificationExpires']),
        isReserve: this.parseBoolean(record?.['isReserve']),
      };
      personnel.push(person);

      const label = `${firstName} ${lastName}`;
      const poolLabel = resolvedPool.label ?? poolRef;
      poolNames.add(poolLabel);
      changes.push({
        kind: 'create',
        entityType: 'personnel',
        id: person.id,
        label,
        details: `Pool ${poolLabel}`,
      });
    }

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      personnel: [...snapshot.personnel, ...personnel],
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary =
      poolNames.size === 1
        ? `Neues Personal (${personnel.length}) im Pool "${Array.from(poolNames)[0]}".`
        : `Neues Personal (${personnel.length}).`;

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  buildUpdatePersonnelPoolPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, [
      'pool',
      'personnelPool',
    ]);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Personalpool fehlt.');
    }

    const targetResult = this.findByIdOrName(
      snapshot.personnelPools,
      targetRecord,
      {
        label: 'Personalpool',
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
    if (pool.id === SYSTEM_POOL_IDS.personnelPool) {
      return this.buildFeedbackResponse(
        'System-Pool kann nicht geändert werden.',
      );
    }

    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const updated: PersonnelPool = { ...pool };
    let changed = false;

    if (this.hasOwn(patch, 'name')) {
      const name = this.cleanText(patch['name']);
      if (!name) {
        return this.buildFeedbackResponse('Name darf nicht leer sein.');
      }
      if (this.hasNameCollision(snapshot.personnelPools, name, pool.id)) {
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

    const hasDepotPatch = this.hasAnyKey(patch, [
      'homeDepotId',
      'homeDepot',
      'homeDepotName',
    ]);
    if (hasDepotPatch) {
      const depotRef = this.extractReference(patch, [
        'homeDepotId',
        'homeDepot',
        'homeDepotName',
      ]);
      if (depotRef) {
        const resolved = this.resolveHomeDepotIdByReference(
          snapshot.homeDepots,
          depotRef,
          {
            apply: { mode: 'value', path: ['patch', 'homeDepot'] },
          },
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
        updated.homeDepotId = resolved.id;
      } else {
        updated.homeDepotId = undefined;
      }
      changed = true;
    }

    if (this.hasOwn(patch, 'locationCode')) {
      updated.locationCode = this.cleanText(patch['locationCode']);
      changed = true;
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    const nextPools = snapshot.personnelPools.map((entry) =>
      entry.id === pool.id ? updated : entry,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      personnelPools: nextPools,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const label = updated.name ?? pool.name;
    const summary = `Personalpool "${label}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'update', entityType: 'personnelPool', id: pool.id, label },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  buildUpdatePersonnelPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, [
      'personnel',
      'person',
    ]);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Personal fehlt.');
    }

    const poolLabels = new Map(
      snapshot.personnelPools.map((pool) => [pool.id, pool.name]),
    );
    const targetResult = this.resolvePersonnelTarget(
      snapshot.personnel,
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
        targetResult.feedback ?? 'Personal nicht gefunden.',
      );
    }

    const person = targetResult.item;
    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const updated: Personnel = { ...person };
    let changed = false;
    const servicePoolLabels = new Map(
      snapshot.personnelServicePools.map((pool) => [pool.id, pool.name]),
    );

    if (this.hasAnyKey(patch, ['name', 'fullName'])) {
      const fullName = this.extractFirstText(patch, ['name', 'fullName']);
      if (!fullName) {
        return this.buildFeedbackResponse('Name darf nicht leer sein.');
      }
      const parsed = this.splitFullName(fullName);
      if (!parsed.firstName || !parsed.lastName) {
        return this.buildFeedbackResponse('Vor- und Nachname fehlen.');
      }
      updated.firstName = parsed.firstName;
      updated.lastName = parsed.lastName;
      changed = true;
    }

    if (this.hasOwn(patch, 'firstName')) {
      const firstName = this.cleanText(patch['firstName']);
      if (!firstName) {
        return this.buildFeedbackResponse('Vorname darf nicht leer sein.');
      }
      updated.firstName = firstName;
      changed = true;
    }

    if (this.hasOwn(patch, 'lastName')) {
      const lastName = this.cleanText(patch['lastName']);
      if (!lastName) {
        return this.buildFeedbackResponse('Nachname darf nicht leer sein.');
      }
      updated.lastName = lastName;
      changed = true;
    }

    if (this.hasOwn(patch, 'preferredName')) {
      updated.preferredName = this.cleanText(patch['preferredName']);
      changed = true;
    }

    if (this.hasAnyKey(patch, ['qualifications', 'qualification'])) {
      updated.qualifications = this.parseStringArray(
        patch['qualifications'] ?? patch['qualification'],
      );
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
      const serviceResult = this.resolvePersonnelServiceIds(
        snapshot.personnelServices,
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

    const hasPoolPatch = this.hasAnyKey(patch, ['poolId', 'pool', 'poolName']);
    if (hasPoolPatch) {
      const poolRef = this.extractReference(patch, [
        'poolId',
        'pool',
        'poolName',
      ]);
      if (!poolRef) {
        return this.buildFeedbackResponse('Personalpool fehlt.');
      }
      const resolved = this.resolvePoolIdByReference(
        snapshot.personnelPools,
        poolRef,
        'Personalpool',
        {
          allowSystem: false,
          systemId: SYSTEM_POOL_IDS.personnelPool,
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
    }

    if (this.hasOwn(patch, 'homeStation')) {
      updated.homeStation = this.cleanText(patch['homeStation']);
      changed = true;
    }

    if (this.hasOwn(patch, 'availabilityStatus')) {
      updated.availabilityStatus = this.cleanText(patch['availabilityStatus']);
      changed = true;
    }

    if (this.hasOwn(patch, 'qualificationExpires')) {
      updated.qualificationExpires = this.cleanText(
        patch['qualificationExpires'],
      );
      changed = true;
    }

    if (this.hasOwn(patch, 'isReserve')) {
      updated.isReserve = this.parseBoolean(patch['isReserve']);
      changed = true;
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    const nextPersonnel = snapshot.personnel.map((entry) =>
      entry.id === person.id ? updated : entry,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      personnel: nextPersonnel,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const label = this.formatPersonnelLabel(updated);
    const summary = `Personal "${label}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'update', entityType: 'personnel', id: person.id, label },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  buildDeletePersonnelPoolPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, [
      'pool',
      'personnelPool',
    ]);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Personalpool fehlt.');
    }

    const targetResult = this.findByIdOrName(
      snapshot.personnelPools,
      targetRecord,
      {
        label: 'Personalpool',
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
    if (pool.id === SYSTEM_POOL_IDS.personnelPool) {
      return this.buildFeedbackResponse(
        'System-Pool kann nicht gelöscht werden.',
      );
    }

    const movedPersonnel = snapshot.personnel.filter(
      (person) => person.poolId === pool.id,
    );
    const nextPersonnel = snapshot.personnel.map((person) =>
      person.poolId === pool.id
        ? { ...person, poolId: SYSTEM_POOL_IDS.personnelPool }
        : person,
    );
    const nextPools = snapshot.personnelPools.filter(
      (entry) => entry.id !== pool.id,
    );

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      personnel: nextPersonnel,
      personnelPools: nextPools,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary = `Personalpool "${pool.name}" gelöscht (${movedPersonnel.length} Personen in System-Pool).`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'personnelPool',
        id: pool.id,
        label: pool.name,
        details: 'System-Pool',
      },
      ...movedPersonnel.map(
        (person): AssistantActionChangeDto => ({
          kind: 'update',
          entityType: 'personnel',
          id: person.id,
          label: this.formatPersonnelLabel(person),
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

  buildDeletePersonnelPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, [
      'personnel',
      'person',
    ]);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Personal fehlt.');
    }

    const poolLabels = new Map(
      snapshot.personnelPools.map((pool) => [pool.id, pool.name]),
    );
    const targetResult = this.resolvePersonnelTarget(
      snapshot.personnel,
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
        targetResult.feedback ?? 'Personal nicht gefunden.',
      );
    }

    const person = targetResult.item;
    if (person.poolId === SYSTEM_POOL_IDS.personnelPool) {
      return this.buildFeedbackResponse(
        'Personal befindet sich bereits im System-Pool.',
      );
    }

    const updated = { ...person, poolId: SYSTEM_POOL_IDS.personnelPool };
    const nextPersonnel = snapshot.personnel.map((entry) =>
      entry.id === person.id ? updated : entry,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      personnel: nextPersonnel,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const label = this.formatPersonnelLabel(person);
    const summary = `Personal "${label}" in System-Pool verschoben.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'personnel',
        id: person.id,
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

  private resolvePersonnelServiceIds(
    services: PersonnelService[],
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
      (service) => service.poolId !== SYSTEM_POOL_IDS.personnelServicePool,
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
            `Personaldienst "${name}" ist nicht eindeutig. Welchen meinst du?`;
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
          feedback: `Personaldienst "${name}" ist nicht eindeutig. ${this.describeCandidates(
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
        feedback: `Personaldienst(e) nicht gefunden: ${missing.join(', ')}`,
      };
    }
    return { ids };
  }

  private resolveTemporalString(
    value?: string | TemporalValue<string>[],
  ): string | undefined {
    if (typeof value === 'string') {
      return value;
    }
    if (Array.isArray(value) && value.length) {
      const last = value[value.length - 1];
      return typeof last?.value === 'string' ? last.value : undefined;
    }
    return undefined;
  }

  private splitFullName(value: string): {
    firstName?: string;
    lastName?: string;
  } {
    const parts = value
      .trim()
      .split(/\\s+/)
      .filter((part) => part.length > 0);
    if (!parts.length) {
      return {};
    }
    if (parts.length === 1) {
      return { firstName: parts[0] };
    }
    return {
      firstName: parts.slice(0, -1).join(' '),
      lastName: parts[parts.length - 1],
    };
  }

  private formatPersonnelLabel(person: Personnel): string {
    const firstName = this.resolveTemporalString(person.firstName) ?? '';
    const lastName = person.lastName ?? '';
    const label = `${firstName} ${lastName}`.trim();
    const preferred = this.resolveTemporalString(person.preferredName);
    return label || preferred || this.cleanText(person.name) || person.id;
  }

  private resolvePersonnelTarget(
    personnel: Personnel[],
    target: Record<string, unknown>,
    options?: {
      clarification?: {
        title?: string;
        apply: AssistantActionClarificationApply;
      };
      poolLabelById?: Map<string, string>;
    },
  ): {
    item?: Personnel;
    feedback?: string;
    clarification?: ClarificationRequest;
  } {
    const id = this.extractFirstText(target, ['id', 'personnelId']);
    if (id) {
      const match = personnel.find((entry) => entry.id === id);
      if (!match) {
        return { feedback: `Personal mit ID "${id}" nicht gefunden.` };
      }
      return { item: match };
    }

    const firstName = this.cleanText(target['firstName']);
    const lastName = this.cleanText(target['lastName']);
    let name =
      this.cleanText(target['name']) ??
      this.cleanText(target['fullName']) ??
      this.cleanText(target['label']);
    if (!name && firstName && lastName) {
      name = `${firstName} ${lastName}`;
    }
    if (!name) {
      return { feedback: 'Personalname fehlt.' };
    }

    const normalized = this.normalizeKey(name);
    const matches = personnel.filter(
      (entry) =>
        this.normalizeKey(this.formatPersonnelLabel(entry)) === normalized,
    );
    if (!matches.length) {
      return { feedback: `Personal "${name}" nicht gefunden.` };
    }
    if (matches.length > 1) {
      if (options?.clarification) {
        const title =
          options.clarification.title ??
          `Personal "${name}" ist nicht eindeutig. Welches meinst du?`;
        return {
          clarification: {
            title,
            options: matches.map((entry) => ({
              id: entry.id,
              label: this.formatPersonnelLabel(entry),
              details: entry.poolId
                ? `Pool ${options.poolLabelById?.get(entry.poolId) ?? entry.poolId}`
                : undefined,
            })),
            apply: options.clarification.apply,
          },
        };
      }
      return {
        feedback: `Personal "${name}" ist nicht eindeutig. ${this.describeCandidates(
          matches.map((entry) => this.formatPersonnelLabel(entry)),
        )}`,
      };
    }
    return { item: matches[0] };
  }
}
