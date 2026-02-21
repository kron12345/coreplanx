export type TimetableFormationServiceType = 'tractive_unit' | 'wagon' | 'pwg';

export interface TimetableFormationVehicle {
  entryId: string;
  serviceType: TimetableFormationServiceType;
  code: string;
  label: string;
  source: 'catalog' | 'manual';
  lengthMeters?: number;
  weightTons?: number;
  maxSpeedKph?: number;
}

export interface TimetableOrderingContext {
  /**
   * Raw user input for OTN/Name decision logic.
   * Numeric range 1..99999 maps to operationalTrainNumber, otherwise to trainName.
   */
  otnOrNameInput?: string;
  operationalTrainNumber?: string;
  trainName?: string;
  reasonOfReference?: string;
  validityDate?: string; // ISO date (YYYY-MM-DD)
  validityDates?: string[]; // ISO dates (YYYY-MM-DD), sorted ascending
  trainType?: string;
  trafficTypeCode?: string;
  trafficTypeNetwork?: string;
  serviceType?: TimetableFormationServiceType;
  vehicleFormation?: TimetableFormationVehicle[];
  pwgLengthMeters?: number;
  pwgWeightTons?: number;
  pwgMaxSpeedKph?: number;
  tractionOrPwg?: string;
  debtorCode?: string;
  distributionList?: string;
  freeProcessingReason?: string;
}
