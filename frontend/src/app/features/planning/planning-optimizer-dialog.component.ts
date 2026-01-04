import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import type { Activity } from '../../models/activity';
import type {
  PlanningCandidateBuildResponseDto,
  PlanningCandidateDto,
  PlanningCandidateBuildStatsDto,
  PlanningSolverResponseDto,
} from '../../core/api/planning-optimizer-api.types';

export type PlanningOptimizerDialogMode = 'candidates' | 'solver';

export interface PlanningOptimizerDialogData {
  title: string;
  mode: PlanningOptimizerDialogMode;
  payload: PlanningCandidateBuildResponseDto | PlanningSolverResponseDto;
  allowApply?: boolean;
}

type CandidatePreview = {
  id: string;
  label: string;
  detail: string;
};

@Component({
  selector: 'app-planning-optimizer-dialog',
  imports: [CommonModule, ...MATERIAL_IMPORTS],
  templateUrl: './planning-optimizer-dialog.component.html',
  styleUrl: './planning-optimizer-dialog.component.scss',
})
export class PlanningOptimizerDialogComponent {
  protected readonly data = inject<PlanningOptimizerDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<PlanningOptimizerDialogComponent, boolean>);

  protected get rulesetLabel(): string {
    const payload = this.data.payload as { rulesetId?: string | null; rulesetVersion?: string | null };
    const id = payload.rulesetId ?? '—';
    const version = payload.rulesetVersion ?? '—';
    return `${id}/${version}`;
  }

  protected get summary(): string | null {
    if (this.data.mode !== 'solver') {
      return null;
    }
    return (this.data.payload as PlanningSolverResponseDto).summary;
  }

  protected get stats(): PlanningCandidateBuildStatsDto | null {
    if (this.data.mode === 'candidates') {
      return (this.data.payload as PlanningCandidateBuildResponseDto).stats;
    }
    if (this.data.mode === 'solver') {
      return (this.data.payload as PlanningSolverResponseDto).stats;
    }
    return null;
  }

  protected get upserts(): Activity[] {
    if (this.data.mode === 'solver') {
      return (this.data.payload as PlanningSolverResponseDto).upserts ?? [];
    }
    return [];
  }

  protected get deletedIds(): string[] {
    if (this.data.mode === 'solver') {
      return (this.data.payload as PlanningSolverResponseDto).deletedIds ?? [];
    }
    return [];
  }

  protected get candidatePreviews(): CandidatePreview[] {
    const candidates = this.candidates();
    return candidates.slice(0, 12).map((candidate) => {
      const typeLabel = candidate.type.toUpperCase();
      const serviceId = this.readString(candidate.params, 'serviceId');
      const gap = this.readNumber(candidate.params, 'gapMinutes', null);
      const detailParts = [serviceId ? `Service ${serviceId}` : null, gap !== null ? `${gap} min` : null]
        .filter((entry) => !!entry)
        .join(' · ');
      return {
        id: candidate.id,
        label: `${typeLabel} · ${candidate.templateId}`,
        detail: detailParts || '—',
      };
    });
  }

  protected get canApply(): boolean {
    if (!this.data.allowApply) {
      return false;
    }
    return this.upserts.length > 0 || this.deletedIds.length > 0;
  }

  protected close(): void {
    this.dialogRef.close(false);
  }

  protected apply(): void {
    this.dialogRef.close(true);
  }

  private candidates(): PlanningCandidateDto[] {
    if (this.data.mode === 'candidates') {
      return (this.data.payload as PlanningCandidateBuildResponseDto).candidates ?? [];
    }
    if (this.data.mode === 'solver') {
      return (this.data.payload as PlanningSolverResponseDto).candidatesUsed ?? [];
    }
    return [];
  }

  private readString(params: Record<string, unknown>, key: string): string {
    const raw = params[key];
    if (typeof raw === 'string') {
      return raw.trim();
    }
    return '';
  }

  private readNumber(params: Record<string, unknown>, key: string, fallback: number | null): number | null {
    const raw = params[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return raw;
    }
    if (typeof raw === 'string') {
      const parsed = Number.parseFloat(raw);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return fallback;
  }
}
