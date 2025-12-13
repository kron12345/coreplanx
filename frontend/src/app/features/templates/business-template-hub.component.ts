import { Component } from '@angular/core';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import { BusinessTemplatePanelComponent } from '../business/business-template-panel.component';

@Component({
    selector: 'app-business-template-hub',
    imports: [...MATERIAL_IMPORTS, BusinessTemplatePanelComponent],
    templateUrl: './business-template-hub.component.html',
    styleUrl: './business-template-hub.component.scss'
})
export class BusinessTemplateHubComponent {}
