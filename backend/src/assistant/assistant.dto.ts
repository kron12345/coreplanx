import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import type { ResourceSnapshot } from '../planning/planning.types';

export class AssistantUiContextDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  route?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  docKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  docSubtopic?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  breadcrumbs?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  dataSummary?: string;
}

export class AssistantChatRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20_000)
  prompt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  clientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  conversationId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AssistantUiContextDto)
  uiContext?: AssistantUiContextDto;
}

export class AssistantHelpRequestDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => AssistantUiContextDto)
  uiContext?: AssistantUiContextDto;
}

export type AssistantChatRole = 'system' | 'user' | 'assistant';

export interface AssistantChatMessageDto {
  role: AssistantChatRole;
  content: string;
  createdAt: string;
}

export interface AssistantChatStatusDto {
  stage: string;
  message: string;
}

export interface AssistantChatResponseDto {
  conversationId: string;
  assistantMessage: AssistantChatMessageDto;
  messages: AssistantChatMessageDto[];
  status?: AssistantChatStatusDto[];
}

export interface AssistantHelpResponseDto {
  available: boolean;
  title?: string;
  sourcePath?: string;
  subtopic?: string;
  markdown?: string;
}

export class AssistantActionPreviewRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20_000)
  prompt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  clientId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AssistantUiContextDto)
  uiContext?: AssistantUiContextDto;
}

export interface AssistantActionChangeDto {
  kind: 'create' | 'update' | 'delete';
  entityType: string;
  id: string;
  label: string;
  details?: string;
}

export interface AssistantActionClarificationOptionDto {
  id: string;
  label: string;
  details?: string;
}

export interface AssistantActionClarificationInputDto {
  label?: string;
  placeholder?: string;
  hint?: string;
  minLength?: number;
  maxLength?: number;
}

export interface AssistantActionClarificationDto {
  resolutionId: string;
  title: string;
  options: AssistantActionClarificationOptionDto[];
  input?: AssistantActionClarificationInputDto;
}

export interface AssistantActionPreviewResponseDto {
  actionable: boolean;
  previewId?: string;
  summary?: string;
  changes?: AssistantActionChangeDto[];
  feedback?: string;
  clarification?: AssistantActionClarificationDto;
}

export class AssistantActionCommitRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  previewId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  clientId?: string;
}

export interface AssistantActionCommitResponseDto {
  applied: boolean;
  snapshot?: ResourceSnapshot;
  refresh?: string[];
}

export class AssistantActionResolveRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  resolutionId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  selectedId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  clientId?: string;
}

export type AssistantActionResolveResponseDto =
  AssistantActionPreviewResponseDto;
