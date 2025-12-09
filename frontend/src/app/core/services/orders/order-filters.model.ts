import { BusinessStatus } from '../../models/business.model';
import { OrderItem, InternalProcessingStatus } from '../../models/order-item.model';
import { TimetablePhase } from '../../models/timetable.model';

export type OrderTimelineReference = 'fpDay' | 'operationalDay' | 'fpYear';

export type OrderTtrPhase =
  | 'annual_request'
  | 'final_offer'
  | 'rolling_planning'
  | 'short_term'
  | 'ad_hoc'
  | 'operational_delivery'
  | 'unknown';

export type OrderTtrPhaseFilter =
  | 'all'
  | 'annual_request'
  | 'final_offer'
  | 'rolling_planning'
  | 'short_term'
  | 'ad_hoc'
  | 'operational_delivery';

export interface OrderTtrPhaseMeta {
  key: OrderTtrPhase;
  label: string;
  window: string;
  reference: OrderTimelineReference | 'mixed';
  hint: string;
}

export interface OrderFilters {
  search: string;
  tag: string | 'all';
  timeRange: 'all' | 'next4h' | 'next12h' | 'today' | 'thisWeek';
  trainStatus: TimetablePhase | 'all';
  businessStatus: BusinessStatus | 'all';
  internalStatus: InternalProcessingStatus | 'all';
  trainNumber: string;
  timetableYearLabel: string | 'all';
  variantType: 'all' | 'productive' | 'simulation';
  linkedBusinessId: string | null;
  fpRangeStart: string | null;
  fpRangeEnd: string | null;
  timelineReference: OrderTimelineReference;
  ttrPhase: OrderTtrPhaseFilter;
}

export type OrderSearchTokens = {
  textTerms: string[];
  tags: string[];
  responsibles: string[];
  customers: string[];
};

export const ORDER_FILTERS_STORAGE_KEY = 'orders.filters.v2';

export const DEFAULT_ORDER_FILTERS: OrderFilters = {
  search: '',
  tag: 'all',
  timeRange: 'all',
  trainStatus: 'all',
  businessStatus: 'all',
  internalStatus: 'all',
  trainNumber: '',
  timetableYearLabel: 'all',
  variantType: 'all',
  linkedBusinessId: null,
  fpRangeStart: null,
  fpRangeEnd: null,
  timelineReference: 'fpDay',
  ttrPhase: 'all',
};

export const TTR_PHASE_META: Record<OrderTtrPhase, OrderTtrPhaseMeta> = {
  annual_request: {
    key: 'annual_request',
    label: 'Annual TT Request',
    window: '12–7 Monate vor Fahrplanjahr',
    reference: 'fpDay',
    hint: 'Jahresfahrplanbestellungen erstellen und einreichen.',
  },
  final_offer: {
    key: 'final_offer',
    label: 'Final Offer (ENFP)',
    window: '7–4 Monate vor Fahrplanjahr',
    reference: 'fpDay',
    hint: 'Angebote prüfen, final annehmen oder ablehnen.',
  },
  rolling_planning: {
    key: 'rolling_planning',
    label: 'Rolling Planning',
    window: '13–3 Wochen vor Fahrplantag',
    reference: 'fpDay',
    hint: 'Mittelfristige Zusatz- und Saisonlagen abstimmen.',
  },
  short_term: {
    key: 'short_term',
    label: 'Short-Term',
    window: '30–7 Tage vor Fahrplantag',
    reference: 'fpDay',
    hint: 'Kurzfristige Bedarfe mit schnellen Reaktionsfristen bedienen.',
  },
  ad_hoc: {
    key: 'ad_hoc',
    label: 'Ad-hoc',
    window: '0–7 Tage vor Produktionstag',
    reference: 'operationalDay',
    hint: 'Akute Bedarfe oder Störungen, Reaktion in Minuten/Stunden.',
  },
  operational_delivery: {
    key: 'operational_delivery',
    label: 'Operative Begleitung',
    window: 'laufender Betrieb',
    reference: 'operationalDay',
    hint: 'Leistung ist im Betrieb / Monitoring & Umsetzung.',
  },
  unknown: {
    key: 'unknown',
    label: 'Unklassifiziert',
    window: 'fehlende Daten',
    reference: 'mixed',
    hint: 'Es fehlen Fahrplan- oder Datumseigenschaften zur Einordnung.',
  },
};
