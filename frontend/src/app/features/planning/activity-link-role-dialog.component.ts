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
    imports: [CommonModule, ...MATERIAL_IMPORTS],
    templateUrl: './activity-link-role-dialog.component.html',
    styleUrl: './activity-link-role-dialog.component.scss',
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
