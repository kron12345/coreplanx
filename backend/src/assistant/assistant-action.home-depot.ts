import type { AssistantActionChangeDto } from './assistant.dto';
import type {
  ActionApplyOutcome,
  ActionContext,
  ActionPayload,
  ClarificationRequest,
} from './assistant-action.engine.types';
import type {
  HomeDepot,
  PersonnelSite,
  ResourceSnapshot,
} from '../planning/planning.types';
import { AssistantActionBase } from './assistant-action.base';

export class AssistantActionHomeDepot extends AssistantActionBase {
  buildHomeDepotPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.homeDepots ?? payload.homeDepot ?? payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse(
        'Mindestens ein Heimatdepot wird benötigt.',
      );
    }

    const state = this.ensureTopologyState(context);
    const depots: HomeDepot[] = [];
    const changes: AssistantActionChangeDto[] = [];
    const seenNames = new Set<string>();

    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const record = this.asRecord(raw);
      const name =
        this.cleanText(typeof raw === 'string' ? raw : record?.['name']) ??
        this.cleanText(record?.['label']);
      if (!name) {
        return this.buildFeedbackResponse('Depotname fehlt.');
      }
      const normalizedName = this.normalizeKey(name);
      if (seenNames.has(normalizedName)) {
        return this.buildFeedbackResponse(
          `Depot "${name}" ist doppelt angegeben.`,
        );
      }
      if (this.hasNameCollision(snapshot.homeDepots, name)) {
        return this.buildFeedbackResponse(
          `Heimatdepot "${name}" existiert bereits.`,
        );
      }
      seenNames.add(normalizedName);

      const siteIdsResult = this.resolvePersonnelSiteIds(
        state.personnelSites,
        this.parseStringArray(record?.['siteIds']),
        { applyPath: ['homeDepots', index, 'siteIds'] },
      );
      if (siteIdsResult.clarification) {
        return this.buildClarificationResponse(
          siteIdsResult.clarification,
          context,
        );
      }
      if (siteIdsResult.feedback) {
        return this.buildFeedbackResponse(siteIdsResult.feedback);
      }
      const breakSiteIdsResult = this.resolvePersonnelSiteIds(
        state.personnelSites,
        this.parseStringArray(record?.['breakSiteIds']),
        { applyPath: ['homeDepots', index, 'breakSiteIds'] },
      );
      if (breakSiteIdsResult.clarification) {
        return this.buildClarificationResponse(
          breakSiteIdsResult.clarification,
          context,
        );
      }
      if (breakSiteIdsResult.feedback) {
        return this.buildFeedbackResponse(breakSiteIdsResult.feedback);
      }
      const shortBreakSiteIdsResult = this.resolvePersonnelSiteIds(
        state.personnelSites,
        this.parseStringArray(record?.['shortBreakSiteIds']),
        { applyPath: ['homeDepots', index, 'shortBreakSiteIds'] },
      );
      if (shortBreakSiteIdsResult.clarification) {
        return this.buildClarificationResponse(
          shortBreakSiteIdsResult.clarification,
          context,
        );
      }
      if (shortBreakSiteIdsResult.feedback) {
        return this.buildFeedbackResponse(shortBreakSiteIdsResult.feedback);
      }
      const overnightSiteIdsResult = this.resolvePersonnelSiteIds(
        state.personnelSites,
        this.parseStringArray(record?.['overnightSiteIds']),
        { applyPath: ['homeDepots', index, 'overnightSiteIds'] },
      );
      if (overnightSiteIdsResult.clarification) {
        return this.buildClarificationResponse(
          overnightSiteIdsResult.clarification,
          context,
        );
      }
      if (overnightSiteIdsResult.feedback) {
        return this.buildFeedbackResponse(overnightSiteIdsResult.feedback);
      }

      const depot: HomeDepot = {
        id: this.generateId('HD'),
        name,
        description: this.cleanText(record?.['description']),
        siteIds: siteIdsResult.ids ?? [],
        breakSiteIds: breakSiteIdsResult.ids ?? [],
        shortBreakSiteIds: shortBreakSiteIdsResult.ids ?? [],
        overnightSiteIds: overnightSiteIdsResult.ids ?? [],
      };
      depots.push(depot);
      changes.push({
        kind: 'create',
        entityType: 'homeDepot',
        id: depot.id,
        label: depot.name,
      });
    }

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      homeDepots: [...snapshot.homeDepots, ...depots],
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary =
      depots.length === 1
        ? `Neues Heimatdepot "${depots[0].name}".`
        : `Neue Heimdepots (${depots.length}).`;

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  buildUpdateHomeDepotPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['homeDepot']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Heimatdepot fehlt.');
    }

    const targetResult = this.findByIdOrName(
      snapshot.homeDepots,
      targetRecord,
      {
        label: 'Heimatdepot',
        nameKeys: ['name', 'label'],
        clarification: { apply: { mode: 'target', path: ['target'] } },
      },
    );
    if (targetResult.clarification) {
      return this.buildClarificationResponse(
        targetResult.clarification,
        context,
      );
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(
        targetResult.feedback ?? 'Depot nicht gefunden.',
      );
    }

    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const depot = targetResult.item;
    const updated: HomeDepot = { ...depot };
    let changed = false;

    if (this.hasOwn(patch, 'name')) {
      const name = this.cleanText(patch['name']);
      if (!name) {
        return this.buildFeedbackResponse('Name darf nicht leer sein.');
      }
      if (this.hasNameCollision(snapshot.homeDepots, name, depot.id)) {
        return this.buildFeedbackResponse(
          `Name "${name}" ist bereits vergeben.`,
        );
      }
      updated.name = name;
      changed = true;
    }

    if (this.hasOwn(patch, 'description')) {
      updated.description = this.cleanText(patch['description']);
      changed = true;
    }

    const state = this.ensureTopologyState(context);
    if (this.hasOwn(patch, 'siteIds')) {
      const refs = this.parseStringArray(patch['siteIds']) ?? [];
      const result = this.resolvePersonnelSiteIds(state.personnelSites, refs, {
        applyPath: ['patch', 'siteIds'],
      });
      if (result.clarification) {
        return this.buildClarificationResponse(result.clarification, context);
      }
      if (result.feedback) {
        return this.buildFeedbackResponse(result.feedback);
      }
      updated.siteIds = result.ids ?? [];
      changed = true;
    }

    if (this.hasOwn(patch, 'breakSiteIds')) {
      const refs = this.parseStringArray(patch['breakSiteIds']) ?? [];
      const result = this.resolvePersonnelSiteIds(state.personnelSites, refs, {
        applyPath: ['patch', 'breakSiteIds'],
      });
      if (result.clarification) {
        return this.buildClarificationResponse(result.clarification, context);
      }
      if (result.feedback) {
        return this.buildFeedbackResponse(result.feedback);
      }
      updated.breakSiteIds = result.ids ?? [];
      changed = true;
    }

    if (this.hasOwn(patch, 'shortBreakSiteIds')) {
      const refs = this.parseStringArray(patch['shortBreakSiteIds']) ?? [];
      const result = this.resolvePersonnelSiteIds(state.personnelSites, refs, {
        applyPath: ['patch', 'shortBreakSiteIds'],
      });
      if (result.clarification) {
        return this.buildClarificationResponse(result.clarification, context);
      }
      if (result.feedback) {
        return this.buildFeedbackResponse(result.feedback);
      }
      updated.shortBreakSiteIds = result.ids ?? [];
      changed = true;
    }

    if (this.hasOwn(patch, 'overnightSiteIds')) {
      const refs = this.parseStringArray(patch['overnightSiteIds']) ?? [];
      const result = this.resolvePersonnelSiteIds(state.personnelSites, refs, {
        applyPath: ['patch', 'overnightSiteIds'],
      });
      if (result.clarification) {
        return this.buildClarificationResponse(result.clarification, context);
      }
      if (result.feedback) {
        return this.buildFeedbackResponse(result.feedback);
      }
      updated.overnightSiteIds = result.ids ?? [];
      changed = true;
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    const nextDepots = snapshot.homeDepots.map((entry) =>
      entry.id === depot.id ? updated : entry,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      homeDepots: nextDepots,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const label = updated.name ?? depot.name;
    const summary = `Heimatdepot "${label}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'update', entityType: 'homeDepot', id: depot.id, label },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  buildDeleteHomeDepotPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['homeDepot']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Heimatdepot fehlt.');
    }

    const targetResult = this.findByIdOrName(
      snapshot.homeDepots,
      targetRecord,
      {
        label: 'Heimatdepot',
        nameKeys: ['name', 'label'],
        clarification: { apply: { mode: 'target', path: ['target'] } },
      },
    );
    if (targetResult.clarification) {
      return this.buildClarificationResponse(
        targetResult.clarification,
        context,
      );
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(
        targetResult.feedback ?? 'Depot nicht gefunden.',
      );
    }

    const depot = targetResult.item;
    const nextDepots = snapshot.homeDepots.filter(
      (entry) => entry.id !== depot.id,
    );
    const nextPersonnelServicePools = snapshot.personnelServicePools.map(
      (pool) =>
        pool.homeDepotId === depot.id
          ? { ...pool, homeDepotId: undefined }
          : pool,
    );
    const nextPersonnelPools = snapshot.personnelPools.map((pool) =>
      pool.homeDepotId === depot.id
        ? { ...pool, homeDepotId: undefined }
        : pool,
    );

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      homeDepots: nextDepots,
      personnelServicePools: nextPersonnelServicePools,
      personnelPools: nextPersonnelPools,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const affectedPools =
      snapshot.personnelServicePools.filter(
        (pool) => pool.homeDepotId === depot.id,
      ).length +
      snapshot.personnelPools.filter((pool) => pool.homeDepotId === depot.id)
        .length;
    const summary = affectedPools
      ? `Heimatdepot "${depot.name}" gelöscht (${affectedPools} Pools ohne Heimatdepot).`
      : `Heimatdepot "${depot.name}" gelöscht.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'homeDepot',
        id: depot.id,
        label: depot.name,
      },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private resolvePersonnelSiteIds(
    sites: PersonnelSite[],
    siteRefs?: string[],
    clarification?: {
      applyPath: Array<string | number>;
      title?: (name: string) => string;
    },
  ): {
    ids?: string[];
    feedback?: string;
    clarification?: ClarificationRequest;
  } {
    if (!siteRefs || !siteRefs.length) {
      return { ids: undefined };
    }
    const ids: string[] = [];
    const missing: string[] = [];
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();

    for (let index = 0; index < siteRefs.length; index += 1) {
      const raw = siteRefs[index];
      const ref = this.cleanText(raw);
      if (!ref) {
        continue;
      }
      const direct = sites.find((site) => site.siteId === ref);
      if (direct) {
        if (!seenIds.has(direct.siteId)) {
          ids.push(direct.siteId);
          seenIds.add(direct.siteId);
        }
        continue;
      }
      const normalized = this.normalizeKey(ref);
      if (seenNames.has(normalized)) {
        continue;
      }
      const matches = sites.filter(
        (site) => this.normalizeKey(site.name ?? '') === normalized,
      );
      if (!matches.length) {
        missing.push(ref);
        continue;
      }
      if (matches.length > 1) {
        if (clarification) {
          const title =
            clarification.title?.(ref) ??
            `Personnel Site "${ref}" ist nicht eindeutig. Welches meinst du?`;
          return {
            clarification: {
              title,
              options: matches.map((site) => ({
                id: site.siteId,
                label: site.name ?? site.siteId,
                details: site.siteType ?? undefined,
              })),
              apply: {
                mode: 'value',
                path: [...clarification.applyPath, index],
              },
            },
          };
        }
        return {
          feedback: `Personnel Site "${ref}" ist nicht eindeutig. ${this.describeCandidates(
            matches.map((site) => site.name ?? site.siteId),
          )}`,
        };
      }
      const match = matches[0];
      seenNames.add(normalized);
      if (!seenIds.has(match.siteId)) {
        ids.push(match.siteId);
        seenIds.add(match.siteId);
      }
    }

    if (missing.length) {
      return {
        feedback: `Personnel Site(s) nicht gefunden: ${missing.join(', ')}`,
      };
    }
    return { ids };
  }
}
