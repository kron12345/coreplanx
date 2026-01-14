import { Inject, Injectable } from '@nestjs/common';
import { ASSISTANT_CONFIG } from './assistant.constants';
import type { AssistantConfig } from './assistant.config';
import type { AssistantChatRole } from './assistant.dto';

export class OllamaOpenAiHttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly body: string;

  constructor(status: number, statusText: string, body: string) {
    super(
      `Ollama request failed (${status} ${statusText})${body ? `: ${body}` : ''}`,
    );
    this.name = 'OllamaOpenAiHttpError';
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

export class OllamaOpenAiTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Ollama request timed out after ${timeoutMs}ms`);
    this.name = 'OllamaOpenAiTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export class OllamaOpenAiNetworkError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = 'OllamaOpenAiNetworkError';
    this.cause = cause;
  }
}

interface OpenAiChatMessage {
  role: AssistantChatRole;
  content: string;
}

interface OpenAiResponseFormat {
  type: 'json_object';
}

interface OpenAiChatCompletionRequest {
  model: string;
  messages: OpenAiChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  response_format?: OpenAiResponseFormat;
}

interface OpenAiChatCompletionResponse {
  choices?: Array<{
    message?: {
      role?: AssistantChatRole;
      content?: string;
    };
  }>;
}

@Injectable()
export class OllamaOpenAiClient {
  constructor(
    @Inject(ASSISTANT_CONFIG) private readonly config: AssistantConfig,
  ) {}

  async createChatCompletion(
    messages: OpenAiChatMessage[],
    options?: {
      responseFormat?: OpenAiResponseFormat;
      allowResponseFormatFallback?: boolean;
    },
  ): Promise<string> {
    const payload = this.buildPayload(messages, options?.responseFormat);
    try {
      return await this.executeChatCompletion(payload);
    } catch (error) {
      if (
        options?.allowResponseFormatFallback &&
        options.responseFormat &&
        this.shouldRetryWithoutResponseFormat(error)
      ) {
        return this.executeChatCompletion(this.buildPayload(messages));
      }
      throw error;
    }
  }

  private buildPayload(
    messages: OpenAiChatMessage[],
    responseFormat?: OpenAiResponseFormat,
  ): OpenAiChatCompletionRequest {
    const payload: OpenAiChatCompletionRequest = {
      model: this.config.ollamaModel,
      messages,
      ...(this.config.ollamaTemperature !== null
        ? { temperature: this.config.ollamaTemperature }
        : {}),
      ...(this.config.ollamaTopP !== null
        ? { top_p: this.config.ollamaTopP }
        : {}),
      ...(this.config.ollamaMaxTokens !== null
        ? { max_tokens: this.config.ollamaMaxTokens }
        : {}),
      stream: false,
      ...(responseFormat ? { response_format: responseFormat } : {}),
    };
    return payload;
  }

  private async executeChatCompletion(
    payload: OpenAiChatCompletionRequest,
  ): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.ollamaTimeoutMs,
    );
    try {
      let response: Response;
      try {
        response = await fetch(
          `${this.config.ollamaBaseUrl}/v1/chat/completions`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(this.config.ollamaApiKey
                ? { authorization: `Bearer ${this.config.ollamaApiKey}` }
                : {}),
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
          },
        );
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') {
          throw new OllamaOpenAiTimeoutError(this.config.ollamaTimeoutMs);
        }
        throw new OllamaOpenAiNetworkError(
          'Ollama request failed (network error).',
          error,
        );
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new OllamaOpenAiHttpError(
          response.status,
          response.statusText,
          text,
        );
      }

      const data = (await response.json()) as OpenAiChatCompletionResponse;
      const content = data.choices?.[0]?.message?.content;
      if (!content || typeof content !== 'string') {
        throw new Error(
          'Ollama response did not contain a chat completion message.',
        );
      }
      return content;
    } finally {
      clearTimeout(timeout);
    }
  }

  private shouldRetryWithoutResponseFormat(error: unknown): boolean {
    if (!(error instanceof OllamaOpenAiHttpError)) {
      return false;
    }
    if (error.status < 400 || error.status >= 500) {
      return false;
    }
    const body = error.body?.toLowerCase() ?? '';
    return (
      body.includes('response_format') ||
      body.includes('json_object') ||
      body.includes('response format')
    );
  }
}
