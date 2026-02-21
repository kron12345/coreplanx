import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { TrainPlansService } from '../train-plans/train-plans.service';
import type { TrainPlanDto } from '../train-plans/train-plans.types';
import {
  buildOrderingEventKey,
  getOrderingProfile,
  listOrderingProfiles,
  OrderingActionDefinition,
  OrderingProcessProfileDefinition,
  OrderingTransitionDefinition,
  resolveSimulatorEvent,
} from './timetable-ordering.profiles';
import {
  CreateTimetableOrderingCaseInput,
  TimetableOrderingCaseRecord,
  TimetableOrderingMessageRecord,
  TimetableOrderingRepository,
  TimetableOrderingTransitionRecord,
  UpdateTimetableOrderingCaseInput,
} from './timetable-ordering.repository';
import {
  ApplyTimetableOrderingActionPayload,
  ApplyTimetableOrderingEventPayload,
  ApplyTimetableOrderingSimulatorPayload,
  CreateTimetableOrderingCasePayload,
  OrderingAggregatedPhaseSnapshot,
  OrderingEventTuple,
  OrderingOperationalContext,
  OrderingRequiredAttributeStatus,
  TimetableOrderingCaseDetailsDto,
  TimetableOrderingCaseDto,
  TimetableOrderingMessageDto,
  TimetableOrderingProfileSummary,
  TimetableOrderingSnapshotDto,
  TimetableOrderingTransitionDto,
} from './timetable-ordering.types';

type ValidationContext = {
  trainPlanId?: string | null;
  pathRequestId?: string | null;
  pathId?: string | null;
  validFrom: string;
  validTo: string;
  providedAttributes: Record<string, unknown>;
};

@Injectable()
export class TimetableOrderingService {
  constructor(
    private readonly repository: TimetableOrderingRepository,
    private readonly trainPlans: TrainPlansService,
  ) {}

  listProfiles(): TimetableOrderingProfileSummary[] {
    return listOrderingProfiles();
  }

  async listCases(): Promise<TimetableOrderingCaseDto[]> {
    const records = await this.repository.listCases();
    return records.map((record) => this.mapCase(record));
  }

  async getCaseDetails(caseId: string): Promise<TimetableOrderingCaseDetailsDto> {
    const record = await this.requireCase(caseId);
    const [messages, transitions] = await Promise.all([
      this.repository.listMessages(record.id),
      this.repository.listTransitions(record.id),
    ]);
    return {
      case: this.mapCase(record),
      messages: messages.map((entry) => this.mapMessage(entry)),
      transitions: transitions.map((entry) => this.mapTransition(entry)),
    };
  }

  async getSnapshot(caseId: string): Promise<TimetableOrderingSnapshotDto> {
    const record = await this.requireCase(caseId);
    return {
      caseId: record.id,
      profileId: record.profileId,
      currentState: record.currentState,
      isTerminal: record.isTerminal,
      aggregated: record.aggregatedPhase,
      operationalContexts: record.operationalContexts,
      generatedAt: new Date().toISOString(),
    };
  }

