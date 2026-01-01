import { Module } from '@nestjs/common';
import { PlanningModule } from '../planning/planning.module';
import { VariantsModule } from '../variants/variants.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { ASSISTANT_CONFIG } from './assistant.constants';
import { loadAssistantConfig } from './assistant.config';
import { OllamaOpenAiClient } from './ollama-openai.client';
import { AssistantConversationStore } from './assistant.conversation-store';
import { AssistantDocumentationService } from './assistant.documentation.service';
import { AssistantActionPreviewStore } from './assistant-action-preview.store';
import { AssistantActionClarificationStore } from './assistant-action-clarification.store';
import { AssistantActionService } from './assistant-action.service';
import { AssistantRateLimiter } from './assistant-rate-limiter.service';
import { AssistantActionAuditService } from './assistant-action-audit.service';
import { AssistantContextService } from './assistant-context.service';

@Module({
  imports: [PlanningModule, VariantsModule],
  controllers: [AssistantController],
  providers: [
    { provide: ASSISTANT_CONFIG, useFactory: loadAssistantConfig },
    AssistantConversationStore,
    AssistantActionPreviewStore,
    AssistantActionClarificationStore,
    AssistantRateLimiter,
    AssistantActionAuditService,
    AssistantContextService,
    AssistantDocumentationService,
    OllamaOpenAiClient,
    AssistantService,
    AssistantActionService,
  ],
})
export class AssistantModule {}
