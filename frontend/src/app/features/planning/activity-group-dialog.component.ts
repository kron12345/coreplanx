import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import { ActivityGroupRole } from '../../models/activity';

export interface ActivityGroupDialogData {
  title: string;
  initialLabel?: string | null;
  initialRole?: ActivityGroupRole | null;
  initialAttachedToActivityId?: string | null;
  focusActivity?: { id: string; label: string } | null;
}

export interface ActivityGroupDialogResult {
  label: string;
  role: ActivityGroupRole;
  attachedToActivityId?: string | null;
}

@Component({
  selector: 'app-activity-group-dialog',
  imports: [CommonModule, ...MATERIAL_IMPORTS],
  templateUrl: './activity-group-dialog.component.html',
  styleUrl: './activity-group-dialog.component.scss',
})
export class ActivityGroupDialogComponent {
  protected readonly data = inject<ActivityGroupDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<ActivityGroupDialogComponent, ActivityGroupDialogResult | undefined>>(
    MatDialogRef,
  );

  protected label = (this.data.initialLabel ?? '').toString();
  protected role: ActivityGroupRole = this.data.initialRole ?? 'independent';
  protected attachedToActivityId: string | null = this.data.initialAttachedToActivityId ?? null;

  protected onCancel(): void {
    this.dialogRef.close(undefined);
  }

  protected onConfirm(): void {
    const trimmedLabel = this.label.trim() || 'Gruppe';
    const result: ActivityGroupDialogResult = {
      label: trimmedLabel,
      role: this.role,
      attachedToActivityId: this.isAttachableRole(this.role) ? this.attachedToActivityId : null,
    };
    this.dialogRef.close(result);
  }

  protected onRoleChange(role: ActivityGroupRole): void {
    this.role = role;
    if (!this.isAttachableRole(role)) {
      this.attachedToActivityId = null;
    }
  }

  protected attachOptions(): Array<{ id: string | null; label: string }> {
    const options: Array<{ id: string | null; label: string }> = [{ id: null, label: 'Keine Hauptaktivität' }];
    const focus = this.data.focusActivity;
    if (focus?.id) {
      options.push({ id: focus.id, label: `Fokus: ${focus.label}` });
    }
    const initial = (this.data.initialAttachedToActivityId ?? '').toString().trim();
    if (initial && (!focus?.id || focus.id !== initial)) {
      options.push({ id: initial, label: `Aktuell: ${initial}` });
    }
    return options;
  }

  protected isAttachableRole(role: ActivityGroupRole | null | undefined): boolean {
    return role === 'pre' || role === 'post';
  }
}

