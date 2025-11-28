import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';

export interface BusinessCommandDefinition {
  id: string;
  label: string;
  icon?: string;
  hint?: string;
}

export interface BusinessCommandPaletteData {
  commands: BusinessCommandDefinition[];
}

@Component({
  selector: 'app-business-command-palette-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatIconModule,
    MatListModule,
    MatButtonModule,
    MatInputModule,
  ],
  template: `
    <h2 mat-dialog-title>Befehlspalette</h2>
    <div mat-dialog-content class="command-palette">
      <mat-form-field appearance="outline" class="command-search">
        <mat-label>Suchen</mat-label>
        <mat-icon matPrefix>search</mat-icon>
        <input
          matInput
          [formControl]="queryControl"
          placeholder="Aktion oder Filter"
          autofocus
        />
      </mat-form-field>

      <mat-nav-list>
        @for (command of filteredCommands(); track command.id) {
          <a mat-list-item (click)="select(command.id)">
            <mat-icon matListIcon>{{ command.icon || 'bolt' }}</mat-icon>
            <div matLine>{{ command.label }}</div>
            @if (command.hint) {
              <div matLine class="command-hint">{{ command.hint }}</div>
            }
          </a>
        }
      </mat-nav-list>

      @if (!filteredCommands().length) {
        <p class="command-empty">
          Keine Befehle gefunden.
        </p>
      }
    </div>
    <div mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Schließen</button>
    </div>
  `,
  styles: [
    `
      .command-palette {
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-width: min(520px, 90vw);
      }

      .command-search {
        margin-bottom: 4px;
      }

      .command-hint {
        font-size: 0.78rem;
        color: rgba(15, 23, 42, 0.6);
      }

      .command-empty {
        margin: 12px 0 0 0;
        font-size: 0.9rem;
        color: rgba(15, 23, 42, 0.7);
        text-align: center;
      }
    `,
  ],
})
export class BusinessCommandPaletteDialogComponent {
  private readonly dialogRef =
    inject<MatDialogRef<BusinessCommandPaletteDialogComponent>>(MatDialogRef);
  private readonly data = inject<BusinessCommandPaletteData>(MAT_DIALOG_DATA);

  readonly queryControl = new FormControl('', { nonNullable: true });
  readonly filteredCommands = computed(() => {
    const query = this.queryControl.value.toLowerCase().trim();
    if (!query) {
      return this.data.commands;
    }
    return this.data.commands.filter((command) =>
      command.label.toLowerCase().includes(query),
    );
  });

  select(commandId: string): void {
    this.dialogRef.close(commandId);
  }
}
