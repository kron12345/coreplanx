import type { DutyAutopilotConfig } from './planning-rule.service';
import { DutyAutopilotService } from './duty-autopilot.service';
import type { Activity, StageId } from './planning.types';

function applyAutopilot(state: Activity[], result: { upserts: Activity[]; deletedIds: string[] }): Activity[] {
  const byId = new Map(state.map((activity) => [activity.id, activity]));
  result.upserts.forEach((activity) => byId.set(activity.id, activity));
  result.deletedIds.forEach((id) => byId.delete(id));
  return Array.from(byId.values());
}

function applyUpserts(state: Activity[], upserts: Activity[]): Activity[] {
  const byId = new Map(state.map((activity) => [activity.id, activity]));
  upserts.forEach((activity) => byId.set(activity.id, activity));
  return Array.from(byId.values());
}

function createMasterDataStub() {
  return {
    getResourceSnapshot: () => ({
      personnel: [],
      personnelServices: [],
      personnelServicePools: [],
      personnelPools: [],
      homeDepots: [],
      vehicles: [],
      vehicleServices: [],
      vehicleServicePools: [],
      vehiclePools: [],
      vehicleTypes: [],
      vehicleCompositions: [],
    }),
    listPersonnelSites: () => [],
    listOperationalPoints: () => [],
    listTransferEdges: () => [],
  };
}

function createActivityCatalogStub() {
  return {
    listActivityTypes: () => [],
  };
}

function createRulesetStub() {
  return {
    listVersions: () => [],
    getCompiledRuleset: () => null,
  };
}

