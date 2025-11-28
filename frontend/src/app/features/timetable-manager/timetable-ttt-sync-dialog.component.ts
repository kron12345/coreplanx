import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  MAT_DIALOG_DATA,
  MatDialogRef,
} from '@angular/material/dialog';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import { Timetable } from '../../core/models/timetable.model';
import { TttSyncService, TttSyncPayload } from '../../core/services/ttt-sync.service';

interface TimetableTttSyncDialogData {
  timetable: Timetable;
}

interface TimetableTttSyncDialogResult {
  applied: boolean;
}

@Component({
  selector: 'app-timetable-ttt-sync-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './timetable-ttt-sync-dialog.component.html',
  styleUrl: './timetable-ttt-sync-dialog.component.scss',
})
export class TimetableTttSyncDialogComponent {
  private readonly dialogRef =
    inject<MatDialogRef<TimetableTttSyncDialogComponent, TimetableTttSyncDialogResult | undefined>>(
      MatDialogRef,
    );
  private readonly data = inject<TimetableTttSyncDialogData>(MAT_DIALOG_DATA);
  private readonly syncService = inject(TttSyncService);
  protected readonly exportJson = signal<string>('');
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly importControl = new FormControl<string | null>(null, Validators.required);

  constructor() {
    const payload = this.syncService.exportPayload(this.data.timetable);
    this.exportJson.set(JSON.stringify(payload, null, 2));
  }

  protected async copyToClipboard() {
    try {
      await navigator.clipboard.writeText(this.exportJson());
      this.errorMessage.set('Exportdaten in die Zwischenablage kopiert.');
    } catch {
      this.errorMessage.set('Kopieren fehlgeschlagen. Bitte manuell kopieren.');
    }
  }

  protected cancel(): void {
    this.dialogRef.close(undefined);
  }

  protected applyImport(): void {
    if (this.importControl.invalid || !this.importControl.value) {
      this.errorMessage.set('Bitte gültige Importdaten einfügen.');
      return;
    }
    try {
      const parsed = JSON.parse(this.importControl.value) as TttSyncPayload;
      this.syncService.applyPayload(this.data.timetable.refTrainId, parsed);
      this.dialogRef.close({ applied: true });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Importdaten konnten nicht verarbeitet werden.';
      this.errorMessage.set(message);
    }
  }
}
