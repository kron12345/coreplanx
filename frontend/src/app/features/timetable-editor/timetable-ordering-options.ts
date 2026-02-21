import type { TimetableFormationServiceType } from '../../core/models/timetable-ordering-context.model';
import type { VehicleType } from '../../models/master-data';

export interface TimetableOrderingOption {
  value: string;
  label: string;
}

export interface TimetableFormationVehicleOption extends TimetableOrderingOption {
  serviceType: Exclude<TimetableFormationServiceType, 'pwg'>;
  code: string;
  lengthMeters?: number;
  weightTons?: number;
  maxSpeedKph?: number;
  icon: string;
}

export const REASON_OF_REFERENCE_OPTIONS: TimetableOrderingOption[] = [
  { value: '1000', label: '1000 · Same path offer as stated PathRequestMessage' },
  { value: '1001', label: '1001 · Same path as stated train/path' },
  { value: '1002', label: '1002 · Full replacement of stated previous path' },
  { value: '1003', label: '1003 · Partial replacement of stated previous path' },
  { value: '1004', label: '1004 · Reference to sub train of Y-train bundle' },
  { value: '1005', label: '1005 · Reference to main train of Y-train bundle' },
  { value: '1006', label: '1006 · Reference after foreign infrastructure interruption' },
  { value: '1007', label: '1007 · Reference before foreign infrastructure interruption' },
  { value: '1008', label: '1008 · Reference to further path offer' },
  { value: '1009', label: '1009 · Reference to booked path before bus replacement' },
  { value: '1010', label: '1010 · Reference to a PreArrangedPath' },
  { value: '1011', label: '1011 · Link new train object with existing booked path' },
  { value: '1012', label: '1012 · New final offer to former draft offer' },
  { value: '1013', label: '1013 · Replaced path after modification by applicant' },
  { value: '1014', label: '1014 · New Route' },
  { value: '1015', label: '1015 · Updated Route' },
  { value: '1016', label: '1016 · Reference to pre-booking path request' },
  { value: '5001', label: '5001 · Incident-management reference in operations phase' },
  { value: 'DE01', label: 'DE01 · Associated empty/transfer train' },
  { value: 'DE02', label: 'DE02 · Associated main run' },
  { value: 'DE03', label: 'DE03 · Notice stated PathRequestMessage' },
  { value: 'DE04', label: 'DE04 · Replacement of stated train' },
  { value: 'DE05', label: 'DE05 · Reference to reserved capacity' },
  { value: 'DE06', label: 'DE06 · Use same OTN as stated train' },
];

export const TRAIN_TYPE_OPTIONS: TimetableOrderingOption[] = [
  { value: '0', label: '0 · Other train' },
  { value: '1', label: '1 · Passenger train' },
  { value: '2', label: '2 · Freight train' },
  { value: '3', label: '3 · Light engine (locomotive train)' },
  { value: '4', label: '4 · Engineering train' },
  { value: '5', label: '5 · Emergency train' },
  { value: '6', label: '6 · Mixed train (passenger + freight)' },
];

const TRAFFIC_TYPE_OPTIONS_DEFAULT: TimetableOrderingOption[] = [
  { value: 'PASSENGER', label: 'Passenger' },
  { value: 'S-BAHN', label: 'S-Bahn' },
  { value: 'REGIONAL', label: 'Regional' },
  { value: 'INTERCITY', label: 'Intercity' },
  { value: 'WAGONLOAD', label: 'Wagonload' },
  { value: 'COMBINED', label: 'Combined' },
];

const TRAFFIC_TYPE_OPTIONS_BY_TRAIN_TYPE: Record<string, TimetableOrderingOption[]> = {
  '1': [
    { value: 'S-BAHN', label: 'S-Bahn' },
    { value: 'REGIONAL', label: 'Regional' },
    { value: 'INTERCITY', label: 'Intercity' },
    { value: 'HIGHSPD', label: 'High Speed' },
    { value: 'NIGHT', label: 'Night Train' },
  ],
  '2': [
    { value: 'WAGONLOAD', label: 'Wagonload' },
    { value: 'COMBINED', label: 'Combined' },
    { value: 'ROLHIGHWY', label: 'Rolling Highway' },
    { value: 'BLOCK', label: 'Block Train' },
    { value: 'INTERMOD', label: 'Intermodal' },
  ],
  '3': [
    { value: 'L-ENGINE', label: 'Light Engine' },
    { value: 'POSITION', label: 'Positioning' },
  ],
  '4': [
    { value: 'ENGINEER', label: 'Engineering' },
    { value: 'MEASURE', label: 'Measurement' },
    { value: 'MAINT', label: 'Maintenance' },
  ],
  '5': [
    { value: 'EMERG', label: 'Emergency' },
    { value: 'RESCUE', label: 'Rescue' },
  ],
  '6': [
    { value: 'MIXED', label: 'Mixed' },
    { value: 'PASS/FRT', label: 'Passenger + Freight' },
  ],
  '0': [{ value: 'OTHER', label: 'Other' }],
};

export function trafficTypeOptionsForTrainType(
  trainType: string | undefined,
): TimetableOrderingOption[] {
  const key = trainType?.trim() ?? '';
  return TRAFFIC_TYPE_OPTIONS_BY_TRAIN_TYPE[key] ?? TRAFFIC_TYPE_OPTIONS_DEFAULT;
}

