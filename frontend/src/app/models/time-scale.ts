export type ZoomLevel =
  | 'year'
  | 'quarter'
  | '2month'
  | 'month'
  | '2week'
  | 'week'
  | '3day'
  | 'day'
  | '12hour'
  | '6hour'
  | '3hour'
  | 'hour'
  | '30min'
  | '15min'
  | '10min'
  | '5min';

export interface Tick {
  time: Date;
  label: string;
  majorLabel?: string;
  minorLabel?: string;
  widthPx: number;
  offsetPx: number;
  index: number;
  isMajor?: boolean;
  isWeekend?: boolean;
  isNow?: boolean;
}
