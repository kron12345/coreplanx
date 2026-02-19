import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  OrderingAggregatedPhaseSnapshot,
  OrderingOperationalContext,
  OrderingRequiredAttributeStatus,
  OrderingActor,
  OrderingProcessProfileId,
} from './timetable-ordering.types';

type MaybeDate = string | Date;

interface CaseRow {
  id: string;
  profile_id: string;
  title: string;
  description: string | null;
  train_plan_id: string | null;
  valid_from: MaybeDate;
  valid_to: MaybeDate;
  path_request_id: string | null;
  path_id: string | null;
  current_state: string;
  is_terminal: boolean;
  required_attributes: unknown;
  provided_attributes: unknown;
  blocking_reasons: unknown;
  operational_contexts: unknown;
  aggregated_phase: unknown;
  created_at: MaybeDate;
  updated_at: MaybeDate;
}

interface MessageRow {
  id: string;
  case_id: string;
  direction: 'outbound' | 'inbound' | 'internal';
  source: string;
  actor: OrderingActor;
  message_type: number | null;
  message_status: number | null;
  type_of_request: number | null;
  type_of_information: number | null;
  event_key: string;
  external_message_id: string | null;
  correlation_key: string | null;
  payload: unknown;
  created_at: MaybeDate;
}

interface TransitionRow {
  id: string;
  case_id: string;
  from_state: string;
  to_state: string;
  event_key: string;
  source: string;
  action_id: string | null;
  rejected: boolean;
  reason: string | null;
  meta: unknown;
  created_at: MaybeDate;
}

export interface TimetableOrderingCaseRecord {
  id: string;
  profileId: OrderingProcessProfileId;
  title: string;
  description?: string | null;
  trainPlanId?: string | null;
  validFrom: string;
  validTo: string;
  pathRequestId?: string | null;
  pathId?: string | null;
  currentState: string;
  isTerminal: boolean;
  requiredAttributes: OrderingRequiredAttributeStatus[];
  providedAttributes: Record<string, unknown>;
  blockingReasons: string[];
  operationalContexts: OrderingOperationalContext[];
  aggregatedPhase: OrderingAggregatedPhaseSnapshot;
  createdAt: string;
  updatedAt: string;
}

export interface TimetableOrderingMessageRecord {
  id: string;
  caseId: string;
  direction: 'outbound' | 'inbound' | 'internal';
  source: string;
  actor: OrderingActor;
  messageType?: number | null;
  messageStatus?: number | null;
  typeOfRequest?: number | null;
  typeOfInformation?: number | null;
  eventKey: string;
  externalMessageId?: string | null;
  correlationKey?: string | null;
  payload?: Record<string, unknown> | null;
  createdAt: string;
}

export interface TimetableOrderingTransitionRecord {
  id: string;
  caseId: string;
  fromState: string;
  toState: string;
  eventKey: string;
  source: string;
  actionId?: string | null;
  rejected: boolean;
  reason?: string | null;
  meta?: Record<string, unknown> | null;
  createdAt: string;
}

export interface CreateTimetableOrderingCaseInput {
  id: string;
  profileId: OrderingProcessProfileId;
  title: string;
  description?: string | null;
  trainPlanId?: string | null;
  validFrom: string;
  validTo: string;
  pathRequestId?: string | null;
  pathId?: string | null;
  currentState: string;
  isTerminal: boolean;
  requiredAttributes: OrderingRequiredAttributeStatus[];
  providedAttributes: Record<string, unknown>;
  blockingReasons: string[];
  operationalContexts: OrderingOperationalContext[];
  aggregatedPhase: OrderingAggregatedPhaseSnapshot;
}

export interface UpdateTimetableOrderingCaseInput {
  id: string;
  pathRequestId?: string | null;
  pathId?: string | null;
  currentState: string;
  isTerminal: boolean;
  requiredAttributes: OrderingRequiredAttributeStatus[];
  providedAttributes: Record<string, unknown>;
  blockingReasons: string[];
  operationalContexts: OrderingOperationalContext[];
  aggregatedPhase: OrderingAggregatedPhaseSnapshot;
}

@Injectable()
export class TimetableOrderingRepository {
  constructor(private readonly database: DatabaseService) {}

  private get isEnabled(): boolean {
    return this.database.enabled;
  }

