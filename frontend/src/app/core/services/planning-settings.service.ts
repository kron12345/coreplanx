import { Injectable, signal } from '@angular/core';

const LLM_COMMAND_STORAGE_KEY = 'coreplanx:planning:llm-command:v1';

@Injectable({ providedIn: 'root' })
export class PlanningSettingsService {
  readonly llmCommand = signal(this.readLlmCommand());

  setLlmCommand(value: string): void {
    this.llmCommand.set(value);
    this.persistLlmCommand(value);
  }

  private readLlmCommand(): string {
    try {
      return localStorage.getItem(LLM_COMMAND_STORAGE_KEY) ?? '';
    } catch {
      return '';
    }
  }

  private persistLlmCommand(value: string): void {
    try {
      if (value.trim().length === 0) {
        localStorage.removeItem(LLM_COMMAND_STORAGE_KEY);
        return;
      }
      localStorage.setItem(LLM_COMMAND_STORAGE_KEY, value);
    } catch {
      // Ignore storage errors (e.g. privacy mode).
    }
  }
}
