import type { AssistantActionClarificationApply } from './assistant-action-clarification.store';
import type {
  ActionContext,
  ActionTopologyState,
  ClarificationRequest,
} from './assistant-action.engine.types';
import type {
  AssistantActionCommitTask,
  AssistantActionTopologyScope,
} from './assistant-action.types';
import type {
  OperationalPoint,
  OpReplacementStopLink,
  PersonnelSite,
  ReplacementEdge,
  ReplacementRoute,
  ReplacementStop,
  SectionOfLine,
  TransferNode,
} from '../planning/planning.types';
import { AssistantActionBase } from './assistant-action.base';

export const PERSONNEL_SITE_TYPES = new Set([
  'MELDESTELLE',
  'PAUSENRAUM',
  'BEREITSCHAFT',
  'BÜRO',
]);
export const SECTION_OF_LINE_NATURES = new Set(['REGULAR', 'LINK']);
export const OP_REPLACEMENT_RELATIONS = new Set([
  'PRIMARY_SEV_STOP',
  'ALTERNATIVE',
  'TEMPORARY',
]);
export const TRANSFER_MODES = new Set(['WALK', 'SHUTTLE', 'INTERNAL']);

export class AssistantActionTopologyBase extends AssistantActionBase {
  protected ensureTopologyState(context: ActionContext): ActionTopologyState {
    if (!context.topologyState) {
      context.topologyState = this.buildTopologyState();
    }
    return context.topologyState;
  }

  protected buildTopologyCommitTasksForState(
    scopes: AssistantActionTopologyScope[],
    state: ActionTopologyState,
  ): AssistantActionCommitTask[] {
    const uniqueScopes = Array.from(new Set(scopes));
    return uniqueScopes.map((scope) =>
      this.buildTopologyCommitTask(scope, state),
    );
  }

  protected buildTopologyCommitTask(
    scope: AssistantActionTopologyScope,
    state: ActionTopologyState,
  ): AssistantActionCommitTask {
    switch (scope) {
      case 'operationalPoints':
        return {
          type: 'topology',
          scope,
          items: this.cloneList(state.operationalPoints),
        };
      case 'sectionsOfLine':
        return {
          type: 'topology',
          scope,
          items: this.cloneList(state.sectionsOfLine),
        };
      case 'personnelSites':
        return {
          type: 'topology',
          scope,
          items: this.cloneList(state.personnelSites),
        };
      case 'replacementStops':
        return {
          type: 'topology',
          scope,
          items: this.cloneList(state.replacementStops),
        };
      case 'replacementRoutes':
        return {
          type: 'topology',
          scope,
          items: this.cloneList(state.replacementRoutes),
        };
      case 'replacementEdges':
        return {
          type: 'topology',
          scope,
          items: this.cloneList(state.replacementEdges),
        };
      case 'opReplacementStopLinks':
        return {
          type: 'topology',
          scope,
          items: this.cloneList(state.opReplacementStopLinks),
        };
      case 'transferEdges':
        return {
          type: 'topology',
          scope,
          items: this.cloneList(state.transferEdges),
        };
      default:
        return { type: 'topology', scope, items: [] };
    }
  }

