import { ConflictException } from '@nestjs/common';
import type { AssistantConfig } from './assistant.config';
import { AssistantActionService } from './assistant-action.service';
import { AssistantActionPreviewStore } from './assistant-action-preview.store';
import { AssistantActionClarificationStore } from './assistant-action-clarification.store';
import type { AssistantDocumentationService } from './assistant.documentation.service';
import type { OllamaOpenAiClient } from './ollama-openai.client';
import type { PlanningService } from '../planning/planning.service';
import type { ResourceSnapshot } from '../planning/planning.types';
import type { TimetableYearService } from '../variants/timetable-year.service';

const baseSnapshot: ResourceSnapshot = {
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
};

function createConfig(overrides?: Partial<AssistantConfig>): AssistantConfig {
  return {
    ollamaBaseUrl: 'http://localhost:11434',
    ollamaModel: 'qwen3:8b',
    ollamaApiKey: null,
    ollamaTimeoutMs: 1000,
    ollamaTemperature: null,
    ollamaTopP: null,
    ollamaMaxTokens: null,
    maxContextMessages: 20,
    maxConversations: 200,
    conversationTtlMs: 3600000,
    enableSummary: false,
    summaryBatchMessages: 10,
    summaryMaxChars: 2000,
    maxDocChars: 2000,
    maxUiDataChars: 2000,
    maxContextChars: 4000,
    docInjectionMode: 'never',
    actionPreviewTtlMs: 3600000,
    actionRetryInvalid: true,
    rateLimitWindowMs: 60000,
    rateLimitMax: 60,
    actionRateLimitMax: 20,
    actionAuditEnabled: false,
    actionAuditLogPath: 'logs/assistant-actions.ndjson',
    actionRoleMap: null,
    ...overrides,
  };
}

function createService(
  responses: string[],
  overrides?: Partial<AssistantConfig>,
) {
  const config = createConfig(overrides);
  let currentSnapshot = { ...baseSnapshot };

  const planning = {
    getResourceSnapshot: jest.fn(() => currentSnapshot),
    normalizeResourceSnapshot: jest.fn(
      (snapshot: ResourceSnapshot) => snapshot,
    ),
    replaceResourceSnapshot: jest.fn(async (snapshot: ResourceSnapshot) => {
      currentSnapshot = snapshot;
      return snapshot;
    }),
    listOperationalPoints: jest.fn(() => []),
    listSectionsOfLine: jest.fn(() => []),
    listPersonnelSites: jest.fn(() => []),
    listReplacementStops: jest.fn(() => []),
    listReplacementRoutes: jest.fn(() => []),
    listReplacementEdges: jest.fn(() => []),
    listOpReplacementStopLinks: jest.fn(() => []),
    listTransferEdges: jest.fn(() => []),
  } as unknown as PlanningService;

  const timetableYears = {
    createYear: jest.fn(),
    deleteYear: jest.fn(),
    createSimulationVariant: jest.fn(),
    updateSimulationVariant: jest.fn(),
    deleteVariant: jest.fn(),
    listVariants: jest.fn(() => []),
  } as unknown as TimetableYearService;

  const ollama = {
    createChatCompletion: jest
      .fn()
      .mockImplementation(async () => responses.shift() ?? ''),
  } as unknown as OllamaOpenAiClient;

  const docs = {
    buildDocumentationMessages: jest.fn(() => []),
  } as unknown as AssistantDocumentationService;

  const previews = new AssistantActionPreviewStore(config);
  const clarifications = new AssistantActionClarificationStore(config);
  const audit = {
    recordPreview: jest.fn(),
    recordCommit: jest.fn(),
    recordConflict: jest.fn(),
  };

  const service = new AssistantActionService(
    config,
    docs,
    planning,
    timetableYears,
    ollama,
    previews,
    clarifications,
    audit as never,
  );

  return { service, planning, previews };
}

describe('AssistantActionService', () => {
  it('creates a preview for a valid action', async () => {
    const { service } = createService([
      '{"action":"create_personnel_pool","pool":{"name":"Alpha"}}',
    ]);

    const response = await service.preview({
      prompt: 'Lege Personalpool Alpha an',
    });

    expect(response.actionable).toBe(true);
    expect(response.previewId).toBeTruthy();
    expect(response.summary).toContain('Alpha');
  });

  it('retries when the first response is invalid JSON', async () => {
    const { service } = createService([
      'not-json',
      '{"action":"create_personnel_pool","pool":{"name":"Beta"}}',
    ]);

    const response = await service.preview({
      prompt: 'Lege Personalpool Beta an',
    });

    expect(response.actionable).toBe(true);
    expect(response.summary).toContain('Beta');
  });

  it('rejects commit when the snapshot changed', async () => {
    const { service, planning } = createService([
      '{"action":"create_personnel_pool","pool":{"name":"Gamma"}}',
    ]);

    const response = await service.preview({
      prompt: 'Lege Personalpool Gamma an',
    });
    const previewId = response.previewId ?? '';

    (planning.getResourceSnapshot as jest.Mock).mockReturnValue({
      ...baseSnapshot,
      personnelPools: [{ id: 'PP-1', name: 'Other', personnelIds: [] }],
    } as ResourceSnapshot);

    await expect(
      service.commit({ previewId, clientId: undefined }),
    ).rejects.toThrow(ConflictException);
  });

  it('blocks actions when the role is not allowed', async () => {
    const { service } = createService(
      ['{"action":"create_personnel_pool","pool":{"name":"Delta"}}'],
      { actionRoleMap: { limited: ['create_vehicle_pool'] } },
    );

    const response = await service.preview(
      { prompt: 'Lege Personalpool Delta an' },
      'limited',
    );

    expect(response.actionable).toBe(false);
    expect(response.feedback).toContain('Rolle');
  });

  it('summarizes batch actions', async () => {
    const { service } = createService([
      '{"action":"batch","actions":[{"action":"create_personnel_pool","pool":{"name":"A"}},{"action":"create_vehicle_pool","pool":{"name":"B"}}]}',
    ]);

    const response = await service.preview({ prompt: 'Lege zwei Pools an' });

    expect(response.actionable).toBe(true);
    expect(response.summary).toContain('Batch (2 Aktionen)');
  });
});
