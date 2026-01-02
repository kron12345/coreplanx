import type { AssistantActionChangeDto } from './assistant.dto';
import type {
  ActionApplyOutcome,
  ActionContext,
  ActionPayload,
} from './assistant-action.engine.types';
import type { AssistantActionCommitTask } from './assistant-action.types';
import type { ResourceSnapshot } from '../planning/planning.types';
import { AssistantActionBase } from './assistant-action.base';

export class AssistantActionTimetableSimulation extends AssistantActionBase {
  buildTimetableYearPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.timetableYears ?? payload.timetableYear ?? payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse('Mindestens ein Fahrplanjahr wird benötigt.');
    }

    const labels: string[] = [];
    for (const raw of rawEntries) {
      const record = this.asRecord(raw);
      const label =
        this.cleanText(typeof raw === 'string' ? raw : record?.['label']) ??
        this.cleanText(record?.['name']);
      if (!label) {
        return this.buildFeedbackResponse('Fahrplanjahr-Label fehlt.');
      }
      labels.push(label);
    }

    const duplicateLabels = this.findDuplicateNames(labels);
    if (duplicateLabels.length) {
      return this.buildFeedbackResponse(
        `Fahrplanjahre doppelt angegeben: ${duplicateLabels.join(', ')}`,
      );
    }

    const commitTasks: AssistantActionCommitTask[] = labels.map((label) => ({
      type: 'timetableYear',
      action: 'create',
      label,
    }));
    const changes: AssistantActionChangeDto[] = labels.map((label) => ({
      kind: 'create',
      entityType: 'timetableYear',
      id: label,
      label,
    }));

    const summary =
      labels.length === 1
        ? `Fahrplanjahr "${labels[0]}" anlegen.`
        : `Fahrplanjahre anlegen (${labels.length}).`;

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  buildDeleteTimetableYearPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['timetableYear']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Fahrplanjahr fehlt.');
    }

    const label =
      this.cleanText(targetRecord['label']) ??
      this.cleanText(targetRecord['timetableYearLabel']) ??
      this.cleanText(targetRecord['name']) ??
      this.cleanText(targetRecord['id']);
    if (!label) {
      return this.buildFeedbackResponse('Fahrplanjahr-Label fehlt.');
    }

    const commitTasks: AssistantActionCommitTask[] = [
      { type: 'timetableYear', action: 'delete', label },
    ];
    const changes: AssistantActionChangeDto[] = [
      { kind: 'delete', entityType: 'timetableYear', id: label, label },
    ];
    const summary = `Fahrplanjahr "${label}" löschen.`;

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  buildSimulationPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.simulations ?? payload.simulation ?? payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse('Mindestens eine Simulation wird benötigt.');
    }

    const tasks: AssistantActionCommitTask[] = [];
    const labels: string[] = [];
    const changes: AssistantActionChangeDto[] = [];
    const seenLabels = new Set<string>();

    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const record = this.asRecord(raw);
      const label =
        this.cleanText(typeof raw === 'string' ? raw : record?.['label']) ??
        this.cleanText(record?.['name']);
      if (!label) {
        return this.buildFeedbackResponse('Simulationstitel fehlt.');
      }
      const normalized = this.normalizeKey(label);
      if (seenLabels.has(normalized)) {
        return this.buildFeedbackResponse(`Simulation "${label}" ist doppelt angegeben.`);
      }
      seenLabels.add(normalized);

      const yearLabel =
        this.extractTimetableYearLabel(
          record?.['timetableYearLabel'] ?? record?.['timetableYear'],
        ) ??
        this.extractTimetableYearLabel(payload.timetableYear ?? payloadRecord['timetableYear']);
      if (!yearLabel) {
        return this.buildFeedbackResponse(
          `Simulation "${label}": Fahrplanjahr fehlt.`,
        );
      }

      tasks.push({
        type: 'simulation',
        action: 'create',
        label,
        timetableYearLabel: yearLabel,
        description: this.cleanText(record?.['description']) ?? undefined,
      });
      labels.push(label);
      changes.push({
        kind: 'create',
        entityType: 'simulation',
        id: label,
        label,
        details: `Fahrplanjahr ${yearLabel}`,
      });
    }

    const summary =
      tasks.length === 1
        ? `Simulation "${labels[0] ?? 'Simulation'}" anlegen.`
        : `Simulationen anlegen (${tasks.length}).`;

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks: tasks,
    };
  }

  buildUpdateSimulationPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['simulation']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Simulation fehlt.');
    }

    const variantId =
      this.cleanText(targetRecord['variantId']) ??
      this.cleanText(targetRecord['simulationId']) ??
      this.cleanText(targetRecord['id']);
    const targetLabel =
      this.cleanText(targetRecord['label']) ??
      this.cleanText(targetRecord['name']);
    const targetYearLabel = this.cleanText(targetRecord['timetableYearLabel']);
    if (!variantId && !targetLabel) {
      return this.buildFeedbackResponse('Simulation-ID oder Name fehlt.');
    }

    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const newLabel =
      this.cleanText(patch['label']) ?? this.cleanText(patch['name']) ?? undefined;
    const description = this.cleanText(patch['description']);
    if (!newLabel && !description) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    const task: AssistantActionCommitTask = {
      type: 'simulation',
      action: 'update',
      variantId: variantId ?? undefined,
      targetLabel: targetLabel ?? undefined,
      targetTimetableYearLabel: targetYearLabel ?? undefined,
      label: newLabel ?? undefined,
      description: description ?? undefined,
    };
    const label = newLabel ?? targetLabel ?? variantId ?? 'Simulation';
    const changes: AssistantActionChangeDto[] = [
      { kind: 'update', entityType: 'simulation', id: variantId ?? label, label },
    ];
    const summary = `Simulation "${label}" aktualisieren.`;

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks: [task],
    };
  }

  buildDeleteSimulationPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['simulation']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Simulation fehlt.');
    }

    const variantId =
      this.cleanText(targetRecord['variantId']) ??
      this.cleanText(targetRecord['simulationId']) ??
      this.cleanText(targetRecord['id']);
    const label =
      this.cleanText(targetRecord['label']) ??
      this.cleanText(targetRecord['name']);
    const yearLabel = this.cleanText(targetRecord['timetableYearLabel']);
    if (!variantId && !label) {
      return this.buildFeedbackResponse('Simulation-ID oder Name fehlt.');
    }

    const task: AssistantActionCommitTask = {
      type: 'simulation',
      action: 'delete',
      variantId: variantId ?? undefined,
      targetLabel: label ?? undefined,
      targetTimetableYearLabel: yearLabel ?? undefined,
      label: label ?? undefined,
    };

    const summary = `Simulation "${label ?? variantId}" löschen.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'simulation',
        id: variantId ?? label ?? 'simulation',
        label: label ?? variantId ?? 'Simulation',
      },
    ];

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks: [task],
    };
  }

}
