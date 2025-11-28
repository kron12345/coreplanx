import { Injectable, inject } from '@angular/core';
import { Timetable } from '../models/timetable.model';
import { TimetableService, AppendAuditEntryPayload } from './timetable.service';

export interface TttSyncPayload {
  refTrainId: string;
  version: number;
  exportedAt: string;
  calendarVariants?: Timetable['calendarVariants'];
  calendarModifications?: Timetable['calendarModifications'];
  responsibilities?: Timetable['responsibilities'];
  auditNote?: string;
}

@Injectable({ providedIn: 'root' })
export class TttSyncService {
  private readonly timetableService = inject(TimetableService);

  exportPayload(timetable: Timetable): TttSyncPayload {
    return {
      refTrainId: timetable.refTrainId,
      version: 1,
      exportedAt: new Date().toISOString(),
      calendarVariants: timetable.calendarVariants ?? undefined,
      calendarModifications: timetable.calendarModifications ?? undefined,
      responsibilities: timetable.responsibilities ?? undefined,
      auditNote: timetable.auditTrail?.[0]?.action,
    };
  }

  applyPayload(refTrainId: string, payload: TttSyncPayload): Timetable {
    const timetable = this.timetableService.getByRefTrainId(refTrainId);
    if (!timetable) {
      throw new Error('Fahrplan nicht gefunden.');
    }
    if (payload.refTrainId !== refTrainId) {
      throw new Error('RefTrainID stimmt nicht überein.');
    }

    if (payload.calendarVariants) {
      this.timetableService.updateCalendarVariants(refTrainId, payload.calendarVariants);
    }
    if (payload.responsibilities) {
      this.timetableService.updateResponsibilities(refTrainId, payload.responsibilities);
    }
    if (payload.calendarModifications) {
      this.timetableService.updateCalendarModifications(refTrainId, payload.calendarModifications);
    }
    if (payload.auditNote) {
      const auditPayload: AppendAuditEntryPayload = {
        actor: 'TTT Sync',
        action: 'Importierte Änderungen',
        notes: payload.auditNote,
        relatedEntity: 'other',
      };
      this.timetableService.appendAuditEntry(refTrainId, auditPayload);
    }

    const updated = this.timetableService.getByRefTrainId(refTrainId);
    if (!updated) {
      throw new Error('Fahrplan konnte nach Import nicht gelesen werden.');
    }
    return updated;
  }
}