  async createCase(
    payload: CreateTimetableOrderingCasePayload,
  ): Promise<TimetableOrderingCaseDetailsDto> {
    const profile = this.requireProfile(payload.profileId);
    const title = payload.title?.trim();
    if (!title) {
      throw new BadRequestException('title ist erforderlich.');
    }

    const validFrom = this.normalizeDateOnly(payload.validFrom, 'validFrom');
    const validTo = this.normalizeDateOnly(payload.validTo, 'validTo');
    if (validTo < validFrom) {
      throw new BadRequestException('validTo darf nicht vor validFrom liegen.');
    }

    const plan = await this.resolveTrainPlan(payload.trainPlanId);
    const providedAttributes = this.mergeAttributes(
      this.seedAttributesFromPlan(plan),
      payload.providedAttributes,
    );

    const pathRequestId =
      this.normalizeNullableText(payload.pathRequestId) ??
      this.normalizeNullableText(plan?.pathRequestId);
    const pathId =
      this.normalizeNullableText(payload.pathId) ??
      this.normalizeNullableText(plan?.pathId);

    const validationContext: ValidationContext = {
      trainPlanId: this.normalizeNullableText(payload.trainPlanId),
      pathRequestId,
      pathId,
      validFrom,
      validTo,
      providedAttributes,
    };

    const requiredAttributes = this.evaluateRequiredAttributes(
      profile,
      validationContext,
    );

    const blockingReasons = this.buildMissingRequiredReasons(requiredAttributes);
    const operationalContexts = this.buildOperationalContexts(
      validFrom,
      validTo,
      profile.initialState,
      false,
    );
    const aggregatedPhase = this.buildAggregatedPhase(
      profile.id,
      profile.initialState,
      false,
      providedAttributes,
    );

    const id = this.generateCaseId();
    const createInput: CreateTimetableOrderingCaseInput = {
      id,
      profileId: profile.id,
      title,
      description: this.normalizeNullableText(payload.description),
      trainPlanId: validationContext.trainPlanId,
      validFrom,
      validTo,
      pathRequestId,
      pathId,
      currentState: profile.initialState,
      isTerminal: false,
      requiredAttributes,
      providedAttributes,
      blockingReasons,
      operationalContexts,
      aggregatedPhase,
    };

    await this.repository.createCase(createInput);

    await this.repository.appendTransition({
      id: randomUUID(),
      caseId: id,
      fromState: '__NEW__',
      toState: profile.initialState,
      eventKey: 'SYSTEM:case_created',
      source: 'system',
      rejected: false,
      reason: null,
      actionId: null,
      meta: {
        profileId: profile.id,
        description: 'Bestellfall angelegt',
      },
    });

    return this.getCaseDetails(id);
  }

  async applyAction(
    caseId: string,
    payload: ApplyTimetableOrderingActionPayload,
  ): Promise<TimetableOrderingCaseDetailsDto> {
    const record = await this.requireCase(caseId);
    const profile = this.requireProfile(record.profileId);

    const actionId = payload.actionId?.trim();
    if (!actionId) {
      throw new BadRequestException('actionId ist erforderlich.');
    }

    const action = profile.actions.find((entry) => entry.id === actionId);
    if (!action) {
      throw new BadRequestException(
        `Aktion ${actionId} ist für Profil ${profile.id} nicht definiert.`,
      );
    }

    const source = this.normalizeNullableText(payload.source) ?? 'cockpit';
    if (!action.fromStates.includes(record.currentState)) {
      await this.repository.appendTransition({
        id: randomUUID(),
        caseId: record.id,
        fromState: record.currentState,
        toState: record.currentState,
        eventKey: buildOrderingEventKey(action.event),
        source,
        actionId: action.id,
        rejected: true,
        reason: `Aktion ${action.id} im Zustand ${record.currentState} nicht erlaubt.`,
        meta: {
          profileId: profile.id,
        },
      });
      return this.getCaseDetails(caseId);
    }

    if (record.isTerminal) {
      throw new BadRequestException('Der Bestellfall ist bereits terminal abgeschlossen.');
    }

    const patchedAttributes = this.mergeAttributes(
      record.providedAttributes,
      payload.providedAttributesPatch,
    );

    const requiredAttributes = this.evaluateRequiredAttributes(profile, {
      trainPlanId: record.trainPlanId,
      pathRequestId: record.pathRequestId,
      pathId: record.pathId,
      validFrom: record.validFrom,
      validTo: record.validTo,
      providedAttributes: patchedAttributes,
    });
    const missingRequiredReasons = this.buildMissingRequiredReasons(requiredAttributes);

    if (action.requiresCompleteRequired && missingRequiredReasons.length) {
      await this.repository.updateCase({
        id: record.id,
        pathRequestId: record.pathRequestId,
        pathId: record.pathId,
        currentState: record.currentState,
        isTerminal: record.isTerminal,
        requiredAttributes,
        providedAttributes: patchedAttributes,
        blockingReasons: missingRequiredReasons,
        operationalContexts: this.rewriteContextsForState(
          record.operationalContexts,
          record.currentState,
          record.isTerminal,
        ),
        aggregatedPhase: this.buildAggregatedPhase(
          record.profileId,
          record.currentState,
          record.isTerminal,
          patchedAttributes,
        ),
      });

      await this.repository.appendTransition({
        id: randomUUID(),
        caseId: record.id,
        fromState: record.currentState,
        toState: record.currentState,
        eventKey: buildOrderingEventKey(action.event),
        source,
        actionId: action.id,
        rejected: true,
        reason: `Pflichtattribute fehlen: ${missingRequiredReasons.join(', ')}`,
        meta: {
          profileId: profile.id,
          missingRequired: missingRequiredReasons,
        },
      });

      return this.getCaseDetails(caseId);
    }

    return this.applyEventInternal({
      record,
      profile,
      event: action.event,
      source,
      direction: 'outbound',
      action,
      payload: payload.payload,
      externalMessageId: payload.externalMessageId,
      providedAttributesPatch: payload.providedAttributesPatch,
    });
  }

