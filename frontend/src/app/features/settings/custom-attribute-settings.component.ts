import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { AttributeDefinitionEditorComponent } from './attribute-definition-editor.component';
import { ActivityCatalogSettingsComponent } from './activity-catalog-settings.component';
import { TranslationSettingsComponent } from './translation-settings.component';
import { ActivityTypeSettingsComponent } from './activity-type-settings.component';
import { LayerGroupSettingsComponent } from './layer-group-settings.component';

@Component({
  selector: 'app-custom-attribute-settings',
  standalone: true,
  imports: [
    CommonModule,
    MatTabsModule,
    AttributeDefinitionEditorComponent,
    ActivityCatalogSettingsComponent,
    TranslationSettingsComponent,
    ActivityTypeSettingsComponent,
    LayerGroupSettingsComponent,
  ],
  templateUrl: './custom-attribute-settings.component.html',
  styleUrl: './custom-attribute-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomAttributeSettingsComponent {}
