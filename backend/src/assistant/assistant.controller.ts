import { Body, Controller, Headers, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AssistantService } from './assistant.service';
import { AssistantActionService } from './assistant-action.service';
import { AssistantRateLimiter } from './assistant-rate-limiter.service';
import {
  AssistantChatRequestDto,
  AssistantActionCommitRequestDto,
  AssistantActionPreviewRequestDto,
  AssistantActionResolveRequestDto,
  AssistantHelpRequestDto,
} from './assistant.dto';
import type {
  AssistantActionCommitResponseDto,
  AssistantActionPreviewResponseDto,
  AssistantActionResolveResponseDto,
  AssistantChatResponseDto,
  AssistantHelpResponseDto,
} from './assistant.dto';

@Controller('assistant')
export class AssistantController {
  constructor(
    private readonly assistantService: AssistantService,
    private readonly actionService: AssistantActionService,
    private readonly rateLimiter: AssistantRateLimiter,
  ) {}

  @Post('chat')
  chat(
    @Body() request: AssistantChatRequestDto,
    @Req() req: FastifyRequest,
  ): Promise<AssistantChatResponseDto> {
    this.rateLimiter.assertAllowed('chat', req, request.clientId ?? null);
    return this.assistantService.chat(request);
  }

  @Post('help')
  help(
    @Body() request: AssistantHelpRequestDto,
    @Req() req: FastifyRequest,
  ): Promise<AssistantHelpResponseDto> {
    this.rateLimiter.assertAllowed('help', req, null);
    return this.assistantService.help(request);
  }

  @Post('actions/preview')
  previewAction(
    @Body() request: AssistantActionPreviewRequestDto,
    @Req() req: FastifyRequest,
    @Headers('x-assistant-role') role?: string,
  ): Promise<AssistantActionPreviewResponseDto> {
    this.rateLimiter.assertAllowed('action', req, request.clientId ?? null);
    return this.actionService.preview(request, role);
  }

  @Post('actions/commit')
  commitAction(
    @Body() request: AssistantActionCommitRequestDto,
    @Req() req: FastifyRequest,
    @Headers('x-assistant-role') role?: string,
  ): Promise<AssistantActionCommitResponseDto> {
    this.rateLimiter.assertAllowed('action', req, request.clientId ?? null);
    return this.actionService.commit(request, role);
  }

  @Post('actions/resolve')
  resolveAction(
    @Body() request: AssistantActionResolveRequestDto,
    @Req() req: FastifyRequest,
    @Headers('x-assistant-role') role?: string,
  ): Promise<AssistantActionResolveResponseDto> {
    this.rateLimiter.assertAllowed('action', req, request.clientId ?? null);
    return this.actionService.resolve(request, role);
  }
}
