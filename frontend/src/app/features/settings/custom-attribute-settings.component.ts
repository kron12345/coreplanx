import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { AttributeDefinitionEditorComponent } from './attribute-definition-editor.component';
import { ActivityCatalogSettingsComponent } from './activity-catalog-settings.component';
import { TranslationSettingsComponent } from './translation-settings.component';
import { LayerGroupSettingsComponent } from './layer-group-settings.component';
import { PlanningRuleSettingsComponent } from './planning-rule-settings.component';
import { PlanningSettingsComponent } from './planning-settings.component';
import { PlanningAdminSettingsComponent } from './planning-admin-settings.component';
import { AssistantUiContextService } from '../../core/services/assistant-ui-context.service';
import { environment } from '../../../environments/environment';

const SETTINGS_TABS = [
  { label: 'Attribut-Editor', docKey: 'settings-attributes' },
  { label: 'Activity-Editor', docKey: 'settings-activity-catalog' },
  { label: 'Layer-Gruppen', docKey: 'settings-layer-groups' },
  { label: 'Übersetzungen', docKey: 'settings-translations' },
  { label: 'Regeln', docKey: 'settings-planning-rules' },
  { label: 'Planung', docKey: 'settings-planning' },
  ...(environment.production ? [] : [{ label: 'Admin', docKey: 'settings-admin' }]),
];

@Component({
    selector: 'app-custom-attribute-settings',
    imports: [
        CommonModule,
        MatTabsModule,
        AttributeDefinitionEditorComponent,
        ActivityCatalogSettingsComponent,
        TranslationSettingsComponent,
        LayerGroupSettingsComponent,
        PlanningRuleSettingsComponent,
        PlanningSettingsComponent,
        PlanningAdminSettingsComponent,
    ],
    templateUrl: './custom-attribute-settings.component.html',
    styleUrl: './custom-attribute-settings.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class CustomAttributeSettingsComponent {
  private readonly assistantUiContext = inject(AssistantUiContextService);

  protected readonly selectedTabIndex = signal(0);
  protected readonly showAdminTab = !environment.production;

  private readonly updateAssistantContext = effect(() => {
    const tab = SETTINGS_TABS[this.selectedTabIndex()];
    if (!tab) {
      return;
    }
    this.assistantUiContext.setDocKey(tab.docKey);
    this.assistantUiContext.setDocSubtopic(tab.label);
    this.assistantUiContext.setBreadcrumbs(['Einstellungen', tab.label]);
    this.assistantUiContext.setDataSummary(null);
  });

  protected handleTabChange(index: number): void {
    this.selectedTabIndex.set(index);
  }
}
