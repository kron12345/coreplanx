import crypto from 'crypto';
import type {
  RulesetAction,
  RulesetConstraint,
  RulesetDocument,
  RulesetIR,
  RulesetObjectiveTerm,
  RulesetSoftConstraint,
  RulesetTemplate,
  RulesetCondition,
  RulesetInclude,
} from './planning-ruleset.types';

const normalizeList = <T>(value: T[] | undefined): T[] =>
  Array.isArray(value) ? value : [];

const mergeById = <T extends { id: string }>(base: T[], next: T[]): T[] => {
  if (!base.length) {
    return [...next];
  }
  const merged = [...base];
  const indexById = new Map<string, number>();
  merged.forEach((item, index) => indexById.set(item.id, index));
  next.forEach((item) => {
    const idx = indexById.get(item.id);
    if (idx === undefined) {
      indexById.set(item.id, merged.length);
      merged.push(item);
      return;
    }
    merged[idx] = item;
  });
  return merged;
};

export const mergeRulesetDocuments = (
  base: RulesetDocument,
  next: RulesetDocument,
): RulesetDocument => {
  return {
    id: next.id || base.id,
    version: next.version || base.version,
    label: next.label ?? base.label,
    description: next.description ?? base.description,
    includes: normalizeList(base.includes).concat(normalizeList(next.includes)),
    conditions: mergeById(
      normalizeList(base.conditions),
      normalizeList(next.conditions),
    ),
    hardConstraints: mergeById(
      normalizeList(base.hardConstraints),
      normalizeList(next.hardConstraints),
    ),
    softConstraints: mergeById(
      normalizeList(base.softConstraints),
      normalizeList(next.softConstraints),
    ),
    objectives: mergeById(
      normalizeList(base.objectives),
      normalizeList(next.objectives),
    ),
    actions: mergeById(
      normalizeList(base.actions),
      normalizeList(next.actions),
    ),
    templates: mergeById(
      normalizeList(base.templates),
      normalizeList(next.templates),
    ),
  };
};

const ensureUniqueIds = <T extends { id: string }>(
  items: T[],
  label: string,
) => {
  const seen = new Set<string>();
  items.forEach((item) => {
    if (seen.has(item.id)) {
      throw new Error(`${label} contains duplicate id: ${item.id}`);
    }
    seen.add(item.id);
  });
};

const hashRuleset = (
  value: RulesetDocument,
  includes: RulesetInclude[],
): string => {
  const payload = JSON.stringify({ value, includes });
  return crypto.createHash('sha256').update(payload).digest('hex');
};

export const compileRuleset = (
  doc: RulesetDocument,
  resolvedIncludes: RulesetInclude[],
): RulesetIR => {
  const conditions: RulesetCondition[] = normalizeList(doc.conditions);
  const hardConstraints: RulesetConstraint[] = normalizeList(
    doc.hardConstraints,
  );
  const softConstraints: RulesetSoftConstraint[] = normalizeList(
    doc.softConstraints,
  );
  const objectives: RulesetObjectiveTerm[] = normalizeList(doc.objectives);
  const actions: RulesetAction[] = normalizeList(doc.actions);
  const templates: RulesetTemplate[] = normalizeList(doc.templates);

  ensureUniqueIds(conditions, 'conditions');
  ensureUniqueIds(hardConstraints, 'hardConstraints');
  ensureUniqueIds(softConstraints, 'softConstraints');
  ensureUniqueIds(objectives, 'objectives');
  ensureUniqueIds(actions, 'actions');
  ensureUniqueIds(templates, 'templates');

  return {
    id: doc.id,
    version: doc.version,
    label: doc.label,
    description: doc.description,
    resolvedIncludes,
    conditions,
    hardConstraints,
    softConstraints,
    objectives,
    actions,
    templates,
    sourceHash: hashRuleset(doc, resolvedIncludes),
  };
};