  async listCases(): Promise<TimetableOrderingCaseRecord[]> {
    if (!this.isEnabled) {
      return [];
    }
    const result = await this.database.query<CaseRow>(
      `
        SELECT
          id,
          profile_id,
          title,
          description,
          train_plan_id,
          valid_from,
          valid_to,
          path_request_id,
          path_id,
          current_state,
          is_terminal,
          required_attributes,
          provided_attributes,
          blocking_reasons,
          operational_contexts,
          aggregated_phase,
          created_at,
          updated_at
        FROM timetable_ordering_case
        ORDER BY updated_at DESC, id DESC
      `,
    );
    return result.rows.map((row) => this.mapCaseRow(row));
  }

  async getCaseById(caseId: string): Promise<TimetableOrderingCaseRecord | null> {
    if (!this.isEnabled) {
      return null;
    }
    const result = await this.database.query<CaseRow>(
      `
        SELECT
          id,
          profile_id,
          title,
          description,
          train_plan_id,
          valid_from,
          valid_to,
          path_request_id,
          path_id,
          current_state,
          is_terminal,
          required_attributes,
          provided_attributes,
          blocking_reasons,
          operational_contexts,
          aggregated_phase,
          created_at,
          updated_at
        FROM timetable_ordering_case
        WHERE id = $1
      `,
      [caseId],
    );
    const row = result.rows[0];
    return row ? this.mapCaseRow(row) : null;
  }

  async createCase(
    input: CreateTimetableOrderingCaseInput,
  ): Promise<TimetableOrderingCaseRecord> {
    if (!this.isEnabled) {
      throw new Error('Database connection not configured');
    }
    const result = await this.database.query<CaseRow>(
      `
        INSERT INTO timetable_ordering_case (
          id,
          profile_id,
          title,
          description,
          train_plan_id,
          valid_from,
          valid_to,
          path_request_id,
          path_id,
          current_state,
          is_terminal,
          required_attributes,
          provided_attributes,
          blocking_reasons,
          operational_contexts,
          aggregated_phase
        ) VALUES (
          $1, $2, $3, $4, $5, $6::date, $7::date, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb
        )
        RETURNING
          id,
          profile_id,
          title,
          description,
          train_plan_id,
          valid_from,
          valid_to,
          path_request_id,
          path_id,
          current_state,
          is_terminal,
          required_attributes,
          provided_attributes,
          blocking_reasons,
          operational_contexts,
          aggregated_phase,
          created_at,
          updated_at
      `,
      [
        input.id,
        input.profileId,
        input.title,
        input.description ?? null,
        input.trainPlanId ?? null,
        input.validFrom,
        input.validTo,
        input.pathRequestId ?? null,
        input.pathId ?? null,
        input.currentState,
        input.isTerminal,
        JSON.stringify(input.requiredAttributes),
        JSON.stringify(input.providedAttributes),
        JSON.stringify(input.blockingReasons),
        JSON.stringify(input.operationalContexts),
        JSON.stringify(input.aggregatedPhase),
      ],
    );
    return this.mapCaseRow(result.rows[0]);
  }

  async updateCase(
    input: UpdateTimetableOrderingCaseInput,
  ): Promise<TimetableOrderingCaseRecord> {
    if (!this.isEnabled) {
      throw new Error('Database connection not configured');
    }
    const result = await this.database.query<CaseRow>(
      `
        UPDATE timetable_ordering_case
        SET
          path_request_id = COALESCE($2, path_request_id),
          path_id = COALESCE($3, path_id),
          current_state = $4,
          is_terminal = $5,
          required_attributes = $6::jsonb,
          provided_attributes = $7::jsonb,
          blocking_reasons = $8::jsonb,
          operational_contexts = $9::jsonb,
          aggregated_phase = $10::jsonb,
          updated_at = now()
        WHERE id = $1
        RETURNING
          id,
          profile_id,
          title,
          description,
          train_plan_id,
          valid_from,
          valid_to,
          path_request_id,
          path_id,
          current_state,
          is_terminal,
          required_attributes,
          provided_attributes,
          blocking_reasons,
          operational_contexts,
          aggregated_phase,
          created_at,
          updated_at
      `,
      [
        input.id,
        input.pathRequestId ?? null,
        input.pathId ?? null,
        input.currentState,
        input.isTerminal,
        JSON.stringify(input.requiredAttributes),
        JSON.stringify(input.providedAttributes),
        JSON.stringify(input.blockingReasons),
        JSON.stringify(input.operationalContexts),
        JSON.stringify(input.aggregatedPhase),
      ],
    );
    return this.mapCaseRow(result.rows[0]);
  }

