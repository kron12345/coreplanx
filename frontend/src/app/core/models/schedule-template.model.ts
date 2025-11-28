export type ScheduleTemplateStatus = 'draft' | 'active' | 'archived';

export type ScheduleTemplateCategory =
  | 'S-Bahn'
  | 'RegionalExpress'
  | 'Fernverkehr'
  | 'Güterverkehr'
  | 'Sonderverkehr';

export type ScheduleTemplateDay =
  | 'Mo'
  | 'Di'
  | 'Mi'
  | 'Do'
  | 'Fr'
  | 'Sa'
  | 'So';

export interface ScheduleTemplateTimingWindow {
  earliest?: string; // HH:mm
  latest?: string; // HH:mm
}

export interface ScheduleTemplateStop {
  id: string;
  sequence: number;
  type: 'origin' | 'intermediate' | 'destination';
  locationCode: string;
  locationName: string;
  countryCode?: string;
  arrival?: ScheduleTemplateTimingWindow;
  departure?: ScheduleTemplateTimingWindow;
  offsetDays?: number;
  dwellMinutes?: number;
  activities: string[];
  platformWish?: string;
  notes?: string;
}

export interface ScheduleTemplateVehicleUnit {
  type: string;
  count: number;
  label?: string;
  note?: string;
}

export interface ScheduleTemplateCompositionChange {
  stopIndex: number;
  action: 'attach' | 'detach';
  vehicles: ScheduleTemplateVehicleUnit[];
  note?: string;
}

export interface ScheduleTemplateComposition {
  base: ScheduleTemplateVehicleUnit[];
  changes: ScheduleTemplateCompositionChange[];
}

export interface ScheduleTemplateRecurrence {
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  intervalMinutes: number;
  days: ScheduleTemplateDay[];
}

export interface ScheduleTemplate {
  id: string;
  title: string;
  description?: string;
  trainNumber: string;
  responsibleRu: string;
  status: ScheduleTemplateStatus;
  category: ScheduleTemplateCategory;
  tags?: string[];
  validity: {
    startDate: string; // ISO date
    endDate?: string; // ISO date
  };
  createdAt: string; // ISO datetime
  updatedAt: string; // ISO datetime
  stops: ScheduleTemplateStop[];
  recurrence?: ScheduleTemplateRecurrence;
  composition?: ScheduleTemplateComposition;
}
