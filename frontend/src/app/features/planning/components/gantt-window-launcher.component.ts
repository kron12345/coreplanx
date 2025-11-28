import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PlanningStageId } from '../planning-stage.model';
import { Router } from '@angular/router';

@Component({
  selector: 'app-gantt-window-launcher',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatTooltipModule],
  template: `
    <button
      mat-icon-button
      type="button"
      [disabled]="!stageId"
      (click)="openExternalBoard()"
      matTooltip="Plantafel in neuem Fenster öffnen"
    >
      <mat-icon fontIcon="open_in_new"></mat-icon>
    </button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GanttWindowLauncherComponent {
  private readonly router = inject(Router);

  @Input() stageId: PlanningStageId | null = null;
  @Input() boardId: string | null = null;
  @Input() resourceIds: string[] | null = null;

  openExternalBoard(): void {
    if (!this.stageId || typeof window === 'undefined') {
      return;
    }
    const urlTree = this.router.createUrlTree(['/planning/external'], {
      queryParams: {
        stage: this.stageId,
        board: this.boardId ?? undefined,
        resources: this.resourceIds && this.resourceIds.length > 0 ? this.resourceIds.join(',') : undefined,
      },
    });
    const url = this.router.serializeUrl(urlTree);
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
