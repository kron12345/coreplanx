import type { BusinessStatus } from '../../../core/models/business.model';
import type { OrderProcessStatus } from '../../../core/models/order.model';
import type { InternalProcessingStatus } from '../../../core/models/order-item.model';
import type { TimetablePhase } from '../../../core/models/timetable.model';
import type { OrderTtrPhaseFilter } from '../../../core/services/order.service';

export const BUSINESS_STATUS_LABELS: Record<BusinessStatus, string> = {
  neu: 'Neu',
  pausiert: 'Pausiert',
  in_arbeit: 'In Arbeit',
  erledigt: 'Erledigt',
};

export const TIMETABLE_PHASE_LABELS: Record<TimetablePhase, string> = {
  bedarf: 'Draft',
  path_request: 'Path Request',
  offer: 'Offered',
  contract: 'Booked',
  operational: 'Used',
  archived: 'Cancelled',
};

export const INTERNAL_STATUS_LABELS: Partial<Record<InternalProcessingStatus, string>> = {
  in_bearbeitung: 'In Bearbeitung',
  freigegeben: 'Freigegeben',
  ueberarbeiten: 'Überarbeiten',
  uebermittelt: 'Übermittelt',
  beantragt: 'Beantragt',
  abgeschlossen: 'Abgeschlossen',
  annulliert: 'Annulliert',
};

export const ORDER_PROCESS_STATUS_LABELS: Record<OrderProcessStatus, string> = {
  auftrag: 'Auftrag',
  planung: 'Planung',
  produkt_leistung: 'Produkt/Leistung',
  produktion: 'Produktion',
  abrechnung_nachbereitung: 'Abrechnung/Nachbereitung',
};

export const FILTERABLE_TTR_PHASES: ReadonlySet<OrderTtrPhaseFilter> = new Set([
  'annual_request',
  'final_offer',
  'rolling_planning',
  'short_term',
  'ad_hoc',
  'operational_delivery',
]);

