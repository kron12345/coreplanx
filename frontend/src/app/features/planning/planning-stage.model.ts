export type PlanningStageId = 'base' | 'operations';

export type PlanningResourceCategory =
  | 'vehicle-service'
  | 'personnel-service'
  | 'vehicle'
  | 'personnel';

export interface PlanningStageMeta {
  id: PlanningStageId;
  label: string;
  shortLabel: string;
  description: string;
  focusHeadline: string;
  focusPoints: string[];
  contextHeadline: string;
  contextDetails: string[];
}

export const PLANNING_STAGE_METAS: PlanningStageMeta[] = [
  {
    id: 'base',
    label: 'Basisplanung',
    shortLabel: 'Basis',
    description:
      'Planwoche entwerfen und Standards für Fahrzeug- und Personaldienste festlegen. Grundlage für alle weiteren Schritte.',
    focusHeadline: 'Im Fokus dieser Phase',
    focusPoints: [
      'Fahrzeugdienste und Umläufe je Pool definieren',
      'Personaldienste strukturieren und zuweisen',
      'Planwoche als Blaupause absichern',
    ],
    contextHeadline: 'Rahmenbedingungen',
    contextDetails: [
      'Arbeit ausschließlich auf Fahrzeug- und Personaldienst-Pools',
      'Planungszeitraum ist eine repräsentative Woche',
      'Ergebnis dient als Vorlage für den Jahresausroll',
    ],
  },
  {
    id: 'operations',
    label: 'Betriebsplanung',
    shortLabel: 'Betrieb',
    description:
      'Die Planwoche wird über das Jahr ausgerollt. Dienste bleiben in ihren Pools, es kommen reale Fahrzeuge und Personale hinzu.',
    focusHeadline: 'Im Fokus dieser Phase',
    focusPoints: [
      'Planwoche auf Jahresfahrplan übertragen',
      'Fahrzeug- und Personaldienste auf Ressourcen abbilden',
      'Verfügbarkeiten und Leistungen (Ruhetage, Ferien) planen',
    ],
    contextHeadline: 'Rahmenbedingungen',
    contextDetails: [
      'Neue Dienste entstehen weiterhin in den Pools',
      'Pooldienste mit Fahrzeugen und Personal verknüpfen',
      'Leistungen und Abwesenheiten werden im Jahreskontext gepflegt',
    ],
  },
];