  async applyInboundEvent(
    caseId: string,
    payload: ApplyTimetableOrderingEventPayload,
  ): Promise<TimetableOrderingCaseDetailsDto> {
    const record = await this.requireCase(caseId);
    const profile = this.requireProfile(record.profileId);
    const source = this.normalizeNullableText(payload.source) ?? 'external';

    if (!payload.event || !payload.event.actor) {
      throw new BadRequestException('event.actor ist erforderlich.');
    }

    return this.applyEventInternal({
      record,
      profile,
      event: payload.event,
      source,
      direction: 'inbound',
      action: null,
      payload: payload.payload,
      externalMessageId: payload.externalMessageId,
      providedAttributesPatch: payload.providedAttributesPatch,
    });
  }

  async applySimulatorResponse(
    caseId: string,
    payload: ApplyTimetableOrderingSimulatorPayload,
  ): Promise<TimetableOrderingCaseDetailsDto> {
    const record = await this.requireCase(caseId);
    const profile = this.requireProfile(record.profileId);
    if (!payload.response) {
      throw new BadRequestException('response ist erforderlich.');
    }
    const event = resolveSimulatorEvent(payload.response);

    return this.applyEventInternal({
      record,
      profile,
      event,
      source: 'simulator',
      direction: 'inbound',
      action: null,
      payload: {
        simulatorResponse: payload.response,
        ...(payload.payload ?? {}),
      },
      externalMessageId: payload.externalMessageId,
      providedAttributesPatch: undefined,
    });
  }

