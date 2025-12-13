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
    imports: [
        CommonModule,
        ReactiveFormsModule,
        MatDialogModule,
        MatIconModule,
        MatListModule,
        MatButtonModule,
        MatInputModule,
    ],
    templateUrl: './business-command-palette-dialog.component.html',
    styleUrl: './business-command-palette-dialog.component.scss',
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
