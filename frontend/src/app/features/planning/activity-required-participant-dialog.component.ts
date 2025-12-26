import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';

export type RequiredParticipantKind = 'vehicle' | 'vehicle-service' | 'personnel' | 'personnel-service';

export interface ActivityRequiredParticipantDialogData {
  title: string;
  message?: string | null;
  requiredLabel: string;
  candidates: Array<{ id: string; name: string }>;
  initialSelectionId?: string | null;
}

export interface ActivityRequiredParticipantDialogResult {
  resourceId: string;
}

@Component({
  selector: 'app-activity-required-participant-dialog',
  imports: [CommonModule, ...MATERIAL_IMPORTS],
  templateUrl: './activity-required-participant-dialog.component.html',
  styleUrl: './activity-required-participant-dialog.component.scss',
})
export class ActivityRequiredParticipantDialogComponent {
  protected readonly data = inject<ActivityRequiredParticipantDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<
    MatDialogRef<ActivityRequiredParticipantDialogComponent, ActivityRequiredParticipantDialogResult | undefined>
  >(MatDialogRef);

  protected selectedId: string | null = this.data.initialSelectionId ?? this.data.candidates?.[0]?.id ?? null;

  protected onCancel(): void {
    this.dialogRef.close(undefined);
  }

  protected onConfirm(): void {
    const id = (this.selectedId ?? '').toString().trim();
    if (!id) {
      return;
    }
    this.dialogRef.close({ resourceId: id });
  }
}

