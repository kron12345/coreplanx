import { Component } from '@angular/core';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import { BusinessTemplatePanelComponent } from '../business/business-template-panel.component';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-business-template-hub',
  standalone: true,
  imports: [...MATERIAL_IMPORTS, BusinessTemplatePanelComponent, RouterLink],
  templateUrl: './business-template-hub.component.html',
  styleUrl: './business-template-hub.component.scss',
})
export class BusinessTemplateHubComponent {}
