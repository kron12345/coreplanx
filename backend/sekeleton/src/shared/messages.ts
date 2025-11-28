export type LodMode = 'activity' | 'service';

export interface ViewportChangedPayload {
  from: string;
  to: string;
  lod: LodMode;
  paddingHours?: number;
}

export interface ActivityUpdateRequestPayload {
  requestId: string;
  activityId: string;
  newStart: string;
  newEnd: string | null;
}

export type ClientToServerMessage =
  | { type: 'VIEWPORT_CHANGED'; payload: ViewportChangedPayload }
  | { type: 'ACTIVITY_UPDATE_REQUEST'; payload: ActivityUpdateRequestPayload }
  | { type: 'ACTIVITY_HOVERED'; payload: { activityId: string } }
  | { type: 'ACTIVITY_HOVER_LEFT'; payload: { activityId: string } }
  | { type: 'ACTIVITY_SELECTED'; payload: { activityId: string } };

export type ServerToClientMessage =
  | { type: 'ACTIVITY_UPDATE_ACCEPTED'; payload: { requestId: string; activityId: string } }
  | {
      type: 'ACTIVITY_UPDATE_VALIDATION_RESULT';
      payload: {
        requestId: string;
        activityId: string;
        status: 'OK' | 'ERROR';
        errors?: Array<{ code: string; message: string }>;
      };
    }
  | { type: 'ACTIVITY_CREATED'; payload: ActivityDto }
  | { type: 'ACTIVITY_UPDATED'; payload: ActivityDto }
  | { type: 'ACTIVITY_DELETED'; payload: { id: string } }
  | { type: 'SERVICE_UPDATED'; payload: ServiceDto }
  | { type: 'ABSENCE_UPDATED'; payload: ServiceDto };

export interface ActivityDto {
  id: string;
  type: string;
  label: string;
  start: string;
  end: string | null;
  status: string;
  attributes: Record<string, unknown>;
  resourceAssignments: Array<{
    resourceId: string;
    resourceType: string;
    role?: string;
    lineIndex?: number;
  }>;
}

export interface ServiceDto {
  id: string;
  type: 'SERVICE' | 'ABSENCE';
  resourceId: string;
  start: string;
  end: string | null;
  label: string;
  status: string;
  attributes?: Record<string, unknown>;
}
