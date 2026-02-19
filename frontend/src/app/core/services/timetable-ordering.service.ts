import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TimetableOrderingApiService } from '../api/timetable-ordering-api.service';
import type {
  ApplyTimetableOrderingActionPayload,
  ApplyTimetableOrderingSimulatorPayload,
  CreateTimetableOrderingCasePayload,
  TimetableOrderingCaseDetailsDto,
  TimetableOrderingCaseDto,
  TimetableOrderingProfileSummaryDto,
} from '../api/timetable-ordering-api.types';

@Injectable({ providedIn: 'root' })
export class TimetableOrderingService {
  private readonly api = inject(TimetableOrderingApiService);

  private readonly casesSignal = signal<TimetableOrderingCaseDto[]>([]);
  private readonly selectedCaseIdSignal = signal<string | null>(null);
  private readonly selectedDetailsSignal = signal<TimetableOrderingCaseDetailsDto | null>(null);
  private readonly profilesSignal = signal<TimetableOrderingProfileSummaryDto[]>([]);
  private readonly loadingSignal = signal(false);
  private readonly errorSignal = signal<string | null>(null);

  readonly cases = computed(() => this.casesSignal());
  readonly selectedCaseId = computed(() => this.selectedCaseIdSignal());
  readonly selectedDetails = computed(() => this.selectedDetailsSignal());
  readonly profiles = computed(() => this.profilesSignal());
  readonly loading = computed(() => this.loadingSignal());
  readonly error = computed(() => this.errorSignal());

  readonly selectedCase = computed(() => {
    const selectedId = this.selectedCaseIdSignal();
    if (!selectedId) {
      return null;
    }
    return this.casesSignal().find((entry) => entry.id === selectedId) ?? null;
  });

  constructor() {
    void this.refreshProfiles();
    void this.refreshCases();
  }

  async refreshProfiles(): Promise<void> {
    try {
      const profiles = await firstValueFrom(this.api.listProfiles());
      this.profilesSignal.set(profiles ?? []);
    } catch (error) {
      console.warn('[TimetableOrderingService] Failed to load profiles', error);
      this.errorSignal.set('Prozessprofile konnten nicht geladen werden.');
    }
  }

  async refreshCases(): Promise<void> {
    this.loadingSignal.set(true);
    try {
      const list = await firstValueFrom(this.api.listCases());
      const next = list ?? [];
      this.casesSignal.set(next);
      const selectedId = this.selectedCaseIdSignal();
      if (selectedId && next.some((entry) => entry.id === selectedId)) {
        await this.selectCase(selectedId);
      } else if (next.length) {
        await this.selectCase(next[0].id);
      } else {
        this.selectedCaseIdSignal.set(null);
        this.selectedDetailsSignal.set(null);
      }
      this.errorSignal.set(null);
    } catch (error) {
      console.warn('[TimetableOrderingService] Failed to load cases', error);
      this.errorSignal.set('Bestellfälle konnten nicht geladen werden.');
    } finally {
      this.loadingSignal.set(false);
    }
  }

  async selectCase(caseId: string): Promise<void> {
    const trimmed = caseId?.trim();
    if (!trimmed) {
      return;
    }
    this.selectedCaseIdSignal.set(trimmed);
    try {
      const details = await firstValueFrom(this.api.getCase(trimmed));
      this.selectedDetailsSignal.set(details);
      this.mergeCaseIntoList(details.case);
      this.errorSignal.set(null);
    } catch (error) {
      console.warn('[TimetableOrderingService] Failed to load case details', error);
      this.errorSignal.set('Bestellfall-Details konnten nicht geladen werden.');
    }
  }

  async createCase(payload: CreateTimetableOrderingCasePayload): Promise<TimetableOrderingCaseDetailsDto | null> {
    this.loadingSignal.set(true);
    try {
      const details = await firstValueFrom(this.api.createCase(payload));
      this.selectedCaseIdSignal.set(details.case.id);
      this.selectedDetailsSignal.set(details);
      this.mergeCaseIntoList(details.case);
      this.errorSignal.set(null);
      return details;
    } catch (error) {
      console.warn('[TimetableOrderingService] Failed to create case', error);
      this.errorSignal.set('Bestellfall konnte nicht angelegt werden.');
      return null;
    } finally {
      this.loadingSignal.set(false);
    }
  }

  async applyAction(
    caseId: string,
    payload: ApplyTimetableOrderingActionPayload,
  ): Promise<TimetableOrderingCaseDetailsDto | null> {
    this.loadingSignal.set(true);
    try {
      const details = await firstValueFrom(this.api.applyAction(caseId, payload));
      this.selectedCaseIdSignal.set(details.case.id);
      this.selectedDetailsSignal.set(details);
      this.mergeCaseIntoList(details.case);
      this.errorSignal.set(null);
      return details;
    } catch (error) {
      console.warn('[TimetableOrderingService] Failed to apply action', error);
      this.errorSignal.set('Aktion konnte nicht ausgeführt werden.');
      return null;
    } finally {
      this.loadingSignal.set(false);
    }
  }

  async applySimulator(
    caseId: string,
    payload: ApplyTimetableOrderingSimulatorPayload,
  ): Promise<TimetableOrderingCaseDetailsDto | null> {
    this.loadingSignal.set(true);
    try {
      const details = await firstValueFrom(this.api.applySimulator(caseId, payload));
      this.selectedCaseIdSignal.set(details.case.id);
      this.selectedDetailsSignal.set(details);
      this.mergeCaseIntoList(details.case);
      this.errorSignal.set(null);
      return details;
    } catch (error) {
      console.warn('[TimetableOrderingService] Failed to apply simulator response', error);
      this.errorSignal.set('Simulator-Antwort konnte nicht verarbeitet werden.');
      return null;
    } finally {
      this.loadingSignal.set(false);
    }
  }

  private mergeCaseIntoList(nextCase: TimetableOrderingCaseDto): void {
    this.casesSignal.update((current) => {
      const existing = current.some((entry) => entry.id === nextCase.id);
      if (!existing) {
        return [nextCase, ...current].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      }
      return current
        .map((entry) => (entry.id === nextCase.id ? nextCase : entry))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }
}