  async appendMessage(input: {
    id: string;
    caseId: string;
    direction: 'outbound' | 'inbound' | 'internal';
    source: string;
    actor: OrderingActor;
    messageType?: number | null;
    messageStatus?: number | null;
    typeOfRequest?: number | null;
    typeOfInformation?: number | null;
    eventKey: string;
    externalMessageId?: string | null;
    correlationKey?: string | null;
    payload?: Record<string, unknown> | null;
  }): Promise<TimetableOrderingMessageRecord> {
    if (!this.isEnabled) {
      throw new Error('Database connection not configured');
    }
    const result = await this.database.query<MessageRow>(
      `
        INSERT INTO timetable_ordering_message (
          id,
          case_id,
          direction,
          source,
          actor,
          message_type,
          message_status,
          type_of_request,
          type_of_information,
          event_key,
          external_message_id,
          correlation_key,
          payload
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb
        )
        RETURNING
          id,
          case_id,
          direction,
          source,
          actor,
          message_type,
          message_status,
          type_of_request,
          type_of_information,
          event_key,
          external_message_id,
          correlation_key,
          payload,
          created_at
      `,
      [
        input.id,
        input.caseId,
        input.direction,
        input.source,
        input.actor,
        input.messageType ?? null,
        input.messageStatus ?? null,
        input.typeOfRequest ?? null,
        input.typeOfInformation ?? null,
        input.eventKey,
        input.externalMessageId ?? null,
        input.correlationKey ?? null,
        JSON.stringify(input.payload ?? null),
      ],
    );
    return this.mapMessageRow(result.rows[0]);
  }

  async listMessages(caseId: string): Promise<TimetableOrderingMessageRecord[]> {
    if (!this.isEnabled) {
      return [];
    }
    const result = await this.database.query<MessageRow>(
      `
        SELECT
          id,
          case_id,
          direction,
          source,
          actor,
          message_type,
          message_status,
          type_of_request,
          type_of_information,
          event_key,
          external_message_id,
          correlation_key,
          payload,
          created_at
        FROM timetable_ordering_message
        WHERE case_id = $1
        ORDER BY created_at DESC, id DESC
      `,
      [caseId],
    );
    return result.rows.map((row) => this.mapMessageRow(row));
  }

  async getMessageByExternalMessageId(
    caseId: string,
    externalMessageId: string,
  ): Promise<TimetableOrderingMessageRecord | null> {
    if (!this.isEnabled) {
      return null;
    }
    const result = await this.database.query<MessageRow>(
      `
        SELECT
          id,
          case_id,
          direction,
          source,
          actor,
          message_type,
          message_status,
          type_of_request,
          type_of_information,
          event_key,
          external_message_id,
          correlation_key,
          payload,
          created_at
        FROM timetable_ordering_message
        WHERE case_id = $1
          AND external_message_id = $2
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `,
      [caseId, externalMessageId],
    );
    const row = result.rows[0];
    return row ? this.mapMessageRow(row) : null;
  }

  async appendTransition(input: {
    id: string;
    caseId: string;
    fromState: string;
    toState: string;
    eventKey: string;
    source: string;
    actionId?: string | null;
    rejected: boolean;
    reason?: string | null;
    meta?: Record<string, unknown> | null;
  }): Promise<TimetableOrderingTransitionRecord> {
    if (!this.isEnabled) {
      throw new Error('Database connection not configured');
    }
    const result = await this.database.query<TransitionRow>(
      `
        INSERT INTO timetable_ordering_transition (
          id,
          case_id,
          from_state,
          to_state,
          event_key,
          source,
          action_id,
          rejected,
          reason,
          meta
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb
        )
        RETURNING
          id,
          case_id,
          from_state,
          to_state,
          event_key,
          source,
          action_id,
          rejected,
          reason,
          meta,
          created_at
      `,
      [
        input.id,
        input.caseId,
        input.fromState,
        input.toState,
        input.eventKey,
        input.source,
        input.actionId ?? null,
        input.rejected,
        input.reason ?? null,
        JSON.stringify(input.meta ?? null),
      ],
    );
    return this.mapTransitionRow(result.rows[0]);
  }

