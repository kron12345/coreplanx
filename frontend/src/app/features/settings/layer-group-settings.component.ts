import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { LayerGroup, LayerGroupService } from '../../core/services/layer-group.service';

@Component({
  selector: 'app-layer-group-settings',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    ReactiveFormsModule,
  ],
  templateUrl: './layer-group-settings.component.html',
  styleUrl: './layer-group-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LayerGroupSettingsComponent {
  private readonly service = inject(LayerGroupService);
  private readonly fb = inject(FormBuilder);

  protected readonly groups = this.service.groups;
  protected readonly selectedId = signal<string | null>(null);

  protected readonly form = this.fb.group({
    id: ['', [Validators.required, Validators.maxLength(80)]],
    label: ['', [Validators.required, Validators.maxLength(80)]],
    order: [50, [Validators.required]],
    description: [''],
  });

  protected select(group: LayerGroup): void {
    this.selectedId.set(group.id);
    this.form.reset({
      id: group.id,
      label: group.label,
      order: group.order,
      description: group.description ?? '',
    });
  }

  protected newGroup(): void {
    this.selectedId.set(null);
    this.form.reset({
      id: '',
      label: '',
      order: 50,
      description: '',
    });
  }

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    const payload: LayerGroup = {
      id: (raw.id ?? '').trim(),
      label: (raw.label ?? '').trim(),
      order: Number(raw.order) || 0,
      description: raw.description?.trim() || undefined,
    };
    if (this.selectedId()) {
      this.service.update(this.selectedId()!, payload);
    } else {
      this.service.add(payload);
    }
    this.select(payload);
  }

  protected remove(group: LayerGroup): void {
    this.service.remove(group.id);
    if (this.selectedId() === group.id) {
      this.newGroup();
    }
  }

  protected move(group: LayerGroup, dir: 'up' | 'down'): void {
    this.service.move(group.id, dir);
  }
}
