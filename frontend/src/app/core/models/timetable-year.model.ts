export interface TimetableYearBounds {
  /** Label such as "2023/24". */
  label: string;
  /** Start of the timetable year (local timezone). */
  start: Date;
  /** Inclusive end of the timetable year (local timezone). */
  end: Date;
  /** ISO string for the start date (YYYY-MM-DD). */
  startIso: string;
  /** ISO string for the inclusive end date (YYYY-MM-DD). */
  endIso: string;
  /** Calendar year in which the timetable year starts (December). */
  startYear: number;
  /** Calendar year in which the timetable year ends. */
  endYear: number;
}

export interface TimetableYearRecord {
  /** Internal identifier (UI list handling). */
  id: string;
  /** Display label, e.g. "2024/25". */
  label: string;
  /** Inclusive ISO start date (YYYY-MM-DD). */
  startIso: string;
  /** Inclusive ISO end date (YYYY-MM-DD). */
  endIso: string;
  /** Optional description shown in the Stammdaten UI. */
  description?: string;
}
