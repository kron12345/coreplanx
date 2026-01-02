import type { AssistantActionChangeDto } from './assistant.dto';
import type {
  ActionApplyOutcome,
  ActionContext,
  ActionPayload,
  ActionTopologyState,
} from './assistant-action.engine.types';
import type { AssistantActionTopologyScope } from './assistant-action.types';
import type {
  OperationalPoint,
  ResourceSnapshot,
  SectionOfLine,
  TransferNode,
} from '../planning/planning.types';
import { AssistantActionTopologyBase, SECTION_OF_LINE_NATURES } from './assistant-action.topology.base';

export class AssistantActionTopologyOperations extends AssistantActionTopologyBase {
  buildOperationalPointPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.operationalPoints ?? payload.operationalPoint ?? payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse('Mindestens ein Operational Point wird benötigt.');
    }

    const state = this.ensureTopologyState(context);
    const ops: OperationalPoint[] = [];
    const changes: AssistantActionChangeDto[] = [];
    const usedOpIds = new Set<string>();
    const usedUniqueIds = new Set<string>();

    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const record = this.asRecord(raw) ?? {};
      const opId =
        this.cleanText(record['opId']) ??
        this.cleanText(record['id']) ??
        this.generateId('OP');
      const uniqueOpId = this.cleanText(record['uniqueOpId']);
      const name = this.cleanText(record['name']) ?? this.cleanText(record['label']);
      const countryCode = this.cleanText(record['countryCode']);
      const opType = this.cleanText(record['opType']);

      if (!uniqueOpId) {
        return this.buildFeedbackResponse('Operational Point: uniqueOpId fehlt.');
      }
      if (!name) {
        return this.buildFeedbackResponse('Operational Point: Name fehlt.');
      }
      if (!countryCode) {
        return this.buildFeedbackResponse('Operational Point: Country Code fehlt.');
      }
      if (!opType) {
        return this.buildFeedbackResponse('Operational Point: Typ fehlt.');
      }

      if (
        usedOpIds.has(opId) ||
        state.operationalPoints.some((entry) => entry.opId === opId)
      ) {
        return this.buildFeedbackResponse(
          `Operational Point "${name}": opId "${opId}" ist bereits vergeben.`,
        );
      }
      if (
        usedUniqueIds.has(uniqueOpId) ||
        state.operationalPoints.some((entry) => entry.uniqueOpId === uniqueOpId)
      ) {
        return this.buildFeedbackResponse(
          `Operational Point "${name}": uniqueOpId "${uniqueOpId}" ist bereits vergeben.`,
        );
      }

      const positionResult = this.parsePosition(record, 'Operational Point');
      if (positionResult.feedback) {
        return this.buildFeedbackResponse(positionResult.feedback);
      }

      const op: OperationalPoint = {
        opId,
        uniqueOpId,
        name,
        countryCode,
        opType,
        position: positionResult.position,
      };
      ops.push(op);
      usedOpIds.add(opId);
      usedUniqueIds.add(uniqueOpId);
      changes.push({
        kind: 'create',
        entityType: 'operationalPoint',
        id: op.opId,
        label: op.name,
        details: op.uniqueOpId,
      });
    }

    state.operationalPoints = [...state.operationalPoints, ...ops];
    const commitTasks = this.buildTopologyCommitTasksForState(
      ['operationalPoints'],
      state,
    );
    const summary =
      ops.length === 1
        ? `Operational Point "${ops[0].name}" angelegt.`
        : `Operational Points angelegt (${ops.length}).`;

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  buildUpdateOperationalPointPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['operationalPoint']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Operational Point fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const targetResult = this.resolveOperationalPointTarget(
      state.operationalPoints,
      targetRecord,
      { apply: { mode: 'target', path: ['target'] } },
    );
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(
        targetResult.feedback ?? 'Operational Point nicht gefunden.',
      );
    }

    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const op = targetResult.item;
    const updated: OperationalPoint = { ...op };
    let changed = false;
    let uniqueChanged = false;
    const oldOpId = op.opId;
    const oldUnique = op.uniqueOpId;

    if (this.hasOwn(patch, 'opId')) {
      const opId = this.cleanText(patch['opId']);
      if (!opId) {
        return this.buildFeedbackResponse('opId darf nicht leer sein.');
      }
      if (
        state.operationalPoints.some(
          (entry) => entry.opId === opId && entry.opId !== oldOpId,
        )
      ) {
        return this.buildFeedbackResponse(`opId "${opId}" ist bereits vergeben.`);
      }
      updated.opId = opId;
      changed = true;
    }

    if (this.hasOwn(patch, 'uniqueOpId')) {
      const uniqueOpId = this.cleanText(patch['uniqueOpId']);
      if (!uniqueOpId) {
        return this.buildFeedbackResponse('uniqueOpId darf nicht leer sein.');
      }
      if (
        state.operationalPoints.some(
          (entry) => entry.uniqueOpId === uniqueOpId && entry.opId !== oldOpId,
        )
      ) {
        return this.buildFeedbackResponse(
          `uniqueOpId "${uniqueOpId}" ist bereits vergeben.`,
        );
      }
      updated.uniqueOpId = uniqueOpId;
      changed = true;
      uniqueChanged = uniqueOpId !== oldUnique;
    }

    if (this.hasOwn(patch, 'name')) {
      const name = this.cleanText(patch['name']);
      if (!name) {
        return this.buildFeedbackResponse('Name darf nicht leer sein.');
      }
      updated.name = name;
      changed = true;
    }
    if (this.hasOwn(patch, 'countryCode')) {
      updated.countryCode = this.cleanText(patch['countryCode']) ?? updated.countryCode;
      changed = true;
    }
    if (this.hasOwn(patch, 'opType')) {
      updated.opType = this.cleanText(patch['opType']) ?? updated.opType;
      changed = true;
    }
    if (this.hasAnyKey(patch, ['lat', 'lng', 'position'])) {
      const positionResult = this.parsePosition(patch, 'Operational Point');
      if (positionResult.feedback) {
        return this.buildFeedbackResponse(positionResult.feedback);
      }
      updated.position = positionResult.position;
      changed = true;
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    if (uniqueChanged) {
      this.relinkUniqueOpId(state, oldUnique, updated.uniqueOpId);
    }

    state.operationalPoints = state.operationalPoints.map((entry) =>
      entry.opId === oldOpId ? updated : entry,
    );
    const scopes: AssistantActionTopologyScope[] = ['operationalPoints'];
    if (uniqueChanged) {
      scopes.push(
        'sectionsOfLine',
        'personnelSites',
        'replacementStops',
        'opReplacementStopLinks',
        'transferEdges',
      );
    }
    const commitTasks = this.buildTopologyCommitTasksForState(scopes, state);
    const summary = uniqueChanged
      ? `Operational Point "${updated.name}" aktualisiert (Referenzen angepasst).`
      : `Operational Point "${updated.name}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'update',
        entityType: 'operationalPoint',
        id: updated.opId,
        label: updated.name,
        details: uniqueChanged ? 'Referenzen aktualisiert' : undefined,
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

  buildDeleteOperationalPointPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['operationalPoint']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Operational Point fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const targetResult = this.resolveOperationalPointTarget(
      state.operationalPoints,
      targetRecord,
      { apply: { mode: 'target', path: ['target'] } },
    );
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(
        targetResult.feedback ?? 'Operational Point nicht gefunden.',
      );
    }

    const op = targetResult.item;
    const uniqueOpId = op.uniqueOpId;
    state.operationalPoints = state.operationalPoints.filter(
      (entry) => entry.opId !== op.opId,
    );

    const removedSections = state.sectionsOfLine.filter(
      (section) =>
        section.startUniqueOpId === uniqueOpId ||
        section.endUniqueOpId === uniqueOpId,
    );
    state.sectionsOfLine = state.sectionsOfLine.filter(
      (section) =>
        section.startUniqueOpId !== uniqueOpId &&
        section.endUniqueOpId !== uniqueOpId,
    );

    let updatedSites = 0;
    state.personnelSites = state.personnelSites.map((site) => {
      if (site.uniqueOpId !== uniqueOpId) {
        return site;
      }
      updatedSites += 1;
      return { ...site, uniqueOpId: undefined };
    });

    let updatedStops = 0;
    state.replacementStops = state.replacementStops.map((stop) => {
      if (stop.nearestUniqueOpId !== uniqueOpId) {
        return stop;
      }
      updatedStops += 1;
      return { ...stop, nearestUniqueOpId: undefined };
    });

    const removedLinks = state.opReplacementStopLinks.filter(
      (link) => link.uniqueOpId === uniqueOpId,
    );
    state.opReplacementStopLinks = state.opReplacementStopLinks.filter(
      (link) => link.uniqueOpId !== uniqueOpId,
    );

    const removedTransfers = state.transferEdges.filter(
      (edge) =>
        this.transferNodeMatches(edge.from, { kind: 'OP', uniqueOpId }) ||
        this.transferNodeMatches(edge.to, { kind: 'OP', uniqueOpId }),
    );
    state.transferEdges = state.transferEdges.filter(
      (edge) =>
        !this.transferNodeMatches(edge.from, { kind: 'OP', uniqueOpId }) &&
        !this.transferNodeMatches(edge.to, { kind: 'OP', uniqueOpId }),
    );

    const scopes: AssistantActionTopologyScope[] = [
      'operationalPoints',
      'sectionsOfLine',
      'personnelSites',
      'replacementStops',
      'opReplacementStopLinks',
      'transferEdges',
    ];
    const commitTasks = this.buildTopologyCommitTasksForState(scopes, state);
    const details: string[] = [];
    if (removedSections.length) {
      details.push(`${removedSections.length} Sections of Line entfernt`);
    }
    if (updatedSites) {
      details.push(`${updatedSites} Personnel Sites angepasst`);
    }
    if (updatedStops) {
      details.push(`${updatedStops} Replacement Stops angepasst`);
    }
    if (removedLinks.length) {
      details.push(`${removedLinks.length} OP-Links entfernt`);
    }
    if (removedTransfers.length) {
      details.push(`${removedTransfers.length} Transfer Edges entfernt`);
    }

    const summary = details.length
      ? `Operational Point "${op.name}" gelöscht (${details.join(', ')}).`
      : `Operational Point "${op.name}" gelöscht.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'operationalPoint',
        id: op.opId,
        label: op.name,
        details: op.uniqueOpId,
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

  buildSectionOfLinePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.sectionsOfLine ?? payload.sectionOfLine ?? payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse('Mindestens eine Section of Line wird benötigt.');
    }

    const state = this.ensureTopologyState(context);
    const sections: SectionOfLine[] = [];
    const changes: AssistantActionChangeDto[] = [];
    const usedIds = new Set<string>();

    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const record = this.asRecord(raw) ?? {};
      const solId =
        this.cleanText(record['solId']) ??
        this.cleanText(record['id']) ??
        this.generateId('SOL');
      if (
        usedIds.has(solId) ||
        state.sectionsOfLine.some((entry) => entry.solId === solId)
      ) {
        return this.buildFeedbackResponse(
          `Section of Line "${solId}" ist bereits vorhanden.`,
        );
      }

      const startRef = this.cleanText(record['startUniqueOpId']);
      const endRef = this.cleanText(record['endUniqueOpId']);
      if (!startRef || !endRef) {
        return this.buildFeedbackResponse('Section of Line: Start/End-OP fehlen.');
      }
      const startResult = this.resolveOperationalPointUniqueOpIdByReference(
        state.operationalPoints,
        startRef,
        { apply: { mode: 'value', path: ['sectionsOfLine', index, 'startUniqueOpId'] } },
      );
      if (startResult.clarification) {
        return this.buildClarificationResponse(startResult.clarification, context);
      }
      if (startResult.feedback) {
        return this.buildFeedbackResponse(startResult.feedback);
      }
      const endResult = this.resolveOperationalPointUniqueOpIdByReference(
        state.operationalPoints,
        endRef,
        { apply: { mode: 'value', path: ['sectionsOfLine', index, 'endUniqueOpId'] } },
      );
      if (endResult.clarification) {
        return this.buildClarificationResponse(endResult.clarification, context);
      }
      if (endResult.feedback) {
        return this.buildFeedbackResponse(endResult.feedback);
      }
      if (startResult.uniqueOpId === endResult.uniqueOpId) {
        return this.buildFeedbackResponse('Section of Line: Start und Ziel sind identisch.');
      }

      const natureRaw =
        this.cleanText(record['nature'])?.toUpperCase() ?? 'REGULAR';
      if (!SECTION_OF_LINE_NATURES.has(natureRaw)) {
        return this.buildFeedbackResponse('Section of Line: Nature ist ungültig.');
      }
      const lengthKm = this.parseNumber(record['lengthKm']);

      const section: SectionOfLine = {
        solId,
        startUniqueOpId: startResult.uniqueOpId ?? startRef,
        endUniqueOpId: endResult.uniqueOpId ?? endRef,
        lengthKm,
        nature: natureRaw as SectionOfLine['nature'],
      };
      sections.push(section);
      usedIds.add(solId);
      changes.push({
        kind: 'create',
        entityType: 'sectionOfLine',
        id: solId,
        label: `${section.startUniqueOpId} -> ${section.endUniqueOpId}`,
      });
    }

    state.sectionsOfLine = [...state.sectionsOfLine, ...sections];
    const commitTasks = this.buildTopologyCommitTasksForState(['sectionsOfLine'], state);
    const summary =
      sections.length === 1
        ? `Section of Line "${sections[0].solId}" angelegt.`
        : `Sections of Line angelegt (${sections.length}).`;

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  buildUpdateSectionOfLinePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['sectionOfLine']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Section of Line fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const targetResult = this.resolveSectionOfLineTarget(
      state.sectionsOfLine,
      targetRecord,
      { apply: { mode: 'target', path: ['target'] } },
    );
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(
        targetResult.feedback ?? 'Section of Line nicht gefunden.',
      );
    }

    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const section = targetResult.item;
    const updated: SectionOfLine = { ...section };
    let changed = false;

    let startUniqueOpId = section.startUniqueOpId;
    let endUniqueOpId = section.endUniqueOpId;

    if (this.hasOwn(patch, 'startUniqueOpId')) {
      const startRef = this.cleanText(patch['startUniqueOpId']);
      if (!startRef) {
        return this.buildFeedbackResponse('Start-OP fehlt.');
      }
      const startResult = this.resolveOperationalPointUniqueOpIdByReference(
        state.operationalPoints,
        startRef,
        { apply: { mode: 'value', path: ['patch', 'startUniqueOpId'] } },
      );
      if (startResult.clarification) {
        return this.buildClarificationResponse(startResult.clarification, context);
      }
      if (startResult.feedback) {
        return this.buildFeedbackResponse(startResult.feedback);
      }
      startUniqueOpId = startResult.uniqueOpId ?? startRef;
      changed = true;
    }

    if (this.hasOwn(patch, 'endUniqueOpId')) {
      const endRef = this.cleanText(patch['endUniqueOpId']);
      if (!endRef) {
        return this.buildFeedbackResponse('End-OP fehlt.');
      }
      const endResult = this.resolveOperationalPointUniqueOpIdByReference(
        state.operationalPoints,
        endRef,
        { apply: { mode: 'value', path: ['patch', 'endUniqueOpId'] } },
      );
      if (endResult.clarification) {
        return this.buildClarificationResponse(endResult.clarification, context);
      }
      if (endResult.feedback) {
        return this.buildFeedbackResponse(endResult.feedback);
      }
      endUniqueOpId = endResult.uniqueOpId ?? endRef;
      changed = true;
    }

    if (startUniqueOpId === endUniqueOpId) {
      return this.buildFeedbackResponse('Start- und End-OP dürfen nicht gleich sein.');
    }

    if (this.hasOwn(patch, 'nature')) {
      const natureRaw =
        this.cleanText(patch['nature'])?.toUpperCase() ?? '';
      if (!SECTION_OF_LINE_NATURES.has(natureRaw)) {
        return this.buildFeedbackResponse('Nature ist ungültig.');
      }
      updated.nature = natureRaw as SectionOfLine['nature'];
      changed = true;
    }

    if (this.hasOwn(patch, 'lengthKm')) {
      updated.lengthKm = this.parseNumber(patch['lengthKm']);
      changed = true;
    }

    updated.startUniqueOpId = startUniqueOpId;
    updated.endUniqueOpId = endUniqueOpId;

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    state.sectionsOfLine = state.sectionsOfLine.map((entry) =>
      entry.solId === section.solId ? updated : entry,
    );
    const commitTasks = this.buildTopologyCommitTasksForState(['sectionsOfLine'], state);
    const summary = `Section of Line "${updated.solId}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'update', entityType: 'sectionOfLine', id: updated.solId, label: updated.solId },
    ];

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  buildDeleteSectionOfLinePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['sectionOfLine']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Section of Line fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const targetResult = this.resolveSectionOfLineTarget(
      state.sectionsOfLine,
      targetRecord,
      { apply: { mode: 'target', path: ['target'] } },
    );
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(
        targetResult.feedback ?? 'Section of Line nicht gefunden.',
      );
    }

    const section = targetResult.item;
    state.sectionsOfLine = state.sectionsOfLine.filter(
      (entry) => entry.solId !== section.solId,
    );

    const commitTasks = this.buildTopologyCommitTasksForState(['sectionsOfLine'], state);
    const summary = `Section of Line "${section.solId}" gelöscht.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'delete', entityType: 'sectionOfLine', id: section.solId, label: section.solId },
    ];

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  private relinkUniqueOpId(
    state: ActionTopologyState,
    oldId: string,
    newId: string,
  ): void {
    state.sectionsOfLine = state.sectionsOfLine.map((section) => ({
      ...section,
      startUniqueOpId:
        section.startUniqueOpId === oldId ? newId : section.startUniqueOpId,
      endUniqueOpId:
        section.endUniqueOpId === oldId ? newId : section.endUniqueOpId,
    }));
    state.personnelSites = state.personnelSites.map((site) =>
      site.uniqueOpId === oldId ? { ...site, uniqueOpId: newId } : site,
    );
    state.replacementStops = state.replacementStops.map((stop) =>
      stop.nearestUniqueOpId === oldId
        ? { ...stop, nearestUniqueOpId: newId }
        : stop,
    );
    state.opReplacementStopLinks = state.opReplacementStopLinks.map((link) =>
      link.uniqueOpId === oldId ? { ...link, uniqueOpId: newId } : link,
    );
    state.transferEdges = state.transferEdges.map((edge) => ({
      ...edge,
      from: this.remapTransferNode(edge.from, oldId, newId),
      to: this.remapTransferNode(edge.to, oldId, newId),
    }));
  }

  private remapTransferNode(
    node: TransferNode,
    oldId: string,
    newId: string,
  ): TransferNode {
    if (node.kind === 'OP' && node.uniqueOpId === oldId) {
      return { ...node, uniqueOpId: newId };
    }
    return node;
  }
}