  private async applyEventInternal(params: {
    record: TimetableOrderingCaseRecord;
    profile: OrderingProcessProfileDefinition;
    event: OrderingEventTuple;
    source: string;
    direction: 'outbound' | 'inbound';
    action: OrderingActionDefinition | null;
    payload?: Record<string, unknown>;
    externalMessageId?: string;
    providedAttributesPatch?: Record<string, unknown>;
  }): Promise<TimetableOrderingCaseDetailsDto> {
    const eventKey = buildOrderingEventKey(params.event);
    const externalMessageId = this.normalizeNullableText(params.externalMessageId);
    if (externalMessageId) {
      const duplicate = await this.repository.getMessageByExternalMessageId(
        params.record.id,
        externalMessageId,
      );
      if (duplicate) {
        await this.repository.appendTransition({
          id: randomUUID(),
          caseId: params.record.id,
          fromState: params.record.currentState,
          toState: params.record.currentState,
          eventKey,
          source: params.source,
          actionId: params.action?.id ?? null,
          rejected: true,
          reason: `Duplikat externalMessageId ${externalMessageId} erkannt (Message ${duplicate.id}).`,
          meta: {
            profileId: params.profile.id,
            duplicateMessageId: duplicate.id,
          },
        });
        return this.getCaseDetails(params.record.id);
      }
    }

    const mergedAttributes = this.mergeAttributes(
      params.record.providedAttributes,
      params.providedAttributesPatch,
    );

    const nextPathRequestId =
      this.extractPayloadString(params.payload, 'pathRequestId') ??
      params.record.pathRequestId;
    const nextPathId =
      this.extractPayloadString(params.payload, 'pathId') ?? params.record.pathId;

    const requiredAttributes = this.evaluateRequiredAttributes(params.profile, {
      trainPlanId: params.record.trainPlanId,
      pathRequestId: nextPathRequestId,
      pathId: nextPathId,
      validFrom: params.record.validFrom,
      validTo: params.record.validTo,
      providedAttributes: mergedAttributes,
    });

    const transition = this.findTransition(
      params.profile,
      params.record.currentState,
      eventKey,
    );

    const nextState = transition?.toState ?? params.record.currentState;
    const rejected = !transition;
    const reason = rejected
      ? `Kein Transition-Mapping für Zustand ${params.record.currentState} und Event ${eventKey}.`
      : null;

    const isTerminal = params.profile.terminalStates.includes(nextState);
    const operationalContexts = this.rewriteContextsForState(
      params.record.operationalContexts,
      nextState,
      isTerminal,
      params.record.validFrom,
      params.record.validTo,
    );
    const blockingReasons = this.buildMissingRequiredReasons(requiredAttributes);

    const updateInput: UpdateTimetableOrderingCaseInput = {
      id: params.record.id,
      pathRequestId: nextPathRequestId,
      pathId: nextPathId,
      currentState: nextState,
      isTerminal,
      requiredAttributes,
      providedAttributes: mergedAttributes,
      blockingReasons,
      operationalContexts,
      aggregatedPhase: this.buildAggregatedPhase(
        params.profile.id,
        nextState,
        isTerminal,
        mergedAttributes,
      ),
    };

    await this.repository.updateCase(updateInput);

    await this.repository.appendMessage({
      id: randomUUID(),
      caseId: params.record.id,
      direction: params.direction,
      source: params.source,
      actor: params.event.actor,
      messageType: params.event.messageType ?? null,
      messageStatus: params.event.messageStatus ?? null,
      typeOfRequest: params.event.typeOfRequest ?? null,
      typeOfInformation: params.event.typeOfInformation ?? null,
      eventKey,
      externalMessageId,
      correlationKey:
        nextPathRequestId ?? nextPathId ?? `${params.record.id}:${eventKey}`,
      payload: params.payload ?? null,
    });

    await this.repository.appendTransition({
      id: randomUUID(),
      caseId: params.record.id,
      fromState: params.record.currentState,
      toState: nextState,
      eventKey,
      source: params.source,
      actionId: params.action?.id ?? null,
      rejected,
      reason,
      meta: {
        profileId: params.profile.id,
        transitionDescription: transition?.description ?? null,
      },
    });

    return this.getCaseDetails(params.record.id);
  }

  private findTransition(
    profile: OrderingProcessProfileDefinition,
    currentState: string,
    eventKey: string,
  ): OrderingTransitionDefinition | null {
    const exact = profile.transitions.find(
      (transition) =>
        transition.fromState === currentState &&
        buildOrderingEventKey(transition.event) === eventKey,
    );
    if (exact) {
      return exact;
    }

    const wildcard = profile.transitions.find(
      (transition) =>
        transition.fromState === '*' &&
        buildOrderingEventKey(transition.event) === eventKey,
    );
    return wildcard ?? null;
  }

  private evaluateRequiredAttributes(
    profile: OrderingProcessProfileDefinition,
    context: ValidationContext,
  ): OrderingRequiredAttributeStatus[] {
    const caseScope = {
      trainPlanId: context.trainPlanId ?? null,
      pathRequestId: context.pathRequestId ?? null,
      pathId: context.pathId ?? null,
      validFrom: context.validFrom,
      validTo: context.validTo,
    };

    return profile.requiredAttributes.map((required) => {
      const source = required.scope === 'case' ? caseScope : context.providedAttributes;
      const value = this.readPath(source, required.path);
      return {
        key: required.key,
        label: required.label,
        scope: required.scope,
        path: required.path,
        required: true,
        missing: this.isMissingValue(value),
      };
    });
  }

