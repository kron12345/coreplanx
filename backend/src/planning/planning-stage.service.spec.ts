import { BadRequestException } from '@nestjs/common';
import { PlanningStageService } from './planning-stage.service';
import type { Activity, StageId } from './planning.types';

describe('PlanningStageService', () => {
  const makeService = () => {
    const repository = { isEnabled: false } as any;
    const dutyAutopilot = {
      apply: jest.fn().mockResolvedValue({ upserts: [], deletedIds: [], touchedIds: [] }),
      applyWorktimeCompliance: jest.fn().mockResolvedValue([]),
    } as any;
    const activityCatalog = {
      listActivityTypes: jest.fn().mockReturnValue([
        { id: 'travel', attributes: { requires_vehicle: true } },
        { id: 'vehicle-on', attributes: { requires_vehicle: true, is_vehicle_on: true } },
        { id: 'vehicle-off', attributes: { requires_vehicle: true, is_vehicle_off: true } },
      ]),
    } as any;
    return {
      service: new PlanningStageService(repository, dutyAutopilot, activityCatalog),
      dutyAutopilot,
      activityCatalog,
    };
  };

  const getStage = (service: PlanningStageService, stageId: StageId, variantId: string) =>
    (service as any).stages.get(`${stageId}::${variantId}`) as { activities: Activity[] };

  it('validates participant requirements only for changed activities', async () => {
    const { service } = makeService();
    const stage = getStage(service, 'operations', 'default');
    stage.activities = [
      {
        id: 'legacy-invalid',
        title: 'Fahrt',
        start: '2025-12-13T08:00:00.000Z',
        end: '2025-12-13T09:00:00.000Z',
        type: 'travel',
        participants: [{ resourceId: 'PS-1', kind: 'personnel-service' }],
      },
    ];

    const result = await service.mutateActivities('operations', 'default', {
      upserts: [
        {
          id: 'new-valid',
          title: 'Fahrt',
          start: '2025-12-13T10:00:00.000Z',
          end: '2025-12-13T11:00:00.000Z',
          type: 'travel',
          participants: [
            { resourceId: 'PS-1', kind: 'personnel-service' },
            { resourceId: 'VS-1', kind: 'vehicle-service' },
          ],
        },
      ],
    });

    expect(result.appliedUpserts).toEqual(['new-valid']);
    expect(stage.activities.some((activity) => activity.id === 'new-valid')).toBe(true);
    expect(stage.activities.some((activity) => activity.id === 'legacy-invalid')).toBe(true);
  });

  it('rolls back stage mutations when participant validation fails', async () => {
    const { service } = makeService();
    const stage = getStage(service, 'operations', 'default');
    stage.activities = [];

    await expect(
      service.mutateActivities('operations', 'default', {
        upserts: [
          {
            id: 'invalid-travel',
            title: 'Fahrt',
            start: '2025-12-13T08:00:00.000Z',
            end: '2025-12-13T09:00:00.000Z',
            type: 'travel',
            participants: [{ resourceId: 'PS-1', kind: 'personnel-service' }],
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(stage.activities).toEqual([]);
  });

  it('does not block unrelated mutations because of existing boundary violations', async () => {
    const { service } = makeService();
    const stage = getStage(service, 'operations', 'default');
    stage.activities = [
      {
        id: 't1',
        title: 'Fahrt',
        start: '2025-12-13T08:00:00.000Z',
        end: '2025-12-13T09:00:00.000Z',
        type: 'travel',
        participants: [
          { resourceId: 'PS-1', kind: 'personnel-service' },
          { resourceId: 'VS-1', kind: 'vehicle-service' },
        ],
      },
      {
        id: 'on-too-late',
        title: 'Einschalten',
        start: '2025-12-13T09:00:00.000Z',
        end: '2025-12-13T09:05:00.000Z',
        type: 'vehicle-on',
        participants: [
          { resourceId: 'PS-1', kind: 'personnel-service' },
          { resourceId: 'VS-1', kind: 'vehicle-service' },
        ],
      },
    ];

    const result = await service.mutateActivities('operations', 'default', {
      upserts: [
        {
          id: 'personnel-only',
          title: 'Dienstleistung',
          start: '2025-12-14T08:00:00.000Z',
          end: '2025-12-14T09:00:00.000Z',
          type: 'duty-work',
          participants: [{ resourceId: 'PS-2', kind: 'personnel-service' }],
        },
      ],
    });

    expect(result.appliedUpserts).toEqual(['personnel-only']);
    expect(stage.activities.some((activity) => activity.id === 'personnel-only')).toBe(true);
  });

  it('enforces boundary order when a boundary group is touched', async () => {
    const { service } = makeService();
    const stage = getStage(service, 'operations', 'default');
    stage.activities = [
      {
        id: 'on-first',
        title: 'Einschalten',
        start: '2025-12-13T07:00:00.000Z',
        end: '2025-12-13T07:05:00.000Z',
        type: 'vehicle-on',
        participants: [
          { resourceId: 'PS-1', kind: 'personnel-service' },
          { resourceId: 'VS-1', kind: 'vehicle-service' },
        ],
      },
      {
        id: 't1',
        title: 'Fahrt',
        start: '2025-12-13T08:00:00.000Z',
        end: '2025-12-13T09:00:00.000Z',
        type: 'travel',
        participants: [
          { resourceId: 'PS-1', kind: 'personnel-service' },
          { resourceId: 'VS-1', kind: 'vehicle-service' },
        ],
      },
    ];

    await expect(
      service.mutateActivities('operations', 'default', {
        upserts: [
          {
            ...stage.activities.find((a) => a.id === 'on-first')!,
            start: '2025-12-13T09:30:00.000Z',
            end: '2025-12-13T09:35:00.000Z',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows creating a vehicle-on activity without vehicle-off', async () => {
    const { service } = makeService();
    const stage = getStage(service, 'operations', 'default');
    stage.activities = [];

    const result = await service.mutateActivities('operations', 'default', {
      upserts: [
        {
          id: 'on-only',
          title: 'Einschalten',
          start: '2025-12-13T07:00:00.000Z',
          end: '2025-12-13T07:05:00.000Z',
          type: 'vehicle-on',
          participants: [
            { resourceId: 'PS-1', kind: 'personnel-service' },
            { resourceId: 'VS-1', kind: 'vehicle-service' },
          ],
        },
      ],
    });

    expect(result.appliedUpserts).toEqual(['on-only']);
    expect(stage.activities.some((activity) => activity.id === 'on-only')).toBe(true);
  });
});
