import { Component, computed, effect, inject, signal } from '@angular/core';
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
import { AssistantCommandComponent } from './features/assistant/assistant-command.component';
import { AssistantUiContextService } from './core/services/assistant-ui-context.service';
import { PlanningDebugService } from './features/planning/planning-debug.service';
import { PlanningDebugStreamService } from './features/planning/planning-debug-stream.service';

type AppSection = 'manager' | 'planning' | 'timetable' | 'master-data' | 'settings';

@Component({
    selector: 'app-root',
    imports: [
      RouterOutlet,
      RouterLink,
      RouterLinkActive,
      AssistantCommandComponent,
      ...MATERIAL_IMPORTS,
    ],
    templateUrl: './app.component.html',
    styleUrl: './app.component.scss'
})
export class AppComponent {
  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly assistantUiContext = inject(AssistantUiContextService);
  private readonly debug = inject(PlanningDebugService);
  private readonly debugStream = inject(PlanningDebugStreamService);
  // ensure phase automation orchestrator is instantiated once
  private readonly _ttrAutomation = inject(TtrBusinessAutomationService);

  readonly brandTitle = 'CorePlanX';
  readonly pageTitle = signal('Auftragsmanager');
  readonly section = signal<AppSection>('manager');
  readonly sectionTitle = computed(() => this.resolveSectionTitle());
  private readonly debugDrawerOpenSignal = signal(false);
  private readonly debugBackendStreamEnabledSignal = signal(false);
  private readonly debugShowAllSignal = signal(false);
  private readonly debugFilterQuerySignal = signal('');
  private readonly debugTopicFilterSignal = signal<string[]>([]);
  private readonly debugStreamTokenStorageKey = 'coreplanx-debug-stream-token';
  private readonly debugStreamTokenSignal = signal(this.loadDebugStreamToken());
  private readonly debugTimestampFormatter = new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'short',
    timeStyle: 'medium',
  });
  readonly brandSubtitle = computed(() => {
    const sectionTitle = this.sectionTitle();
    const pageTitle = this.pageTitle();
    if (pageTitle.toLowerCase() === sectionTitle.toLowerCase()) {
      return sectionTitle;
    }
    return `${sectionTitle} · ${pageTitle}`;
  });

  readonly debugDrawerOpen = computed(() => this.debugDrawerOpenSignal());
  readonly debugBackendStreamEnabled = computed(() => this.debugBackendStreamEnabledSignal());
  readonly debugShowAll = computed(() => this.debugShowAllSignal());
  readonly debugFilterQuery = computed(() => this.debugFilterQuerySignal());
  readonly debugTopicFilters = computed(() => this.debugTopicFilterSignal());
  readonly debugStreamToken = computed(() => this.debugStreamTokenSignal());
  readonly debugTopicOptions = [
    'orders',
    'planning',
    'solver',
    'assistant',
    'db',
    'rules',
    'system',
  ] as const;
  readonly debugAlertCount = computed(() =>
    this.debug
      .entries()
      .filter((entry) => entry.level === 'warn' || entry.level === 'error')
      .length,
  );
  readonly debugConnectionState = computed(() => {
    const backend = this.debug.backendStreamStatus();
    if (backend.state === 'error') {
      return 'error';
    }
    if (backend.state === 'connected') {
      return 'ok';
    }
    return 'warn';
  });
  readonly debugConnectionLabel = computed(() => {
    const backend = this.debug.backendStreamStatus();
    if (backend.state === 'connected') {
      return 'Stream verbunden';
    }
    if (backend.state === 'error') {
      return 'Stream Fehler';
    }
    return 'Stream aus';
  });
  readonly debugLogEntries = computed(() => {
    const entries = this.debug.entries();
    const query = this.debugFilterQuerySignal().trim().toLowerCase();
    const topics = this.debugTopicFilterSignal();
    const filtered = entries.filter((entry) => {
      if (!this.debugShowAllSignal() && topics.length > 0 && !topics.includes(entry.topic ?? '')) {
        return false;
      }
      if (query.length === 0) {
        return true;
      }
      const contextText = entry.context ? JSON.stringify(entry.context) : '';
      return (
        entry.message.toLowerCase().includes(query) ||
        entry.level.toLowerCase().includes(query) ||
        entry.topic?.toLowerCase().includes(query) ||
        contextText.toLowerCase().includes(query)
      );
    });
    return filtered.slice(-300);
  });

  constructor() {
    this.updateTitle();
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.updateTitle());

    effect(() => {
      const enabled = this.debugBackendStreamEnabledSignal();
      const token = this.debugStreamTokenSignal();
      if (enabled) {
        this.debugStream.connect({ token: token.trim().length ? token : undefined });
      } else {
        this.debugStream.disconnect();
      }
    });
  }

  private updateTitle() {
    const snapshot = this.activatedRoute.snapshot;
    const title = this.extractTitle(snapshot) ?? 'Auftragsmanager';
    const section = this.extractSection(snapshot) ?? 'manager';
    this.pageTitle.set(title);
    this.section.set(section);
    this.updateDebugTopicFilters(section);
    this.updateAssistantUiContext();
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

  toggleDebugDrawer(): void {
    this.debugDrawerOpenSignal.update((current) => !current);
  }

  closeDebugDrawer(): void {
    this.debugDrawerOpenSignal.set(false);
  }

  toggleDebugStream(enabled: boolean): void {
    this.debugBackendStreamEnabledSignal.set(enabled);
  }

  toggleDebugShowAll(enabled: boolean): void {
    this.debugShowAllSignal.set(enabled);
  }

  updateDebugFilterQuery(value: string): void {
    this.debugFilterQuerySignal.set(value);
  }

  toggleDebugTopicFilter(topic: string): void {
    this.debugTopicFilterSignal.update((current) => {
      if (current.includes(topic)) {
        return current.filter((entry) => entry !== topic);
      }
      return [...current, topic];
    });
  }

  clearDebugLogs(): void {
    this.debug.clear();
  }

  updateDebugStreamToken(value: string): void {
    this.debugStreamTokenSignal.set(value);
    this.persistDebugStreamToken(value);
  }

  formatDebugTimestamp(value?: string | null): string {
    if (!value) {
      return '-';
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }
    return this.debugTimestampFormatter.format(parsed);
  }

  formatDebugContext(context?: Record<string, unknown>): string | null {
    if (!context || Object.keys(context).length === 0) {
      return null;
    }
    try {
      const serialized = JSON.stringify(context, null, 2);
      const limit = 4000;
      if (serialized.length <= limit) {
        return serialized;
      }
      return `${serialized.slice(0, limit)}\n... (truncated)`;
    } catch {
      return null;
    }
  }

  private updateDebugTopicFilters(section: AppSection): void {
    if (this.debugShowAllSignal()) {
      return;
    }
    const next =
      section === 'manager'
        ? ['orders']
        : section === 'planning'
          ? ['planning', 'solver', 'rules']
          : ['system'];
    this.debugTopicFilterSignal.set(next);
  }

  private loadDebugStreamToken(): string {
    if (typeof window === 'undefined') {
      return '';
    }
    try {
      return window.localStorage.getItem(this.debugStreamTokenStorageKey) ?? '';
    } catch {
      return '';
    }
  }

  private persistDebugStreamToken(value: string): void {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      const storage = window.localStorage;
      if (!value.trim()) {
        storage.removeItem(this.debugStreamTokenStorageKey);
        return;
      }
      storage.setItem(this.debugStreamTokenStorageKey, value);
    } catch {
      // ignore storage errors
    }
  }

  private updateAssistantUiContext(): void {
    const route = this.router.url;
    const sectionTitle = this.sectionTitle();
    const pageTitle = this.pageTitle();
    const breadcrumbs =
      sectionTitle.toLowerCase() === pageTitle.toLowerCase()
        ? [sectionTitle]
        : [sectionTitle, pageTitle];
    this.assistantUiContext.setRoute(route);
    this.assistantUiContext.setDocKey(null);
    this.assistantUiContext.setDocSubtopic(null);
    this.assistantUiContext.setBreadcrumbs(breadcrumbs);
    this.assistantUiContext.setDataSummary(null);
  }
}
