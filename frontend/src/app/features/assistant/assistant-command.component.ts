import { CdkOverlayOrigin, OverlayModule, type ConnectedPosition } from '@angular/cdk/overlay';
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  signal,
  viewChild,
} from '@angular/core';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import { AssistantChatService } from '../../core/services/assistant-chat.service';
import { AssistantHelpService } from '../../core/services/assistant-help.service';
import { AssistantActionService } from '../../core/services/assistant-action.service';
import { MarkdownPipe } from '../../shared/pipes/markdown.pipe';

@Component({
  selector: 'app-assistant-command',
  standalone: true,
  imports: [CommonModule, OverlayModule, MarkdownPipe, ...MATERIAL_IMPORTS],
  templateUrl: './assistant-command.component.html',
  styleUrl: './assistant-command.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssistantCommandComponent {
  readonly chat: AssistantChatService;
  readonly help: AssistantHelpService;
  readonly actions: AssistantActionService;

  readonly draft = signal('');
  readonly panelOpen = signal(false);
  readonly panelMode = signal<'chat' | 'help'>('chat');
  readonly clarificationDraft = signal('');

  readonly messageContainer = viewChild<ElementRef<HTMLDivElement>>('messageContainer');

  readonly overlayPositions: ConnectedPosition[] = [
    {
      originX: 'end',
      originY: 'bottom',
      overlayX: 'end',
      overlayY: 'top',
      offsetY: 8,
    },
    {
      originX: 'start',
      originY: 'bottom',
      overlayX: 'start',
      overlayY: 'top',
      offsetY: 8,
    },
  ];

  constructor(chat: AssistantChatService, help: AssistantHelpService, actions: AssistantActionService) {
    this.chat = chat;
    this.help = help;
    this.actions = actions;

    effect(() => {
      const isOpen = this.panelOpen();
      const mode = this.panelMode();
      const container = this.messageContainer();
      if (mode === 'chat') {
        this.chat.messages();
        this.chat.isLoading();
        this.actions.preview();
        this.actions.isLoading();
        this.actions.isCommitting();
        this.actions.isResolving();
        const clarificationId = this.actions.preview()?.clarification?.resolutionId ?? null;
        if (clarificationId !== this.lastClarificationId) {
          this.lastClarificationId = clarificationId;
          this.clarificationDraft.set('');
        }
      } else {
        this.help.response();
        this.help.isLoading();
      }
      if (!isOpen || !container || mode !== 'chat') {
        return;
      }
      queueMicrotask(() => this.scrollToBottom());
    });
  }

  openPanel(): void {
    this.panelOpen.set(true);
  }

  openChatPanel(): void {
    this.panelMode.set('chat');
    this.openPanel();
  }

  async openHelpPanel(): Promise<void> {
    this.panelMode.set('help');
    this.openPanel();
    await this.help.load();
  }

  closePanel(): void {
    this.panelOpen.set(false);
  }

  handleOverlayOutsideClick(event: MouseEvent, origin: CdkOverlayOrigin): void {
    const target = event.target as Node | null;
    if (target && origin.elementRef.nativeElement.contains(target)) {
      return;
    }
    this.closePanel();
  }

  async send(): Promise<void> {
    const prompt = this.draft();
    if (
      !prompt.trim() ||
      this.chat.isLoading() ||
      this.actions.isLoading() ||
      this.actions.isCommitting() ||
      this.actions.isResolving()
    ) {
      return;
    }
    this.panelMode.set('chat');
    this.openPanel();
    this.draft.set('');
    this.actions.clearPreview();
    if (this.actions.shouldAttemptAction(prompt)) {
      const actionResult = await this.actions.requestPreview(prompt);
      if (actionResult === 'actionable' || actionResult === 'feedback') {
        this.scrollToBottom();
        return;
      }
      if (actionResult === 'error') {
        return;
      }
    }
    await this.chat.sendPrompt(prompt);
    this.scrollToBottom();
  }

  async handleKeydown(event: KeyboardEvent): Promise<void> {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    await this.send();
  }

  resetConversation(): void {
    this.chat.resetConversation();
    this.actions.clearPreview();
    this.panelMode.set('chat');
    this.openPanel();
  }

  async switchMode(mode: unknown): Promise<void> {
    if (mode !== 'chat' && mode !== 'help') {
      return;
    }
    this.panelMode.set(mode);
    if (mode === 'help') {
      await this.help.load();
    }
  }

  roleLabel(role: string): string {
    switch (role) {
      case 'user':
        return 'Du';
      case 'assistant':
        return 'Assistant';
      default:
        return role;
    }
  }

  chatError(): string | null {
    return this.actions.error() ?? this.chat.error();
  }

  updateClarificationDraft(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.clarificationDraft.set(target?.value ?? '');
  }

  async resolveClarificationInput(): Promise<void> {
    const clarification = this.actions.preview()?.clarification;
    const value = this.clarificationDraft().trim();
    if (!clarification?.resolutionId || !value) {
      return;
    }
    await this.actions.resolveClarification(clarification.resolutionId, value);
    this.clarificationDraft.set('');
    this.scrollToBottom();
  }

  private scrollToBottom(): void {
    const container = this.messageContainer()?.nativeElement;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }

  private lastClarificationId: string | null = null;
}
