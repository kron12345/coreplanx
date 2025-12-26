import type { Activity, ActivityGroupRole } from '../../models/activity';

export const ACTIVITY_GROUP_ATTRIBUTE_KEY = 'activity_group';

export type ActivityGroupMeta = {
  id: string;
  order?: number | null;
  label?: string | null;
  role?: ActivityGroupRole | null;
  attachedToActivityId?: string | null;
};

export function stripDayScope(activityId: string | null | undefined): string | null {
  const trimmed = (activityId ?? '').toString().trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.split('@')[0] ?? trimmed;
}

export function readActivityGroupMetaFromAttributes(
  attributes: Record<string, unknown> | null | undefined,
): ActivityGroupMeta | null {
  const attrs = (attributes ?? {}) as Record<string, unknown>;
  const raw = attrs[ACTIVITY_GROUP_ATTRIBUTE_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const meta = raw as Record<string, unknown>;
  const id = typeof meta['id'] === 'string' ? meta['id'].trim() : '';
  if (!id) {
    return null;
  }
  const order = typeof meta['order'] === 'number' && Number.isFinite(meta['order']) ? meta['order'] : null;
  const label = typeof meta['label'] === 'string' ? meta['label'].trim() : null;
  const role = isGroupRole(meta['role']) ? (meta['role'] as ActivityGroupRole) : null;
  const attachedToActivityId = typeof meta['attachedToActivityId'] === 'string' ? meta['attachedToActivityId'].trim() : null;
  return {
    id,
    order,
    label: label && label.length ? label : null,
    role,
    attachedToActivityId: attachedToActivityId && attachedToActivityId.length ? attachedToActivityId : null,
  };
}

export function readActivityGroupMeta(activity: Activity): ActivityGroupMeta | null {
  const groupId = typeof activity.groupId === 'string' && activity.groupId.trim().length ? activity.groupId.trim() : null;
  const groupOrder =
    typeof activity.groupOrder === 'number' && Number.isFinite(activity.groupOrder) ? activity.groupOrder : null;
  const attributeMeta = readActivityGroupMetaFromAttributes(activity.attributes ?? undefined);
  const id = groupId ?? attributeMeta?.id ?? null;
  if (!id) {
    return null;
  }
  return {
    id,
    order: groupOrder ?? attributeMeta?.order ?? null,
    label: attributeMeta?.label ?? null,
    role: attributeMeta?.role ?? null,
    attachedToActivityId: attributeMeta?.attachedToActivityId ?? null,
  };
}

export function writeActivityGroupMetaToAttributes(
  attributes: Record<string, unknown> | null | undefined,
  meta: ActivityGroupMeta | null,
): Record<string, unknown> | undefined {
  const base = { ...(attributes ?? {}) } as Record<string, unknown>;
  if (!meta || !meta.id?.trim()) {
    if (ACTIVITY_GROUP_ATTRIBUTE_KEY in base) {
      delete base[ACTIVITY_GROUP_ATTRIBUTE_KEY];
    }
    return Object.keys(base).length ? base : undefined;
  }
  const group: Record<string, unknown> = { id: meta.id };
  if (typeof meta.order === 'number' && Number.isFinite(meta.order)) {
    group['order'] = meta.order;
  }
  if (typeof meta.label === 'string' && meta.label.trim().length) {
    group['label'] = meta.label.trim();
  }
  if (isGroupRole(meta.role)) {
    group['role'] = meta.role;
  }
  if (typeof meta.attachedToActivityId === 'string' && meta.attachedToActivityId.trim().length) {
    group['attachedToActivityId'] = meta.attachedToActivityId.trim();
  }
  base[ACTIVITY_GROUP_ATTRIBUTE_KEY] = group;
  return base;
}

export function applyActivityGroup(activity: Activity, meta: ActivityGroupMeta | null): Activity {
  const trimmedId = meta?.id?.trim() ?? '';
  if (!trimmedId) {
    const nextAttributes = writeActivityGroupMetaToAttributes(activity.attributes ?? undefined, null);
    return {
      ...activity,
      groupId: null,
      groupOrder: null,
      attributes: nextAttributes,
    };
  }
  const order =
    typeof meta?.order === 'number' && Number.isFinite(meta.order) ? meta.order : null;
  const nextAttributes = writeActivityGroupMetaToAttributes(activity.attributes ?? undefined, {
    ...meta,
    id: trimmedId,
    order,
  });
  return {
    ...activity,
    groupId: trimmedId,
    groupOrder: order,
    attributes: nextAttributes,
  };
}

function isGroupRole(value: unknown): value is ActivityGroupRole {
  return value === 'pre' || value === 'main' || value === 'post' || value === 'independent';
}

