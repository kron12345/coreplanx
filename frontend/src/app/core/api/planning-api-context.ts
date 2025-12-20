export interface PlanningApiContext {
  /**
   * Planning variant/simulation id. Defaults to "default" on the backend.
   */
  variantId?: string | null;
  /**
   * Optional timetable year label (e.g. "2029/30") used for initial stage metadata.
   */
  timetableYearLabel?: string | null;
}