  protected resolveOperationalPointTarget(
    operationalPoints: OperationalPoint[],
    target: Record<string, unknown>,
    clarification?: { apply: AssistantActionClarificationApply },
  ): {
    item?: OperationalPoint;
    feedback?: string;
    clarification?: ClarificationRequest;
  } {
    const opId = this.cleanText(target['opId']) ?? this.cleanText(target['id']);
    if (opId) {
      const match = operationalPoints.find((entry) => entry.opId === opId);
      if (!match) {
        return { feedback: `Operational Point "${opId}" nicht gefunden.` };
      }
      return { item: match };
    }

    const uniqueOpId = this.cleanText(target['uniqueOpId']);
    if (uniqueOpId) {
      const match = operationalPoints.find(
        (entry) => entry.uniqueOpId === uniqueOpId,
      );
      if (!match) {
        return {
          feedback: `Operational Point "${uniqueOpId}" nicht gefunden.`,
        };
      }
      return { item: match };
    }

    const name =
      this.cleanText(target['name']) ?? this.cleanText(target['label']);
    if (!name) {
      return { feedback: 'Operational Point fehlt.' };
    }
    const normalized = this.normalizeKey(name);
    const matches = operationalPoints.filter(
      (entry) => this.normalizeKey(entry.name ?? '') === normalized,
    );
    if (!matches.length) {
      return { feedback: `Operational Point "${name}" nicht gefunden.` };
    }
    if (matches.length > 1) {
      if (clarification) {
        return {
          clarification: {
            title: `Operational Point "${name}" ist nicht eindeutig. Welchen meinst du?`,
            options: matches.map((entry) => ({
              id: entry.opId,
              label: entry.name ?? entry.opId,
              details: entry.uniqueOpId,
            })),
            apply: clarification.apply,
          },
        };
      }
      return {
        feedback: `Operational Point "${name}" ist nicht eindeutig. ${this.describeCandidates(
          matches.map((entry) => entry.name ?? entry.opId),
        )}`,
      };
    }
    return { item: matches[0] };
  }

  protected resolveOperationalPointUniqueOpIdByReference(
    operationalPoints: OperationalPoint[],
    ref: string,
    clarification?: { apply: AssistantActionClarificationApply },
  ): {
    uniqueOpId?: string;
    feedback?: string;
    clarification?: ClarificationRequest;
  } {
    const trimmed = ref.trim();
    const byUnique = operationalPoints.find(
      (entry) => entry.uniqueOpId === trimmed,
    );
    if (byUnique) {
      return { uniqueOpId: byUnique.uniqueOpId };
    }
    const byId = operationalPoints.find((entry) => entry.opId === trimmed);
    if (byId) {
      return { uniqueOpId: byId.uniqueOpId };
    }
    const normalized = this.normalizeKey(trimmed);
    const matches = operationalPoints.filter(
      (entry) => this.normalizeKey(entry.name ?? '') === normalized,
    );
    if (!matches.length) {
      return { feedback: `Operational Point "${ref}" nicht gefunden.` };
    }
    if (matches.length > 1) {
      if (clarification) {
        return {
          clarification: {
            title: `Operational Point "${ref}" ist nicht eindeutig. Welchen meinst du?`,
            options: matches.map((entry) => ({
              id: entry.uniqueOpId,
              label: entry.name ?? entry.uniqueOpId,
              details: entry.uniqueOpId,
            })),
            apply: clarification.apply,
          },
        };
      }
      return {
        feedback: `Operational Point "${ref}" ist nicht eindeutig. ${this.describeCandidates(
          matches.map((entry) => entry.name ?? entry.uniqueOpId),
        )}`,
      };
    }
    return { uniqueOpId: matches[0].uniqueOpId };
  }

  protected resolveSectionOfLineTarget(
    sections: SectionOfLine[],
    target: Record<string, unknown>,
    clarification?: { apply: AssistantActionClarificationApply },
  ): {
    item?: SectionOfLine;
    feedback?: string;
    clarification?: ClarificationRequest;
  } {
    const solId =
      this.cleanText(target['solId']) ?? this.cleanText(target['id']);
    if (solId) {
      const match = sections.find((entry) => entry.solId === solId);
      if (!match) {
        return { feedback: `Section of Line "${solId}" nicht gefunden.` };
      }
      return { item: match };
    }
    const start = this.cleanText(target['startUniqueOpId']);
    const end = this.cleanText(target['endUniqueOpId']);
    if (!start || !end) {
      return { feedback: 'Section of Line ID fehlt.' };
    }
    const matches = sections.filter(
      (entry) => entry.startUniqueOpId === start && entry.endUniqueOpId === end,
    );
    if (!matches.length) {
      return { feedback: 'Section of Line nicht gefunden.' };
    }
    if (matches.length > 1) {
      if (clarification) {
        return {
          clarification: {
            title: 'Section of Line ist nicht eindeutig. Welche meinst du?',
            options: matches.map((entry) => ({
              id: entry.solId,
              label: `${entry.startUniqueOpId} -> ${entry.endUniqueOpId}`,
              details: entry.solId,
            })),
            apply: clarification.apply,
          },
        };
      }
      return { feedback: 'Section of Line ist nicht eindeutig.' };
    }
    return { item: matches[0] };
  }

