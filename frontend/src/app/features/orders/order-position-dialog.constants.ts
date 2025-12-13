import { OrderItemGeneralLabels } from '../orders/shared/order-item-general-fields/order-item-general-fields.component';

export const SERVICE_FIELDS_CONFIG = {
  startControl: 'start',
  endControl: 'end',
  serviceTypeControl: 'serviceType',
  fromControl: 'fromLocation',
  toControl: 'toLocation',
} as const;

export const SERVICE_GENERAL_LABELS: OrderItemGeneralLabels = {
  name: 'Positionsname (optional)',
  responsible: 'Verantwortlich (optional)',
  deviation: 'Bemerkung',
  tags: 'Tags (optional)',
};

export const SERVICE_GENERAL_DESCRIPTIONS = {
  name: 'Optionaler Anzeigename. Ohne Eingabe wird der Leistungstyp als Name verwendet.',
  responsible: 'Wer führt die Leistung aus oder ist Ansprechpartner?',
  deviation: 'Kurze Notiz zu Besonderheiten, z. B. +3 min.',
  tags: 'Kommagetrennte Stichwörter, um Positionen zu gruppieren (z. B. rolling, premium).',
} as const;

export const SERVICE_FIELD_DESCRIPTIONS = {
  start: 'Startuhrzeit der Leistung (HH:MM). Das Datum ergibt sich aus dem Referenzkalender.',
  end: 'Enduhrzeit. Liegt sie vor der Startzeit, wird automatisch der Folgetag verwendet.',
  serviceType: 'Art der Leistung, z. B. Werkstatt, Reinigung, Begleitung.',
  from: 'Ausgangsort oder Bereich, an dem die Leistung startet.',
  to: 'Zielort oder Bereich, an dem die Leistung endet.',
  trafficPeriod: 'Referenzkalender, in dem die Leistung gelten soll.',
} as const;

export const MANUAL_GENERAL_LABELS: OrderItemGeneralLabels = {
  name: 'Positionsname',
  responsible: 'Verantwortlich',
  deviation: 'Bemerkung',
  tags: 'Tags (optional)',
};

export const MANUAL_GENERAL_DESCRIPTIONS = {
  name: 'Titel der Fahrplanposition, z. B. Sonderzug 4711.',
  responsible: 'Verantwortliche Person oder Stelle für den Fahrplan.',
  deviation: 'Hinweise oder Abweichungen für den manuellen Fahrplan.',
  tags: 'Kommagetrennte Stichwörter für Filter & Automationen.',
} as const;

export const PLAN_FIELD_DESCRIPTIONS = {
  templateId: 'Vorlage mit Strecke und Zeiten, die für die Serie genutzt wird.',
  startTime: 'Erste Abfahrt am Tag der Serie (HH:MM).',
  endTime: 'Letzte Abfahrt am Tag der Serie (HH:MM).',
  intervalMinutes: 'Abstand zwischen den Zügen in Minuten.',
  namePrefix: 'Optionales Präfix für generierte Positionsnamen.',
  responsible: 'Verantwortlicher für die erzeugten Fahrpläne.',
  otn: 'Optionaler Startwert für die Zugnummer (OTN).',
  otnInterval: 'Differenz zwischen den OTN der nacheinander erzeugten Züge.',
  tags: 'Kommagetrennte Schlagwörter, die allen erzeugten Fahrplanpositionen hinzugefügt werden.',
} as const;

export const MANUAL_FIELD_DESCRIPTIONS = {
  trainNumber: 'Offizielle Zugnummer (OTN), unter der der Zug geführt wird.',
} as const;

export const IMPORT_OPTIONS_DESCRIPTIONS = {
  trafficPeriodId: 'Optional: überschreibt den aus der RailML-Datei erzeugten Referenzkalender.',
  namePrefix: 'Optionaler Zusatz für erzeugte Positionsnamen.',
  responsible: 'Verantwortliche Person für importierte Fahrpläne.',
  tags: 'Kommagetrennte Schlagwörter, die allen importierten Positionen hinzugefügt werden.',
} as const;

export const IMPORT_FILTER_DESCRIPTIONS = {
  search: 'Suche nach Zugname oder ID innerhalb der importierten Datei.',
  start: 'Filtere nach Startort im RailML-Datensatz.',
  end: 'Filtere nach Zielort im RailML-Datensatz.',
  templateId: 'Beziehe den Vergleich nur auf eine bestimmte Vorlage mit Takt.',
  irregularOnly: 'Zeige nur Züge, die den erwarteten Takt der Vorlage verletzen.',
  minDeviation: 'Blendt Züge aus, deren größte Abweichung unter diesem Wert (Minuten) liegt.',
  deviationSort: 'Sortiert die Ergebnisliste nach der größten Abweichung.',
} as const;
