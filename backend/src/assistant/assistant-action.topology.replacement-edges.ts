import type { AssistantActionChangeDto } from './assistant.dto';
import type {
  ActionApplyOutcome,
  ActionContext,
  ActionPayload,
} from './assistant-action.engine.types';
import type {
  OpReplacementStopLink,
  ReplacementEdge,
  ResourceSnapshot,
} from '../planning/planning.types';
import {
  AssistantActionTopologyBase,
  OP_REPLACEMENT_RELATIONS,
} from './assistant-action.topology.base';

export class AssistantActionTopologyReplacementEdges extends AssistantActionTopologyBase {
  buildReplacementEdgePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.replacementEdges ??
        payload.replacementEdge ??
        payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse(
        'Mindestens eine Replacement Edge wird benötigt.',
      );
    }

    const state = this.ensureTopologyState(context);
    const edges: ReplacementEdge[] = [];
    const changes: AssistantActionChangeDto[] = [];
    const usedIds = new Set<string>();

    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const record = this.asRecord(raw) ?? {};

      const routeRef = this.cleanText(record['replacementRouteId']);
      const fromRef = this.cleanText(record['fromStopId']);
      const toRef = this.cleanText(record['toStopId']);
      if (!routeRef || !fromRef || !toRef) {
        return this.buildFeedbackResponse(
          'Replacement Edge: Route oder Stop fehlt.',
        );
      }

      const routeResult = this.resolveReplacementRouteIdByReference(
        state.replacementRoutes,
        routeRef,
        {
          apply: {
            mode: 'value',
            path: ['replacementEdges', index, 'replacementRouteId'],
          },
        },
      );
      if (routeResult.clarification) {
        return this.buildClarificationResponse(
          routeResult.clarification,
          context,
        );
      }
      if (routeResult.feedback || !routeResult.routeId) {
        return this.buildFeedbackResponse(
          routeResult.feedback ?? 'Replacement Route nicht gefunden.',
        );
      }

      const fromResult = this.resolveReplacementStopIdByReference(
        state.replacementStops,
        fromRef,
        {
          apply: {
            mode: 'value',
            path: ['replacementEdges', index, 'fromStopId'],
          },
        },
      );
      if (fromResult.clarification) {
        return this.buildClarificationResponse(
          fromResult.clarification,
          context,
        );
      }
      if (fromResult.feedback || !fromResult.stopId) {
        return this.buildFeedbackResponse(
          fromResult.feedback ?? 'Replacement Stop nicht gefunden.',
        );
      }
      const toResult = this.resolveReplacementStopIdByReference(
        state.replacementStops,
        toRef,
        {
          apply: {
            mode: 'value',
            path: ['replacementEdges', index, 'toStopId'],
          },
        },
      );
      if (toResult.clarification) {
        return this.buildClarificationResponse(toResult.clarification, context);
      }
      if (toResult.feedback || !toResult.stopId) {
        return this.buildFeedbackResponse(
          toResult.feedback ?? 'Replacement Stop nicht gefunden.',
        );
      }

      if (fromResult.stopId === toResult.stopId) {
        return this.buildFeedbackResponse(
          'Replacement Edge: Start und Ziel dürfen nicht gleich sein.',
        );
      }

      const seqRaw = this.parseNumber(record['seq']);
      if (seqRaw === undefined || !Number.isInteger(seqRaw) || seqRaw <= 0) {
        return this.buildFeedbackResponse(
          'Replacement Edge: Sequenz ist ungültig.',
        );
      }

      const seqConflict = this.assertUniqueReplacementEdgeSeq(
        state.replacementEdges,
        routeResult.routeId,
        seqRaw,
      );
      if (seqConflict) {
        return this.buildFeedbackResponse(seqConflict);
      }

      const edgeId =
        this.cleanText(record['replacementEdgeId']) ??
        this.cleanText(record['id']) ??
        this.generateId('REDGE');
      if (
        usedIds.has(edgeId) ||
        state.replacementEdges.some(
          (entry) => entry.replacementEdgeId === edgeId,
        )
      ) {
        return this.buildFeedbackResponse(
          `Replacement Edge \"${edgeId}\" existiert bereits.`,
        );
      }

      const avgDurationSec = this.parseNumber(record['avgDurationSec']);
      if (
        record['avgDurationSec'] !== undefined &&
        avgDurationSec === undefined
      ) {
        return this.buildFeedbackResponse(
          'Replacement Edge: Dauer ist ungültig.',
        );
      }
      const distanceM = this.parseNumber(record['distanceM']);
      if (record['distanceM'] !== undefined && distanceM === undefined) {
        return this.buildFeedbackResponse(
          'Replacement Edge: Distanz ist ungültig.',
        );
      }

      const edge: ReplacementEdge = {
        replacementEdgeId: edgeId,
        replacementRouteId: routeResult.routeId,
        fromStopId: fromResult.stopId,
        toStopId: toResult.stopId,
        seq: seqRaw,
        avgDurationSec,
        distanceM,
      };
      edges.push(edge);
      usedIds.add(edgeId);
      changes.push({
        kind: 'create',
        entityType: 'replacementEdge',
        id: edge.replacementEdgeId,
        label: `${edge.replacementRouteId} · Seq ${edge.seq}`,
      });
    }

    state.replacementEdges = [...state.replacementEdges, ...edges];
    const commitTasks = this.buildTopologyCommitTasksForState(
      ['replacementEdges'],
      state,
    );
    const summary =
      edges.length === 1
        ? `Replacement Edge \"${edges[0].replacementEdgeId}\" angelegt.`
        : `Replacement Edges angelegt (${edges.length}).`;

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  buildUpdateReplacementEdgePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['replacementEdge']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Replacement Edge fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const edgeResult = this.resolveReplacementEdgeTarget(
      state.replacementEdges,
      targetRecord,
      { apply: { mode: 'target', path: ['target'] } },
    );
    if (edgeResult.clarification) {
      return this.buildClarificationResponse(edgeResult.clarification, context);
    }
    if (edgeResult.feedback || !edgeResult.item) {
      return this.buildFeedbackResponse(
        edgeResult.feedback ?? 'Replacement Edge nicht gefunden.',
      );
    }

    const edge = edgeResult.item;
    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const updated: ReplacementEdge = { ...edge };
    let changed = false;

    let replacementRouteId = edge.replacementRouteId;
    let fromStopId = edge.fromStopId;
    let toStopId = edge.toStopId;
    let seq = edge.seq;

    if (this.hasOwn(patch, 'replacementRouteId')) {
      const routeRef = this.cleanText(patch['replacementRouteId']);
      if (!routeRef) {
        return this.buildFeedbackResponse('Replacement Route fehlt.');
      }
      const routeResult = this.resolveReplacementRouteIdByReference(
        state.replacementRoutes,
        routeRef,
        { apply: { mode: 'value', path: ['patch', 'replacementRouteId'] } },
      );
      if (routeResult.clarification) {
        return this.buildClarificationResponse(
          routeResult.clarification,
          context,
        );
      }
      if (routeResult.feedback || !routeResult.routeId) {
        return this.buildFeedbackResponse(
          routeResult.feedback ?? 'Replacement Route nicht gefunden.',
        );
      }
      replacementRouteId = routeResult.routeId;
      changed = true;
    }

    if (this.hasOwn(patch, 'fromStopId')) {
      const fromRef = this.cleanText(patch['fromStopId']);
      if (!fromRef) {
        return this.buildFeedbackResponse('Start-Stop fehlt.');
      }
      const fromResult = this.resolveReplacementStopIdByReference(
        state.replacementStops,
        fromRef,
        { apply: { mode: 'value', path: ['patch', 'fromStopId'] } },
      );
      if (fromResult.clarification) {
        return this.buildClarificationResponse(
          fromResult.clarification,
          context,
        );
      }
      if (fromResult.feedback || !fromResult.stopId) {
        return this.buildFeedbackResponse(
          fromResult.feedback ?? 'Replacement Stop nicht gefunden.',
        );
      }
      fromStopId = fromResult.stopId;
      changed = true;
    }

    if (this.hasOwn(patch, 'toStopId')) {
      const toRef = this.cleanText(patch['toStopId']);
      if (!toRef) {
        return this.buildFeedbackResponse('Ziel-Stop fehlt.');
      }
      const toResult = this.resolveReplacementStopIdByReference(
        state.replacementStops,
        toRef,
        { apply: { mode: 'value', path: ['patch', 'toStopId'] } },
      );
      if (toResult.clarification) {
        return this.buildClarificationResponse(toResult.clarification, context);
      }
      if (toResult.feedback || !toResult.stopId) {
        return this.buildFeedbackResponse(
          toResult.feedback ?? 'Replacement Stop nicht gefunden.',
        );
      }
      toStopId = toResult.stopId;
      changed = true;
    }

    if (fromStopId === toStopId) {
      return this.buildFeedbackResponse(
        'Start und Ziel dürfen nicht gleich sein.',
      );
    }

    if (this.hasOwn(patch, 'seq')) {
      const seqRaw = this.parseNumber(patch['seq']);
      if (seqRaw === undefined || !Number.isInteger(seqRaw) || seqRaw <= 0) {
        return this.buildFeedbackResponse('Sequenz ist ungültig.');
      }
      seq = seqRaw;
      changed = true;
    }

    const seqConflict = this.assertUniqueReplacementEdgeSeq(
      state.replacementEdges,
      replacementRouteId,
      seq,
      edge.replacementEdgeId,
    );
    if (seqConflict) {
      return this.buildFeedbackResponse(seqConflict);
    }

    if (this.hasOwn(patch, 'avgDurationSec')) {
      const duration = this.parseNumber(patch['avgDurationSec']);
      if (duration === undefined && patch['avgDurationSec'] !== null) {
        return this.buildFeedbackResponse('Dauer ist ungültig.');
      }
      updated.avgDurationSec = duration;
      changed = true;
    }
    if (this.hasOwn(patch, 'distanceM')) {
      const distance = this.parseNumber(patch['distanceM']);
      if (distance === undefined && patch['distanceM'] !== null) {
        return this.buildFeedbackResponse('Distanz ist ungültig.');
      }
      updated.distanceM = distance;
      changed = true;
    }

    updated.replacementRouteId = replacementRouteId;
    updated.fromStopId = fromStopId;
    updated.toStopId = toStopId;
    updated.seq = seq;

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    state.replacementEdges = state.replacementEdges.map((entry) =>
      entry.replacementEdgeId === edge.replacementEdgeId ? updated : entry,
    );
    const commitTasks = this.buildTopologyCommitTasksForState(
      ['replacementEdges'],
      state,
    );
    const summary = `Replacement Edge \"${updated.replacementEdgeId}\" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'update',
        entityType: 'replacementEdge',
        id: updated.replacementEdgeId,
        label: updated.replacementEdgeId,
      },
    ];

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  buildDeleteReplacementEdgePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['replacementEdge']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Replacement Edge fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const edgeResult = this.resolveReplacementEdgeTarget(
      state.replacementEdges,
      targetRecord,
      { apply: { mode: 'target', path: ['target'] } },
    );
    if (edgeResult.clarification) {
      return this.buildClarificationResponse(edgeResult.clarification, context);
    }
    if (edgeResult.feedback || !edgeResult.item) {
      return this.buildFeedbackResponse(
        edgeResult.feedback ?? 'Replacement Edge nicht gefunden.',
      );
    }

    const edge = edgeResult.item;
    state.replacementEdges = state.replacementEdges.filter(
      (entry) => entry.replacementEdgeId !== edge.replacementEdgeId,
    );

    const commitTasks = this.buildTopologyCommitTasksForState(
      ['replacementEdges'],
      state,
    );
    const summary = `Replacement Edge \"${edge.replacementEdgeId}\" gelöscht.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'replacementEdge',
        id: edge.replacementEdgeId,
        label: edge.replacementEdgeId,
      },
    ];

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  buildOpReplacementStopLinkPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.opReplacementStopLinks ??
        payload.opReplacementStopLink ??
        payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse(
        'Mindestens ein OP-Link wird benötigt.',
      );
    }

    const state = this.ensureTopologyState(context);
    const links: OpReplacementStopLink[] = [];
    const changes: AssistantActionChangeDto[] = [];
    const usedIds = new Set<string>();

    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const record = this.asRecord(raw) ?? {};
      const opRef = this.cleanText(record['uniqueOpId']);
      const stopRef = this.cleanText(record['replacementStopId']);
      if (!opRef || !stopRef) {
        return this.buildFeedbackResponse('OP-Link: OP oder Stop fehlt.');
      }
      const opResult = this.resolveOperationalPointUniqueOpIdByReference(
        state.operationalPoints,
        opRef,
        {
          apply: {
            mode: 'value',
            path: ['opReplacementStopLinks', index, 'uniqueOpId'],
          },
        },
      );
      if (opResult.clarification) {
        return this.buildClarificationResponse(opResult.clarification, context);
      }
      if (opResult.feedback || !opResult.uniqueOpId) {
        return this.buildFeedbackResponse(
          opResult.feedback ?? 'Operational Point nicht gefunden.',
        );
      }
      const stopResult = this.resolveReplacementStopIdByReference(
        state.replacementStops,
        stopRef,
        {
          apply: {
            mode: 'value',
            path: ['opReplacementStopLinks', index, 'replacementStopId'],
          },
        },
      );
      if (stopResult.clarification) {
        return this.buildClarificationResponse(
          stopResult.clarification,
          context,
        );
      }
      if (stopResult.feedback || !stopResult.stopId) {
        return this.buildFeedbackResponse(
          stopResult.feedback ?? 'Replacement Stop nicht gefunden.',
        );
      }

      const relationRaw =
        this.cleanText(record['relationType'])?.toUpperCase() ?? '';
      if (!OP_REPLACEMENT_RELATIONS.has(relationRaw)) {
        return this.buildFeedbackResponse('OP-Link: Relation ist ungültig.');
      }

      const linkId =
        this.cleanText(record['linkId']) ??
        this.cleanText(record['id']) ??
        this.generateId('OPLINK');
      if (
        usedIds.has(linkId) ||
        state.opReplacementStopLinks.some((entry) => entry.linkId === linkId)
      ) {
        return this.buildFeedbackResponse(
          `OP-Link \"${linkId}\" existiert bereits.`,
        );
      }

      const uniqueConflict = this.assertUniqueOpReplacementLink(
        state.opReplacementStopLinks,
        opResult.uniqueOpId,
        stopResult.stopId,
      );
      if (uniqueConflict) {
        return this.buildFeedbackResponse(uniqueConflict);
      }

      const walkingTimeSec = this.parseNumber(record['walkingTimeSec']);
      if (
        record['walkingTimeSec'] !== undefined &&
        walkingTimeSec === undefined
      ) {
        return this.buildFeedbackResponse('OP-Link: Fußweg ist ungültig.');
      }
      const distanceM = this.parseNumber(record['distanceM']);
      if (record['distanceM'] !== undefined && distanceM === undefined) {
        return this.buildFeedbackResponse('OP-Link: Distanz ist ungültig.');
      }

      const link: OpReplacementStopLink = {
        linkId,
        uniqueOpId: opResult.uniqueOpId,
        replacementStopId: stopResult.stopId,
        relationType: relationRaw as OpReplacementStopLink['relationType'],
        walkingTimeSec,
        distanceM,
      };
      links.push(link);
      usedIds.add(linkId);
      changes.push({
        kind: 'create',
        entityType: 'opReplacementStopLink',
        id: link.linkId,
        label: `${link.uniqueOpId} -> ${link.replacementStopId}`,
      });
    }

    state.opReplacementStopLinks = [...state.opReplacementStopLinks, ...links];
    const commitTasks = this.buildTopologyCommitTasksForState(
      ['opReplacementStopLinks'],
      state,
    );
    const summary =
      links.length === 1
        ? `OP-Link \"${links[0].linkId}\" angelegt.`
        : `OP-Links angelegt (${links.length}).`;

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  buildUpdateOpReplacementStopLinkPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, [
      'opReplacementStopLink',
    ]);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-OP-Link fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const linkResult = this.resolveOpReplacementStopLinkTarget(
      state.opReplacementStopLinks,
      targetRecord,
      { apply: { mode: 'target', path: ['target'] } },
    );
    if (linkResult.clarification) {
      return this.buildClarificationResponse(linkResult.clarification, context);
    }
    if (linkResult.feedback || !linkResult.item) {
      return this.buildFeedbackResponse(
        linkResult.feedback ?? 'OP-Link nicht gefunden.',
      );
    }

    const link = linkResult.item;
    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const updated: OpReplacementStopLink = { ...link };
    let changed = false;

    let uniqueOpId = link.uniqueOpId;
    let replacementStopId = link.replacementStopId;

    if (this.hasOwn(patch, 'uniqueOpId')) {
      const opRef = this.cleanText(patch['uniqueOpId']);
      if (!opRef) {
        return this.buildFeedbackResponse('OP fehlt.');
      }
      const opResult = this.resolveOperationalPointUniqueOpIdByReference(
        state.operationalPoints,
        opRef,
        { apply: { mode: 'value', path: ['patch', 'uniqueOpId'] } },
      );
      if (opResult.clarification) {
        return this.buildClarificationResponse(opResult.clarification, context);
      }
      if (opResult.feedback || !opResult.uniqueOpId) {
        return this.buildFeedbackResponse(
          opResult.feedback ?? 'Operational Point nicht gefunden.',
        );
      }
      uniqueOpId = opResult.uniqueOpId;
      changed = true;
    }

    if (this.hasOwn(patch, 'replacementStopId')) {
      const stopRef = this.cleanText(patch['replacementStopId']);
      if (!stopRef) {
        return this.buildFeedbackResponse('Replacement Stop fehlt.');
      }
      const stopResult = this.resolveReplacementStopIdByReference(
        state.replacementStops,
        stopRef,
        { apply: { mode: 'value', path: ['patch', 'replacementStopId'] } },
      );
      if (stopResult.clarification) {
        return this.buildClarificationResponse(
          stopResult.clarification,
          context,
        );
      }
      if (stopResult.feedback || !stopResult.stopId) {
        return this.buildFeedbackResponse(
          stopResult.feedback ?? 'Replacement Stop nicht gefunden.',
        );
      }
      replacementStopId = stopResult.stopId;
      changed = true;
    }

    const uniqueConflict = this.assertUniqueOpReplacementLink(
      state.opReplacementStopLinks,
      uniqueOpId,
      replacementStopId,
      link.linkId,
    );
    if (uniqueConflict) {
      return this.buildFeedbackResponse(uniqueConflict);
    }

    if (this.hasOwn(patch, 'relationType')) {
      const relationRaw =
        this.cleanText(patch['relationType'])?.toUpperCase() ?? '';
      if (!OP_REPLACEMENT_RELATIONS.has(relationRaw)) {
        return this.buildFeedbackResponse('Relation ist ungültig.');
      }
      updated.relationType =
        relationRaw as OpReplacementStopLink['relationType'];
      changed = true;
    }

    if (this.hasOwn(patch, 'walkingTimeSec')) {
      const walking = this.parseNumber(patch['walkingTimeSec']);
      if (walking === undefined && patch['walkingTimeSec'] !== null) {
        return this.buildFeedbackResponse('Fußweg ist ungültig.');
      }
      updated.walkingTimeSec = walking;
      changed = true;
    }
    if (this.hasOwn(patch, 'distanceM')) {
      const distance = this.parseNumber(patch['distanceM']);
      if (distance === undefined && patch['distanceM'] !== null) {
        return this.buildFeedbackResponse('Distanz ist ungültig.');
      }
      updated.distanceM = distance;
      changed = true;
    }

    updated.uniqueOpId = uniqueOpId;
    updated.replacementStopId = replacementStopId;

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    state.opReplacementStopLinks = state.opReplacementStopLinks.map((entry) =>
      entry.linkId === link.linkId ? updated : entry,
    );
    const commitTasks = this.buildTopologyCommitTasksForState(
      ['opReplacementStopLinks'],
      state,
    );
    const summary = `OP-Link \"${updated.linkId}\" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'update',
        entityType: 'opReplacementStopLink',
        id: updated.linkId,
        label: updated.linkId,
      },
    ];

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  buildDeleteOpReplacementStopLinkPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, [
      'opReplacementStopLink',
    ]);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-OP-Link fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const linkResult = this.resolveOpReplacementStopLinkTarget(
      state.opReplacementStopLinks,
      targetRecord,
      { apply: { mode: 'target', path: ['target'] } },
    );
    if (linkResult.clarification) {
      return this.buildClarificationResponse(linkResult.clarification, context);
    }
    if (linkResult.feedback || !linkResult.item) {
      return this.buildFeedbackResponse(
        linkResult.feedback ?? 'OP-Link nicht gefunden.',
      );
    }

    const link = linkResult.item;
    state.opReplacementStopLinks = state.opReplacementStopLinks.filter(
      (entry) => entry.linkId !== link.linkId,
    );

    const commitTasks = this.buildTopologyCommitTasksForState(
      ['opReplacementStopLinks'],
      state,
    );
    const summary = `OP-Link "${link.linkId}" gelöscht.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'opReplacementStopLink',
        id: link.linkId,
        label: link.linkId,
      },
    ];

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  private assertUniqueReplacementEdgeSeq(
    edges: ReplacementEdge[],
    routeId: string,
    seq: number,
    ignoreEdgeId?: string,
  ): string | null {
    const conflict = edges.find(
      (edge) =>
        edge.replacementRouteId === routeId &&
        edge.seq === seq &&
        edge.replacementEdgeId !== ignoreEdgeId,
    );
    if (conflict) {
      return `Sequenz ${seq} ist bereits für Route "${routeId}" vergeben.`;
    }
    return null;
  }

  private assertUniqueOpReplacementLink(
    links: OpReplacementStopLink[],
    uniqueOpId: string,
    replacementStopId: string,
    ignoreLinkId?: string,
  ): string | null {
    const conflict = links.find(
      (link) =>
        link.uniqueOpId === uniqueOpId &&
        link.replacementStopId === replacementStopId &&
        link.linkId !== ignoreLinkId,
    );
    if (conflict) {
      return `OP-Link zwischen "${uniqueOpId}" und "${replacementStopId}" existiert bereits.`;
    }
    return null;
  }
}
