import type { DutyAutopilotConfig } from './planning-rule.service';
import { DutyAutopilotService } from './duty-autopilot.service';
import type { Activity, StageId } from './planning.types';

function applyAutopilot(state: Activity[], result: { upserts: Activity[]; deletedIds: string[] }): Activity[] {
  const byId = new Map(state.map((activity) => [activity.id, activity]));
  result.upserts.forEach((activity) => byId.set(activity.id, activity));
  result.deletedIds.forEach((id) => byId.delete(id));
  return Array.from(byId.values());
}

describe('DutyAutopilotService', () => {
  const config: DutyAutopilotConfig = {
    serviceStartTypeId: 'service-start',
    serviceEndTypeId: 'service-end',
    breakTypeIds: ['break'],
    conflictAttributeKey: 'service_conflict_level',
    conflictCodesAttributeKey: 'service_conflict_codes',
    maxConflictLevel: 2,
    maxWorkMinutes: 600,
    maxContinuousWorkMinutes: 300,
    minBreakMinutes: 30,
    maxDutySpanMinutes: 720,
    enforceOneDutyPerDay: true,
  };

  it('re-derives serviceId when an activity is moved to another duty row', async () => {
    const rules = {
      getDutyAutopilotConfig: jest.fn().mockResolvedValue(config),
    };
    const service = new DutyAutopilotService(rules as any);

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
    expect(state.find((a) => a.id === 'a1')?.serviceId).toBe(firstServiceId);
    expect(state.some((a) => a.id === `svcstart:${firstServiceId}`)).toBe(true);
    expect(state.some((a) => a.id === `svcend:${firstServiceId}`)).toBe(true);

    // Simulate drag&drop: owner changes but the client still sends the old serviceId.
    state = state.map((activity) =>
      activity.id === 'a1'
        ? {
            ...activity,
            serviceId: firstServiceId,
            participants: [{ resourceId: 'PS-2', kind: 'personnel-service' }],
          }
        : activity,
    );

    const second = await service.apply(stageId, variantId, state);
    const secondServiceId = 'svc:base:PS-2:2025-01-01';

    expect(second.upserts.find((a) => a.id === 'a1')?.serviceId).toBe(secondServiceId);
    expect(second.upserts.some((a) => a.id === `svcstart:${secondServiceId}`)).toBe(true);
    expect(second.upserts.some((a) => a.id === `svcend:${secondServiceId}`)).toBe(true);
    expect(second.deletedIds).toEqual(expect.arrayContaining([`svcstart:${firstServiceId}`, `svcend:${firstServiceId}`]));
  });

  it('annotates capacity overlaps and location sequence conflicts', async () => {
    const rules = {
      getDutyAutopilotConfig: jest.fn().mockResolvedValue(config),
    };
    const service = new DutyAutopilotService(rules as any);

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
    const overlapCodes1 = ((overlap1.attributes as any)?.service_conflict_codes ?? []) as string[];
    const overlapCodes2 = ((overlap2.attributes as any)?.service_conflict_codes ?? []) as string[];
    expect(overlapCodes1).toEqual(expect.arrayContaining(['CAPACITY_OVERLAP']));
    expect(overlapCodes2).toEqual(expect.arrayContaining(['CAPACITY_OVERLAP']));
    expect(((overlap1.attributes as any)?.service_conflict_level ?? 0) as number).toBe(2);

    const loc1 = result.upserts.find((a) => a.id === 'loc-1')!;
    const loc2 = result.upserts.find((a) => a.id === 'loc-2')!;
    const locCodes1 = ((loc1.attributes as any)?.service_conflict_codes ?? []) as string[];
    const locCodes2 = ((loc2.attributes as any)?.service_conflict_codes ?? []) as string[];
    expect(locCodes1).toEqual(expect.arrayContaining(['LOCATION_SEQUENCE']));
    expect(locCodes2).toEqual(expect.arrayContaining(['LOCATION_SEQUENCE']));
    expect(((loc1.attributes as any)?.service_conflict_level ?? 0) as number).toBe(1);
  });
});
