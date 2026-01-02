import type { AssistantActionChangeDto } from './assistant.dto';
import type { ActionApplyOutcome, ActionContext, ActionPayload } from './assistant-action.engine.types';
import type { ResourceSnapshot, TransferEdge } from '../planning/planning.types';
import { AssistantActionTopologyBase, TRANSFER_MODES } from './assistant-action.topology.base';

export class AssistantActionTopologyTransfers extends AssistantActionTopologyBase {
  buildTransferEdgePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.transferEdges ?? payload.transferEdge ?? payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse('Mindestens eine Transfer Edge wird benötigt.');
    }

    const state = this.ensureTopologyState(context);
    const edges: TransferEdge[] = [];
    const changes: AssistantActionChangeDto[] = [];
    const usedIds = new Set<string>();

    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const record = this.asRecord(raw) ?? {};

      const fromResult = this.parseTransferNode(record['from'], state, {
        applyPath: ['transferEdges', index, 'from'],
      });
      if (fromResult.clarification) {
        return this.buildClarificationResponse(fromResult.clarification, context);
      }
      if (fromResult.feedback || !fromResult.node) {
        return this.buildFeedbackResponse(fromResult.feedback ?? 'Transfer-Knoten fehlt.');
      }
      const toResult = this.parseTransferNode(record['to'], state, {
        applyPath: ['transferEdges', index, 'to'],
      });
      if (toResult.clarification) {
        return this.buildClarificationResponse(toResult.clarification, context);
      }
      if (toResult.feedback || !toResult.node) {
        return this.buildFeedbackResponse(toResult.feedback ?? 'Transfer-Knoten fehlt.');
      }

      if (this.transferNodesEqual(fromResult.node, toResult.node)) {
        return this.buildFeedbackResponse('Transfer Edge darf keinen Selbst-Loop haben.');
      }

      const modeRaw = this.cleanText(record['mode'])?.toUpperCase() ?? '';
      if (!TRANSFER_MODES.has(modeRaw)) {
        return this.buildFeedbackResponse('Transfer Edge: Modus ist ungültig.');
      }

      const transferId =
        this.cleanText(record['transferId']) ??
        this.cleanText(record['id']) ??
        this.generateId('TR');
      if (
        usedIds.has(transferId) ||
        state.transferEdges.some((entry) => entry.transferId === transferId)
      ) {
        return this.buildFeedbackResponse(`Transfer Edge "${transferId}" existiert bereits.`);
      }

      const avgDurationSec = this.parseNumber(record['avgDurationSec']);
      if (record['avgDurationSec'] !== undefined && avgDurationSec === undefined) {
        return this.buildFeedbackResponse('Transfer Edge: Dauer ist ungültig.');
      }
      const distanceM = this.parseNumber(record['distanceM']);
      if (record['distanceM'] !== undefined && distanceM === undefined) {
        return this.buildFeedbackResponse('Transfer Edge: Distanz ist ungültig.');
      }
      const bidirectional = this.parseBoolean(record['bidirectional']) ?? false;

      const edge: TransferEdge = {
        transferId,
        from: fromResult.node,
        to: toResult.node,
        mode: modeRaw as TransferEdge['mode'],
        avgDurationSec,
        distanceM,
        bidirectional,
      };
      edges.push(edge);
      usedIds.add(transferId);
      changes.push({
        kind: 'create',
        entityType: 'transferEdge',
        id: edge.transferId,
        label: edge.transferId,
      });
    }

    state.transferEdges = [...state.transferEdges, ...edges];
    const commitTasks = this.buildTopologyCommitTasksForState(['transferEdges'], state);
    const summary =
      edges.length === 1
        ? `Transfer Edge "${edges[0].transferId}" angelegt.`
        : `Transfer Edges angelegt (${edges.length}).`;

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  buildUpdateTransferEdgePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['transferEdge']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Transfer Edge fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const transferId =
      this.cleanText(targetRecord['transferId']) ??
      this.cleanText(targetRecord['id']);
    if (!transferId) {
      return this.buildFeedbackResponse('Transfer Edge ID fehlt.');
    }
    const edge = state.transferEdges.find((entry) => entry.transferId === transferId);
    if (!edge) {
      return this.buildFeedbackResponse('Transfer Edge nicht gefunden.');
    }

    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const updated: TransferEdge = { ...edge };
    let changed = false;

    if (this.hasOwn(patch, 'from')) {
      const fromResult = this.parseTransferNode(patch['from'], state, {
        applyPath: ['patch', 'from'],
      });
      if (fromResult.clarification) {
        return this.buildClarificationResponse(fromResult.clarification, context);
      }
      if (fromResult.feedback || !fromResult.node) {
        return this.buildFeedbackResponse(fromResult.feedback ?? 'Transfer-Knoten fehlt.');
      }
      updated.from = fromResult.node;
      changed = true;
    }
    if (this.hasOwn(patch, 'to')) {
      const toResult = this.parseTransferNode(patch['to'], state, {
        applyPath: ['patch', 'to'],
      });
      if (toResult.clarification) {
        return this.buildClarificationResponse(toResult.clarification, context);
      }
      if (toResult.feedback || !toResult.node) {
        return this.buildFeedbackResponse(toResult.feedback ?? 'Transfer-Knoten fehlt.');
      }
      updated.to = toResult.node;
      changed = true;
    }
    if (this.transferNodesEqual(updated.from, updated.to)) {
      return this.buildFeedbackResponse('Transfer Edge darf keinen Selbst-Loop haben.');
    }

    if (this.hasOwn(patch, 'mode')) {
      const modeRaw = this.cleanText(patch['mode'])?.toUpperCase() ?? '';
      if (!TRANSFER_MODES.has(modeRaw)) {
        return this.buildFeedbackResponse('Modus ist ungültig.');
      }
      updated.mode = modeRaw as TransferEdge['mode'];
      changed = true;
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
    if (this.hasOwn(patch, 'bidirectional')) {
      updated.bidirectional = this.parseBoolean(patch['bidirectional']) ?? false;
      changed = true;
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    state.transferEdges = state.transferEdges.map((entry) =>
      entry.transferId === edge.transferId ? updated : entry,
    );
    const commitTasks = this.buildTopologyCommitTasksForState(['transferEdges'], state);
    const summary = `Transfer Edge "${updated.transferId}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'update', entityType: 'transferEdge', id: updated.transferId, label: updated.transferId },
    ];

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  buildDeleteTransferEdgePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['transferEdge']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Transfer Edge fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const transferId =
      this.cleanText(targetRecord['transferId']) ??
      this.cleanText(targetRecord['id']);
    if (!transferId) {
      return this.buildFeedbackResponse('Transfer Edge ID fehlt.');
    }
    const edge = state.transferEdges.find((entry) => entry.transferId === transferId);
    if (!edge) {
      return this.buildFeedbackResponse('Transfer Edge nicht gefunden.');
    }

    state.transferEdges = state.transferEdges.filter(
      (entry) => entry.transferId !== edge.transferId,
    );

    const commitTasks = this.buildTopologyCommitTasksForState(['transferEdges'], state);
    const summary = `Transfer Edge "${edge.transferId}" gelöscht.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'delete', entityType: 'transferEdge', id: edge.transferId, label: edge.transferId },
    ];

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }
}
