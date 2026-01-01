import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ASSISTANT_CONFIG } from './assistant.constants';
import type { AssistantConfig } from './assistant.config';
import {
  AssistantChatRequestDto,
  AssistantChatResponseDto,
  AssistantHelpRequestDto,
  AssistantHelpResponseDto,
} from './assistant.dto';
import { AssistantConversationStore } from './assistant.conversation-store';
import type { StoredAssistantChatMessage, StoredConversationState } from './assistant.conversation-store';
import {
  OllamaOpenAiClient,
  OllamaOpenAiHttpError,
  OllamaOpenAiNetworkError,
  OllamaOpenAiTimeoutError,
} from './ollama-openai.client';
import { COREPLANX_ASSISTANT_SYSTEM_PROMPT } from './assistant.system-prompt';
import { AssistantDocumentationService } from './assistant.documentation.service';
import {
  applyMessageBudget,
  buildUiContextMessage,
} from './assistant-context-budget';
import {
  AssistantContextService,
  type AssistantContextResult,
} from './assistant-context.service';

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    @Inject(ASSISTANT_CONFIG) private readonly config: AssistantConfig,
    private readonly conversationStore: AssistantConversationStore,
    private readonly docs: AssistantDocumentationService,
    private readonly ollama: OllamaOpenAiClient,
    private readonly context: AssistantContextService,
  ) {}

  async chat(request: AssistantChatRequestDto): Promise<AssistantChatResponseDto> {
    const prompt = request.prompt?.trim?.() ?? '';
    if (!prompt) {
      throw new BadRequestException('prompt is required');
    }

    const clientId = request.clientId?.trim() || null;
    const conversationId = request.conversationId?.trim() || randomUUID();

    let conversation: StoredConversationState;
    try {
      conversation = this.conversationStore.append(
        conversationId,
        {
          role: 'user',
          content: prompt,
          createdAt: Date.now(),
        },
        clientId,
      );
    } catch (error) {
      if ((error as Error)?.message?.includes('belongs to another client')) {
        throw new ForbiddenException('conversationId is owned by another client');
      }
      throw error;
    }

    await this.maybeUpdateSummary(conversationId, conversation);
    const uiContext = this.sanitizeUiContext(request.uiContext);
    const status: Array<{ stage: string; message: string }> = [];
    const prefetch = await this.context.prefetch(prompt, uiContext);
    if (prefetch) {
      status.push({ stage: 'prefetch', message: this.context.describeStatus(prefetch) });
    }
    const contextMessages = this.buildContextMessages(
      conversationId,
      conversation,
      uiContext,
      prefetch,
      null,
    );
    const messagesForModel = [
      { role: 'system' as const, content: COREPLANX_ASSISTANT_SYSTEM_PROMPT },
      ...contextMessages,
      ...this.buildSummaryMessages(conversation),
      ...conversation.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ];

    let assistantContent: string;
    try {
      assistantContent = await this.ollama.createChatCompletion(messagesForModel);
    } catch (error) {
      this.logger.error(
        `Assistant chat failed (model=${this.config.ollamaModel})`,
        (error as Error)?.stack ?? String(error),
      );
      throw new BadGatewayException(this.describeOllamaError(error));
    }

    const contextRequest = this.context.parseContextRequest(assistantContent);
    if (contextRequest) {
      const contextResult = await this.context.fetchContext(contextRequest);
      status.push({
        stage: 'context-request',
        message: this.context.describeStatus(contextResult),
      });
      const followupContextMessages = this.buildContextMessages(
        conversationId,
        conversation,
        uiContext,
        prefetch,
        contextResult,
      );
      const followupMessages = [
        { role: 'system' as const, content: COREPLANX_ASSISTANT_SYSTEM_PROMPT },
        ...followupContextMessages,
        ...this.buildSummaryMessages(conversation),
        ...conversation.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      ];
      try {
        assistantContent = await this.ollama.createChatCompletion(followupMessages);
      } catch (error) {
        this.logger.error(
          `Assistant chat failed (model=${this.config.ollamaModel})`,
          (error as Error)?.stack ?? String(error),
        );
        throw new BadGatewayException(this.describeOllamaError(error));
      }
      if (this.context.parseContextRequest(assistantContent)) {
        assistantContent =
          'Es fehlen noch Daten fuer eine Antwort. Bitte praezisiere deine Frage.';
      }
    }

    const assistantMessage = this.conversationStore.append(
      conversationId,
      {
        role: 'assistant',
        content: assistantContent,
        createdAt: Date.now(),
      },
      clientId,
    );

    const dtoMessages = assistantMessage.messages.map((message) => ({
      role: message.role,
      content: message.content,
      createdAt: new Date(message.createdAt).toISOString(),
    }));
    const last = dtoMessages[dtoMessages.length - 1];

    if (!last || last.role !== 'assistant') {
      throw new Error('Assistant response was not persisted correctly.');
    }

    return {
      conversationId,
      assistantMessage: last,
      messages: dtoMessages,
      ...(status.length ? { status } : {}),
    };
  }

  async help(request: AssistantHelpRequestDto): Promise<AssistantHelpResponseDto> {
    const resolved = this.docs.resolveDocumentation(request.uiContext);
    if (!resolved) {
      return { available: false };
    }
    return {
      available: true,
      title: resolved.title,
      sourcePath: resolved.sourcePath,
      ...(resolved.subtopic ? { subtopic: resolved.subtopic } : {}),
      markdown: resolved.markdown,
    };
  }

  private buildSummaryMessages(
    conversation: StoredConversationState,
  ): Array<{ role: 'system'; content: string }> {
    const summary = conversation.summary?.trim();
    if (!summary) {
      return [];
    }
    return [
      {
        role: 'system',
        content: `Zusammenfassung bisheriger Unterhaltung (gekürzt):\n${summary}`,
      },
    ];
  }

  private buildContextMessages(
    conversationId: string,
    conversation: StoredConversationState,
    uiContext: AssistantChatRequestDto['uiContext'],
    prefetch: AssistantContextResult | null,
    extra: AssistantContextResult | null,
  ): Array<{ role: 'system'; content: string }> {
    const maxContextChars = Math.max(0, this.config.maxContextChars);
    if (maxContextChars <= 0) {
      return [];
    }

    const messages: Array<{ role: 'system'; content: string }> = [];
    let remaining = maxContextChars;

    const uiMessages = this.buildUiContextMessages(uiContext);
    const uiBudget = Math.min(this.config.maxUiDataChars, remaining);
    const limitedUi = applyMessageBudget(uiMessages, uiBudget);
    if (limitedUi.length) {
      messages.push(...limitedUi);
      remaining -= this.countMessageChars(limitedUi);
    }

    if (remaining > 0 && prefetch) {
      const prefetchMessage = this.context.buildContextMessage(
        prefetch,
        Math.min(this.config.maxUiDataChars, remaining),
      );
      if (prefetchMessage) {
        messages.push(prefetchMessage);
        remaining -= prefetchMessage.content.length;
      }
    }

    if (remaining > 0 && extra) {
      const extraMessage = this.context.buildContextMessage(
        extra,
        Math.min(this.config.maxUiDataChars, remaining),
      );
      if (extraMessage) {
        messages.push(extraMessage);
        remaining -= extraMessage.content.length;
      }
    }

    if (remaining > 0) {
      const docMessages = this.buildDocMessages(
        conversationId,
        conversation,
        uiContext,
        Math.min(this.config.maxDocChars, remaining),
        { force: !!extra },
      );
      const limitedDocs = applyMessageBudget(docMessages, remaining);
      if (limitedDocs.length) {
        messages.push(...limitedDocs);
        remaining -= this.countMessageChars(limitedDocs);
      }
    }

    return messages;
  }

  private buildDocMessages(
    conversationId: string,
    conversation: StoredConversationState,
    uiContext: AssistantChatRequestDto['uiContext'],
    maxChars: number,
    options?: { force?: boolean },
  ): Array<{ role: 'system'; content: string }> {
    const mode = this.config.docInjectionMode;
    if (mode === 'never' || maxChars <= 0) {
      return [];
    }

    const resolved = this.docs.resolveDocumentation(uiContext);
    if (!resolved) {
      this.conversationStore.updateLastDocSignature(conversationId, null);
      return [];
    }

    const signature = `${resolved.sourcePath}#${resolved.subtopic ?? ''}`;
    if (!options?.force && mode === 'on-change' && conversation.lastDocSignature === signature) {
      return [];
    }

    const docBudget = Math.min(maxChars, this.config.maxDocChars);
    const docMessages = this.docs.buildDocumentationMessagesFromResolved(resolved, {
      maxChars: docBudget,
    });
    if (!docMessages.length) {
      return [];
    }
    this.conversationStore.updateLastDocSignature(conversationId, signature);
    return docMessages;
  }

  private async maybeUpdateSummary(
    conversationId: string,
    conversation: StoredConversationState,
  ): Promise<void> {
    if (!this.config.enableSummary) {
      return;
    }

    const batchSize = Math.max(1, this.config.summaryBatchMessages);
    if (conversation.summaryPending.length < batchSize) {
      return;
    }

    const batch = conversation.summaryPending.splice(0, batchSize);
    const summary = await this.summarize(conversation.summary, batch).catch((error) => {
      this.logger.warn(
        `Assistant summary update failed (conversationId=${conversationId})`,
        (error as Error)?.stack ?? String(error),
      );
      return null;
    });

    if (!summary) {
      return;
    }

    const limited =
      summary.length <= this.config.summaryMaxChars
        ? summary
        : `${summary.slice(0, Math.max(0, this.config.summaryMaxChars - 12)).trimEnd()}\n\n… (gekürzt)`;

    this.conversationStore.updateSummary(conversationId, limited);
  }

  private async summarize(
    existingSummary: string | null,
    messages: StoredAssistantChatMessage[],
  ): Promise<string> {
    const lines: string[] = [];
    const maxPerMessageChars = 1500;
    const maxInputChars = 12_000;
    let totalChars = 0;
    for (const message of messages) {
      if (message.role !== 'user' && message.role !== 'assistant') {
        continue;
      }
      const content = message.content?.trim() ?? '';
      if (!content) {
        continue;
      }
      const clipped =
        content.length <= maxPerMessageChars
          ? content
          : `${content.slice(0, maxPerMessageChars).trimEnd()}…`;
      const line = `${message.role === 'user' ? 'User' : 'Assistant'}: ${clipped}`;
      if (totalChars + line.length > maxInputChars) {
        lines.push('… (Eingabe gekürzt)');
        break;
      }
      lines.push(line);
      totalChars += line.length + 1;
    }

    const input = lines.join('\n');
    const previous = existingSummary?.trim();

    const prompt = [
      'Du fasst Chatverläufe für den CorePlanX Assistant zusammen.',
      'Ziel: einen kompakten Kontext für spätere Antworten zu erhalten.',
      'Regeln:',
      '- Schreibe auf Deutsch.',
      '- Nutze kurze Bullet Points (Markdown).',
      '- Behalte Domain-Fakten, Entscheidungen, Begriffe, IDs, offene Fragen.',
      '- Entferne Smalltalk und Wiederholungen.',
      `- Maximal ${Math.max(200, this.config.summaryMaxChars)} Zeichen.`,
    ].join('\n');

    const userContent = [
      previous ? `Bisherige Zusammenfassung:\n${previous}\n` : '',
      'Neue Nachrichten, die ergänzt werden sollen:\n',
      input,
    ]
      .filter((part) => part.length)
      .join('\n');

    return this.ollama.createChatCompletion([
      { role: 'system', content: prompt },
      { role: 'user', content: userContent },
    ]);
  }

  private describeOllamaError(error: unknown): string {
    if (error instanceof OllamaOpenAiTimeoutError) {
      return `Ollama hat zu lange nicht geantwortet (Timeout nach ${error.timeoutMs}ms). Prüfe OLLAMA_TIMEOUT_MS oder die Modelllast.`;
    }
    if (error instanceof OllamaOpenAiNetworkError) {
      return `Ollama ist nicht erreichbar (${this.config.ollamaBaseUrl}). Läuft Ollama und ist OLLAMA_BASE_URL korrekt?`;
    }
    if (error instanceof OllamaOpenAiHttpError) {
      const upstreamMessage = this.extractOllamaErrorMessage(error.body);
      if (error.status === 404 && upstreamMessage?.toLowerCase().includes('model')) {
        return `Ollama: Modell '${this.config.ollamaModel}' nicht gefunden. Installiere es z. B. mit: ollama pull ${this.config.ollamaModel}`;
      }
      if (error.status === 401 || error.status === 403) {
        return `Ollama: Zugriff verweigert (${error.status}). Prüfe OLLAMA_API_KEY und die Ollama-Konfiguration.`;
      }
      return `Ollama: Upstream-Fehler (${error.status} ${error.statusText})${upstreamMessage ? `: ${upstreamMessage}` : ''}`;
    }

    return 'LLM backend (Ollama) request failed.';
  }

  private extractOllamaErrorMessage(body: string): string | null {
    const text = body?.trim?.() ?? '';
    if (!text) {
      return null;
    }
    try {
      const parsed = JSON.parse(text) as { error?: { message?: unknown } };
      const message = parsed?.error?.message;
      return typeof message === 'string' && message.trim() ? message.trim() : null;
    } catch {
      return null;
    }
  }

  private buildUiContextMessages(
    uiContext: AssistantChatRequestDto['uiContext'],
  ): Array<{ role: 'system'; content: string }> {
    const content = buildUiContextMessage(uiContext, {
      maxDataChars: this.config.maxUiDataChars,
    });
    if (!content) {
      return [];
    }
    return [{ role: 'system', content }];
  }

  private countMessageChars(messages: Array<{ role: 'system'; content: string }>): number {
    return messages.reduce((total, message) => total + message.content.length, 0);
  }

  private sanitizeUiContext(
    uiContext: AssistantChatRequestDto['uiContext'],
  ): AssistantChatRequestDto['uiContext'] {
    if (!uiContext) {
      return uiContext;
    }
    const breadcrumbs = (uiContext.breadcrumbs ?? [])
      .map((entry) => this.sanitizeUiText(entry))
      .filter((entry) => entry.length > 0)
      .slice(0, 20);
    const route = this.sanitizeUiText(uiContext.route ?? '');
    const docKey = this.sanitizeUiText(uiContext.docKey ?? '');
    const docSubtopic = this.sanitizeUiText(uiContext.docSubtopic ?? '');
    const dataSummary = this.sanitizeUiText(uiContext.dataSummary ?? '');
    return {
      ...(breadcrumbs.length ? { breadcrumbs } : {}),
      ...(route ? { route } : {}),
      ...(docKey ? { docKey } : {}),
      ...(docSubtopic ? { docSubtopic } : {}),
      ...(dataSummary ? { dataSummary } : {}),
    };
  }

  private sanitizeUiText(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }
    const withoutEmails = trimmed.replace(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
      '[redacted-email]',
    );
    const withoutUuids = withoutEmails.replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      '[redacted-id]',
    );
    return withoutUuids.replace(/\b\d{6,}\b/g, '[redacted]');
  }
}
