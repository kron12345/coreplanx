import type { AssistantActionChangeDto } from './assistant.dto';
import type { ActionApplyOutcome, ActionContext, ActionPayload } from './assistant-action.engine.types';
import type { PersonnelSite, ResourceSnapshot } from '../planning/planning.types';
import { AssistantActionTopologyBase, PERSONNEL_SITE_TYPES } from './assistant-action.topology.base';

export class AssistantActionTopologySites extends AssistantActionTopologyBase {
  buildPersonnelSitePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.personnelSites ?? payload.personnelSite ?? payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse('Mindestens ein Personnel Site wird benötigt.');
    }

    const state = this.ensureTopologyState(context);
    const sites: PersonnelSite[] = [];
    const changes: AssistantActionChangeDto[] = [];
    const usedIds = new Set<string>();

    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const record = this.asRecord(raw) ?? {};
      const name = this.cleanText(record['name']) ?? this.cleanText(record['label']);
      if (!name) {
        return this.buildFeedbackResponse('Personnel Site: Name fehlt.');
      }
      const siteTypeRaw =
        this.cleanText(record['siteType'])?.toUpperCase() ?? '';
      if (!PERSONNEL_SITE_TYPES.has(siteTypeRaw)) {
        return this.buildFeedbackResponse('Personnel Site: Site-Typ ist ungültig.');
      }
      const siteId =
        this.cleanText(record['siteId']) ??
        this.cleanText(record['id']) ??
        this.generateId('SITE');
      if (
        usedIds.has(siteId) ||
        state.personnelSites.some((entry) => entry.siteId === siteId)
      ) {
        return this.buildFeedbackResponse(
          `Personnel Site "${name}": siteId "${siteId}" ist bereits vergeben.`,
        );
      }

      const positionResult = this.parsePosition(record, 'Personnel Site');
      if (positionResult.feedback) {
        return this.buildFeedbackResponse(positionResult.feedback);
      }

      let uniqueOpId: string | undefined;
      const opRef = this.cleanText(record['uniqueOpId']);
      if (opRef) {
        const opResult = this.resolveOperationalPointUniqueOpIdByReference(
          state.operationalPoints,
          opRef,
          { apply: { mode: 'value', path: ['personnelSites', index, 'uniqueOpId'] } },
        );
        if (opResult.clarification) {
          return this.buildClarificationResponse(opResult.clarification, context);
        }
        if (opResult.feedback) {
          return this.buildFeedbackResponse(opResult.feedback);
        }
        uniqueOpId = opResult.uniqueOpId ?? opRef;
      }

      const site: PersonnelSite = {
        siteId,
        siteType: siteTypeRaw as PersonnelSite['siteType'],
        name,
        uniqueOpId,
        position: positionResult.position ?? { lat: 0, lng: 0 },
        openingHoursJson: this.cleanText(record['openingHoursJson']),
      };
      sites.push(site);
      usedIds.add(siteId);
      changes.push({
        kind: 'create',
        entityType: 'personnelSite',
        id: site.siteId,
        label: site.name,
      });
    }

    state.personnelSites = [...state.personnelSites, ...sites];
    const commitTasks = this.buildTopologyCommitTasksForState(['personnelSites'], state);
    const summary =
      sites.length === 1
        ? `Personnel Site "${sites[0].name}" angelegt.`
        : `Personnel Sites angelegt (${sites.length}).`;

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  buildUpdatePersonnelSitePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['personnelSite']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Personnel Site fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const siteRef =
      this.cleanText(targetRecord['siteId']) ??
      this.cleanText(targetRecord['id']) ??
      this.cleanText(targetRecord['name']) ??
      this.cleanText(targetRecord['label']);
    if (!siteRef) {
      return this.buildFeedbackResponse('Personnel Site fehlt.');
    }
    const siteResult = this.resolvePersonnelSiteIdByReference(
      state.personnelSites,
      siteRef,
      { apply: { mode: 'target', path: ['target'] } },
    );
    if (siteResult.clarification) {
      return this.buildClarificationResponse(siteResult.clarification, context);
    }
    if (siteResult.feedback || !siteResult.siteId) {
      return this.buildFeedbackResponse(siteResult.feedback ?? 'Personnel Site nicht gefunden.');
    }

    const site = state.personnelSites.find((entry) => entry.siteId === siteResult.siteId);
    if (!site) {
      return this.buildFeedbackResponse('Personnel Site nicht gefunden.');
    }

    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const updated: PersonnelSite = { ...site };
    let changed = false;

    if (this.hasOwn(patch, 'name')) {
      const name = this.cleanText(patch['name']);
      if (!name) {
        return this.buildFeedbackResponse('Name darf nicht leer sein.');
      }
      updated.name = name;
      changed = true;
    }

    if (this.hasOwn(patch, 'siteType')) {
      const siteTypeRaw =
        this.cleanText(patch['siteType'])?.toUpperCase() ?? '';
      if (!PERSONNEL_SITE_TYPES.has(siteTypeRaw)) {
        return this.buildFeedbackResponse('Site-Typ ist ungültig.');
      }
      updated.siteType = siteTypeRaw as PersonnelSite['siteType'];
      changed = true;
    }

    if (this.hasOwn(patch, 'uniqueOpId')) {
      const opRef = this.cleanText(patch['uniqueOpId']);
      if (opRef) {
        const opResult = this.resolveOperationalPointUniqueOpIdByReference(
          state.operationalPoints,
          opRef,
          { apply: { mode: 'value', path: ['patch', 'uniqueOpId'] } },
        );
        if (opResult.clarification) {
          return this.buildClarificationResponse(opResult.clarification, context);
        }
        if (opResult.feedback) {
          return this.buildFeedbackResponse(opResult.feedback);
        }
        updated.uniqueOpId = opResult.uniqueOpId ?? opRef;
      } else {
        updated.uniqueOpId = undefined;
      }
      changed = true;
    }

    if (this.hasAnyKey(patch, ['lat', 'lng', 'position'])) {
      const positionResult = this.parsePosition(patch, 'Personnel Site');
      if (positionResult.feedback) {
        return this.buildFeedbackResponse(positionResult.feedback);
      }
      updated.position = positionResult.position ?? updated.position;
      changed = true;
    }

    if (this.hasOwn(patch, 'openingHoursJson')) {
      updated.openingHoursJson = this.cleanText(patch['openingHoursJson']);
      changed = true;
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    state.personnelSites = state.personnelSites.map((entry) =>
      entry.siteId === site.siteId ? updated : entry,
    );
    const commitTasks = this.buildTopologyCommitTasksForState(['personnelSites'], state);
    const summary = `Personnel Site "${updated.name}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'update', entityType: 'personnelSite', id: updated.siteId, label: updated.name },
    ];

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  buildDeletePersonnelSitePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['personnelSite']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Personnel Site fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const siteRef =
      this.cleanText(targetRecord['siteId']) ??
      this.cleanText(targetRecord['id']) ??
      this.cleanText(targetRecord['name']) ??
      this.cleanText(targetRecord['label']);
    if (!siteRef) {
      return this.buildFeedbackResponse('Personnel Site fehlt.');
    }
    const siteResult = this.resolvePersonnelSiteIdByReference(
      state.personnelSites,
      siteRef,
      { apply: { mode: 'target', path: ['target'] } },
    );
    if (siteResult.clarification) {
      return this.buildClarificationResponse(siteResult.clarification, context);
    }
    if (siteResult.feedback || !siteResult.siteId) {
      return this.buildFeedbackResponse(siteResult.feedback ?? 'Personnel Site nicht gefunden.');
    }

    const site = state.personnelSites.find((entry) => entry.siteId === siteResult.siteId);
    if (!site) {
      return this.buildFeedbackResponse('Personnel Site nicht gefunden.');
    }

    state.personnelSites = state.personnelSites.filter(
      (entry) => entry.siteId !== site.siteId,
    );
    const removedTransfers = state.transferEdges.filter(
      (edge) =>
        this.transferNodeMatches(edge.from, { kind: 'PERSONNEL_SITE', siteId: site.siteId }) ||
        this.transferNodeMatches(edge.to, { kind: 'PERSONNEL_SITE', siteId: site.siteId }),
    );
    state.transferEdges = state.transferEdges.filter(
      (edge) =>
        !this.transferNodeMatches(edge.from, { kind: 'PERSONNEL_SITE', siteId: site.siteId }) &&
        !this.transferNodeMatches(edge.to, { kind: 'PERSONNEL_SITE', siteId: site.siteId }),
    );

    const commitTasks = this.buildTopologyCommitTasksForState(
      ['personnelSites', 'transferEdges'],
      state,
    );
    const summary = removedTransfers.length
      ? `Personnel Site "${site.name}" gelöscht (${removedTransfers.length} Transfer Edges entfernt).`
      : `Personnel Site "${site.name}" gelöscht.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'delete', entityType: 'personnelSite', id: site.siteId, label: site.name },
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