  protected resolvePersonnelSiteIdByReference(
    sites: PersonnelSite[],
    ref: string,
    clarification?: { apply: AssistantActionClarificationApply },
  ): {
    siteId?: string;
    feedback?: string;
    clarification?: ClarificationRequest;
  } {
    const trimmed = ref.trim();
    const direct = sites.find((site) => site.siteId === trimmed);
    if (direct) {
      return { siteId: direct.siteId };
    }
    const normalized = this.normalizeKey(trimmed);
    const matches = sites.filter(
      (site) => this.normalizeKey(site.name ?? '') === normalized,
    );
    if (!matches.length) {
      return { feedback: `Personnel Site "${ref}" nicht gefunden.` };
    }
    if (matches.length > 1) {
      if (clarification) {
        return {
          clarification: {
            title: `Personnel Site "${ref}" ist nicht eindeutig. Welches meinst du?`,
            options: matches.map((site) => ({
              id: site.siteId,
              label: site.name ?? site.siteId,
              details: site.siteType ?? undefined,
            })),
            apply: clarification.apply,
          },
        };
      }
      return {
        feedback: `Personnel Site "${ref}" ist nicht eindeutig. ${this.describeCandidates(
          matches.map((site) => site.name ?? site.siteId),
        )}`,
      };
    }
    return { siteId: matches[0].siteId };
  }

  protected resolveReplacementStopIdByReference(
    stops: ReplacementStop[],
    ref: string,
    clarification?: { apply: AssistantActionClarificationApply },
  ): {
    stopId?: string;
    feedback?: string;
    clarification?: ClarificationRequest;
  } {
    const trimmed = ref.trim();
    const direct = stops.find((stop) => stop.replacementStopId === trimmed);
    if (direct) {
      return { stopId: direct.replacementStopId };
    }
    const normalized = this.normalizeKey(trimmed);
    const matches = stops.filter(
      (stop) => this.normalizeKey(stop.name ?? '') === normalized,
    );
    if (!matches.length) {
      return { feedback: `Replacement Stop "${ref}" nicht gefunden.` };
    }
    if (matches.length > 1) {
      if (clarification) {
        return {
          clarification: {
            title: `Replacement Stop "${ref}" ist nicht eindeutig. Welchen meinst du?`,
            options: matches.map((stop) => ({
              id: stop.replacementStopId,
              label: stop.name ?? stop.replacementStopId,
              details: stop.stopCode ?? undefined,
            })),
            apply: clarification.apply,
          },
        };
      }
      return {
        feedback: `Replacement Stop "${ref}" ist nicht eindeutig. ${this.describeCandidates(
          matches.map((stop) => stop.name ?? stop.replacementStopId),
        )}`,
      };
    }
    return { stopId: matches[0].replacementStopId };
  }

  protected resolveReplacementRouteIdByReference(
    routes: ReplacementRoute[],
    ref: string,
    clarification?: { apply: AssistantActionClarificationApply },
  ): {
    routeId?: string;
    feedback?: string;
    clarification?: ClarificationRequest;
  } {
    const trimmed = ref.trim();
    const direct = routes.find((route) => route.replacementRouteId === trimmed);
    if (direct) {
      return { routeId: direct.replacementRouteId };
    }
    const normalized = this.normalizeKey(trimmed);
    const matches = routes.filter(
      (route) => this.normalizeKey(route.name ?? '') === normalized,
    );
    if (!matches.length) {
      return { feedback: `Replacement Route "${ref}" nicht gefunden.` };
    }
    if (matches.length > 1) {
      if (clarification) {
        return {
          clarification: {
            title: `Replacement Route "${ref}" ist nicht eindeutig. Welche meinst du?`,
            options: matches.map((route) => ({
              id: route.replacementRouteId,
              label: route.name ?? route.replacementRouteId,
              details: route.operator ?? undefined,
            })),
            apply: clarification.apply,
          },
        };
      }
      return {
        feedback: `Replacement Route "${ref}" ist nicht eindeutig. ${this.describeCandidates(
          matches.map((route) => route.name ?? route.replacementRouteId),
        )}`,
      };
    }
    return { routeId: matches[0].replacementRouteId };
  }

