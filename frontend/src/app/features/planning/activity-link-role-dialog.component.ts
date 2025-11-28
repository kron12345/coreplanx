import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';

export type ActivityLinkRole = 'teacher' | 'student';

export interface ActivityLinkRoleDialogData {
  sourceResourceName: string;
  targetResourceName: string;
}

export interface ActivityLinkRoleDialogResult {
  sourceRole: ActivityLinkRole;
  targetRole: ActivityLinkRole;
}

@Component({
  selector: 'app-activity-link-role-dialog',
  standalone: true,
  imports: [CommonModule, ...MATERIAL_IMPORTS],
  template: `
    <h2 mat-dialog-title>Funktionen der verknüpften Leistungen</h2>
    <mat-dialog-content>
      <p>
        Wie sollen die Rollen zwischen den beiden Leistungen verteilt werden?
      </p>
      <div class="activity-link-role-dialog__section">
        <div class="activity-link-role-dialog__label">
          Original:&nbsp;<strong>{{ data.sourceResourceName }}</strong>
        </div>
        <mat-button-toggle-group
          [value]="sourceRole"
          (valueChange)="sourceRole = $event"
          aria-label="Rolle des Originals wählen"
        >
          <mat-button-toggle value="teacher">Lehrer</mat-button-toggle>
          <mat-button-toggle value="student">Schüler</mat-button-toggle>
        </mat-button-toggle-group>
      </div>

      <div class="activity-link-role-dialog__section">
        <div class="activity-link-role-dialog__label">
          Kopie:&nbsp;<strong>{{ data.targetResourceName }}</strong>
        </div>
        <mat-button-toggle-group
          [value]="targetRole"
          (valueChange)="targetRole = $event"
          aria-label="Rolle der Kopie wählen"
        >
          <mat-button-toggle value="teacher">Lehrer</mat-button-toggle>
          <mat-button-toggle value="student">Schüler</mat-button-toggle>
        </mat-button-toggle-group>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="onCancel()">Abbrechen</button>
      <button mat-flat-button color="primary" type="button" (click)="onConfirm()">
        Verknüpfen
      </button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      .activity-link-role-dialog__section {
        margin-top: 12px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .activity-link-role-dialog__label {
        font-size: 0.85rem;
      }

      mat-button-toggle-group {
        width: 100%;
      }

      mat-button-toggle {
        flex: 1 1 0;
      }
    `,
  ],
})
export class ActivityLinkRoleDialogComponent {
  protected readonly data = inject<ActivityLinkRoleDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef =
    inject<MatDialogRef<ActivityLinkRoleDialogComponent, ActivityLinkRoleDialogResult | undefined>>(
      MatDialogRef,
    );

  protected sourceRole: ActivityLinkRole = 'teacher';
  protected targetRole: ActivityLinkRole = 'student';

  protected onCancel(): void {
    this.dialogRef.close(undefined);
  }

  protected onConfirm(): void {
    this.dialogRef.close({
      sourceRole: this.sourceRole,
      targetRole: this.targetRole,
    });
  }
}

