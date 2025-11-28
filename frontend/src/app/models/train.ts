export interface TrainRun {
  id: string;
  /**
   * Öffentliche Zugnummer (z. B. ICE 123).
   */
  trainNumber: string;
  /**
   * Verweis auf den zugrunde liegenden Fahrplan / Timetable.
   */
  timetableId?: string | null;
  /**
   * Freies Attribut-Bag für fahrplanspezifische Daten
   * (Zugkategorie, Produktklasse, Liniennummer usw.).
   */
  attributes?: Record<string, unknown>;
}

export interface TrainSegment {
  id: string;
  /**
   * Zugehöriger Zuglauf.
   */
  trainRunId: string;
  /**
   * Reihenfolge des Abschnitts innerhalb des Zuglaufes (0-basiert oder 1-basiert).
   */
  sectionIndex: number;
  /**
   * Geplanter Startzeitpunkt des Abschnitts (ISO).
   */
  startTime: string;
  /**
   * Geplanter Endzeitpunkt des Abschnitts (ISO).
   */
  endTime: string;
  /**
   * Start- und Zielbetriebsstelle.
   */
  fromLocationId: string;
  toLocationId: string;
  /**
   * Optionaler Fahrweg / Trassen-Identifikator.
   */
  pathId?: string | null;
  /**
   * Optionaler Abschnittslänge in Kilometern.
   */
  distanceKm?: number | null;
  /**
   * Freies Attribut-Bag für zusätzliche Zug-/Infrastrukturinformationen.
   */
  attributes?: Record<string, unknown>;
}