  protected resolveReplacementEdgeTarget(
    edges: ReplacementEdge[],
    target: Record<string, unknown>,
    clarification?: { apply: AssistantActionClarificationApply },
  ): {
    item?: ReplacementEdge;
    feedback?: string;
    clarification?: ClarificationRequest;
  } {
    const edgeId =
      this.cleanText(target['replacementEdgeId']) ??
      this.cleanText(target['id']);
    if (edgeId) {
      const match = edges.find((entry) => entry.replacementEdgeId === edgeId);
      if (!match) {
        return { feedback: `Replacement Edge "${edgeId}" nicht gefunden.` };
      }
      return { item: match };
    }
    const routeId = this.cleanText(target['replacementRouteId']);
    const seq = this.parseNumber(target['seq']);
    if (!routeId || seq === undefined) {
      return { feedback: 'Replacement Edge ID fehlt.' };
    }
    const matches = edges.filter(
      (entry) => entry.replacementRouteId === routeId && entry.seq === seq,
    );
    if (!matches.length) {
      return { feedback: 'Replacement Edge nicht gefunden.' };
    }
    if (matches.length > 1 && clarification) {
      return {
        clarification: {
          title: 'Replacement Edge ist nicht eindeutig. Welche meinst du?',
          options: matches.map((entry) => ({
            id: entry.replacementEdgeId,
            label: `${entry.replacementRouteId} · Seq ${entry.seq}`,
            details: entry.replacementEdgeId,
          })),
          apply: clarification.apply,
        },
      };
    }
    return { item: matches[0] };
  }

  protected resolveOpReplacementStopLinkTarget(
    links: OpReplacementStopLink[],
    target: Record<string, unknown>,
    clarification?: { apply: AssistantActionClarificationApply },
  ): {
    item?: OpReplacementStopLink;
    feedback?: string;
    clarification?: ClarificationRequest;
  } {
    const linkId =
      this.cleanText(target['linkId']) ?? this.cleanText(target['id']);
    if (linkId) {
      const match = links.find((entry) => entry.linkId === linkId);
      if (!match) {
        return { feedback: `OP-Link "${linkId}" nicht gefunden.` };
      }
      return { item: match };
    }
    const uniqueOpId = this.cleanText(target['uniqueOpId']);
    const replacementStopId = this.cleanText(target['replacementStopId']);
    if (!uniqueOpId || !replacementStopId) {
      return { feedback: 'OP-Link ID fehlt.' };
    }
    const matches = links.filter(
      (entry) =>
        entry.uniqueOpId === uniqueOpId &&
        entry.replacementStopId === replacementStopId,
    );
    if (!matches.length) {
      return { feedback: 'OP-Link nicht gefunden.' };
    }
    if (matches.length > 1 && clarification) {
      return {
        clarification: {
          title: 'OP-Link ist nicht eindeutig. Welchen meinst du?',
          options: matches.map((entry) => ({
            id: entry.linkId,
            label: entry.linkId,
            details: `${entry.uniqueOpId} -> ${entry.replacementStopId}`,
          })),
          apply: clarification.apply,
        },
      };
    }
    return { item: matches[0] };
  }

  protected parsePosition(
    record: Record<string, unknown>,
    label: string,
  ): { position?: { lat: number; lng: number }; feedback?: string } {
    const positionRecord = this.asRecord(record['position']) ?? {};
    const lat = this.parseNumber(record['lat'] ?? positionRecord['lat']);
    const lng = this.parseNumber(record['lng'] ?? positionRecord['lng']);
    if (lat === undefined || lng === undefined) {
      return {
        feedback: `${label}: Latitude und Longitude fehlen oder sind ungültig.`,
      };
    }
    return { position: { lat, lng } };
  }

