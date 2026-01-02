import type { ResourceSnapshotDto } from '../api/planning-resource-api.service';

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

export interface AssistantUiContextDto {
  route?: string;
  docKey?: string;
  docSubtopic?: string;
  breadcrumbs?: string[];
  dataSummary?: string;
}

export interface AssistantChatRequestDto {
  prompt: string;
  clientId?: string;
  conversationId?: string;
  uiContext?: AssistantUiContextDto;
}

export interface AssistantChatResponseDto {
  conversationId: string;
  assistantMessage: AssistantChatMessageDto;
  messages: AssistantChatMessageDto[];
  status?: AssistantChatStatusDto[];
}

export interface AssistantHelpRequestDto {
  uiContext?: AssistantUiContextDto;
}

export interface AssistantHelpResponseDto {
  available: boolean;
  title?: string;
  sourcePath?: string;
  subtopic?: string;
  markdown?: string;
}

export interface AssistantActionPreviewRequestDto {
  prompt: string;
  clientId?: string;
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

export interface AssistantActionCommitRequestDto {
  previewId: string;
  clientId?: string;
}

export interface AssistantActionCommitResponseDto {
  applied: boolean;
  snapshot?: ResourceSnapshotDto;
  refresh?: string[];
}

export interface AssistantActionResolveRequestDto {
  resolutionId: string;
  selectedId: string;
  clientId?: string;
}

export type AssistantActionResolveResponseDto = AssistantActionPreviewResponseDto;