  private buildMissingRequiredReasons(
    required: OrderingRequiredAttributeStatus[],
  ): string[] {
    return required
      .filter((entry) => entry.required && entry.missing)
      .map((entry) => entry.label);
  }

  private buildAggregatedPhase(
    profileId: TimetableOrderingCaseRecord['profileId'],
    currentState: string,
    isTerminal: boolean,
    providedAttributes: Record<string, unknown>,
  ): OrderingAggregatedPhaseSnapshot {
    return {
      profileId,
      currentState,
      isTerminal,
      tttPhase: this.readStringPath(providedAttributes, 'tttPhase'),
      ttrPhase: this.readStringPath(providedAttributes, 'ttrPhase'),
    };
  }

  private buildOperationalContexts(
    validFrom: string,
    validTo: string,
    state: string,
    isTerminal: boolean,
  ): OrderingOperationalContext[] {
    const start = this.parseDateOnly(validFrom);
    const end = this.parseDateOnly(validTo);
    const contexts: OrderingOperationalContext[] = [];

    let cursor = new Date(start.getTime());
    while (cursor.getTime() <= end.getTime() && contexts.length < 24) {
      const yearLabel = this.deriveTimetableYearLabelFromDate(cursor);
      const yearEnd = this.endOfTimetableYear(yearLabel);
      const contextEnd = yearEnd.getTime() < end.getTime() ? yearEnd : end;
      contexts.push({
        timetableYearLabel: yearLabel,
        validFrom: cursor.toISOString().slice(0, 10),
        validTo: contextEnd.toISOString().slice(0, 10),
        state,
        status: isTerminal ? 'terminal' : 'active',
      });
      cursor = this.addDays(contextEnd, 1);
    }

    return contexts;
  }

  private rewriteContextsForState(
    contexts: OrderingOperationalContext[],
    state: string,
    isTerminal: boolean,
    validFrom?: string,
    validTo?: string,
  ): OrderingOperationalContext[] {
    const base = contexts.length
      ? contexts
      : validFrom && validTo
        ? this.buildOperationalContexts(validFrom, validTo, state, isTerminal)
        : [];
    return base.map((entry) => ({
      ...entry,
      state,
      status: isTerminal ? 'terminal' : 'active',
    }));
  }

