import type { OrderFilters } from '../../../core/services/order.service';

export const INSIGHTS_COLLAPSED_STORAGE_KEY = 'orders.insightsCollapsed.v1';
export const ORDER_PRESETS_STORAGE_KEY = 'orders.presets.v1';

export const ORDER_TTR_PHASE_META: Record<
  Exclude<OrderFilters['ttrPhase'], 'all'>,
  { label: string; window: string }
> = {
  annual_request: { label: 'Annual TT Request', window: '12–7 Monate vor FP' },
  final_offer: { label: 'Final Offer (ENFP)', window: '7–4 Monate vor FP' },
  rolling_planning: { label: 'Rolling Planning', window: '13–3 Wochen vor FP' },
  short_term: { label: 'Short-Term', window: '30–7 Tage vor FP' },
  ad_hoc: { label: 'Ad-hoc', window: '0–7 Tage vor Produktion' },
  operational_delivery: { label: 'Operative Begleitung', window: 'laufender Betrieb' },
};

export const ORDER_TIMELINE_REFERENCE_LABELS: Record<
  OrderFilters['timelineReference'],
  { label: string; hint: string }
> = {
  fpDay: { label: 'Fahrplantag', hint: 'Planungsbezug' },
  fpYear: { label: 'Fahrplanjahr', hint: 'Jahresfrist' },
  operationalDay: { label: 'Produktionstag', hint: 'Echtzeit / Betrieb' },
};

