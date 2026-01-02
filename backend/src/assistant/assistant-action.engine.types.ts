import type {
  OperationalPoint,
  OpReplacementStopLink,
  PersonnelSite,
  ReplacementEdge,
  ReplacementRoute,
  ReplacementStop,
  SectionOfLine,
  ResourceSnapshot,
  TransferEdge,
} from '../planning/planning.types';
import type {
  AssistantActionChangeDto,
  AssistantActionPreviewResponseDto,
} from './assistant.dto';
import type { AssistantActionCommitTask, AssistantActionRefreshHint } from './assistant-action.types';
import type { AssistantActionClarificationApply } from './assistant-action-clarification.store';

export type ActionPayload = {
  action?: string;
  schemaVersion?: number;
  reason?: string;
  pool?: unknown;
  poolName?: unknown;
  servicePool?: unknown;
  personnelServicePool?: unknown;
  vehicleServicePool?: unknown;
  personnelPool?: unknown;
  vehiclePool?: unknown;
  homeDepot?: unknown;
  homeDepots?: unknown;
  vehicleType?: unknown;
  vehicleTypes?: unknown;
  vehicleComposition?: unknown;
  vehicleCompositions?: unknown;
  timetableYear?: unknown;
  timetableYears?: unknown;
  simulation?: unknown;
  simulations?: unknown;
  operationalPoint?: unknown;
  operationalPoints?: unknown;
  sectionOfLine?: unknown;
  sectionsOfLine?: unknown;
  personnelSite?: unknown;
  personnelSites?: unknown;
  replacementStop?: unknown;
  replacementStops?: unknown;
  replacementRoute?: unknown;
  replacementRoutes?: unknown;
  replacementEdge?: unknown;
  replacementEdges?: unknown;
  opReplacementStopLink?: unknown;
  opReplacementStopLinks?: unknown;
  transferEdge?: unknown;
  transferEdges?: unknown;
  activityType?: unknown;
  activityTypes?: unknown;
  activityTemplate?: unknown;
  activityTemplates?: unknown;
  activityDefinition?: unknown;
  activityDefinitions?: unknown;
  layerGroup?: unknown;
  layerGroups?: unknown;
  translations?: unknown;
  translation?: unknown;
  locale?: unknown;
  customAttribute?: unknown;
  customAttributes?: unknown;
  service?: unknown;
  services?: unknown;
  personnelService?: unknown;
  vehicleService?: unknown;
  personnel?: unknown;
  person?: unknown;
  people?: unknown;
  vehicles?: unknown;
  vehicle?: unknown;
  target?: unknown;
  patch?: unknown;
  items?: unknown;
  actions?: unknown[];
};

export type ActionApplyAppliedOutcome = {
  type: 'applied';
  snapshot: ResourceSnapshot;
  summary: string;
  changes: AssistantActionChangeDto[];
  commitTasks?: AssistantActionCommitTask[];
  refreshHints?: AssistantActionRefreshHint[];
};

export type ActionApplyFeedbackOutcome = {
  type: 'feedback';
  response: AssistantActionPreviewResponseDto;
};

export type ActionApplyClarificationOutcome = {
  type: 'clarification';
  response: AssistantActionPreviewResponseDto;
};

export type ActionApplyOutcome =
  | ActionApplyAppliedOutcome
  | ActionApplyFeedbackOutcome
  | ActionApplyClarificationOutcome;

export type ClarificationRequest = {
  title: string;
  options: Array<{ id: string; label: string; details?: string }>;
  input?: {
    label?: string;
    placeholder?: string;
    hint?: string;
    minLength?: number;
    maxLength?: number;
  };
  apply: AssistantActionClarificationApply;
};

export type ActionContext = {
  clientId: string | null;
  role: string | null;
  rootPayload: ActionPayload;
  baseSnapshot: ResourceSnapshot;
  baseHash: string;
  pathPrefix: Array<string | number>;
  topologyState?: ActionTopologyState;
};

export type ActionTopologyState = {
  operationalPoints: OperationalPoint[];
  sectionsOfLine: SectionOfLine[];
  personnelSites: PersonnelSite[];
  replacementStops: ReplacementStop[];
  replacementRoutes: ReplacementRoute[];
  replacementEdges: ReplacementEdge[];
  opReplacementStopLinks: OpReplacementStopLink[];
  transferEdges: TransferEdge[];
};
