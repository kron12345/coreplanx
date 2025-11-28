import { AutomationCondition, BusinessTemplate } from '../models/business-template.model';
import { BusinessAssignment } from '../models/business.model';
import { OrderTimelineReference, OrderTtrPhase } from '../services/order.service';

export type PhaseWindowUnit = 'hours' | 'days' | 'weeks';

export interface PhaseWindowConfig {
  unit: PhaseWindowUnit;
  start: number;
  end: number;
  bucket: 'hour' | 'day' | 'week' | 'year';
  label: string;
}

export interface PhaseTemplateDefinition {
  id: string;
  label: string;
  summary: string;
  timelineReference: OrderTimelineReference | 'fpYear';
  autoCreate: boolean;
  window: PhaseWindowConfig;
  template: BusinessTemplate;
  sourcePhase?: OrderTtrPhase;
  conditions?: AutomationCondition[];
}

const groupAssignment = (name: string): BusinessAssignment => ({
  type: 'group',
  name,
});

const personAssignment = (name: string): BusinessAssignment => ({
  type: 'person',
  name,
});

export const TTR_PHASE_TEMPLATE_DEFINITIONS: PhaseTemplateDefinition[] = [
  {
    id: 'annual_request',
    label: 'Annual TT Request',
    summary: 'Jahresfahrplan-Bestellungen einsammeln und vollständig einreichen.',
    timelineReference: 'fpYear',
    autoCreate: true,
    sourcePhase: 'annual_request',
    window: {
      unit: 'days',
      start: -365,
      end: -210,
      bucket: 'week',
      label: '12–7 Monate vor Fahrplanjahr',
    },
    template: {
      id: 'tpl-annual-request',
      title: 'Jahresbestellung abstimmen',
      description: 'Forecast anfragen, Bestellung erstellen und Freigaben dokumentieren.',
      tags: ['#Jahresbestellung', '#Planung'],
      category: 'Bestellung',
      recommendedAssignment: personAssignment('L. Kramer'),
      dueRule: {
        anchor: 'order_creation',
        offsetDays: 30,
        label: '30 Tage nach Auftrag',
      },
      defaultLeadTimeDays: 14,
      automationHint: 'Erzeugt automatisch Aufgaben für Jahresfahrplan-Anmeldungen.',
      steps: [
        {
          id: 'annual-1',
          title: 'Bedarf sammeln',
          description: 'Kundeninput & Ressourcenabgleich erstellen.',
          dueRule: { anchor: 'order_creation', offsetDays: 7, label: '7 Tage nach Auftrag' },
        },
        {
          id: 'annual-2',
          title: 'Bestellung einreichen',
          description: 'Path Requests im System platzieren und Bestätigung abwarten.',
          dueRule: { anchor: 'order_creation', offsetDays: 30, label: '30 Tage nach Auftrag' },
        },
      ],
      parameterHints: ['kundensegment'],
    },
  },
  {
    id: 'final_offer',
    label: 'Final Offer',
    summary: 'Draft/Final Offers prüfen, Abweichungen bewerten und Entscheidungen dokumentieren.',
    timelineReference: 'fpDay',
    autoCreate: true,
    sourcePhase: 'final_offer',
    window: {
      unit: 'days',
      start: -210,
      end: -120,
      bucket: 'week',
      label: '7–4 Monate vor Fahrplantag',
    },
    template: {
      id: 'tpl-final-offer',
      title: 'Final Offer prüfen',
      description:
        'Vergleicht Offer mit der Bestellung, stößt Eskalationen an und dokumentiert Annahmen.',
      tags: ['#offer', '#entscheid'],
      category: 'Kommunikation',
      recommendedAssignment: groupAssignment('Offer Team'),
      dueRule: {
        anchor: 'production_start',
        offsetDays: -120,
        label: '120 Tage vor Produktion',
      },
      defaultLeadTimeDays: 10,
      steps: [
        {
          id: 'offer-1',
          title: 'Offer delta analysieren',
          description: 'Zeit- und Kapazitätsabweichungen markieren.',
          dueRule: { anchor: 'production_start', offsetDays: -125, label: '125 Tage vor Produktion' },
        },
        {
          id: 'offer-2',
          title: 'Annahme / Ablehnung',
          description: 'Kunde & Betrieb abstimmen, Ergebnis dokumentieren.',
          dueRule: { anchor: 'production_start', offsetDays: -115, label: '115 Tage vor Produktion' },
        },
      ],
      parameterHints: ['abweichung', 'slot'],
    },
  },
  {
    id: 'rolling_planning',
    label: 'Rolling Planning',
    summary: 'Mittelfristige Zusatzbedarfe, Saison- und Verstärkerlagen koordinieren.',
    timelineReference: 'fpDay',
    autoCreate: true,
    sourcePhase: 'rolling_planning',
    window: {
      unit: 'weeks',
      start: -13,
      end: -3,
      bucket: 'week',
      label: '13–3 Wochen vor Fahrplantag',
    },
    template: {
      id: 'tpl-rolling',
      title: 'Rolling Request koordinieren',
      description: 'Rolling-Window prüfen, Bedarf erzeugen, Antwort überwachen.',
      tags: ['#rolling', '#ttr'],
      category: 'Bestellung',
      recommendedAssignment: groupAssignment('Operations Mitte'),
      dueRule: {
        anchor: 'production_start',
        offsetDays: -21,
        label: '21 Tage vor Produktion',
      },
      defaultLeadTimeDays: 5,
      steps: [
        {
          id: 'rolling-1',
          title: 'Rolling Request senden',
          description: 'Bedarf in TTR Rolling Modul einstellen.',
          dueRule: { anchor: 'production_start', offsetDays: -25, label: '25 Tage vor Produktion' },
        },
        {
          id: 'rolling-2',
          title: 'Antwort prüfen',
          description: 'Offer innerhalb der Frist bewerten, ggf. Alternativen starten.',
          dueRule: { anchor: 'production_start', offsetDays: -18, label: '18 Tage vor Produktion' },
        },
      ],
    },
  },
  {
    id: 'short_term',
    label: 'Short-Term',
    summary: 'Kurzfristige Bestellungen & Umplanungen mit engen SLA abwickeln.',
    timelineReference: 'fpDay',
    autoCreate: true,
    sourcePhase: 'short_term',
    window: {
      unit: 'days',
      start: -30,
      end: -7,
      bucket: 'day',
      label: '30–7 Tage vor Fahrplantag',
    },
    template: {
      id: 'tpl-short-term',
      title: 'Short-Term Taskforce',
      description: '24/48h-SLA prüfen, Kunden informieren und Dokumentation auffüllen.',
      tags: ['#shortterm', '#sla'],
      category: 'Kommunikation',
      recommendedAssignment: groupAssignment('Short-Term Desk'),
      dueRule: {
        anchor: 'production_start',
        offsetDays: -7,
        label: '7 Tage vor Produktion',
      },
      defaultLeadTimeDays: 2,
      steps: [
        {
          id: 'short-1',
          title: 'SLA prüfen',
          description: 'Prüfen, ob Anfrage in STR-Fenster fällt.',
          dueRule: { anchor: 'production_start', offsetDays: -9, label: '9 Tage vor Produktion' },
        },
        {
          id: 'short-2',
          title: 'Freigabe & Info',
          description: 'Kunde informieren, Abweichung dokumentieren.',
          dueRule: { anchor: 'production_start', offsetDays: -6, label: '6 Tage vor Produktion' },
        },
      ],
    },
  },
  {
    id: 'ad_hoc',
    label: 'Ad-hoc',
    summary: 'Störungs- und Sofortbedarf innerhalb weniger Stunden lösen.',
    timelineReference: 'operationalDay',
    autoCreate: true,
    sourcePhase: 'ad_hoc',
    window: {
      unit: 'hours',
      start: -48,
      end: 0,
      bucket: 'day',
      label: '0–48 Stunden vor Produktionstag',
    },
    template: {
      id: 'tpl-ad-hoc',
      title: 'Ad-hoc Kapazität',
      description: 'Unmittelbare Kapazitäts- oder Umleiteraufgabe für den Betriebstag.',
      tags: ['#ad-hoc', '#störung'],
      category: 'Kommunikation',
      recommendedAssignment: groupAssignment('Betriebsbegleitung'),
      dueRule: {
        anchor: 'go_live',
        offsetDays: -1,
        label: '1 Tag vor Einsatz',
      },
      defaultLeadTimeDays: 1,
      steps: [
        {
          id: 'adhoc-1',
          title: 'Bedarf bestätigen',
          description: 'Meldung aufnehmen, SLA starten.',
          dueRule: { anchor: 'go_live', offsetDays: -1, label: '1 Tag vor Einsatz' },
        },
        {
          id: 'adhoc-2',
          title: 'Ressourcen allokieren',
          description: 'Fahrzeug / Personal sicherstellen, Kunde informieren.',
          dueRule: { anchor: 'go_live', offsetDays: 0, label: 'Go-Live' },
        },
      ],
    },
  },
];
