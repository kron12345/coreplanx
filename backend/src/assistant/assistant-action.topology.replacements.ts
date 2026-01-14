import type { AssistantActionChangeDto } from './assistant.dto';
import type {
  ActionApplyOutcome,
  ActionContext,
  ActionPayload,
} from './assistant-action.engine.types';
import type {
  ReplacementRoute,
  ReplacementStop,
  ResourceSnapshot,
} from '../planning/planning.types';
import { AssistantActionTopologyBase } from './assistant-action.topology.base';

export class AssistantActionTopologyReplacements extends AssistantActionTopologyBase {
  buildReplacementStopPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.replacementStops ??
        payload.replacementStop ??
        payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse(
        'Mindestens ein Replacement Stop wird benötigt.',
      );
    }

    const state = this.ensureTopologyState(context);
    const stops: ReplacementStop[] = [];
    const changes: AssistantActionChangeDto[] = [];
    const usedIds = new Set<string>();

    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const record = this.asRecord(raw) ?? {};
      const name =
        this.cleanText(record['name']) ?? this.cleanText(record['label']);
      if (!name) {
        return this.buildFeedbackResponse('Replacement Stop: Name fehlt.');
      }
      const stopId =
        this.cleanText(record['replacementStopId']) ??
        this.cleanText(record['id']) ??
        this.generateId('RSTOP');
      if (
        usedIds.has(stopId) ||
        state.replacementStops.some(
          (entry) => entry.replacementStopId === stopId,
        )
      ) {
        return this.buildFeedbackResponse(
          `Replacement Stop "${name}": ID "${stopId}" ist bereits vergeben.`,
        );
      }

      const positionResult = this.parsePosition(record, 'Replacement Stop');
      if (positionResult.feedback) {
        return this.buildFeedbackResponse(positionResult.feedback);
      }

      let nearestUniqueOpId: string | undefined;
      const nearestRef = this.cleanText(record['nearestUniqueOpId']);
      if (nearestRef) {
        const opResult = this.resolveOperationalPointUniqueOpIdByReference(
          state.operationalPoints,
          nearestRef,
          {
            apply: {
              mode: 'value',
              path: ['replacementStops', index, 'nearestUniqueOpId'],
            },
          },
        );
        if (opResult.clarification) {
          return this.buildClarificationResponse(
            opResult.clarification,
            context,
          );
        }
        if (opResult.feedback) {
          return this.buildFeedbackResponse(opResult.feedback);
        }
        nearestUniqueOpId = opResult.uniqueOpId ?? nearestRef;
      }

      const stop: ReplacementStop = {
        replacementStopId: stopId,
        name,
        stopCode: this.cleanText(record['stopCode']),
        nearestUniqueOpId,
        position: positionResult.position ?? { lat: 0, lng: 0 },
      };
      stops.push(stop);
      usedIds.add(stopId);
      changes.push({
        kind: 'create',
        entityType: 'replacementStop',
        id: stop.replacementStopId,
        label: stop.name,
      });
    }

    state.replacementStops = [...state.replacementStops, ...stops];
    const commitTasks = this.buildTopologyCommitTasksForState(
      ['replacementStops'],
      state,
    );
    const summary =
      stops.length === 1
        ? `Replacement Stop "${stops[0].name}" angelegt.`
        : `Replacement Stops angelegt (${stops.length}).`;

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  buildUpdateReplacementStopPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['replacementStop']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Replacement Stop fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const stopRef =
      this.cleanText(targetRecord['replacementStopId']) ??
      this.cleanText(targetRecord['id']) ??
      this.cleanText(targetRecord['name']) ??
      this.cleanText(targetRecord['label']);
    if (!stopRef) {
      return this.buildFeedbackResponse('Replacement Stop fehlt.');
    }
    const stopResult = this.resolveReplacementStopIdByReference(
      state.replacementStops,
      stopRef,
      { apply: { mode: 'target', path: ['target'] } },
    );
    if (stopResult.clarification) {
      return this.buildClarificationResponse(stopResult.clarification, context);
    }
    if (stopResult.feedback || !stopResult.stopId) {
      return this.buildFeedbackResponse(
        stopResult.feedback ?? 'Replacement Stop nicht gefunden.',
      );
    }

    const stop = state.replacementStops.find(
      (entry) => entry.replacementStopId === stopResult.stopId,
    );
    if (!stop) {
      return this.buildFeedbackResponse('Replacement Stop nicht gefunden.');
    }

    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const updated: ReplacementStop = { ...stop };
    let changed = false;

    if (this.hasOwn(patch, 'name')) {
      const name = this.cleanText(patch['name']);
      if (!name) {
        return this.buildFeedbackResponse('Name darf nicht leer sein.');
      }
      updated.name = name;
      changed = true;
    }
    if (this.hasOwn(patch, 'stopCode')) {
      updated.stopCode = this.cleanText(patch['stopCode']);
      changed = true;
    }
    if (this.hasOwn(patch, 'nearestUniqueOpId')) {
      const opRef = this.cleanText(patch['nearestUniqueOpId']);
      if (opRef) {
        const opResult = this.resolveOperationalPointUniqueOpIdByReference(
          state.operationalPoints,
          opRef,
          { apply: { mode: 'value', path: ['patch', 'nearestUniqueOpId'] } },
        );
        if (opResult.clarification) {
          return this.buildClarificationResponse(
            opResult.clarification,
            context,
          );
        }
        if (opResult.feedback) {
          return this.buildFeedbackResponse(opResult.feedback);
        }
        updated.nearestUniqueOpId = opResult.uniqueOpId ?? opRef;
      } else {
        updated.nearestUniqueOpId = undefined;
      }
      changed = true;
    }
    if (this.hasAnyKey(patch, ['lat', 'lng', 'position'])) {
      const positionResult = this.parsePosition(patch, 'Replacement Stop');
      if (positionResult.feedback) {
        return this.buildFeedbackResponse(positionResult.feedback);
      }
      updated.position = positionResult.position ?? updated.position;
      changed = true;
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    state.replacementStops = state.replacementStops.map((entry) =>
      entry.replacementStopId === stop.replacementStopId ? updated : entry,
    );
    const commitTasks = this.buildTopologyCommitTasksForState(
      ['replacementStops'],
      state,
    );
    const summary = `Replacement Stop "${updated.name}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'update',
        entityType: 'replacementStop',
        id: updated.replacementStopId,
        label: updated.name,
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

  buildDeleteReplacementStopPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['replacementStop']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Replacement Stop fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const stopRef =
      this.cleanText(targetRecord['replacementStopId']) ??
      this.cleanText(targetRecord['id']) ??
      this.cleanText(targetRecord['name']) ??
      this.cleanText(targetRecord['label']);
    if (!stopRef) {
      return this.buildFeedbackResponse('Replacement Stop fehlt.');
    }
    const stopResult = this.resolveReplacementStopIdByReference(
      state.replacementStops,
      stopRef,
      { apply: { mode: 'target', path: ['target'] } },
    );
    if (stopResult.clarification) {
      return this.buildClarificationResponse(stopResult.clarification, context);
    }
    if (stopResult.feedback || !stopResult.stopId) {
      return this.buildFeedbackResponse(
        stopResult.feedback ?? 'Replacement Stop nicht gefunden.',
      );
    }

    const stop = state.replacementStops.find(
      (entry) => entry.replacementStopId === stopResult.stopId,
    );
    if (!stop) {
      return this.buildFeedbackResponse('Replacement Stop nicht gefunden.');
    }

    state.replacementStops = state.replacementStops.filter(
      (entry) => entry.replacementStopId !== stop.replacementStopId,
    );
    const removedEdges = state.replacementEdges.filter(
      (edge) =>
        edge.fromStopId === stop.replacementStopId ||
        edge.toStopId === stop.replacementStopId,
    );
    state.replacementEdges = state.replacementEdges.filter(
      (edge) =>
        edge.fromStopId !== stop.replacementStopId &&
        edge.toStopId !== stop.replacementStopId,
    );
    const removedLinks = state.opReplacementStopLinks.filter(
      (link) => link.replacementStopId === stop.replacementStopId,
    );
    state.opReplacementStopLinks = state.opReplacementStopLinks.filter(
      (link) => link.replacementStopId !== stop.replacementStopId,
    );
    const removedTransfers = state.transferEdges.filter(
      (edge) =>
        this.transferNodeMatches(edge.from, {
          kind: 'REPLACEMENT_STOP',
          replacementStopId: stop.replacementStopId,
        }) ||
        this.transferNodeMatches(edge.to, {
          kind: 'REPLACEMENT_STOP',
          replacementStopId: stop.replacementStopId,
        }),
    );
    state.transferEdges = state.transferEdges.filter(
      (edge) =>
        !this.transferNodeMatches(edge.from, {
          kind: 'REPLACEMENT_STOP',
          replacementStopId: stop.replacementStopId,
        }) &&
        !this.transferNodeMatches(edge.to, {
          kind: 'REPLACEMENT_STOP',
          replacementStopId: stop.replacementStopId,
        }),
    );

    const commitTasks = this.buildTopologyCommitTasksForState(
      [
        'replacementStops',
        'replacementEdges',
        'opReplacementStopLinks',
        'transferEdges',
      ],
      state,
    );
    const details: string[] = [];
    if (removedEdges.length) {
      details.push(`${removedEdges.length} Replacement Edges entfernt`);
    }
    if (removedLinks.length) {
      details.push(`${removedLinks.length} OP-Links entfernt`);
    }
    if (removedTransfers.length) {
      details.push(`${removedTransfers.length} Transfer Edges entfernt`);
    }
    const summary = details.length
      ? `Replacement Stop "${stop.name}" gelöscht (${details.join(', ')}).`
      : `Replacement Stop "${stop.name}" gelöscht.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'replacementStop',
        id: stop.replacementStopId,
        label: stop.name,
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

  buildReplacementRoutePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.replacementRoutes ??
        payload.replacementRoute ??
        payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse(
        'Mindestens eine Replacement Route wird benötigt.',
      );
    }

    const state = this.ensureTopologyState(context);
    const routes: ReplacementRoute[] = [];
    const changes: AssistantActionChangeDto[] = [];
    const usedIds = new Set<string>();

    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const record = this.asRecord(raw) ?? {};
      const name =
        this.cleanText(record['name']) ?? this.cleanText(record['label']);
      if (!name) {
        return this.buildFeedbackResponse('Replacement Route: Name fehlt.');
      }
      const routeId =
        this.cleanText(record['replacementRouteId']) ??
        this.cleanText(record['id']) ??
        this.generateId('RROUTE');
      if (
        usedIds.has(routeId) ||
        state.replacementRoutes.some(
          (entry) => entry.replacementRouteId === routeId,
        )
      ) {
        return this.buildFeedbackResponse(
          `Replacement Route "${name}": ID "${routeId}" ist bereits vergeben.`,
        );
      }

      const route: ReplacementRoute = {
        replacementRouteId: routeId,
        name,
        operator: this.cleanText(record['operator']),
      };
      routes.push(route);
      usedIds.add(routeId);
      changes.push({
        kind: 'create',
        entityType: 'replacementRoute',
        id: route.replacementRouteId,
        label: route.name,
      });
    }

    state.replacementRoutes = [...state.replacementRoutes, ...routes];
    const commitTasks = this.buildTopologyCommitTasksForState(
      ['replacementRoutes'],
      state,
    );
    const summary =
      routes.length === 1
        ? `Replacement Route "${routes[0].name}" angelegt.`
        : `Replacement Routes angelegt (${routes.length}).`;

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  buildUpdateReplacementRoutePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, [
      'replacementRoute',
    ]);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Replacement Route fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const routeRef =
      this.cleanText(targetRecord['replacementRouteId']) ??
      this.cleanText(targetRecord['id']) ??
      this.cleanText(targetRecord['name']) ??
      this.cleanText(targetRecord['label']);
    if (!routeRef) {
      return this.buildFeedbackResponse('Replacement Route fehlt.');
    }
    const routeResult = this.resolveReplacementRouteIdByReference(
      state.replacementRoutes,
      routeRef,
      { apply: { mode: 'target', path: ['target'] } },
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

    const route = state.replacementRoutes.find(
      (entry) => entry.replacementRouteId === routeResult.routeId,
    );
    if (!route) {
      return this.buildFeedbackResponse('Replacement Route nicht gefunden.');
    }

    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const updated: ReplacementRoute = { ...route };
    let changed = false;

    if (this.hasOwn(patch, 'name')) {
      const name = this.cleanText(patch['name']);
      if (!name) {
        return this.buildFeedbackResponse('Name darf nicht leer sein.');
      }
      updated.name = name;
      changed = true;
    }
    if (this.hasOwn(patch, 'operator')) {
      updated.operator = this.cleanText(patch['operator']);
      changed = true;
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    state.replacementRoutes = state.replacementRoutes.map((entry) =>
      entry.replacementRouteId === route.replacementRouteId ? updated : entry,
    );
    const commitTasks = this.buildTopologyCommitTasksForState(
      ['replacementRoutes'],
      state,
    );
    const summary = `Replacement Route "${updated.name}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'update',
        entityType: 'replacementRoute',
        id: updated.replacementRouteId,
        label: updated.name,
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

  buildDeleteReplacementRoutePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, [
      'replacementRoute',
    ]);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Replacement Route fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const routeRef =
      this.cleanText(targetRecord['replacementRouteId']) ??
      this.cleanText(targetRecord['id']) ??
      this.cleanText(targetRecord['name']) ??
      this.cleanText(targetRecord['label']);
    if (!routeRef) {
      return this.buildFeedbackResponse('Replacement Route fehlt.');
    }
    const routeResult = this.resolveReplacementRouteIdByReference(
      state.replacementRoutes,
      routeRef,
      { apply: { mode: 'target', path: ['target'] } },
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

    const route = state.replacementRoutes.find(
      (entry) => entry.replacementRouteId === routeResult.routeId,
    );
    if (!route) {
      return this.buildFeedbackResponse('Replacement Route nicht gefunden.');
    }

    state.replacementRoutes = state.replacementRoutes.filter(
      (entry) => entry.replacementRouteId !== route.replacementRouteId,
    );
    const removedEdges = state.replacementEdges.filter(
      (edge) => edge.replacementRouteId === route.replacementRouteId,
    );
    state.replacementEdges = state.replacementEdges.filter(
      (edge) => edge.replacementRouteId !== route.replacementRouteId,
    );

    const commitTasks = this.buildTopologyCommitTasksForState(
      ['replacementRoutes', 'replacementEdges'],
      state,
    );
    const summary = removedEdges.length
      ? `Replacement Route "${route.name}" gelöscht (${removedEdges.length} Replacement Edges entfernt).`
      : `Replacement Route "${route.name}" gelöscht.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'replacementRoute',
        id: route.replacementRouteId,
        label: route.name,
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
}