  private mapCase(record: TimetableOrderingCaseRecord): TimetableOrderingCaseDto {
    const profile = this.requireProfile(record.profileId);
    const missingRequiredReasons = this.buildMissingRequiredReasons(
      record.requiredAttributes,
    );

    const allowedActions = profile.actions.map((action) => {
      const reasons: string[] = [];
      if (record.isTerminal) {
        reasons.push('Fall ist terminal abgeschlossen.');
      }
      if (!action.fromStates.includes(record.currentState)) {
        reasons.push(`Aktion in Zustand ${record.currentState} nicht erlaubt.`);
      }
      if (action.requiresCompleteRequired && missingRequiredReasons.length) {
        reasons.push(...missingRequiredReasons.map((entry) => `Fehlt: ${entry}`));
      }
      return {
        id: action.id,
        label: action.label,
        blocked: reasons.length > 0,
        reasons,
        eventTuple: action.event,
      };
    });

    return {
      id: record.id,
      profileId: record.profileId,
      profileLabel: profile.label,
      title: record.title,
      description: record.description,
      trainPlanId: record.trainPlanId,
      validFrom: record.validFrom,
      validTo: record.validTo,
      pathRequestId: record.pathRequestId,
      pathId: record.pathId,
      currentState: record.currentState,
      isTerminal: record.isTerminal,
      requiredAttributes: record.requiredAttributes,
      providedAttributes: record.providedAttributes,
      blockingReasons: record.blockingReasons,
      operationalContexts: record.operationalContexts,
      aggregatedPhase: record.aggregatedPhase,
      allowedActions,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private mapMessage(record: TimetableOrderingMessageRecord): TimetableOrderingMessageDto {
    return {
      id: record.id,
      caseId: record.caseId,
      direction: record.direction,
      source: record.source,
      actor: record.actor,
      messageType: record.messageType,
      messageStatus: record.messageStatus,
      typeOfRequest: record.typeOfRequest,
      typeOfInformation: record.typeOfInformation,
      eventKey: record.eventKey,
      externalMessageId: record.externalMessageId,
      correlationKey: record.correlationKey,
      payload: record.payload,
      createdAt: record.createdAt,
    };
  }

  private mapTransition(
    record: TimetableOrderingTransitionRecord,
  ): TimetableOrderingTransitionDto {
    return {
      id: record.id,
      caseId: record.caseId,
      fromState: record.fromState,
      toState: record.toState,
      eventKey: record.eventKey,
      source: record.source,
      actionId: record.actionId,
      rejected: record.rejected,
      reason: record.reason,
      meta: record.meta,
      createdAt: record.createdAt,
    };
  }

  private async requireCase(caseId: string): Promise<TimetableOrderingCaseRecord> {
    const trimmed = caseId?.trim();
    if (!trimmed) {
      throw new BadRequestException('caseId ist erforderlich.');
    }
    const record = await this.repository.getCaseById(trimmed);
    if (!record) {
      throw new NotFoundException(`Bestellfall ${trimmed} nicht gefunden.`);
    }
    return record;
  }

  private requireProfile(profileId: string): OrderingProcessProfileDefinition {
    const profile = getOrderingProfile(profileId as TimetableOrderingCaseRecord['profileId']);
    if (!profile) {
      throw new BadRequestException(
        `Unbekanntes Profil ${profileId}. Zulässig: annual_order, occasional_traffic.`,
      );
    }
    return profile;
  }

  private normalizeDateOnly(value: string, field: string): string {
    const trimmed = value?.trim();
    if (!trimmed) {
      throw new BadRequestException(`${field} ist erforderlich.`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      throw new BadRequestException(`${field} muss ISO-Datum YYYY-MM-DD sein.`);
    }
    const date = new Date(`${trimmed}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} ist ungültig.`);
    }
    return date.toISOString().slice(0, 10);
  }

  private normalizeNullableText(value?: string | null): string | null {
    const trimmed = value?.trim();
    return trimmed && trimmed.length ? trimmed : null;
  }

  private async resolveTrainPlan(planId?: string): Promise<TrainPlanDto | null> {
    const trimmed = this.normalizeNullableText(planId);
    if (!trimmed) {
      return null;
    }
    const plan = await this.trainPlans.getPlanById(trimmed);
    if (!plan) {
      throw new BadRequestException(`trainPlanId ${trimmed} nicht gefunden.`);
    }
    return plan;
  }

  private seedAttributesFromPlan(
    plan: TrainPlanDto | null,
  ): Record<string, unknown> {
    if (!plan) {
      return {};
    }
    const origin = plan.stops
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .find((stop) => stop.type === 'origin' || stop.sequence === 1);
    const destination = plan.stops
      .slice()
      .sort((a, b) => b.sequence - a.sequence)
      .find((stop) => stop.type === 'destination') ??
      plan.stops.slice().sort((a, b) => b.sequence - a.sequence)[0];
    const ordering = plan.routeMetadata?.orderingContext;
    const validityDates =
      ordering?.validityDates
        ?.map((value) => value?.trim())
        .filter((value): value is string => !!value)
        .sort() ?? [];
    const anchorValidityDate =
      ordering?.validityDate?.trim() || validityDates[0] || undefined;

    return {
      responsibleRu: plan.responsibleRu,
      trainNumber: plan.trainNumber,
      originLocationCode: origin?.locationCode,
      destinationLocationCode: destination?.locationCode,
      rollingStock: plan.rollingStock ?? undefined,
      tttPhase: plan.status,
      ttrPhase: plan.status,
      requestedDepartureTime:
        origin?.departureTime ?? origin?.arrivalTime ?? undefined,
      otnOrNameInput: ordering?.otnOrNameInput ?? undefined,
      operationalTrainNumber: ordering?.operationalTrainNumber ?? undefined,
      trainName: ordering?.trainName ?? undefined,
      reasonOfReference: ordering?.reasonOfReference ?? undefined,
      validityDate: anchorValidityDate,
      validityDates: validityDates.length ? validityDates : undefined,
      trainType: ordering?.trainType ?? undefined,
      trafficTypeCode: ordering?.trafficTypeCode ?? undefined,
      trafficTypeNetwork: ordering?.trafficTypeNetwork ?? undefined,
      serviceType: ordering?.serviceType ?? undefined,
      vehicleFormation:
        ordering?.vehicleFormation && ordering.vehicleFormation.length
          ? ordering.vehicleFormation.map((entry) => ({
              entryId: entry.entryId,
              serviceType: entry.serviceType,
              code: entry.code,
              label: entry.label,
              source: entry.source,
              lengthMeters: entry.lengthMeters,
              weightTons: entry.weightTons,
              maxSpeedKph: entry.maxSpeedKph,
            }))
          : undefined,
      pwgLengthMeters: ordering?.pwgLengthMeters ?? undefined,
      pwgWeightTons: ordering?.pwgWeightTons ?? undefined,
      pwgMaxSpeedKph: ordering?.pwgMaxSpeedKph ?? undefined,
      tractionOrPwg: ordering?.tractionOrPwg ?? undefined,
      debtorCode: ordering?.debtorCode ?? undefined,
      distributionList: ordering?.distributionList ?? undefined,
      freeProcessingReason: ordering?.freeProcessingReason ?? undefined,
    };
  }

  private mergeAttributes(
    base: Record<string, unknown> | null | undefined,
    patch: Record<string, unknown> | null | undefined,
  ): Record<string, unknown> {
    const left = base && typeof base === 'object' ? { ...base } : {};
    const right = patch && typeof patch === 'object' ? patch : {};
    return {
      ...left,
      ...right,
    };
  }

  private isMissingValue(value: unknown): boolean {
    if (value === null || value === undefined) {
      return true;
    }
    if (typeof value === 'string') {
      return value.trim().length === 0;
    }
    if (Array.isArray(value)) {
      return value.length === 0;
    }
    return false;
  }

  private readPath(source: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.').filter((part) => part.length);
    let current: unknown = source;
    for (const part of parts) {
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  private readStringPath(source: Record<string, unknown>, path: string): string | null {
    const value = this.readPath(source, path);
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }

  private extractPayloadString(
    payload: Record<string, unknown> | undefined,
    key: string,
  ): string | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    const value = payload[key];
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }

  private parseDateOnly(value: string): Date {
    return new Date(`${value}T00:00:00Z`);
  }

  private addDays(date: Date, days: number): Date {
    const next = new Date(date.getTime());
    next.setUTCDate(next.getUTCDate() + days);
    return next;
  }

  private buildYearStart(decemberYear: number): Date {
    const date = new Date(Date.UTC(decemberYear, 11, 10, 0, 0, 0, 0));
    while (date.getUTCDay() !== 0) {
      date.setUTCDate(date.getUTCDate() + 1);
    }
    return date;
  }

  private deriveTimetableYearLabelFromDate(date: Date): string {
    const year = date.getUTCFullYear();
    const yearStart = this.buildYearStart(year);
    const startYear = date.getTime() >= yearStart.getTime() ? year : year - 1;
    return `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`;
  }

  private endOfTimetableYear(label: string): Date {
    const match = /^(\d{4})[/-]\d{2}$/.exec(label.trim());
    if (!match) {
      return this.addDays(new Date(), 365);
    }
    const startYear = Number.parseInt(match[1], 10);
    const nextStart = this.buildYearStart(startYear + 1);
    return this.addDays(nextStart, -1);
  }

  private generateCaseId(): string {
    return `TOC-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`;
  }
}
