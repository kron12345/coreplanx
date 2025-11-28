import { TimetablePhase } from './timetable.model';

export type InternalProcessingStatus =
  | 'in_bearbeitung'
  | 'freigegeben'
  | 'ueberarbeiten'
  | 'uebermittelt'
  | 'beantragt'
  | 'abgeschlossen'
  | 'annulliert';

export interface OrderItemValiditySegment {
  startDate: string; // ISO date (YYYY-MM-DD)
  endDate: string; // ISO date (YYYY-MM-DD)
}

export interface OrderItemTimetableSnapshotStop {
  sequence: number;
  locationName: string;
  arrivalTime?: string;
  departureTime?: string;
}

export interface OrderItemTimetableSnapshot {
  refTrainId: string;
  title: string;
  trainNumber: string;
  calendar: {
    validFrom: string;
    validTo?: string;
    daysBitmap: string;
  };
  stops: OrderItemTimetableSnapshotStop[];
  variants?: OrderItemTimetableSnapshotVariant[];
  modifications?: OrderItemTimetableSnapshotModification[];
}

export interface OrderItemTimetableSnapshotVariant {
  id: string;
  description?: string;
  type?: string;
  validFrom?: string;
  validTo?: string;
  daysOfWeek?: string[];
  dates?: string[];
  appliesTo?: string;
  variantNumber?: string;
  reason?: string;
}

export interface OrderItemTimetableSnapshotModification {
  date: string;
  description?: string;
  type: string;
  notes?: string;
}

export interface OrderItem {
  id: string;
  name: string;
  type: 'Leistung' | 'Fahrplan';
  tags?: string[];
  start?: string; // ISO
  end?: string; // ISO
  responsible?: string;
  deviation?: string;
  linkedBusinessIds?: string[];
  linkedTemplateId?: string;
  linkedTrainPlanId?: string;
  trafficPeriodId?: string;
  timetableYearLabel?: string;
  serviceType?: string;
  fromLocation?: string;
  toLocation?: string;
  validity?: OrderItemValiditySegment[];
  parentItemId?: string;
  childItemIds?: string[];
  versionPath?: number[];
  generatedTimetableRefId?: string;
  timetablePhase?: TimetablePhase;
  originalTimetable?: OrderItemTimetableSnapshot;
  /**
   * SOB-interner Bearbeitungsstatus der Position (optional im Mock).
   * Ergänzt den Fahrplanstatus um die Sicht „In Bearbeitung“, „Freigegeben“, „Beantragt“, etc.
   */
  internalStatus?: InternalProcessingStatus;
}
