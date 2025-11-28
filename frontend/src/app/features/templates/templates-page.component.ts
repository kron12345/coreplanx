import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';

@Component({
  selector: 'app-templates-page',
  standalone: true,
  imports: [...MATERIAL_IMPORTS, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './templates-page.component.html',
  styleUrl: './templates-page.component.scss',
})
export class TemplatesPageComponent {}
