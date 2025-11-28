import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { Resource } from '../models/resource';

@Component({
  selector: 'app-gantt-resources',
  standalone: true,
  imports: [CommonModule, MatMenuModule, MatIconModule, MatDividerModule],
  templateUrl: './gantt-resources.component.html',
  styleUrl: './gantt-resources.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GanttResourcesComponent {
  @Input({ required: true }) resource!: Resource;
  @Input() viewMode: 'block' | 'detail' = 'detail';
  @Input() viewModeToggleEnabled = false;
  @Input() canAssignService = false;
  @Output() remove = new EventEmitter<void>();
  @Output() viewModeChange = new EventEmitter<'block' | 'detail'>();
  @Output() assignService = new EventEmitter<void>();

  protected onRemoveClick(): void {
    this.remove.emit();
  }

  protected onViewModeClick(mode: 'block' | 'detail'): void {
    if (!this.viewModeToggleEnabled) {
      return;
    }
    this.viewModeChange.emit(mode);
  }

  protected onAssignServiceClick(): void {
    if (this.canAssignService) {
      this.assignService.emit();
    }
  }

  protected resourceIcon(): string {
    const attributes = this.resource.attributes as Record<string, unknown> | undefined;
    const category = (attributes?.['category'] ?? null) as string | null;
    switch (category) {
      case 'vehicle-service':
        return 'route';
      case 'personnel-service':
        return 'badge';
      case 'vehicle':
        return 'directions_transit';
      case 'personnel':
        return 'groups';
      default:
        return 'inventory_2';
    }
  }
}
