import type { AssistantActionChangeDto } from './assistant.dto';
import type {
  ActionApplyOutcome,
  ActionContext,
  ActionPayload,
  ClarificationRequest,
} from './assistant-action.engine.types';
import type {
  ResourceSnapshot,
  VehicleComposition,
  VehicleType,
} from '../planning/planning.types';
import { AssistantActionBase } from './assistant-action.base';

export class AssistantActionVehicleMeta extends AssistantActionBase {
  buildVehicleTypePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.vehicleTypes ?? payload.vehicleType ?? payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse(
        'Mindestens ein Fahrzeugtyp wird benötigt.',
      );
    }

    const types: VehicleType[] = [];
    const changes: AssistantActionChangeDto[] = [];
    const seenLabels = new Set<string>();

    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const record = this.asRecord(raw);
      const label =
        this.cleanText(typeof raw === 'string' ? raw : record?.['label']) ??
        this.cleanText(record?.['name']);
      if (!label) {
        return this.buildFeedbackResponse('Bezeichnung fehlt.');
      }
      const normalizedLabel = this.normalizeKey(label);
      if (seenLabels.has(normalizedLabel)) {
        return this.buildFeedbackResponse(
          `Fahrzeugtyp "${label}" ist doppelt angegeben.`,
        );
      }
      if (
        snapshot.vehicleTypes.some(
          (entry) => this.normalizeKey(entry.label) === normalizedLabel,
        )
      ) {
        return this.buildFeedbackResponse(
          `Fahrzeugtyp "${label}" existiert bereits.`,
        );
      }
      seenLabels.add(normalizedLabel);

      const tiltingRaw = this.cleanText(record?.['tiltingCapability']);
      const tilting =
        tiltingRaw === 'none' ||
        tiltingRaw === 'passive' ||
        tiltingRaw === 'active'
          ? tiltingRaw
          : undefined;
      if (tiltingRaw && !tilting) {
        return this.buildFeedbackResponse(
          `Fahrzeugtyp "${label}": Neigetechnik ist ungültig.`,
        );
      }

      const powerSupplySystems = this.parseStringArray(
        record?.['powerSupplySystems'],
      );
      const trainProtectionSystems = this.parseStringArray(
        record?.['trainProtectionSystems'],
      );

      const type: VehicleType = {
        id: this.generateId('VT'),
        label,
        category: this.cleanText(record?.['category']),
        capacity: this.parseNumber(record?.['capacity']),
        maxSpeed: this.parseNumber(record?.['maxSpeed']),
        maintenanceIntervalDays: this.parseNumber(
          record?.['maintenanceIntervalDays'],
        ),
        energyType: this.cleanText(record?.['energyType']),
        manufacturer: this.cleanText(record?.['manufacturer']),
        trainTypeCode: this.cleanText(record?.['trainTypeCode']),
        lengthMeters: this.parseNumber(record?.['lengthMeters']),
        weightTons: this.parseNumber(record?.['weightTons']),
        brakeType: this.cleanText(record?.['brakeType']),
        brakePercentage: this.parseNumber(record?.['brakePercentage']),
        tiltingCapability: tilting ?? null,
        powerSupplySystems: powerSupplySystems?.length
          ? powerSupplySystems
          : undefined,
        trainProtectionSystems: trainProtectionSystems?.length
          ? trainProtectionSystems
          : undefined,
        etcsLevel: this.cleanText(record?.['etcsLevel']),
        gaugeProfile: this.cleanText(record?.['gaugeProfile']),
        maxAxleLoad: this.parseNumber(record?.['maxAxleLoad']),
        noiseCategory: this.cleanText(record?.['noiseCategory']),
        remarks: this.cleanText(record?.['remarks']),
      };
      types.push(type);
      changes.push({
        kind: 'create',
        entityType: 'vehicleType',
        id: type.id,
        label: type.label,
      });
    }

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicleTypes: [...snapshot.vehicleTypes, ...types],
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary =
      types.length === 1
        ? `Neuer Fahrzeugtyp "${types[0].label}".`
        : `Neue Fahrzeugtypen (${types.length}).`;

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  buildUpdateVehicleTypePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['vehicleType']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Fahrzeugtyp fehlt.');
    }

    const typeRef =
      this.extractFirstText(targetRecord, [
        'id',
        'typeId',
        'label',
        'name',
        'typeLabel',
        'vehicleType',
      ]) ?? '';
    if (!typeRef) {
      return this.buildFeedbackResponse('Ziel-Fahrzeugtyp fehlt.');
    }
    const resolved = this.resolveVehicleTypeIdByReference(
      snapshot.vehicleTypes,
      typeRef,
      {
        apply: { mode: 'target', path: ['target'] },
      },
    );
    if (resolved.clarification) {
      return this.buildClarificationResponse(resolved.clarification, context);
    }
    if (resolved.feedback || !resolved.id) {
      return this.buildFeedbackResponse(
        resolved.feedback ?? 'Fahrzeugtyp nicht gefunden.',
      );
    }

    const type = snapshot.vehicleTypes.find(
      (entry) => entry.id === resolved.id,
    );
    if (!type) {
      return this.buildFeedbackResponse('Fahrzeugtyp nicht gefunden.');
    }

    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const updated: VehicleType = { ...type };
    let changed = false;

    if (this.hasOwn(patch, 'label')) {
      const label = this.cleanText(patch['label']);
      if (!label) {
        return this.buildFeedbackResponse('Bezeichnung darf nicht leer sein.');
      }
      if (
        snapshot.vehicleTypes.some(
          (entry) =>
            entry.id !== type.id &&
            this.normalizeKey(entry.label) === this.normalizeKey(label),
        )
      ) {
        return this.buildFeedbackResponse(
          `Bezeichnung "${label}" ist bereits vergeben.`,
        );
      }
      updated.label = label;
      changed = true;
    }

    if (this.hasOwn(patch, 'category')) {
      updated.category = this.cleanText(patch['category']);
      changed = true;
    }
    if (this.hasOwn(patch, 'capacity')) {
      updated.capacity = this.parseNumber(patch['capacity']);
      changed = true;
    }
    if (this.hasOwn(patch, 'maxSpeed')) {
      updated.maxSpeed = this.parseNumber(patch['maxSpeed']);
      changed = true;
    }
    if (this.hasOwn(patch, 'maintenanceIntervalDays')) {
      updated.maintenanceIntervalDays = this.parseNumber(
        patch['maintenanceIntervalDays'],
      );
      changed = true;
    }
    if (this.hasOwn(patch, 'energyType')) {
      updated.energyType = this.cleanText(patch['energyType']);
      changed = true;
    }
    if (this.hasOwn(patch, 'manufacturer')) {
      updated.manufacturer = this.cleanText(patch['manufacturer']);
      changed = true;
    }
    if (this.hasOwn(patch, 'trainTypeCode')) {
      updated.trainTypeCode = this.cleanText(patch['trainTypeCode']);
      changed = true;
    }
    if (this.hasOwn(patch, 'lengthMeters')) {
      updated.lengthMeters = this.parseNumber(patch['lengthMeters']);
      changed = true;
    }
    if (this.hasOwn(patch, 'weightTons')) {
      updated.weightTons = this.parseNumber(patch['weightTons']);
      changed = true;
    }
    if (this.hasOwn(patch, 'brakeType')) {
      updated.brakeType = this.cleanText(patch['brakeType']);
      changed = true;
    }
    if (this.hasOwn(patch, 'brakePercentage')) {
      updated.brakePercentage = this.parseNumber(patch['brakePercentage']);
      changed = true;
    }
    if (this.hasOwn(patch, 'tiltingCapability')) {
      const tiltingRaw = this.cleanText(patch['tiltingCapability']);
      const tilting =
        tiltingRaw === 'none' ||
        tiltingRaw === 'passive' ||
        tiltingRaw === 'active'
          ? tiltingRaw
          : undefined;
      if (tiltingRaw && !tilting) {
        return this.buildFeedbackResponse('Neigetechnik ist ungültig.');
      }
      updated.tiltingCapability = tilting ?? null;
      changed = true;
    }
    if (this.hasOwn(patch, 'powerSupplySystems')) {
      const values = this.parseStringArray(patch['powerSupplySystems']);
      updated.powerSupplySystems = values?.length ? values : undefined;
      changed = true;
    }
    if (this.hasOwn(patch, 'trainProtectionSystems')) {
      const values = this.parseStringArray(patch['trainProtectionSystems']);
      updated.trainProtectionSystems = values?.length ? values : undefined;
      changed = true;
    }
    if (this.hasOwn(patch, 'etcsLevel')) {
      updated.etcsLevel = this.cleanText(patch['etcsLevel']);
      changed = true;
    }
    if (this.hasOwn(patch, 'gaugeProfile')) {
      updated.gaugeProfile = this.cleanText(patch['gaugeProfile']);
      changed = true;
    }
    if (this.hasOwn(patch, 'maxAxleLoad')) {
      updated.maxAxleLoad = this.parseNumber(patch['maxAxleLoad']);
      changed = true;
    }
    if (this.hasOwn(patch, 'noiseCategory')) {
      updated.noiseCategory = this.cleanText(patch['noiseCategory']);
      changed = true;
    }
    if (this.hasOwn(patch, 'remarks')) {
      updated.remarks = this.cleanText(patch['remarks']);
      changed = true;
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    const nextTypes = snapshot.vehicleTypes.map((entry) =>
      entry.id === type.id ? updated : entry,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicleTypes: nextTypes,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary = `Fahrzeugtyp "${updated.label}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'update',
        entityType: 'vehicleType',
        id: type.id,
        label: updated.label,
      },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  buildDeleteVehicleTypePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['vehicleType']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Fahrzeugtyp fehlt.');
    }

    const typeRef =
      this.extractFirstText(targetRecord, [
        'id',
        'typeId',
        'label',
        'name',
        'typeLabel',
        'vehicleType',
      ]) ?? '';
    if (!typeRef) {
      return this.buildFeedbackResponse('Ziel-Fahrzeugtyp fehlt.');
    }
    const resolved = this.resolveVehicleTypeIdByReference(
      snapshot.vehicleTypes,
      typeRef,
      {
        apply: { mode: 'target', path: ['target'] },
      },
    );
    if (resolved.clarification) {
      return this.buildClarificationResponse(resolved.clarification, context);
    }
    if (resolved.feedback || !resolved.id) {
      return this.buildFeedbackResponse(
        resolved.feedback ?? 'Fahrzeugtyp nicht gefunden.',
      );
    }

    const type = snapshot.vehicleTypes.find(
      (entry) => entry.id === resolved.id,
    );
    if (!type) {
      return this.buildFeedbackResponse('Fahrzeugtyp nicht gefunden.');
    }

    const nextTypes = snapshot.vehicleTypes.filter(
      (entry) => entry.id !== type.id,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicleTypes: nextTypes,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary = `Fahrzeugtyp "${type.label}" gelöscht.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'vehicleType',
        id: type.id,
        label: type.label,
      },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  buildVehicleCompositionPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.vehicleCompositions ??
        payload.vehicleComposition ??
        payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse(
        'Mindestens eine Komposition wird benötigt.',
      );
    }

    const compositions: VehicleComposition[] = [];
    const changes: AssistantActionChangeDto[] = [];
    const seenNames = new Set<string>();

    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const record = this.asRecord(raw) ?? {};
      const name =
        this.cleanText(typeof raw === 'string' ? raw : record['name']) ??
        this.cleanText(record['label']);
      if (!name) {
        return this.buildFeedbackResponse('Kompositionsname fehlt.');
      }
      const normalizedName = this.normalizeKey(name);
      if (seenNames.has(normalizedName)) {
        return this.buildFeedbackResponse(
          `Komposition "${name}" ist doppelt angegeben.`,
        );
      }
      if (
        snapshot.vehicleCompositions.some(
          (entry) => this.normalizeKey(entry.name) === normalizedName,
        )
      ) {
        return this.buildFeedbackResponse(
          `Komposition "${name}" existiert bereits.`,
        );
      }
      seenNames.add(normalizedName);

      const entriesResult = this.resolveVehicleCompositionEntries(
        snapshot.vehicleTypes,
        record,
        ['vehicleCompositions', index, 'entries'],
      );
      if (entriesResult.clarification) {
        return this.buildClarificationResponse(
          entriesResult.clarification,
          context,
        );
      }
      if (entriesResult.feedback) {
        return this.buildFeedbackResponse(entriesResult.feedback);
      }
      const entries = entriesResult.entries ?? [];
      if (!entries.length) {
        return this.buildFeedbackResponse(
          `Komposition "${name}": Mindestens ein Fahrzeugtyp ist erforderlich.`,
        );
      }

      const composition: VehicleComposition = {
        id: this.generateId('VC'),
        name,
        entries,
        turnaroundBuffer: this.cleanText(record['turnaroundBuffer']),
        remark: this.cleanText(record['remark']),
      };
      compositions.push(composition);
      changes.push({
        kind: 'create',
        entityType: 'vehicleComposition',
        id: composition.id,
        label: composition.name,
      });
    }

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicleCompositions: [...snapshot.vehicleCompositions, ...compositions],
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary =
      compositions.length === 1
        ? `Neue Komposition "${compositions[0].name}".`
        : `Neue Kompositionen (${compositions.length}).`;

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  buildUpdateVehicleCompositionPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, [
      'vehicleComposition',
    ]);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Komposition fehlt.');
    }

    const targetResult = this.findByIdOrName(
      snapshot.vehicleCompositions,
      targetRecord,
      {
        label: 'Komposition',
        nameKeys: ['name', 'label'],
        idKeys: ['id', 'compositionId'],
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
        targetResult.feedback ?? 'Komposition nicht gefunden.',
      );
    }

    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const composition = targetResult.item;
    const updated: VehicleComposition = { ...composition };
    let changed = false;

    if (this.hasOwn(patch, 'name')) {
      const name = this.cleanText(patch['name']);
      if (!name) {
        return this.buildFeedbackResponse('Name darf nicht leer sein.');
      }
      if (
        snapshot.vehicleCompositions.some(
          (entry) =>
            entry.id !== composition.id &&
            this.normalizeKey(entry.name) === this.normalizeKey(name),
        )
      ) {
        return this.buildFeedbackResponse(
          `Name "${name}" ist bereits vergeben.`,
        );
      }
      updated.name = name;
      changed = true;
    }

    if (this.hasAnyKey(patch, ['entries', 'entriesSerialized'])) {
      const entriesResult = this.resolveVehicleCompositionEntries(
        snapshot.vehicleTypes,
        patch,
        ['patch', 'entries'],
      );
      if (entriesResult.clarification) {
        return this.buildClarificationResponse(
          entriesResult.clarification,
          context,
        );
      }
      if (entriesResult.feedback) {
        return this.buildFeedbackResponse(entriesResult.feedback);
      }
      const entries = entriesResult.entries ?? [];
      if (!entries.length) {
        return this.buildFeedbackResponse(
          'Mindestens ein Fahrzeugtyp ist erforderlich.',
        );
      }
      updated.entries = entries;
      changed = true;
    }

    if (this.hasOwn(patch, 'turnaroundBuffer')) {
      updated.turnaroundBuffer = this.cleanText(patch['turnaroundBuffer']);
      changed = true;
    }

    if (this.hasOwn(patch, 'remark')) {
      updated.remark = this.cleanText(patch['remark']);
      changed = true;
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    const nextCompositions = snapshot.vehicleCompositions.map((entry) =>
      entry.id === composition.id ? updated : entry,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicleCompositions: nextCompositions,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const label = updated.name ?? composition.name;
    const summary = `Komposition "${label}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'update',
        entityType: 'vehicleComposition',
        id: composition.id,
        label,
      },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  buildDeleteVehicleCompositionPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, [
      'vehicleComposition',
    ]);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Komposition fehlt.');
    }

    const targetResult = this.findByIdOrName(
      snapshot.vehicleCompositions,
      targetRecord,
      {
        label: 'Komposition',
        nameKeys: ['name', 'label'],
        idKeys: ['id', 'compositionId'],
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
        targetResult.feedback ?? 'Komposition nicht gefunden.',
      );
    }

    const composition = targetResult.item;
    const nextCompositions = snapshot.vehicleCompositions.filter(
      (entry) => entry.id !== composition.id,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicleCompositions: nextCompositions,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary = `Komposition "${composition.name}" gelöscht.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'vehicleComposition',
        id: composition.id,
        label: composition.name,
      },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private resolveVehicleCompositionEntries(
    types: VehicleType[],
    record: Record<string, unknown>,
    basePath: Array<string | number>,
  ): {
    entries?: VehicleComposition['entries'];
    feedback?: string;
    clarification?: ClarificationRequest;
  } {
    const entriesRaw = Array.isArray(record['entries'])
      ? record['entries']
      : [];
    const serialized = this.cleanText(record['entriesSerialized']) ?? '';
    const parsedEntries: Array<{ typeRef: string; quantity: number }> = [];

    if (entriesRaw.length) {
      entriesRaw.forEach((entry) => {
        if (typeof entry === 'string') {
          const ref = this.cleanText(entry);
          if (ref) {
            parsedEntries.push({ typeRef: ref, quantity: 1 });
          }
          return;
        }
        const entryRecord = this.asRecord(entry);
        if (!entryRecord) {
          return;
        }
        const typeRef =
          this.cleanText(
            entryRecord['typeId'] ??
              entryRecord['type'] ??
              entryRecord['typeLabel'] ??
              entryRecord['vehicleType'],
          ) ?? '';
        const quantityRaw = this.parseNumber(
          entryRecord['quantity'] ?? entryRecord['count'],
        );
        const quantity =
          quantityRaw && Number.isFinite(quantityRaw)
            ? Math.max(1, Math.trunc(quantityRaw))
            : 1;
        if (typeRef) {
          parsedEntries.push({ typeRef, quantity });
        }
      });
    } else if (serialized) {
      const lines = serialized
        .split('\\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      lines.forEach((line) => {
        const [typePart, quantityPart] = line
          .split(':')
          .map((part) => part.trim());
        const typeRef = typePart ?? '';
        const quantity = Math.max(
          1,
          Number.parseInt(quantityPart ?? '1', 10) || 1,
        );
        if (typeRef) {
          parsedEntries.push({ typeRef, quantity });
        }
      });
    }

    const entries: VehicleComposition['entries'] = [];
    for (let index = 0; index < parsedEntries.length; index += 1) {
      const entry = parsedEntries[index];
      if (!entry.typeRef) {
        return { feedback: 'Fahrzeugtyp fehlt.' };
      }
      const resolved = this.resolveVehicleTypeIdByReference(
        types,
        entry.typeRef,
        {
          apply: {
            mode: 'value',
            path: [...basePath, index, 'typeId'],
          },
        },
      );
      if (resolved.clarification) {
        return { clarification: resolved.clarification };
      }
      if (resolved.feedback || !resolved.id) {
        return { feedback: resolved.feedback ?? 'Fahrzeugtyp nicht gefunden.' };
      }

      entries.push({ typeId: resolved.id, quantity: entry.quantity });
    }

    return { entries };
  }
}