  protected parseTransferNode(
    value: unknown,
    state: ActionTopologyState,
    clarification?: { applyPath: Array<string | number> },
  ): {
    node?: TransferNode;
    feedback?: string;
    clarification?: ClarificationRequest;
  } {
    const record = this.asRecord(value);
    if (!record) {
      return { feedback: 'Transfer-Knoten fehlt.' };
    }
    const kindRaw = this.cleanText(record['kind']);
    if (!kindRaw) {
      return { feedback: 'Transfer-Knoten: kind fehlt.' };
    }
    const kind = kindRaw.toUpperCase();
    switch (kind) {
      case 'OP': {
        const ref =
          this.cleanText(record['uniqueOpId']) ??
          this.cleanText(record['opId']) ??
          this.cleanText(record['name']);
        if (!ref) {
          return { feedback: 'Transfer-Knoten (OP) fehlt.' };
        }
        const opResult = this.resolveOperationalPointUniqueOpIdByReference(
          state.operationalPoints,
          ref,
          clarification
            ? {
                apply: {
                  mode: 'value',
                  path: [...clarification.applyPath, 'uniqueOpId'],
                },
              }
            : undefined,
        );
        if (opResult.clarification) {
          return { clarification: opResult.clarification };
        }
        if (opResult.feedback || !opResult.uniqueOpId) {
          return {
            feedback: opResult.feedback ?? 'Operational Point nicht gefunden.',
          };
        }
        return { node: { kind: 'OP', uniqueOpId: opResult.uniqueOpId } };
      }
      case 'PERSONNEL_SITE': {
        const ref =
          this.cleanText(record['siteId']) ?? this.cleanText(record['name']);
        if (!ref) {
          return { feedback: 'Transfer-Knoten (Personnel Site) fehlt.' };
        }
        const siteResult = this.resolvePersonnelSiteIdByReference(
          state.personnelSites,
          ref,
          clarification
            ? {
                apply: {
                  mode: 'value',
                  path: [...clarification.applyPath, 'siteId'],
                },
              }
            : undefined,
        );
        if (siteResult.clarification) {
          return { clarification: siteResult.clarification };
        }
        if (siteResult.feedback || !siteResult.siteId) {
          return {
            feedback: siteResult.feedback ?? 'Personnel Site nicht gefunden.',
          };
        }
        return { node: { kind: 'PERSONNEL_SITE', siteId: siteResult.siteId } };
      }
      case 'REPLACEMENT_STOP': {
        const ref =
          this.cleanText(record['replacementStopId']) ??
          this.cleanText(record['name']);
        if (!ref) {
          return { feedback: 'Transfer-Knoten (Replacement Stop) fehlt.' };
        }
        const stopResult = this.resolveReplacementStopIdByReference(
          state.replacementStops,
          ref,
          clarification
            ? {
                apply: {
                  mode: 'value',
                  path: [...clarification.applyPath, 'replacementStopId'],
                },
              }
            : undefined,
        );
        if (stopResult.clarification) {
          return { clarification: stopResult.clarification };
        }
        if (stopResult.feedback || !stopResult.stopId) {
          return {
            feedback: stopResult.feedback ?? 'Replacement Stop nicht gefunden.',
          };
        }
        return {
          node: {
            kind: 'REPLACEMENT_STOP',
            replacementStopId: stopResult.stopId,
          },
        };
      }
      default:
        return { feedback: `Transfer-Knoten: Unbekannter Typ "${kindRaw}".` };
    }
  }

  protected transferNodeMatches(
    node: TransferNode,
    target: TransferNode,
  ): boolean {
    if (node.kind !== target.kind) {
      return false;
    }
    switch (node.kind) {
      case 'OP':
        return (
          node.uniqueOpId === (target as { uniqueOpId: string }).uniqueOpId
        );
      case 'PERSONNEL_SITE':
        return node.siteId === (target as { siteId: string }).siteId;
      case 'REPLACEMENT_STOP':
        return (
          node.replacementStopId ===
          (target as { replacementStopId: string }).replacementStopId
        );
    }
  }

  protected transferNodesEqual(a: TransferNode, b: TransferNode): boolean {
    return this.transferNodeMatches(a, b);
  }
}
