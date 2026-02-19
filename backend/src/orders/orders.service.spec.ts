import { NotFoundException } from '@nestjs/common';
import { OrdersService } from './orders.service';

function createService(params: {
  orderRecord: any;
  cases: any[];
  caseDetailsById?: Record<string, any>;
  caseDetailErrorCaseIds?: string[];
}) {
  const repository = {
    getOrderById: jest.fn(async () => params.orderRecord),
  } as any;
  const timetableService = {} as any;
  const detailErrors = new Set(params.caseDetailErrorCaseIds ?? []);
  const timetableOrderingService = {
    listCases: jest.fn(async () => params.cases),
    getCaseDetails: jest.fn(async (caseId: string) => {
      if (detailErrors.has(caseId)) {
        throw new Error(`Case ${caseId} detail load failed`);
      }
      const details = params.caseDetailsById?.[caseId];
      if (!details) {
        throw new Error(`Missing case details mock for ${caseId}`);
      }
      return details;
    }),
  } as any;

  const service = new OrdersService(
    repository,
    timetableService,
    timetableOrderingService,
  );

  return {
    service,
    repository,
    timetableOrderingService,
  };
}

describe('OrdersService FM supervision read models', () => {
  it('builds an aggregated phase snapshot scoped to linked train plans', async () => {
    const orderRecord = {
      id: 'ORD-1',
      items: [
        { linkedTrainPlanId: 'TP-1' },
        { linkedTrainPlanId: 'TP-2' },
        { linkedTrainPlanId: null },
      ],
    };

    const cases = [
      {
        id: 'TOC-1',
        title: 'Annual Alpha',
        profileId: 'annual_order',
        profileLabel: 'Jahresbestellung',
        trainPlanId: 'TP-1',
        currentState: 'PLANNING',
        isTerminal: false,
        aggregatedPhase: { tttPhase: 'offer', ttrPhase: 'annual_request' },
        operationalContexts: [
          {
            timetableYearLabel: '2026/27',
            validFrom: '2026-12-15',
            validTo: '2027-01-08',
            state: 'PLANNING',
            status: 'active',
          },
        ],
      },
      {
        id: 'TOC-2',
        title: 'Occasional Beta',
        profileId: 'occasional_traffic',
        profileLabel: 'Gelegenheitsverkehr',
        trainPlanId: 'TP-2',
        currentState: 'BOOKED',
        isTerminal: true,
        aggregatedPhase: { tttPhase: 'contract', ttrPhase: 'short_term' },
        operationalContexts: [
          {
            timetableYearLabel: '2026/27',
            validFrom: '2027-02-01',
            validTo: '2027-02-03',
            state: 'BOOKED',
            status: 'terminal',
          },
        ],
      },
      {
        id: 'TOC-3',
        title: 'Other plan',
        profileId: 'annual_order',
        profileLabel: 'Jahresbestellung',
        trainPlanId: 'TP-99',
        currentState: 'DRAFT',
        isTerminal: false,
        aggregatedPhase: { tttPhase: 'path_request', ttrPhase: 'annual_request' },
        operationalContexts: [],
      },
    ];

    const { service } = createService({ orderRecord, cases });

    const snapshot = await service.getOrderPhaseSnapshot('ORD-1');

    expect(snapshot.orderId).toBe('ORD-1');
    expect(snapshot.linkedPlanCount).toBe(2);
    expect(snapshot.matchedCaseCount).toBe(2);
    expect(snapshot.activeCaseCount).toBe(1);
    expect(snapshot.terminalCaseCount).toBe(1);
    expect(snapshot.missingOrderItemLinks).toBe(1);
    expect(snapshot.unresolvedPlanIds).toEqual([]);
    expect(snapshot.stateSummaries).toEqual(
      expect.arrayContaining([
        { label: 'PLANNING', count: 1 },
        { label: 'BOOKED', count: 1 },
      ]),
    );
    expect(snapshot.tttSummaries).toEqual(
      expect.arrayContaining([
        { label: 'offer', count: 1 },
        { label: 'contract', count: 1 },
      ]),
    );
    expect(snapshot.ttrSummaries).toEqual(
      expect.arrayContaining([
        { label: 'annual_request', count: 1 },
        { label: 'short_term', count: 1 },
      ]),
    );
  });

  it('returns per-context rows and reports unresolved linked plans', async () => {
    const orderRecord = {
      id: 'ORD-2',
      items: [
        { linkedTrainPlanId: 'TP-1' },
        { linkedTrainPlanId: 'TP-404' },
      ],
    };

    const cases = [
      {
        id: 'TOC-10',
        title: 'Cross-year Case',
        profileId: 'annual_order',
        profileLabel: 'Jahresbestellung',
        trainPlanId: 'TP-1',
        currentState: 'PLANNING',
        isTerminal: false,
        aggregatedPhase: { tttPhase: 'offer', ttrPhase: 'rolling_planning' },
        operationalContexts: [
          {
            timetableYearLabel: '2025/26',
            validFrom: '2026-12-20',
            validTo: '2026-12-31',
            state: 'PLANNING',
            status: 'active',
          },
          {
            timetableYearLabel: '2026/27',
            validFrom: '2027-01-01',
            validTo: '2027-01-15',
            state: 'PLANNING',
            status: 'active',
          },
        ],
      },
    ];

    const { service } = createService({ orderRecord, cases });

    const snapshot = await service.getOrderPhaseSnapshot('ORD-2');
    const contexts = await service.getOrderOperationalContexts('ORD-2');

    expect(snapshot.unresolvedPlanIds).toEqual(['TP-404']);
    expect(contexts).toHaveLength(2);
    expect(contexts[0]).toMatchObject({
      caseId: 'TOC-10',
      profileLabel: 'Jahresbestellung',
      timetableYearLabel: '2025/26',
      contextStatus: 'active',
    });
    expect(contexts[1]).toMatchObject({
      caseId: 'TOC-10',
      timetableYearLabel: '2026/27',
      contextStatus: 'active',
    });
  });

  it('builds traceability entries with correlation ids and latest audit markers', async () => {
    const orderRecord = {
      id: 'ORD-TRACE-1',
      items: [{ linkedTrainPlanId: 'TP-100' }],
    };

    const cases = [
      {
        id: 'TOC-100',
        title: 'Traceability Case',
        profileId: 'annual_order',
        profileLabel: 'Jahresbestellung',
        trainPlanId: 'TP-100',
        validFrom: '2026-12-15',
        validTo: '2027-01-08',
        pathRequestId: 'PR-100',
        pathId: 'PATH-100',
        currentState: 'PLANNING',
        isTerminal: false,
        aggregatedPhase: { tttPhase: 'offer', ttrPhase: 'annual_request' },
        operationalContexts: [
          {
            timetableYearLabel: '2026/27',
            validFrom: '2026-12-15',
            validTo: '2027-01-08',
            state: 'PLANNING',
            status: 'active',
          },
        ],
      },
    ];

    const caseDetailsById = {
      'TOC-100': {
        case: cases[0],
        messages: [
          {
            id: 'MSG-1',
            caseId: 'TOC-100',
            direction: 'inbound',
            source: 'simulator',
            actor: 'INFRASTRUCTURE_MANAGER',
            eventKey: 'INFRASTRUCTURE_MANAGER:2007:1:2:4',
            externalMessageId: 'EXT-TRACE-1',
            correlationKey: 'PR-100',
            createdAt: '2026-12-16T10:00:00.000Z',
          },
        ],
        transitions: [
          {
            id: 'TR-1',
            caseId: 'TOC-100',
            fromState: 'PATH_REQUEST_SENT',
            toState: 'PLANNING',
            eventKey: 'INFRASTRUCTURE_MANAGER:2007:1:2:4',
            source: 'simulator',
            actionId: null,
            rejected: false,
            reason: null,
            createdAt: '2026-12-16T10:00:01.000Z',
          },
        ],
      },
    };

    const { service } = createService({ orderRecord, cases, caseDetailsById });

    const traceability = await service.getOrderTraceability('ORD-TRACE-1');

    expect(traceability.orderId).toBe('ORD-TRACE-1');
    expect(traceability.matchedCaseCount).toBe(1);
    expect(traceability.degradedCaseCount).toBe(0);
    expect(traceability.unresolvedPlanIds).toEqual([]);
    expect(traceability.entries).toHaveLength(1);
    expect(traceability.entries[0]).toMatchObject({
      caseId: 'TOC-100',
      pathRequestId: 'PR-100',
      pathId: 'PATH-100',
      detailStatus: 'ok',
      messageCount: 1,
      transitionCount: 1,
    });
    expect(traceability.entries[0].lastMessage).toMatchObject({
      id: 'MSG-1',
      externalMessageId: 'EXT-TRACE-1',
      correlationKey: 'PR-100',
    });
    expect(traceability.entries[0].lastTransition).toMatchObject({
      id: 'TR-1',
      fromState: 'PATH_REQUEST_SENT',
      toState: 'PLANNING',
      rejected: false,
    });
  });

  it('marks traceability entry as degraded when FM case details cannot be enriched', async () => {
    const orderRecord = {
      id: 'ORD-TRACE-2',
      items: [{ linkedTrainPlanId: 'TP-200' }],
    };

    const cases = [
      {
        id: 'TOC-200',
        title: 'Degraded Case',
        profileId: 'occasional_traffic',
        profileLabel: 'Gelegenheitsverkehr',
        trainPlanId: 'TP-200',
        validFrom: '2027-03-01',
        validTo: '2027-03-03',
        pathRequestId: 'PR-200',
        pathId: null,
        currentState: 'PLANNING',
        isTerminal: false,
        aggregatedPhase: { tttPhase: 'offer', ttrPhase: 'short_term' },
        operationalContexts: [
          {
            timetableYearLabel: '2026/27',
            validFrom: '2027-03-01',
            validTo: '2027-03-03',
            state: 'PLANNING',
            status: 'active',
          },
        ],
      },
    ];

    const { service } = createService({
      orderRecord,
      cases,
      caseDetailErrorCaseIds: ['TOC-200'],
    });

    const traceability = await service.getOrderTraceability('ORD-TRACE-2');

    expect(traceability.matchedCaseCount).toBe(1);
    expect(traceability.degradedCaseCount).toBe(1);
    expect(traceability.entries[0]).toMatchObject({
      caseId: 'TOC-200',
      detailStatus: 'degraded',
      messageCount: 0,
      transitionCount: 0,
    });
    expect(traceability.entries[0].detailError).toContain(
      'FM-Case-Details',
    );
  });

  it('returns full case-level traceability details for linked cases', async () => {
    const orderRecord = {
      id: 'ORD-TRACE-3',
      items: [{ linkedTrainPlanId: 'TP-300' }],
    };

    const cases = [
      {
        id: 'TOC-300',
        title: 'Detail Case',
        profileId: 'annual_order',
        profileLabel: 'Jahresbestellung',
        trainPlanId: 'TP-300',
        validFrom: '2026-12-20',
        validTo: '2027-01-10',
        pathRequestId: 'PR-300',
        pathId: 'PATH-300',
        currentState: 'FINAL_OFFER',
        isTerminal: false,
        aggregatedPhase: { tttPhase: 'offer', ttrPhase: 'final_offer' },
        operationalContexts: [
          {
            timetableYearLabel: '2025/26',
            validFrom: '2026-12-20',
            validTo: '2026-12-31',
            state: 'PLANNING',
            status: 'active',
          },
          {
            timetableYearLabel: '2026/27',
            validFrom: '2027-01-01',
            validTo: '2027-01-10',
            state: 'FINAL_OFFER',
            status: 'active',
          },
        ],
      },
    ];

    const caseDetailsById = {
      'TOC-300': {
        case: cases[0],
        messages: [
          {
            id: 'MSG-300-1',
            caseId: 'TOC-300',
            direction: 'outbound',
            source: 'cockpit',
            actor: 'RAILWAY_UNDERTAKING',
            eventKey: 'RAILWAY_UNDERTAKING:2006:1:2:4',
            externalMessageId: 'EXT-300-1',
            correlationKey: 'PR-300',
            createdAt: '2026-12-20T09:00:00.000Z',
          },
          {
            id: 'MSG-300-2',
            caseId: 'TOC-300',
            direction: 'inbound',
            source: 'simulator',
            actor: 'INFRASTRUCTURE_MANAGER',
            eventKey: 'INFRASTRUCTURE_MANAGER:2003:1:2:16',
            externalMessageId: 'EXT-300-2',
            correlationKey: 'PR-300',
            createdAt: '2026-12-21T10:00:00.000Z',
          },
        ],
        transitions: [
          {
            id: 'TR-300-1',
            caseId: 'TOC-300',
            fromState: 'DRAFT',
            toState: 'PATH_REQUEST_SENT',
            eventKey: 'RAILWAY_UNDERTAKING:2006:1:2:4',
            source: 'cockpit',
            actionId: 'send_request',
            rejected: false,
            reason: null,
            createdAt: '2026-12-20T09:00:01.000Z',
          },
          {
            id: 'TR-300-2',
            caseId: 'TOC-300',
            fromState: 'PLANNING',
            toState: 'FINAL_OFFER',
            eventKey: 'INFRASTRUCTURE_MANAGER:2003:1:2:16',
            source: 'simulator',
            actionId: null,
            rejected: false,
            reason: null,
            createdAt: '2026-12-21T10:00:01.000Z',
          },
        ],
      },
    };

    const { service } = createService({ orderRecord, cases, caseDetailsById });
    const details = await service.getOrderTraceabilityCaseDetails(
      'ORD-TRACE-3',
      'TOC-300',
    );

    expect(details).toMatchObject({
      orderId: 'ORD-TRACE-3',
      caseId: 'TOC-300',
      detailStatus: 'ok',
      pathRequestId: 'PR-300',
      pathId: 'PATH-300',
    });
    expect(details.messages).toHaveLength(2);
    expect(details.transitions).toHaveLength(2);
    expect(details.operationalContexts).toHaveLength(2);
  });

  it('returns degraded case-level details when FM detail loading fails', async () => {
    const orderRecord = {
      id: 'ORD-TRACE-4',
      items: [{ linkedTrainPlanId: 'TP-400' }],
    };

    const cases = [
      {
        id: 'TOC-400',
        title: 'Detail Degraded Case',
        profileId: 'occasional_traffic',
        profileLabel: 'Gelegenheitsverkehr',
        trainPlanId: 'TP-400',
        validFrom: '2027-04-01',
        validTo: '2027-04-02',
        pathRequestId: 'PR-400',
        pathId: null,
        currentState: 'PLANNING',
        isTerminal: false,
        aggregatedPhase: { tttPhase: 'offer', ttrPhase: 'short_term' },
        operationalContexts: [
          {
            timetableYearLabel: '2026/27',
            validFrom: '2027-04-01',
            validTo: '2027-04-02',
            state: 'PLANNING',
            status: 'active',
          },
        ],
      },
    ];

    const { service } = createService({
      orderRecord,
      cases,
      caseDetailErrorCaseIds: ['TOC-400'],
    });

    const details = await service.getOrderTraceabilityCaseDetails(
      'ORD-TRACE-4',
      'TOC-400',
    );

    expect(details.detailStatus).toBe('degraded');
    expect(details.messages).toEqual([]);
    expect(details.transitions).toEqual([]);
    expect(details.detailError).toContain('FM-Case-Details');
  });

  it('rejects case-level detail lookup for cases not linked to order', async () => {
    const orderRecord = {
      id: 'ORD-TRACE-5',
      items: [{ linkedTrainPlanId: 'TP-500' }],
    };

    const cases = [
      {
        id: 'TOC-500',
        title: 'Only Linked Case',
        profileId: 'annual_order',
        profileLabel: 'Jahresbestellung',
        trainPlanId: 'TP-500',
        validFrom: '2027-05-01',
        validTo: '2027-05-02',
        pathRequestId: 'PR-500',
        pathId: null,
        currentState: 'DRAFT',
        isTerminal: false,
        aggregatedPhase: { tttPhase: 'path_request', ttrPhase: 'annual_request' },
        operationalContexts: [],
      },
    ];

    const { service } = createService({ orderRecord, cases });

    await expect(
      service.getOrderTraceabilityCaseDetails('ORD-TRACE-5', 'TOC-UNKNOWN'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFoundException when order does not exist', async () => {
    const { service } = createService({
      orderRecord: null,
      cases: [],
    });

    await expect(service.getOrderPhaseSnapshot('UNKNOWN')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.getOrderOperationalContexts('UNKNOWN'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getOrderTraceability('UNKNOWN')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.getOrderTraceabilityCaseDetails('UNKNOWN', 'TOC-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
