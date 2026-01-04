import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import { PlanningSettingsService } from '../../core/services/planning-settings.service';

@Component({
  selector: 'app-planning-settings',
  imports: [CommonModule, ReactiveFormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './planning-settings.component.html',
  styleUrl: './planning-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanningSettingsComponent {
  private readonly settings = inject(PlanningSettingsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly llmCommandControl = new FormControl('', { nonNullable: true });

  constructor() {
    this.llmCommandControl.setValue(this.settings.llmCommand());

    this.llmCommandControl.valueChanges
      .pipe(debounceTime(250), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.settings.setLlmCommand(value ?? '');
      });

    effect(() => {
      const value = this.settings.llmCommand();
      if (value !== this.llmCommandControl.value) {
        this.llmCommandControl.setValue(value, { emitEvent: false });
      }
    });
  }

}
