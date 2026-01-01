import { ChangeDetectionStrategy, Component, Input, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import {
  MasterDataCategorySection,
  MasterDataHierarchySection,
  MasterDataComponentSection,
  MasterDataSection,
  MasterDataTabConfig,
} from '../../master-data.types';
import { MasterDataCategoryComponent } from '../master-data-category/master-data-category.component';
import { MasterDataHierarchySectionComponent } from '../master-data-hierarchy-section/master-data-hierarchy-section.component';
import { AssistantUiContextService } from '../../../../core/services/assistant-ui-context.service';

@Component({
    selector: 'app-master-data-layout',
    imports: [
        CommonModule,
        MatTabsModule,
        MatIconModule,
        MasterDataCategoryComponent,
        MasterDataHierarchySectionComponent,
    ],
    templateUrl: './master-data-layout.component.html',
    styleUrl: './master-data-layout.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class MasterDataLayoutComponent implements OnInit {
  private readonly assistantUiContext = inject(AssistantUiContextService);

  @Input({ required: true }) title = '';
  @Input({ required: true }) subtitle = '';
  @Input({ required: true }) tabs: MasterDataTabConfig[] = [];

  protected readonly selectedIndex = signal(0);

  ngOnInit(): void {
    this.updateAssistantBreadcrumbs(this.selectedIndex());
    this.assistantUiContext.setDataSummary(null);
  }

  protected handleTabChange(index: number): void {
    this.selectedIndex.set(index);
    this.updateAssistantBreadcrumbs(index);
    this.assistantUiContext.setDataSummary(null);
  }

  protected trackTab(_index: number, tab: MasterDataTabConfig): string {
    return tab.id;
  }

  protected trackSection(_index: number, section: MasterDataSection): string {
    return section.id;
  }

  protected isCategorySection(section: MasterDataSection): section is MasterDataCategorySection {
    return section.type === 'category';
  }

  protected isHierarchySection(section: MasterDataSection): section is MasterDataHierarchySection {
    return section.type === 'hierarchy';
  }

  protected isComponentSection(section: MasterDataSection): section is MasterDataComponentSection {
    return section.type === 'component';
  }

  private updateAssistantBreadcrumbs(index: number): void {
    const tab = this.tabs[index];
    if (!tab) {
      return;
    }
    this.assistantUiContext.setDocKey(tab.id);
    this.assistantUiContext.setDocSubtopic(null);
    this.assistantUiContext.setBreadcrumbs(['Stammdaten', tab.title]);
  }
}
