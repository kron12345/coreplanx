import { Component, computed, inject, signal } from '@angular/core';
import {
  ActivatedRoute,
  ActivatedRouteSnapshot,
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { filter } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MATERIAL_IMPORTS } from './core/material.imports.imports';
import { TtrBusinessAutomationService } from './core/services/ttr-business-automation.service';

type AppSection = 'manager' | 'planning' | 'timetable' | 'master-data' | 'settings';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ...MATERIAL_IMPORTS],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);
  // ensure phase automation orchestrator is instantiated once
  private readonly _ttrAutomation = inject(TtrBusinessAutomationService);

  readonly pageTitle = signal('Auftragsmanager');
  readonly section = signal<AppSection>('manager');
  readonly sectionTitle = computed(() => this.resolveSectionTitle());
  readonly showSubtitle = computed(
    () => this.pageTitle().toLowerCase() !== this.sectionTitle().toLowerCase(),
  );

  constructor() {
    this.updateTitle();
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.updateTitle());
  }

  private updateTitle() {
    const snapshot = this.activatedRoute.snapshot;
    const title = this.extractTitle(snapshot) ?? 'Auftragsmanager';
    const section = this.extractSection(snapshot) ?? 'manager';
    this.pageTitle.set(title);
    this.section.set(section);
  }

  private extractTitle(route: ActivatedRouteSnapshot): string | undefined {
    let current: ActivatedRouteSnapshot | null = route;
    let title: string | undefined;
    while (current) {
      if (current.title) {
        title = current.title;
      } else if (current.data && current.data['title']) {
        title = current.data['title'];
      }
      current = current.firstChild ?? null;
    }
    return title;
  }

  private extractSection(route: ActivatedRouteSnapshot): AppSection | undefined {
    let current: ActivatedRouteSnapshot | null = route;
    while (current) {
      const section = current.data?.['section'] as AppSection | undefined;
      if (section) {
        return section;
      }
      current = current.firstChild ?? null;
    }
    return undefined;
  }

  private resolveSectionTitle(): string {
    switch (this.section()) {
      case 'planning':
        return 'Planung';
      case 'timetable':
        return 'Fahrplanmanager';
      case 'master-data':
        return 'Stammdaten';
      case 'settings':
        return 'Einstellungen';
      default:
        return 'Auftragsmanager';
    }
  }
}