describe('DutyAutopilotService', () => {
  const baseAzg = {
    enabled: false,
    exceedBufferMinutes: 10,
    workAvg7d: { enabled: false, windowWorkdays: 7, maxAverageMinutes: 540 },
    workAvg365d: { enabled: false, windowDays: 365, maxAverageMinutes: 420 },
    dutySpanAvg28d: { enabled: false, windowDays: 28, maxAverageMinutes: 720 },
    restMin: { enabled: false, minMinutes: 660 },
    restAvg28d: { enabled: false, windowDays: 28, minAverageMinutes: 720 },
    breakMaxCount: { enabled: false, maxCount: 3 },
    breakForbiddenNight: { enabled: false, startHour: 23, endHour: 5 },
    breakStandard: { enabled: false, minMinutes: 60 },
    breakMidpoint: { enabled: false, toleranceMinutes: 60 },
    breakInterruption: { enabled: false, minMinutes: 20, maxDutyMinutes: 540, maxWorkMinutes: 360 },
    nightMaxStreak: { enabled: false, maxConsecutive: 7 },
    nightMax28d: { enabled: false, windowDays: 28, maxCount: 14 },
    restDaysYear: {
      enabled: false,
      minRestDays: 62,
      minSundayRestDays: 20,
      additionalSundayLikeHolidays: [],
    },
  };

  const config: DutyAutopilotConfig = {
    serviceStartTypeId: 'service-start',
    serviceEndTypeId: 'service-end',
    breakTypeIds: ['break'],
    shortBreakTypeId: 'short-break',
    commuteTypeId: 'commute',
    conflictAttributeKey: 'service_conflict_level',
    conflictCodesAttributeKey: 'service_conflict_codes',
    maxConflictLevel: 2,
    maxWorkMinutes: 600,
    maxContinuousWorkMinutes: 300,
    minBreakMinutes: 30,
    minShortBreakMinutes: 20,
    maxDutySpanMinutes: 720,
    enforceOneDutyPerDay: true,
    azg: baseAzg,
  };

  const azgConfig: DutyAutopilotConfig = {
    ...config,
    azg: {
      ...baseAzg,
      enabled: true,
      breakStandard: { enabled: true, minMinutes: 60 },
      breakMidpoint: { enabled: true, toleranceMinutes: 60 },
      breakInterruption: { enabled: true, minMinutes: 20, maxDutyMinutes: 540, maxWorkMinutes: 360 },
    },
  };

  const readOwnerCodes = (activity: Activity, ownerId: string): string[] => {
    const mapping = (activity.attributes as any)?.service_by_owner ?? {};
    return (mapping[ownerId]?.conflictCodes ?? []) as string[];
  };

  it('re-derives serviceId when an activity is moved to another duty row', async () => {
    const rules = {
      getDutyAutopilotConfig: jest.fn().mockResolvedValue(config),
    };
    const service = new DutyAutopilotService(
      rules as any,
      createMasterDataStub() as any,
      createActivityCatalogStub() as any,
      createRulesetStub() as any,
    );

    const stageId: StageId = 'base';
    const variantId = 'default';

    let state: Activity[] = [
      {
        id: 'a1',
        title: 'Dienstleistung',
        start: '2025-01-01T08:00:00.000Z',
        end: '2025-01-01T09:00:00.000Z',
        type: 'duty-work',
        participants: [{ resourceId: 'PS-1', kind: 'personnel-service' }],
      },
    ];

    const first = await service.apply(stageId, variantId, state);
    state = applyAutopilot(state, first);

    const firstServiceId = 'svc:base:PS-1:2025-01-01';
    const firstActivity = state.find((a) => a.id === 'a1')!;
    expect(firstActivity.serviceId ?? null).toBeNull();
    expect(((firstActivity.attributes as any)?.service_by_owner ?? {})['PS-1']?.serviceId).toBe(firstServiceId);
    expect(state.some((a) => a.id === `svcstart:${firstServiceId}`)).toBe(true);
    expect(state.some((a) => a.id === `svcend:${firstServiceId}`)).toBe(true);

    // Simulate drag&drop: owner changes but stale service metadata is still present on the payload.
    state = state.map((activity) =>
      activity.id === 'a1'
        ? {
            ...activity,
            participants: [{ resourceId: 'PS-2', kind: 'personnel-service' }],
          }
        : activity,
    );

    const second = await service.apply(stageId, variantId, state);
    const secondServiceId = 'svc:base:PS-2:2025-01-01';

    const updated = second.upserts.find((a) => a.id === 'a1')!;
    expect(updated.serviceId ?? null).toBeNull();
    const mapping = (updated.attributes as any)?.service_by_owner ?? {};
    expect(mapping['PS-2']?.serviceId).toBe(secondServiceId);
    expect(mapping['PS-1']).toBeUndefined();
    expect(second.upserts.some((a) => a.id === `svcstart:${secondServiceId}`)).toBe(true);
    expect(second.upserts.some((a) => a.id === `svcend:${secondServiceId}`)).toBe(true);
    expect(second.deletedIds).toEqual(expect.arrayContaining([`svcstart:${firstServiceId}`, `svcend:${firstServiceId}`]));
  });

  it('annotates capacity overlaps and location sequence conflicts', async () => {
    const rules = {
      getDutyAutopilotConfig: jest.fn().mockResolvedValue(config),
    };
    const service = new DutyAutopilotService(
      rules as any,
      createMasterDataStub() as any,
      createActivityCatalogStub() as any,
      createRulesetStub() as any,
    );

    const stageId: StageId = 'base';
    const variantId = 'default';

    const state: Activity[] = [
      {
        id: 'overlap-1',
        title: 'Dienstleistung',
        start: '2025-01-02T08:00:00.000Z',
        end: '2025-01-02T10:00:00.000Z',
        type: 'duty-work',
        participants: [{ resourceId: 'PS-1', kind: 'personnel-service' }],
      },
      {
        id: 'overlap-2',
        title: 'Dienstleistung',
        start: '2025-01-02T09:30:00.000Z',
        end: '2025-01-02T11:00:00.000Z',
        type: 'duty-work',
        participants: [{ resourceId: 'PS-1', kind: 'personnel-service' }],
      },
      {
        id: 'loc-1',
        title: 'Fahrt',
        start: '2025-01-03T08:00:00.000Z',
        end: '2025-01-03T09:00:00.000Z',
        from: 'A',
        to: 'B',
        type: 'travel',
        participants: [{ resourceId: 'PS-1', kind: 'personnel-service' }],
      },
      {
        id: 'loc-2',
        title: 'Fahrt',
        start: '2025-01-03T09:00:00.000Z',
        end: '2025-01-03T10:00:00.000Z',
        from: 'C',
        to: 'D',
        type: 'travel',
        participants: [{ resourceId: 'PS-1', kind: 'personnel-service' }],
      },
    ];

    const result = await service.apply(stageId, variantId, state);
    const overlap1 = result.upserts.find((a) => a.id === 'overlap-1')!;
    const overlap2 = result.upserts.find((a) => a.id === 'overlap-2')!;
    const overlapCodes1 = (((overlap1.attributes as any)?.service_by_owner ?? {})['PS-1']?.conflictCodes ?? []) as string[];
    const overlapCodes2 = (((overlap2.attributes as any)?.service_by_owner ?? {})['PS-1']?.conflictCodes ?? []) as string[];
    expect(overlapCodes1).toEqual(expect.arrayContaining(['CAPACITY_OVERLAP']));
    expect(overlapCodes2).toEqual(expect.arrayContaining(['CAPACITY_OVERLAP']));
    expect((((overlap1.attributes as any)?.service_by_owner ?? {})['PS-1']?.conflictLevel ?? 0) as number).toBe(2);

    const loc1 = result.upserts.find((a) => a.id === 'loc-1')!;
    const loc2 = result.upserts.find((a) => a.id === 'loc-2')!;
    const locCodes1 = (((loc1.attributes as any)?.service_by_owner ?? {})['PS-1']?.conflictCodes ?? []) as string[];
    const locCodes2 = (((loc2.attributes as any)?.service_by_owner ?? {})['PS-1']?.conflictCodes ?? []) as string[];
    expect(locCodes1).toEqual(expect.arrayContaining(['LOCATION_SEQUENCE']));
    expect(locCodes2).toEqual(expect.arrayContaining(['LOCATION_SEQUENCE']));
    expect((((loc1.attributes as any)?.service_by_owner ?? {})['PS-1']?.conflictLevel ?? 0) as number).toBe(1);
  });

  it('flags location conflicts between operational points and personnel sites without walk time', async () => {
    const rules = {
      getDutyAutopilotConfig: jest.fn().mockResolvedValue(config),
    };
    const masterData = {
      ...createMasterDataStub(),
      listOperationalPoints: () => [
        {
          opId: 'OP-BER-HBF',
          uniqueOpId: 'DE:BER-HBF',
          countryCode: 'DE',
          name: 'Berlin Hbf',
          opType: 'STATION',
          position: { lat: 52.52508, lng: 13.3694 },
        },
      ],
      listPersonnelSites: () => [
        {
          siteId: 'PS-BER',
          siteType: 'MELDESTELLE',
          name: 'Berlin Hbf Meldestelle',
          uniqueOpId: 'DE:BER-HBF',
          position: { lat: 52.52508, lng: 13.3694 },
        },
      ],
      listTransferEdges: () => [],
    };
    const service = new DutyAutopilotService(
      rules as any,
      masterData as any,
      createActivityCatalogStub() as any,
      createRulesetStub() as any,
    );

    const stageId: StageId = 'base';
    const variantId = 'default';
    const participants = [{ resourceId: 'PS-1', kind: 'personnel-service' as const }];

    const state: Activity[] = [
      {
        id: 'loc-op',
        title: 'Fahrt',
        start: '2025-02-01T08:00:00.000Z',
        end: '2025-02-01T09:00:00.000Z',
        from: 'DE:BER-HBF',
        to: 'DE:BER-HBF',
        type: 'travel',
        participants,
      },
      {
        id: 'loc-site',
        title: 'Meldestelle',
        start: '2025-02-01T09:05:00.000Z',
        end: '2025-02-01T09:15:00.000Z',
        from: 'DE:BER-HBF',
        to: 'DE:BER-HBF',
        locationId: 'PS-BER',
        type: 'service',
        participants,
      },
    ];

    const result = await service.apply(stageId, variantId, state);
    const updated = applyAutopilot(state, result);
    const op = updated.find((a) => a.id === 'loc-op')!;
    const site = updated.find((a) => a.id === 'loc-site')!;
    expect(readOwnerCodes(op, 'PS-1')).toEqual(expect.arrayContaining(['LOCATION_SEQUENCE']));
    expect(readOwnerCodes(site, 'PS-1')).toEqual(expect.arrayContaining(['LOCATION_SEQUENCE']));
  });

  it('flags location conflicts even when walk time exists between operational point and personnel site', async () => {
    const rules = {
      getDutyAutopilotConfig: jest.fn().mockResolvedValue(config),
    };
    const masterData = {
      ...createMasterDataStub(),
      listOperationalPoints: () => [
        {
          opId: 'OP-BER-HBF',
          uniqueOpId: 'DE:BER-HBF',
          countryCode: 'DE',
          name: 'Berlin Hbf',
          opType: 'STATION',
          position: { lat: 52.52508, lng: 13.3694 },
        },
      ],
      listPersonnelSites: () => [
        {
          siteId: 'PS-BER',
          siteType: 'MELDESTELLE',
          name: 'Berlin Hbf Meldestelle',
          uniqueOpId: 'DE:BER-HBF',
          position: { lat: 52.52508, lng: 13.3694 },
        },
      ],
      listTransferEdges: () => [
        {
          transferId: 'walk-ber',
          from: { kind: 'OP', uniqueOpId: 'DE:BER-HBF' },
          to: { kind: 'PERSONNEL_SITE', siteId: 'PS-BER' },
          mode: 'WALK',
          avgDurationSec: 180,
          bidirectional: true,
        },
      ],
    };
    const service = new DutyAutopilotService(
      rules as any,
      masterData as any,
      createActivityCatalogStub() as any,
      createRulesetStub() as any,
    );

    const stageId: StageId = 'base';
    const variantId = 'default';
    const participants = [{ resourceId: 'PS-1', kind: 'personnel-service' as const }];

    const state: Activity[] = [
      {
        id: 'loc-op',
        title: 'Fahrt',
        start: '2025-02-02T08:00:00.000Z',
        end: '2025-02-02T09:00:00.000Z',
        from: 'DE:BER-HBF',
        to: 'DE:BER-HBF',
        type: 'travel',
        participants,
      },
      {
        id: 'loc-site',
        title: 'Meldestelle',
        start: '2025-02-02T09:05:00.000Z',
        end: '2025-02-02T09:15:00.000Z',
        from: 'DE:BER-HBF',
        to: 'DE:BER-HBF',
        locationId: 'PS-BER',
        type: 'service',
        participants,
      },
    ];

    const result = await service.apply(stageId, variantId, state);
    const updated = applyAutopilot(state, result);
    const op = updated.find((a) => a.id === 'loc-op')!;
    const site = updated.find((a) => a.id === 'loc-site')!;
    expect(readOwnerCodes(op, 'PS-1')).toEqual(expect.arrayContaining(['LOCATION_SEQUENCE']));
    expect(readOwnerCodes(site, 'PS-1')).toEqual(expect.arrayContaining(['LOCATION_SEQUENCE']));
  });

  it('creates independent duties for each duty owner on linked activities', async () => {
    const rules = {
      getDutyAutopilotConfig: jest.fn().mockResolvedValue(config),
    };
    const service = new DutyAutopilotService(
      rules as any,
      createMasterDataStub() as any,
      createActivityCatalogStub() as any,
      createRulesetStub() as any,
    );

    const stageId: StageId = 'base';
    const variantId = 'default';

    const state: Activity[] = [
      {
        id: 'a1',
        title: 'Dienstleistung',
        start: '2025-01-04T08:00:00.000Z',
        end: '2025-01-04T09:00:00.000Z',
        type: 'duty-work',
        participants: [
          { resourceId: 'PS-1', kind: 'personnel-service' },
          { resourceId: 'PS-2', kind: 'personnel-service' },
        ],
      },
    ];

    const result = await service.apply(stageId, variantId, state);
    const updated = result.upserts.find((a) => a.id === 'a1')!;
    expect(updated.serviceId ?? null).toBeNull();
    const mapping = (updated.attributes as any)?.service_by_owner ?? {};
    const svc1 = 'svc:base:PS-1:2025-01-04';
    const svc2 = 'svc:base:PS-2:2025-01-04';
    expect(mapping['PS-1']?.serviceId).toBe(svc1);
    expect(mapping['PS-2']?.serviceId).toBe(svc2);
    expect(result.upserts.some((a) => a.id === `svcstart:${svc1}`)).toBe(true);
    expect(result.upserts.some((a) => a.id === `svcend:${svc1}`)).toBe(true);
    expect(result.upserts.some((a) => a.id === `svcstart:${svc2}`)).toBe(true);
    expect(result.upserts.some((a) => a.id === `svcend:${svc2}`)).toBe(true);
  });

  it('assigns cross-midnight activities to the duty start day when within max duty span', async () => {
    const rules = {
      getDutyAutopilotConfig: jest.fn().mockResolvedValue(config),
    };
    const service = new DutyAutopilotService(
      rules as any,
      createMasterDataStub() as any,
      createActivityCatalogStub() as any,
      createRulesetStub() as any,
    );

    const stageId: StageId = 'base';
    const variantId = 'default';

    const state: Activity[] = [
      {
        id: 'late',
        title: 'Dienstleistung',
        start: '2025-01-01T22:00:00.000Z',
        end: '2025-01-01T23:00:00.000Z',
        type: 'duty-work',
        participants: [{ resourceId: 'PS-1', kind: 'personnel-service' }],
      },
      {
        id: 'early',
        title: 'Dienstleistung',
        start: '2025-01-02T01:00:00.000Z',
        end: '2025-01-02T02:00:00.000Z',
        type: 'duty-work',
        participants: [{ resourceId: 'PS-1', kind: 'personnel-service' }],
      },
    ];

    const result = await service.apply(stageId, variantId, state);
    const expectedServiceId = 'svc:base:PS-1:2025-01-01';
    const late = result.upserts.find((a) => a.id === 'late')!;
    const early = result.upserts.find((a) => a.id === 'early')!;
    expect(((late.attributes as any)?.service_by_owner ?? {})['PS-1']?.serviceId).toBe(expectedServiceId);
    expect(((early.attributes as any)?.service_by_owner ?? {})['PS-1']?.serviceId).toBe(expectedServiceId);
    expect(result.upserts.some((a) => a.id === `svcstart:${expectedServiceId}`)).toBe(true);
    expect(result.upserts.some((a) => a.id === `svcend:${expectedServiceId}`)).toBe(true);
  });

  it('keeps manually adjusted service boundaries', async () => {
    const rules = {
      getDutyAutopilotConfig: jest.fn().mockResolvedValue(config),
    };
    const service = new DutyAutopilotService(
      rules as any,
      createMasterDataStub() as any,
      createActivityCatalogStub() as any,
      createRulesetStub() as any,
    );

    const stageId: StageId = 'base';
    const variantId = 'default';

    let state: Activity[] = [
      {
        id: 'a1',
        title: 'Dienstleistung',
        start: '2025-01-06T08:00:00.000Z',
        end: '2025-01-06T09:00:00.000Z',
        type: 'duty-work',
        participants: [{ resourceId: 'PS-1', kind: 'personnel-service' }],
      },
    ];

    const first = await service.apply(stageId, variantId, state);
    state = applyAutopilot(state, first);

    const serviceId = 'svc:base:PS-1:2025-01-06';
    const startId = `svcstart:${serviceId}`;
    state = state.map((activity) =>
      activity.id === startId
        ? {
            ...activity,
            start: '2025-01-06T07:50:00.000Z',
            attributes: { ...(activity.attributes ?? {}), manual_service_boundary: true },
          }
        : activity,
    );

    const second = await service.apply(stageId, variantId, state);
    const updatedStart = second.upserts.find((a) => a.id === startId)!;
    expect(updatedStart.start).toBe('2025-01-06T07:50:00.000Z');
    expect(((updatedStart.attributes as any)?.manual_service_boundary ?? false) as boolean).toBe(true);
  });

  it('flags missing break or interruption when continuous work exceeds limit', async () => {
    const rules = {
      getDutyAutopilotConfig: jest.fn().mockResolvedValue(azgConfig),
    };
    const service = new DutyAutopilotService(
      rules as any,
      createMasterDataStub() as any,
      createActivityCatalogStub() as any,
      createRulesetStub() as any,
    );

    const stageId: StageId = 'base';
    const variantId = 'default';

    const state: Activity[] = [
      {
        id: 'long',
        title: 'Dienstleistung',
        start: '2025-01-07T08:00:00.000Z',
        end: '2025-01-07T16:00:00.000Z',
        type: 'duty-work',
        participants: [{ resourceId: 'PS-1', kind: 'personnel-service' }],
      },
    ];

    const result = await service.apply(stageId, variantId, state);
    const updated = result.upserts.find((a) => a.id === 'long')!;
    const codes = readOwnerCodes(updated, 'PS-1');
    expect(codes).toEqual(expect.arrayContaining(['AZG_BREAK_REQUIRED']));
  });

  it('treats short breaks as interruption below the work-time threshold', async () => {
    const rules = {
      getDutyAutopilotConfig: jest.fn().mockResolvedValue(azgConfig),
    };
    const service = new DutyAutopilotService(
      rules as any,
      createMasterDataStub() as any,
      createActivityCatalogStub() as any,
      createRulesetStub() as any,
    );

    const stageId: StageId = 'base';
    const variantId = 'default';

    const state: Activity[] = [
      {
        id: 'duty',
        title: 'Dienstleistung',
        start: '2025-01-08T08:00:00.000Z',
        end: '2025-01-08T13:30:00.000Z',
        type: 'duty-work',
        participants: [{ resourceId: 'PS-1', kind: 'personnel-service' }],
      },
      {
        id: 'short-break',
        title: 'Kurzpause',
        start: '2025-01-08T11:00:00.000Z',
        end: '2025-01-08T11:20:00.000Z',
        type: 'short-break',
        participants: [{ resourceId: 'PS-1', kind: 'personnel-service' }],
      },
    ];

    const result = await service.apply(stageId, variantId, state);
    const updated = result.upserts.find((a) => a.id === 'duty')!;
    const codes = readOwnerCodes(updated, 'PS-1');
    expect(codes.includes('AZG_BREAK_REQUIRED')).toBe(false);
  });

  it('requires a regular break when work exceeds the interruption limit', async () => {
    const rules = {
      getDutyAutopilotConfig: jest.fn().mockResolvedValue(azgConfig),
    };
    const service = new DutyAutopilotService(
      rules as any,
      createMasterDataStub() as any,
      createActivityCatalogStub() as any,
      createRulesetStub() as any,
    );

    const stageId: StageId = 'base';
    const variantId = 'default';

    const state: Activity[] = [
      {
        id: 'duty',
        title: 'Dienstleistung',
        start: '2025-01-08T08:00:00.000Z',
        end: '2025-01-08T16:00:00.000Z',
        type: 'duty-work',
        participants: [{ resourceId: 'PS-1', kind: 'personnel-service' }],
      },
      {
        id: 'short-break',
        title: 'Kurzpause',
        start: '2025-01-08T11:00:00.000Z',
        end: '2025-01-08T11:20:00.000Z',
        type: 'short-break',
        participants: [{ resourceId: 'PS-1', kind: 'personnel-service' }],
      },
    ];

    const result = await service.apply(stageId, variantId, state);
    const updated = result.upserts.find((a) => a.id === 'duty')!;
    const codes = readOwnerCodes(updated, 'PS-1');
    expect(codes).toEqual(expect.arrayContaining(['AZG_BREAK_REQUIRED']));
  });

  it('flags standard break length and midpoint placement', async () => {
    const rules = {
      getDutyAutopilotConfig: jest.fn().mockResolvedValue(azgConfig),
    };
    const service = new DutyAutopilotService(
      rules as any,
      createMasterDataStub() as any,
      createActivityCatalogStub() as any,
      createRulesetStub() as any,
    );

    const stageId: StageId = 'base';
    const variantId = 'default';

    const state: Activity[] = [
      {
        id: 'duty',
        title: 'Dienstleistung',
        start: '2025-01-09T08:00:00.000Z',
        end: '2025-01-09T18:00:00.000Z',
        type: 'duty-work',
        participants: [{ resourceId: 'PS-1', kind: 'personnel-service' }],
      },
      {
        id: 'break',
        title: 'Pause',
        start: '2025-01-09T09:00:00.000Z',
        end: '2025-01-09T09:30:00.000Z',
        type: 'break',
        participants: [{ resourceId: 'PS-1', kind: 'personnel-service' }],
      },
    ];

    const result = await service.apply(stageId, variantId, state);
    const updated = result.upserts.find((a) => a.id === 'duty')!;
    const codes = readOwnerCodes(updated, 'PS-1');
    expect(codes).toEqual(expect.arrayContaining(['AZG_BREAK_STANDARD_MIN', 'AZG_BREAK_MIDPOINT']));
  });

  it('interrupts max continuous work with short breaks', async () => {
    const rules = {
      getDutyAutopilotConfig: jest.fn().mockResolvedValue(azgConfig),
    };
    const service = new DutyAutopilotService(
      rules as any,
      createMasterDataStub() as any,
      createActivityCatalogStub() as any,
      createRulesetStub() as any,
    );

    const stageId: StageId = 'base';
    const variantId = 'default';

    const baseParticipants = [{ resourceId: 'PS-1', kind: 'personnel-service' as const }];
    const withinAttrs = { is_within_service: 'yes' };

    let state: Activity[] = [
      {
        id: 'start',
        title: 'Dienstanfang',
        start: '2025-01-10T08:00:00.000Z',
        end: '2025-01-10T08:00:00.000Z',
        type: 'service-start',
        participants: baseParticipants,
        attributes: withinAttrs,
      },
      {
        id: 't1',
        title: 'Fahrt 1',
        start: '2025-01-10T08:00:00.000Z',
        end: '2025-01-10T11:00:00.000Z',
        from: 'A',
        to: 'B',
        type: 'travel',
        participants: baseParticipants,
        attributes: withinAttrs,
      },
      {
        id: 'sb',
        title: 'Kurzpause',
        start: '2025-01-10T11:00:00.000Z',
        end: '2025-01-10T11:20:00.000Z',
        type: 'short-break',
        participants: baseParticipants,
        attributes: withinAttrs,
      },
      {
        id: 't2',
        title: 'Fahrt 2',
        start: '2025-01-10T11:20:00.000Z',
        end: '2025-01-10T16:00:00.000Z',
        from: 'B',
        to: 'C',
        type: 'travel',
        participants: baseParticipants,
        attributes: withinAttrs,
      },
      {
        id: 'end',
        title: 'Dienstende',
        start: '2025-01-10T16:00:00.000Z',
        end: '2025-01-10T16:00:00.000Z',
        type: 'service-end',
        participants: baseParticipants,
        attributes: withinAttrs,
      },
    ];

    const upserts = await service.applyWorktimeCompliance(stageId, variantId, state);
    state = applyUpserts(state, upserts);

    const updated = state.find((a) => a.id === 't1')!;
    const codes = readOwnerCodes(updated, 'PS-1');
    expect(codes.includes('MAX_CONTINUOUS')).toBe(false);
    expect(codes.includes('NO_BREAK_WINDOW')).toBe(false);
  });

  it('assigns activities within the service window defined by boundaries', async () => {
    const rules = {
      getDutyAutopilotConfig: jest.fn().mockResolvedValue(config),
    };
    const service = new DutyAutopilotService(
      rules as any,
      createMasterDataStub() as any,
      createActivityCatalogStub() as any,
      createRulesetStub() as any,
    );

    const stageId: StageId = 'base';
    const variantId = 'default';

    const baseParticipants = [{ resourceId: 'PS-1', kind: 'personnel-service' as const }];
    const withinAttrs = { is_within_service: 'yes' };

    let state: Activity[] = [
      {
        id: 'start',
        title: 'Dienstanfang',
        start: '2025-01-11T08:00:00.000Z',
        end: '2025-01-11T08:00:00.000Z',
        type: 'service-start',
        participants: baseParticipants,
        attributes: withinAttrs,
      },
      {
        id: 't1',
        title: 'Fahrt 1',
        start: '2025-01-11T08:00:00.000Z',
        end: '2025-01-11T09:00:00.000Z',
        from: 'A',
        to: 'B',
        type: 'travel',
        participants: baseParticipants,
        attributes: withinAttrs,
      },
      {
        id: 't2',
        title: 'Fahrt 2',
        start: '2025-01-11T12:10:00.000Z',
        end: '2025-01-11T12:30:00.000Z',
        from: 'B',
        to: 'C',
        type: 'travel',
        participants: baseParticipants,
        attributes: withinAttrs,
      },
      {
        id: 'end',
        title: 'Dienstende',
        start: '2025-01-11T12:00:00.000Z',
        end: '2025-01-11T12:45:00.000Z',
        type: 'service-end',
        participants: baseParticipants,
        attributes: withinAttrs,
      },
    ];

    const upserts = await service.applyWorktimeCompliance(stageId, variantId, state);
    state = applyUpserts(state, upserts);

    const expectedServiceId = 'svc:base:PS-1:2025-01-11';
    const updated = state.find((a) => a.id === 't2')!;
    const mapping = ((updated.attributes as any)?.service_by_owner ?? {})['PS-1'];
    expect(mapping?.serviceId ?? null).toBe(expectedServiceId);
    expect(readOwnerCodes(updated, 'PS-1')).not.toEqual(expect.arrayContaining(['WITHIN_SERVICE_REQUIRED']));
  });

  it('uses the latest service end when multiple end boundaries exist', async () => {
    const rules = {
      getDutyAutopilotConfig: jest.fn().mockResolvedValue(config),
    };
    const service = new DutyAutopilotService(
      rules as any,
      createMasterDataStub() as any,
      createActivityCatalogStub() as any,
      createRulesetStub() as any,
    );

    const stageId: StageId = 'base';
    const variantId = 'default';

    const baseParticipants = [{ resourceId: 'PS-1', kind: 'personnel-service' as const }];
    const withinAttrs = { is_within_service: 'yes' };

    let state: Activity[] = [
      {
        id: 'start',
        title: 'Dienstanfang',
        start: '2025-01-12T08:00:00.000Z',
        end: '2025-01-12T08:00:00.000Z',
        type: 'service-start',
        participants: baseParticipants,
        attributes: withinAttrs,
      },
      {
        id: 'end-early',
        title: 'Dienstende (alt)',
        start: '2025-01-12T12:00:00.000Z',
        end: '2025-01-12T12:00:00.000Z',
        type: 'service-end',
        participants: baseParticipants,
        attributes: withinAttrs,
      },
      {
        id: 'end-late',
        title: 'Dienstende',
        start: '2025-01-12T20:00:00.000Z',
        end: '2025-01-12T20:00:00.000Z',
        type: 'service-end',
        participants: baseParticipants,
        attributes: withinAttrs,
      },
      {
        id: 't1',
        title: 'Fahrt',
        start: '2025-01-12T15:00:00.000Z',
        end: '2025-01-12T16:00:00.000Z',
        from: 'A',
        to: 'B',
        type: 'travel',
        participants: baseParticipants,
        attributes: withinAttrs,
      },
    ];

    const upserts = await service.applyWorktimeCompliance(stageId, variantId, state);
    state = applyUpserts(state, upserts);

    const expectedServiceId = 'svc:base:PS-1:2025-01-12';
    const updated = state.find((a) => a.id === 't1')!;
    const mapping = ((updated.attributes as any)?.service_by_owner ?? {})['PS-1'];
    expect(mapping?.serviceId ?? null).toBe(expectedServiceId);
    expect(readOwnerCodes(updated, 'PS-1')).not.toEqual(expect.arrayContaining(['WITHIN_SERVICE_REQUIRED']));
  });
});
