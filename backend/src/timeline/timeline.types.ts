import type {
  ActivityAttributes,
  ResourceKind,
} from '../planning/planning.types';

export type Lod = 'activity' | 'service';

export interface ResourceAssignmentDto {
  resourceId: string;
  resourceType: ResourceKind;
  role?: string | null;
  lineIndex?: number | null;
}

export interface ActivityVersionData {
  label?: string | null;
  orderId?: string | null;
  serviceId?: string | null;
  serviceRole?: 'start' | 'segment' | 'end' | null;
  start: string;
  end?: string | null;
  status?: string | null;
  from?: string | null;
  to?: string | null;
  remark?: string | null;
  resourceAssignments?: ResourceAssignmentDto[];
  attributes?: ActivityAttributes | null;
}

export interface ActivityDto {
  id: string;
  stage: 'base' | 'operations';
  type: string;
  start: string;
  end?: string | null;
  isOpenEnded: boolean;
  status?: string | null;
  label?: string | null;
  serviceId?: string | null;
  serviceRole?: 'start' | 'segment' | 'end' | null;
  from?: string | null;
  to?: string | null;
  remark?: string | null;
  resourceAssignments: ResourceAssignmentDto[];
  attributes?: ActivityAttributes | null;
  version?: number;
}

export interface TimelineServiceDto {
  id: string;
  type: 'SERVICE' | 'ABSENCE';
  stage: 'base' | 'operations';
  resourceId: string;
  start: string;
  end?: string | null;
  isOpenEnded: boolean;
  status?: string | null;
  label?: string | null;
  attributes?: Record<string, unknown>;
}

export interface TimelineResponse {
  lod: Lod;
  activities?: ActivityDto[];
  services?: TimelineServiceDto[];
}

export interface ViewportChangedPayload {
  from: string;
  to: string;
  lod: Lod;
  paddingHours?: number;
  stage?: 'base' | 'operations';
}

export interface ActivityUpdateRequestPayload {
  requestId: string;
  activityId: string;
  newStart: string;
  newEnd?: string | null;
  stage?: 'base' | 'operations';
}

export type GatewayInboundMessage =
  | { type: 'VIEWPORT_CHANGED'; payload: ViewportChangedPayload & { templateId?: string } }
  | { type: 'ACTIVITY_UPDATE_REQUEST'; payload: ActivityUpdateRequestPayload & { templateId?: string } }
  | { type: 'ACTIVITY_HOVERED'; payload: { activityId: string; userId?: string; at?: string } }
  | { type: 'ACTIVITY_HOVER_LEFT'; payload: { activityId: string; userId?: string; at?: string } }
  | { type: 'ACTIVITY_SELECTED'; payload: { activityId: string; userId?: string; at?: string } };

export type GatewayOutboundMessage =
  | { type: 'ACTIVITY_UPDATE_ACCEPTED'; payload: { requestId: string; activityId: string } }
  | {
      type: 'ACTIVITY_UPDATE_VALIDATION_RESULT';
      payload: {
        requestId: string;
        activityId: string;
        status: 'OK' | 'ERROR';
        errors?: { code: string; message: string }[];
      };
    }
  | { type: 'ACTIVITY_CREATED'; payload: ActivityDto }
  | { type: 'ACTIVITY_UPDATED'; payload: ActivityDto }
  | { type: 'ACTIVITY_DELETED'; payload: { id: string } }
  | { type: 'SERVICE_UPDATED'; payload: TimelineServiceDto }
  | { type: 'ABSENCE_UPDATED'; payload: TimelineServiceDto };

export interface ClientContext {
  subscribedFrom: string;
  subscribedTo: string;
  lod: Lod;
  stage: 'base' | 'operations';
}
