import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, Input, computed, effect, inject, signal } from '@angular/core';
import {
  FormControl,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import {
  ScheduleTemplateService,
  ScheduleTemplateSort,
  ScheduleTemplateSortField,
} from '../../core/services/schedule-template.service';
import {
  ScheduleTemplate,
  ScheduleTemplateCategory,
  ScheduleTemplateDay,
  ScheduleTemplateStatus,
} from '../../core/models/schedule-template.model';
import { OrderService } from '../../core/services/order.service';
import { MatDialog } from '@angular/material/dialog';
import {
  ScheduleTemplateCreateDialogComponent,
  ScheduleTemplateCreateDialogData,
  ScheduleTemplateDialogResult,
} from './schedule-template-create-dialog.component';
import { MatSelect, MatSelectChange } from '@angular/material/select';

interface SortOption {
  value: string;
  label: string;
}

@Component({
  selector: 'app-schedule-template-list',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './schedule-template-list.component.html',
  styleUrl: './schedule-template-list.component.scss',
})
export class ScheduleTemplateListComponent {
  private readonly templateService = inject(ScheduleTemplateService);
  private readonly orderService = inject(OrderService);
  private readonly dialog = inject(MatDialog);
  private readonly document = inject(DOCUMENT);
  private readonly highlightTemplateId = signal<string | null>(null);

  readonly searchControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(80)],
  });

  readonly filters = computed(() => this.templateService.filters());
  readonly sort = computed(() => this.templateService.sort());
  readonly templates = computed(() =>
    this.templateService.filteredTemplates(),
  );
  readonly tags = computed(() => this.templateService.tags());
  readonly orderItemOptions = computed(() =>
    this.orderService.orderItemOptions(),
  );
  readonly orderItems = computed(() => this.orderService.orderItems());

  readonly statusBadges: Record<ScheduleTemplateStatus, string> = {
    active: 'Aktiv',
    draft: 'Entwurf',
    archived: 'Archiviert',
  };

  readonly statusIcon: Record<ScheduleTemplateStatus, string> = {
    active: 'bolt',
    draft: 'edit_note',
    archived: 'archive',
  };

  readonly categoryOptions: { value: ScheduleTemplateCategory | 'all'; label: string }[] =
    [
      { value: 'all', label: 'Alle Kategorien' },
      { value: 'S-Bahn', label: 'S-Bahn' },
      { value: 'RegionalExpress', label: 'RegionalExpress' },
      { value: 'Fernverkehr', label: 'Fernverkehr' },
      { value: 'Güterverkehr', label: 'Güterverkehr' },
      { value: 'Sonderverkehr', label: 'Sonderverkehr' },
    ];

  readonly statusOptions: { value: ScheduleTemplateStatus | 'all'; label: string }[] =
    [
      { value: 'all', label: 'Alle Status' },
      { value: 'active', label: 'Aktiv' },
      { value: 'draft', label: 'Entwurf' },
      { value: 'archived', label: 'Archiviert' },
    ];

  readonly dayOptions: { value: ScheduleTemplateDay | 'all'; label: string }[] = [
    { value: 'all', label: 'Alle Tage' },
    { value: 'Mo', label: 'Mo' },
    { value: 'Di', label: 'Di' },
    { value: 'Mi', label: 'Mi' },
    { value: 'Do', label: 'Do' },
    { value: 'Fr', label: 'Fr' },
    { value: 'Sa', label: 'Sa' },
    { value: 'So', label: 'So' },
  ];

  readonly sortOptions: SortOption[] = [
    { value: 'updatedAt:desc', label: 'Zuletzt bearbeitet' },
    { value: 'title:asc', label: 'Titel A–Z' },
    { value: 'trainNumber:asc', label: 'Zugnummer' },
    { value: 'status:asc', label: 'Status' },
  ];

  @Input()
  set highlightId(value: string | null) {
    this.highlightTemplateId.set(value);
    window.setTimeout(() => this.scrollToHighlightedTemplate(), 0);
  }
  @Input() showHeader = true;

  constructor() {
    this.searchControl.setValue(this.filters().search, { emitEvent: false });
    this.searchControl.valueChanges
      .pipe(debounceTime(200), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((value) => {
        this.templateService.setFilters({ search: value });
      });

    effect(() => {
      const value = this.filters().search;
      if (this.searchControl.value !== value) {
        this.searchControl.setValue(value, { emitEvent: false });
      }
    });

    effect(() => {
      this.templates();
      window.setTimeout(() => this.scrollToHighlightedTemplate(), 0);
    });
  }

  openCreateDialog() {
    this.openTemplateDialog();
  }

  openEditDialog(template: ScheduleTemplate) {
    this.openTemplateDialog(template);
  }

  private openTemplateDialog(template?: ScheduleTemplate) {
    const dialogRef = this.dialog.open<
      ScheduleTemplateCreateDialogComponent,
      ScheduleTemplateCreateDialogData,
      ScheduleTemplateDialogResult | undefined
    >(ScheduleTemplateCreateDialogComponent, {
      width: '95vw',
      maxWidth: '1200px',
      maxHeight: '95vh',
      data: template ? { template } : undefined,
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (!result) {
        return;
      }
      if (result.mode === 'edit') {
        this.templateService.updateTemplateFromPayload(result.templateId, result.payload);
      } else {
        this.templateService.createTemplate(result.payload);
      }
    });
  }

  onStatusFilterChange(value: ScheduleTemplateStatus | 'all') {
    this.templateService.setFilters({ status: value });
  }

  onCategoryFilterChange(value: ScheduleTemplateCategory | 'all') {
    this.templateService.setFilters({ category: value });
  }

  onDayFilterChange(value: ScheduleTemplateDay | 'all') {
    this.templateService.setFilters({ day: value });
  }

  onTagFilterChange(value: string | 'all') {
    this.templateService.setFilters({ tag: value });
  }

  onSortChange(value: string) {
    const [field, direction] = value.split(':') as [
      ScheduleTemplateSortField,
      'asc' | 'desc',
    ];
    this.templateService.setSort({ field, direction });
  }

  stops(template: ScheduleTemplate) {
    return this.templateService.stopsWithTimeline(template);
  }

  itemLabel(itemId: string): string {
    const option = this.orderItemOptions().find(
      (item) => item.itemId === itemId,
    );
    if (!option) {
      return itemId;
    }
    return `${option.orderName} · ${option.itemName}`;
  }

  linkedOrderItems(templateId: string) {
    return this.orderItems().filter(
      (entry) => entry.item.linkedTemplateId === templateId,
    );
  }

  stopName(template: ScheduleTemplate, index: number): string {
    const stop = template.stops.find((entry) => entry.sequence === index);
    return stop ? stop.locationName : `Halt #${index}`;
  }

  setStatus(templateId: string, status: ScheduleTemplateStatus) {
    this.templateService.updateTemplate(templateId, { status });
  }

  linkTemplate(templateId: string, itemId: string) {
    this.orderService.linkTemplateToItem(templateId, itemId);
  }

  unlinkTemplate(templateId: string, itemId: string) {
    this.orderService.unlinkTemplateFromItem(templateId, itemId);
  }

  onLinkSelection(
    templateId: string,
    select: MatSelect,
    event: MatSelectChange,
  ) {
    if (!event.value) {
      return;
    }
    this.linkTemplate(templateId, event.value);
    select.writeValue(null);
    select.close();
  }

  sortSelection(sort: ScheduleTemplateSort): string {
    return `${sort.field}:${sort.direction}`;
  }

  trackByTemplateId(_: number, template: ScheduleTemplate) {
    return template.id;
  }

  templateElementId(id: string): string {
    return `template-${id}`;
  }

  private scrollToHighlightedTemplate() {
    const highlight = this.highlightTemplateId();
    if (!highlight) {
      return;
    }
    const element = this.document.getElementById(this.templateElementId(highlight));
    if (!element) {
      return;
    }
    this.highlightTemplateId.set(null);
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    element.classList.add('template-card--highlight');
    window.setTimeout(() => {
      element.classList.remove('template-card--highlight');
    }, 2000);
  }
}