  async listTransitions(caseId: string): Promise<TimetableOrderingTransitionRecord[]> {
    if (!this.isEnabled) {
      return [];
    }
    const result = await this.database.query<TransitionRow>(
      `
        SELECT
          id,
          case_id,
          from_state,
          to_state,
          event_key,
          source,
          action_id,
          rejected,
          reason,
          meta,
          created_at
        FROM timetable_ordering_transition
        WHERE case_id = $1
        ORDER BY created_at DESC, id DESC
      `,
      [caseId],
    );
    return result.rows.map((row) => this.mapTransitionRow(row));
  }

  private mapCaseRow(row: CaseRow): TimetableOrderingCaseRecord {
    return {
      id: row.id,
      profileId: row.profile_id as OrderingProcessProfileId,
      title: row.title,
      description: row.description,
      trainPlanId: row.train_plan_id,
      validFrom: this.toDateOnly(row.valid_from),
      validTo: this.toDateOnly(row.valid_to),
      pathRequestId: row.path_request_id,
      pathId: row.path_id,
      currentState: row.current_state,
      isTerminal: row.is_terminal,
      requiredAttributes: this.toRequiredAttributes(row.required_attributes),
      providedAttributes: this.toObject(row.provided_attributes),
      blockingReasons: this.toStringArray(row.blocking_reasons),
      operationalContexts: this.toOperationalContexts(row.operational_contexts),
      aggregatedPhase: this.toAggregatedPhase(row.aggregated_phase, row.profile_id as OrderingProcessProfileId, row.current_state, row.is_terminal),
      createdAt: this.toIso(row.created_at),
      updatedAt: this.toIso(row.updated_at),
    };
  }

  private mapMessageRow(row: MessageRow): TimetableOrderingMessageRecord {
    return {
      id: row.id,
      caseId: row.case_id,
      direction: row.direction,
      source: row.source,
      actor: row.actor,
      messageType: row.message_type,
      messageStatus: row.message_status,
      typeOfRequest: row.type_of_request,
      typeOfInformation: row.type_of_information,
      eventKey: row.event_key,
      externalMessageId: row.external_message_id,
      correlationKey: row.correlation_key,
      payload: this.toNullableObject(row.payload),
      createdAt: this.toIso(row.created_at),
    };
  }

  private mapTransitionRow(row: TransitionRow): TimetableOrderingTransitionRecord {
    return {
      id: row.id,
      caseId: row.case_id,
      fromState: row.from_state,
      toState: row.to_state,
      eventKey: row.event_key,
      source: row.source,
      actionId: row.action_id,
      rejected: row.rejected,
      reason: row.reason,
      meta: this.toNullableObject(row.meta),
      createdAt: this.toIso(row.created_at),
    };
  }

  private toIso(value: MaybeDate): string {
    if (value instanceof Date) {
      return value.toISOString();
    }
    return new Date(value).toISOString();
  }

  private toDateOnly(value: MaybeDate): string {
    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }
    const asString = value.toString();
    return asString.length >= 10 ? asString.slice(0, 10) : asString;
  }

  private toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map((entry) => `${entry}`);
  }

  private toObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, unknown>;
  }

  private toNullableObject(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private toRequiredAttributes(value: unknown): OrderingRequiredAttributeStatus[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => {
        const row = entry as Partial<OrderingRequiredAttributeStatus>;
        return {
          key: `${row.key ?? ''}`,
          label: `${row.label ?? ''}`,
          scope: row.scope === 'case' ? 'case' : 'provided',
          path: `${row.path ?? ''}`,
          required: row.required !== false,
          missing: Boolean(row.missing),
        };
      });
  }

  private toOperationalContexts(value: unknown): OrderingOperationalContext[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => {
        const row = entry as Partial<OrderingOperationalContext>;
        return {
          timetableYearLabel: `${row.timetableYearLabel ?? ''}`,
          validFrom: `${row.validFrom ?? ''}`,
          validTo: `${row.validTo ?? ''}`,
          state: `${row.state ?? ''}`,
          status: row.status === 'terminal' ? 'terminal' : 'active',
        };
      });
  }

  private toAggregatedPhase(
    value: unknown,
    profileId: OrderingProcessProfileId,
    currentState: string,
    isTerminal: boolean,
  ): OrderingAggregatedPhaseSnapshot {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {
        profileId,
        currentState,
        isTerminal,
      };
    }
    const row = value as Partial<OrderingAggregatedPhaseSnapshot>;
    return {
      profileId,
      currentState,
      isTerminal,
      tttPhase: row.tttPhase ?? null,
      ttrPhase: row.ttrPhase ?? null,
    };
  }
}
