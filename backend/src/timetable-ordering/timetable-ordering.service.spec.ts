import { TimetableOrderingService } from './timetable-ordering.service';
import type {
  CreateTimetableOrderingCaseInput,
  TimetableOrderingCaseRecord,
  TimetableOrderingMessageRecord,
  TimetableOrderingRepository,
  TimetableOrderingTransitionRecord,
  UpdateTimetableOrderingCaseInput,
} from './timetable-ordering.repository';
import type { TrainPlanDto } from '../train-plans/train-plans.types';

function sortByCreatedDesc<T extends { createdAt: string; id: string }>(
  entries: T[],
): T[] {
  return [...entries].sort((a, b) => {
    const byTime = b.createdAt.localeCompare(a.createdAt);
    if (byTime !== 0) {
      return byTime;
    }
    return b.id.localeCompare(a.id);
  });
}

function mapCreateInputToCase(
  input: CreateTimetableOrderingCaseInput,
): TimetableOrderingCaseRecord {
  const now = new Date().toISOString();
  return {
    id: input.id,
    profileId: input.profileId,
    title: input.title,
    description: input.description ?? null,
    trainPlanId: input.trainPlanId ?? null,
    validFrom: input.validFrom,
    validTo: input.validTo,
    pathRequestId: input.pathRequestId ?? null,
    pathId: input.pathId ?? null,
    currentState: input.currentState,
    isTerminal: input.isTerminal,
    requiredAttributes: input.requiredAttributes,
    providedAttributes: input.providedAttributes,
    blockingReasons: input.blockingReasons,
    operationalContexts: input.operationalContexts,
    aggregatedPhase: input.aggregatedPhase,
    createdAt: now,
    updatedAt: now,
  };
}

