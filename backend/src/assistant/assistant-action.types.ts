import type {
  OperationalPoint,
  OpReplacementStopLink,
  PersonnelSite,
  ReplacementEdge,
  ReplacementRoute,
  ReplacementStop,
  SectionOfLine,
  TransferEdge,
} from '../planning/planning.types';

export type AssistantActionRefreshHint = 'topology' | 'simulations' | 'timetable-years';

export type AssistantActionTopologyScope =
  | 'operationalPoints'
  | 'sectionsOfLine'
  | 'personnelSites'
  | 'replacementStops'
  | 'replacementRoutes'
  | 'replacementEdges'
  | 'opReplacementStopLinks'
  | 'transferEdges';

export type AssistantActionCommitTask =
  | {
      type: 'timetableYear';
      action: 'create' | 'delete';
      label: string;
    }
  | {
      type: 'simulation';
      action: 'create' | 'update' | 'delete';
      variantId?: string;
      timetableYearLabel?: string;
      targetLabel?: string;
      targetTimetableYearLabel?: string;
      label?: string;
      description?: string | null;
    }
  | {
      type: 'topology';
      scope: AssistantActionTopologyScope;
      items: Array<
        | OperationalPoint
        | SectionOfLine
        | PersonnelSite
        | ReplacementStop
        | ReplacementRoute
        | ReplacementEdge
        | OpReplacementStopLink
        | TransferEdge
      >;
    };