export const SERVICE_TYPE_OPTIONS: TimetableOrderingOption[] = [
  { value: 'tractive_unit', label: 'Triebfahrzeug' },
  { value: 'wagon', label: 'Wagen' },
  { value: 'pwg', label: 'PWG (pauschal)' },
];

const TRACTIVE_UNIT_CATEGORIES = new Set([
  'lokomotive',
  'triebzug',
  'triebfahrzeug',
]);

function normalizeVehicleCategory(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function normalizeNumber(value: number | undefined): number | undefined {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return undefined;
  }
  return value > 0 ? value : undefined;
}

export function serviceTypeForVehicleType(
  type: Pick<VehicleType, 'formationServiceType' | 'category'>,
): Exclude<TimetableFormationServiceType, 'pwg'> | null {
  if (type.formationServiceType === 'wagon') {
    return 'wagon';
  }
  if (type.formationServiceType === 'tractive_unit') {
    return 'tractive_unit';
  }
  const category = normalizeVehicleCategory(type.category);
  if (!category) {
    return null;
  }
  if (category === 'wagen') {
    return 'wagon';
  }
  if (TRACTIVE_UNIT_CATEGORIES.has(category)) {
    return 'tractive_unit';
  }
  return null;
}

export function iconForFormationServiceType(
  serviceType: TimetableFormationServiceType,
): string {
  if (serviceType === 'wagon') {
    return 'directions_transit';
  }
  if (serviceType === 'pwg') {
    return 'view_agenda';
  }
  return 'train';
}

export function buildFormationVehicleOptionsFromVehicleTypes(
  vehicleTypes: readonly VehicleType[],
  serviceType: TimetableFormationServiceType | undefined,
): TimetableFormationVehicleOption[] {
  if (!serviceType || serviceType === 'pwg') {
    return [];
  }
  const options: TimetableFormationVehicleOption[] = [];
  vehicleTypes.forEach((type) => {
    const mappedType = serviceTypeForVehicleType(type);
    if (mappedType !== serviceType) {
      return;
    }
    const code = type.trainTypeCode?.trim() || type.id;
    const details: string[] = [];
    const length = normalizeNumber(type.lengthMeters);
    const weight = normalizeNumber(type.weightTons);
    const speed = normalizeNumber(type.maxSpeed);
    if (length !== undefined) {
      details.push(`${length} m`);
    }
    if (weight !== undefined) {
      details.push(`${weight} t`);
    }
    if (speed !== undefined) {
      details.push(`${speed} km/h`);
    }
    const detailLabel = details.length ? ` · ${details.join(' · ')}` : '';
    const option: TimetableFormationVehicleOption = {
      value: type.id,
      label: `${type.label} (${code})${detailLabel}`,
      serviceType: mappedType,
      code,
      icon: iconForFormationServiceType(mappedType),
    };
    if (length !== undefined) {
      option.lengthMeters = length;
    }
    if (weight !== undefined) {
      option.weightTons = weight;
    }
    if (speed !== undefined) {
      option.maxSpeedKph = speed;
    }
    options.push(option);
  });
  return options.sort((left, right) =>
    left.label.localeCompare(right.label, 'de', { sensitivity: 'base' }),
  );
}

export const FREE_PROCESSING_REASON_OPTIONS: TimetableOrderingOption[] = [
  {
    value: 'path_modification_due_to_path_alteration',
    label: 'Path Modification aufgrund Path Alteration',
  },
  { value: 'none', label: 'Keine kostenlose Bearbeitung' },
];

export const ORDERING_HELP_TEXT: Record<string, string> = {
  otnOrNameInput:
    'Numerisch 1..99999 wird als OTN interpretiert. Sonst wird der Wert als Name gespeichert und OTN bleibt leer.',
  reasonOfReference:
    'XSD 3.4.1: Codeliste ReasonOfReference (1000.., DE..). Beschreibt den Referenzgrund zum verknüpften Objekt.',
  validityDate:
    'Gueltigkeit über den Jahreskalender auswählen. Mehrere Tage sind moeglich; erlaubt sind nur Tage innerhalb der übergebenen Range.',
  trainType:
    'XSD 3.4.1: TrainType (0..6). Beschreibt den grundlegenden Zugzweck.',
  trafficTypeCode:
    "XSD 3.4.1: TrafficTypeCode (1..9 Zeichen), optional mit TrafficTypeNetwork. TrafficTypeNetwork = The code of the company (IM) that has planning responsibility of the network where the TrafficTypeCode applies. If NetworkCode isn't used, then the TrafficTypeCode must be a value in the common European list.",
  serviceType:
    'Fahrtyp für den Formationsaufbau: Triebfahrzeug, Wagen oder PWG (pauschal). Die Fahrzeugauswahl basiert auf den Stammdaten.',
  tractionOrPwg:
    'Die live zusammengestellte Formation inklusive Stammdaten-Vorlagen wird automatisch als Verdichtung gespeichert.',
  debtorCode:
    'Debitorencode (EVU/Abrechnung) gemäß nationaler Vorgaben.',
  distributionList:
    'Distributionsliste für die Bestellung (Empfängerkreis, IDs oder Kürzel).',
  freeProcessingReason:
    'Grund für kostenlose Bearbeitung, z. B. Path Modification aufgrund einer Path Alteration.',
};