function createHarness() {
  const cases = new Map<string, TimetableOrderingCaseRecord>();
  const messages: TimetableOrderingMessageRecord[] = [];
  const transitions: TimetableOrderingTransitionRecord[] = [];

  const repository: Pick<
    TimetableOrderingRepository,
    | 'listCases'
    | 'getCaseById'
    | 'createCase'
    | 'updateCase'
    | 'appendMessage'
    | 'listMessages'
    | 'getMessageByExternalMessageId'
    | 'appendTransition'
    | 'listTransitions'
  > = {
    listCases: jest.fn(async () =>
      [...cases.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    ),
    getCaseById: jest.fn(async (caseId: string) => cases.get(caseId) ?? null),
    createCase: jest.fn(async (input: CreateTimetableOrderingCaseInput) => {
      const next = mapCreateInputToCase(input);
      cases.set(next.id, next);
      return next;
    }),
    updateCase: jest.fn(async (input: UpdateTimetableOrderingCaseInput) => {
      const current = cases.get(input.id);
      if (!current) {
        throw new Error(`Case ${input.id} not found`);
      }
      const next: TimetableOrderingCaseRecord = {
        ...current,
        pathRequestId: input.pathRequestId ?? current.pathRequestId,
        pathId: input.pathId ?? current.pathId,
        currentState: input.currentState,
        isTerminal: input.isTerminal,
        requiredAttributes: input.requiredAttributes,
        providedAttributes: input.providedAttributes,
        blockingReasons: input.blockingReasons,
        operationalContexts: input.operationalContexts,
        aggregatedPhase: input.aggregatedPhase,
        updatedAt: new Date().toISOString(),
      };
      cases.set(next.id, next);
      return next;
    }),
    appendMessage: jest.fn(
      async (
        input: Parameters<TimetableOrderingRepository['appendMessage']>[0],
      ) => {
        const record: TimetableOrderingMessageRecord = {
          id: input.id,
          caseId: input.caseId,
          direction: input.direction,
          source: input.source,
          actor: input.actor,
          messageType: input.messageType ?? null,
          messageStatus: input.messageStatus ?? null,
          typeOfRequest: input.typeOfRequest ?? null,
          typeOfInformation: input.typeOfInformation ?? null,
          eventKey: input.eventKey,
          externalMessageId: input.externalMessageId ?? null,
          correlationKey: input.correlationKey ?? null,
          payload: input.payload ?? null,
          createdAt: new Date().toISOString(),
        };
        messages.push(record);
        return record;
      },
    ),
    listMessages: jest.fn(async (caseId: string) =>
      sortByCreatedDesc(messages.filter((entry) => entry.caseId === caseId)),
    ),
    getMessageByExternalMessageId: jest.fn(
      async (caseId: string, externalMessageId: string) => {
        const hit = sortByCreatedDesc(
          messages.filter(
            (entry) =>
              entry.caseId === caseId &&
              entry.externalMessageId === externalMessageId,
          ),
        )[0];
        return hit ?? null;
      },
    ),
    appendTransition: jest.fn(
      async (
        input: Parameters<TimetableOrderingRepository['appendTransition']>[0],
      ) => {
        const record: TimetableOrderingTransitionRecord = {
          id: input.id,
          caseId: input.caseId,
          fromState: input.fromState,
          toState: input.toState,
          eventKey: input.eventKey,
          source: input.source,
          actionId: input.actionId ?? null,
          rejected: input.rejected,
          reason: input.reason ?? null,
          meta: input.meta ?? null,
          createdAt: new Date().toISOString(),
        };
        transitions.push(record);
        return record;
      },
    ),
    listTransitions: jest.fn(async (caseId: string) =>
      sortByCreatedDesc(transitions.filter((entry) => entry.caseId === caseId)),
    ),
  };

  const trainPlan: TrainPlanDto = {
    id: 'TP-1',
    title: 'RE Basel',
    trainNumber: 'RE4711',
    pathRequestId: 'PR-100',
    pathId: 'PATH-100',
    status: 'requested',
    responsibleRu: 'SOB',
    calendar: {
      validFrom: '2026-12-01',
      validTo: '2026-12-31',
      daysBitmap: '1111111',
    },
    stops: [
      {
        id: 'S1',
        sequence: 1,
        type: 'origin',
        locationCode: 'BASEL',
        locationName: 'Basel SBB',
        departureTime: '08:00',
        activities: ['stop'],
      },
      {
        id: 'S2',
        sequence: 2,
        type: 'destination',
        locationCode: 'BERN',
        locationName: 'Bern',
        arrivalTime: '09:00',
        activities: ['stop'],
      },
    ],
    technical: {
      trainType: 'RE',
    },
    routeMetadata: {
      orderingContext: {
        otnOrNameInput: '4711',
        operationalTrainNumber: '4711',
        reasonOfReference: '1014',
        validityDate: '2026-12-05',
        trainType: '1',
        trafficTypeCode: 'passenger',
        serviceType: 'tractive_unit',
        debtorCode: 'DB-4711',
        distributionList: 'DISPO-CH',
        freeProcessingReason: 'path_modification_due_to_path_alteration',
      },
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    source: {
      type: 'ttt',
      name: 'TTT',
    },
    rollingStock: {
      segments: [
        {
          position: 1,
          vehicleTypeId: 'ETR610',
          count: 1,
        },
      ],
    },
  };

  const trainPlans = {
    getPlanById: jest.fn(async (id: string) => (id === 'TP-1' ? trainPlan : null)),
  };

  const service = new TimetableOrderingService(
    repository as unknown as TimetableOrderingRepository,
    trainPlans as any,
  );

  return {
    service,
    repository,
    trainPlans,
  };
}

describe('TimetableOrderingService', () => {
  const createReadyAnnualCase = async (service: TimetableOrderingService) => {
    return service.createCase({
      profileId: 'annual_order',
      title: 'Annual ready case',
      trainPlanId: 'TP-1',
      validFrom: '2026-12-05',
      validTo: '2026-12-20',
      providedAttributes: {
        annualRequestWindow: 'NW-2026-01',
        tttPhase: 'path_request',
        ttrPhase: 'annual_request',
      },
    });
  };

  it('splits cross-year validity into multiple operational contexts', async () => {
    const { service } = createHarness();

    const details = await createReadyAnnualCase(service);

    expect(details.case.operationalContexts).toHaveLength(2);
    const labels = details.case.operationalContexts.map(
      (entry) => entry.timetableYearLabel,
    );
    expect(labels).toContain('2025/26');
    expect(labels).toContain('2026/27');
  });

  it('blocks send_request when required attributes are missing', async () => {
    const { service } = createHarness();

    const created = await service.createCase({
      profileId: 'annual_order',
      title: 'Missing required',
      validFrom: '2026-04-01',
      validTo: '2026-04-30',
      providedAttributes: {
        tttPhase: 'path_request',
        ttrPhase: 'annual_request',
      },
    });

    const details = await service.applyAction(created.case.id, {
      actionId: 'send_request',
      source: 'test',
    });

    expect(details.case.currentState).toBe('DRAFT');
    const blockedTransition = details.transitions.find(
      (entry) => entry.actionId === 'send_request',
    );
    expect(blockedTransition?.rejected).toBe(true);
    expect(blockedTransition?.reason).toContain('Pflichtattribute fehlen');
  });

  it('keeps state on unknown tuples and records a rejected transition', async () => {
    const { service } = createHarness();
    const created = await createReadyAnnualCase(service);

    const sent = await service.applyAction(created.case.id, {
      actionId: 'send_request',
      source: 'test',
    });
    expect(sent.case.currentState).toBe('PATH_REQUEST_SENT');

    const details = await service.applyInboundEvent(created.case.id, {
      source: 'test',
      event: {
        actor: 'INFRASTRUCTURE_MANAGER',
        messageType: 9999,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 99,
      },
      externalMessageId: 'UNKNOWN-1',
    });

    expect(details.case.currentState).toBe('PATH_REQUEST_SENT');
    const unknownTupleTransition = details.transitions.find((entry) =>
      (entry.reason ?? '').includes('Kein Transition-Mapping'),
    );
    expect(unknownTupleTransition?.rejected).toBe(true);
    expect(unknownTupleTransition?.reason).toContain('Kein Transition-Mapping');
  });

  it('treats duplicate externalMessageId as idempotent and avoids second transition', async () => {
    const { service } = createHarness();
    const created = await createReadyAnnualCase(service);

    await service.applyAction(created.case.id, {
      actionId: 'send_request',
      source: 'test',
    });

    const firstInbound = await service.applyInboundEvent(created.case.id, {
      source: 'test',
      event: {
        actor: 'INFRASTRUCTURE_MANAGER',
        messageType: 2007,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 4,
      },
      externalMessageId: 'EXT-1',
    });
    expect(firstInbound.case.currentState).toBe('PLANNING');

    const duplicateInbound = await service.applyInboundEvent(created.case.id, {
      source: 'test',
      event: {
        actor: 'INFRASTRUCTURE_MANAGER',
        messageType: 2003,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 9,
      },
      externalMessageId: 'EXT-1',
    });

    expect(duplicateInbound.case.currentState).toBe('PLANNING');
    expect(
      duplicateInbound.messages.filter((entry) => entry.externalMessageId === 'EXT-1'),
    ).toHaveLength(1);
    const duplicateTransition = duplicateInbound.transitions.find((entry) =>
      (entry.reason ?? '').includes('Duplikat externalMessageId'),
    );
    expect(duplicateTransition?.rejected).toBe(true);
    expect(duplicateTransition?.reason).toContain('Duplikat externalMessageId');
  });

  it('allows simulator withdrawn response to terminate the case', async () => {
    const { service } = createHarness();
    const created = await createReadyAnnualCase(service);

    await service.applyAction(created.case.id, {
      actionId: 'send_request',
      source: 'test',
    });

    const withdrawn = await service.applySimulatorResponse(created.case.id, {
      response: 'withdrawn',
    });

    expect(withdrawn.case.currentState).toBe('INACTIVE');
    expect(withdrawn.case.isTerminal).toBe(true);
    const withdrawnTransition = withdrawn.transitions.find(
      (entry) => entry.source === 'simulator' && entry.toState === 'INACTIVE',
    );
    expect(withdrawnTransition?.rejected).toBe(false);
  });
});
