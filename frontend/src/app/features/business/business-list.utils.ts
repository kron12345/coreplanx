import type { DatePipe } from '@angular/common';
import type { Business, BusinessStatus, BusinessAssignment } from '../../core/models/business.model';
import type {
  BusinessDueDateFilter,
  BusinessFilters,
} from '../../core/services/business.service';
import type { OrderItemOption } from '../../core/services/order.service';
import type {
  ActivityFeedItem,
  AssignmentInsight,
  BusinessHighlight,
  BusinessInsightContext,
  BusinessMetric,
  HealthBadge,
  PipelineMetrics,
  SearchSuggestion,
  StatusBreakdownEntry,
  TagInsightStat,
  TimelineEntry,
  TimelineState,
} from './business-list.types';

export function formatTagLabel(tag: string): string {
  return tag.startsWith('#') ? tag : `#${tag}`;
}

export function encodeTokenValue(value: string): string {
  return value.includes(' ') ? `"${value}"` : value;
}

export function computeSearchSuggestions(params: {
  query: string;
  tagStats: TagInsightStat[];
  assignments: BusinessAssignment[];
  statusOptions: Array<{ value: BusinessStatus | 'all'; label: string }>;
  maxResults?: number;
}): SearchSuggestion[] {
  const query = params.query.trim().toLowerCase();
  const suggestions: SearchSuggestion[] = [];

  params.tagStats.forEach(([tag, count]) => {
    const encoded = encodeTokenValue(tag);
    suggestions.push({
      label: formatTagLabel(tag),
      value: `tag:${encoded}`,
      icon: 'sell',
      description: `${count} Treffer · Tag`,
      kind: 'tag',
    });
  });

  params.assignments.forEach((assignment) => {
    const encoded = encodeTokenValue(assignment.name);
    suggestions.push({
      label: assignment.name,
      value: `assign:${encoded}`,
      icon: assignment.type === 'group' ? 'groups' : 'person',
      description: 'Verantwortlich',
      kind: 'assignment',
    });
  });

  params.statusOptions
    .filter((option) => option.value !== 'all')
    .forEach((option) => {
      suggestions.push({
        label: option.label,
        value: `status:${option.value}`,
        icon: 'flag',
        description: 'Status',
        kind: 'status',
      });
    });

  const filtered = query
    ? suggestions.filter(
        (suggestion) =>
          suggestion.label.toLowerCase().includes(query) ||
          suggestion.value.toLowerCase().includes(query),
      )
    : suggestions;

  return filtered.slice(0, params.maxResults ?? 8);
}

export function computeTagStats(businesses: readonly Business[]): TagInsightStat[] {
  const stats = new Map<string, number>();
  businesses.forEach((business) => {
    business.tags?.forEach((tag) => {
      stats.set(tag, (stats.get(tag) ?? 0) + 1);
    });
  });
  return Array.from(stats.entries()).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de', { sensitivity: 'base' }),
  );
}

export function computeOverviewMetrics(businesses: readonly Business[]): PipelineMetrics {
  const total = businesses.length;
  let active = 0;
  let completed = 0;
  let overdue = 0;
  let dueSoon = 0;
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  const soonThreshold = new Date(startToday);
  soonThreshold.setDate(soonThreshold.getDate() + 7);

  businesses.forEach((business) => {
    if (business.status === 'erledigt') {
      completed += 1;
    } else {
      active += 1;
    }

    if (!business.dueDate) {
      return;
    }

    const due = new Date(business.dueDate);
    if (due < startToday) {
      overdue += 1;
      return;
    }
    if (due >= startToday && due <= soonThreshold) {
      dueSoon += 1;
    }
  });

  return {
    total,
    active,
    completed,
    overdue,
    dueSoon,
  };
}

export function computeTopAssignments(businesses: readonly Business[]): AssignmentInsight[] {
  const stats = new Map<string, { count: number; type: Business['assignment']['type'] }>();
  businesses.forEach((business) => {
    const entry = stats.get(business.assignment.name) ?? {
      count: 0,
      type: business.assignment.type,
    };
    entry.count += 1;
    entry.type = business.assignment.type;
    stats.set(business.assignment.name, entry);
  });
  return Array.from(stats.entries())
    .map(([name, info]) => ({ name, type: info.type, count: info.count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }))
    .slice(0, 3);
}

export function computeStatusBreakdown(
  businesses: readonly Business[],
  statusLabel: (status: BusinessStatus) => string,
): StatusBreakdownEntry[] {
  const counts = new Map<BusinessStatus, number>();
  businesses.forEach((business) => {
    counts.set(business.status, (counts.get(business.status) ?? 0) + 1);
  });
  const statuses: BusinessStatus[] = ['neu', 'in_arbeit', 'pausiert', 'erledigt'];
  return statuses
    .map((status) => ({
      status,
      label: statusLabel(status),
      count: counts.get(status) ?? 0,
    }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'de', { sensitivity: 'base' }));
}

export function computeDueSoonHighlights(businesses: readonly Business[]): Business[] {
  return businesses
    .filter((business) => business.dueDate && business.status !== 'erledigt')
    .sort(
      (a, b) =>
        new Date(a.dueDate ?? 0).getTime() - new Date(b.dueDate ?? 0).getTime(),
    )
    .slice(0, 3);
}

export function computeInsightContext(params: {
  filters: BusinessFilters;
  search: string;
  resultCount: number;
  statusLabel: (status: BusinessStatus) => string;
  dueDateLabelLookup: Record<BusinessDueDateFilter, string>;
  formatTagLabel: (tag: string) => string;
  metrics: PipelineMetrics;
}): BusinessInsightContext {
  const filters = params.filters;
  const search = params.search.trim();
  const resultCount = params.resultCount;

  if (search.length) {
    return {
      title: 'Suche aktiv',
      message: `Gefiltert nach "${search}" · ${resultCount} Treffer.`,
      hint: 'Suche leeren, um wieder alle Geschäfte zu sehen.',
      icon: 'search',
    };
  }
  if (filters.status !== 'all') {
    return {
      title: 'Statusfilter aktiv',
      message: `${params.statusLabel(filters.status as BusinessStatus)} · ${resultCount} Treffer.`,
      hint: 'Status oben im Filterbereich zurücksetzen.',
      icon: 'flag',
    };
  }
  if (filters.assignment !== 'all') {
    return {
      title: 'Zuständigkeit aktiv',
      message: `${filters.assignment} · ${resultCount} Geschäfte.`,
      hint: 'Zuständigkeitsfilter anpassen, um weitere anzuzeigen.',
      icon: 'groups',
    };
  }
  if (filters.dueDate !== 'all') {
    return {
      title: 'Fälligkeit aktiv',
      message: `${params.dueDateLabelLookup[filters.dueDate]} · ${resultCount} Geschäfte.`,
      hint: 'Preset in der Suche zurücksetzen für alle Termine.',
      icon: 'event',
    };
  }
  if (filters.tags.length) {
    return {
      title: 'Tags aktiv',
      message: `${filters.tags.map((tag) => params.formatTagLabel(tag)).join(', ')}`,
      hint: 'Tag-Chips unten anklicken, um Filter zu entfernen.',
      icon: 'sell',
    };
  }
  const metrics = params.metrics;
  return {
    title: 'Pipeline Überblick',
    message: `${metrics.total} Geschäfte · ${metrics.overdue} überfällig · ${metrics.dueSoon} fällig in 7 Tagen.`,
    hint: 'Nutze die Insights, um schnell in Tags, Zuständigkeiten oder Termine zu springen.',
    icon: 'insights',
  };
}

export function tagTone(
  tag: string,
): 'region' | 'phase' | 'risk' | 'priority' | 'default' {
  const normalized = tag.toLowerCase();
  if (
    normalized.startsWith('de-') ||
    ['ch', 'at', 'basel'].some((region) => normalized.includes(region))
  ) {
    return 'region';
  }
  if (
    ['pitch', 'rollout', 'vertrag', 'pilot'].some((keyword) =>
      normalized.includes(keyword),
    )
  ) {
    return 'phase';
  }
  if (
    ['risk', 'risiko', 'escalation', 'warn'].some((keyword) =>
      normalized.includes(keyword),
    )
  ) {
    return 'risk';
  }
  if (
    ['highimpact', 'premium', 'prio'].some((keyword) =>
      normalized.includes(keyword),
    )
  ) {
    return 'priority';
  }
  return 'default';
}

export function buildOrderItemLookup(orderItemOptions: readonly OrderItemOption[]): Map<string, OrderItemOption> {
  const map = new Map<string, OrderItemOption>();
  orderItemOptions.forEach((option) => map.set(option.itemId, option));
  return map;
}

export function orderItemRange(
  itemId: string,
  orderItemLookup: Map<string, OrderItemOption>,
  datePipe: DatePipe,
): string | null {
  const meta = orderItemLookup.get(itemId);
  if (!meta?.start && !meta?.end) {
    return null;
  }
  const start = meta?.start ? datePipe.transform(meta.start, 'short') : '—';
  const end = meta?.end ? datePipe.transform(meta.end, 'short') : '—';
  return `${start} – ${end}`;
}

export function assignmentInitials(business: Business): string {
  return business.assignment.name
    .split(' ')
    .map((chunk) => chunk.trim()[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function buildBusinessHighlights(
  business: Business,
  params: {
    datePipe: DatePipe;
    statusLabel: (status: BusinessStatus) => string;
    assignmentIcon: (business: Business) => string;
    assignmentLabel: (business: Business) => string;
  },
): BusinessHighlight[] {
  const highlights: BusinessHighlight[] = [];
  highlights.push({
    icon: 'flag',
    label: params.statusLabel(business.status),
    filter: { kind: 'status', value: business.status },
  });
  highlights.push({
    icon: params.assignmentIcon(business),
    label: params.assignmentLabel(business),
    filter: { kind: 'assignment', value: business.assignment.name },
  });
  const dueLabel = business.dueDate
    ? params.datePipe.transform(business.dueDate, 'mediumDate')
    : null;
  const createdLabel =
    params.datePipe.transform(business.createdAt, 'short') ?? business.createdAt;
  highlights.push({
    icon: 'event_available',
    label: `Erstellt ${createdLabel}`,
  });
  highlights.push({
    icon: 'schedule',
    label: dueLabel ? `Fällig ${dueLabel}` : 'Keine Fälligkeit',
  });
  return highlights;
}

export function daysUntilDue(business: Business): number | null {
  if (!business.dueDate) {
    return null;
  }
  const due = new Date(business.dueDate);
  const now = new Date();
  const diff = due.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function dueProgress(business: Business): number {
  const created = new Date(business.createdAt).getTime();
  if (!business.dueDate) {
    return 0;
  }
  const due = new Date(business.dueDate).getTime();
  if (Number.isNaN(created) || Number.isNaN(due) || due <= created) {
    return 100;
  }
  const now = Date.now();
  const total = due - created;
  const elapsed = Math.min(Math.max(0, now - created), total);
  return Math.round((elapsed / total) * 100);
}

export function businessMetrics(business: Business): BusinessMetric[] {
  const linked = business.linkedOrderItemIds?.length ?? 0;
  const docs = business.documents?.length ?? 0;
  const daysLeft = daysUntilDue(business);
  return [
    {
      label: 'Positionen',
      value: linked,
      icon: 'work',
      hint: 'Verknüpfte Auftragspositionen',
    },
    {
      label: 'Dokumente',
      value: docs,
      icon: 'attach_file',
      hint: 'Hinterlegte Geschäftsdokumente',
    },
    {
      label: 'Tage übrig',
      value: daysLeft ?? '—',
      icon: 'calendar_today',
      hint: 'Tage bis zur Fälligkeit',
    },
  ];
}

export function businessTimeline(business: Business, datePipe: DatePipe): TimelineEntry[] {
  const created = new Date(business.createdAt);
  const due = business.dueDate ? new Date(business.dueDate) : null;
  const today = new Date();
  const createdLabel = datePipe.transform(created, 'mediumDate') ?? created.toDateString();
  const dueLabel = due ? datePipe.transform(due, 'mediumDate') ?? due.toDateString() : 'Keine Angabe';

  const dueState: TimelineState = due
    ? isBeforeDay(due, today)
      ? 'past'
      : isSameDay(due, today)
      ? 'current'
      : 'future'
    : 'none';

  return [
    {
      label: 'Erstellt',
      description: createdLabel,
      state: 'past',
      date: created,
    },
    {
      label: 'Heute',
      description: datePipe.transform(today, 'mediumDate') ?? '',
      state: dueState === 'past' ? 'past' : dueState === 'current' ? 'current' : 'future',
      date: today,
    },
    {
      label: 'Fälligkeit',
      description: dueLabel,
      state: dueState,
      date: due,
    },
  ];
}

export function businessActivityFeed(
  business: Business,
  params: {
    datePipe: DatePipe;
    statusLabel: (status: BusinessStatus) => string;
  },
): ActivityFeedItem[] {
  const items: ActivityFeedItem[] = [
    {
      icon: 'flag',
      title: `Status: ${params.statusLabel(business.status)}`,
      subtitle: `Aktualisiert am ${params.datePipe.transform(new Date(business.createdAt), 'medium') ?? ''}`,
    },
  ];

  if (business.dueDate) {
    items.push({
      icon: 'calendar_today',
      title: 'Fälligkeit geplant',
      subtitle: params.datePipe.transform(business.dueDate, 'fullDate') ?? business.dueDate,
    });
  }

  if (business.linkedOrderItemIds?.length) {
    items.push({
      icon: 'link',
      title: `${business.linkedOrderItemIds.length} Position${business.linkedOrderItemIds.length === 1 ? '' : 'en'} verknüpft`,
      subtitle: 'Zuletzt gepflegt im Positionen-Tab',
    });
  }

  return items;
}

export function healthBadge(business: Business): HealthBadge {
  if (business.status === 'erledigt') {
    return { tone: 'done', label: 'Abgeschlossen' };
  }
  const daysLeft = daysUntilDue(business);
  if (daysLeft === null) {
    return { tone: 'idle', label: 'Ohne Termin' };
  }
  if (daysLeft < 0) {
    return {
      tone: 'critical',
      label: `${Math.abs(daysLeft)} Tage überfällig`,
    };
  }
  if (daysLeft <= 3) {
    return {
      tone: 'warning',
      label: `Fällig in ${daysLeft} Tag${daysLeft === 1 ? '' : 'en'}`,
    };
  }
  return { tone: 'ok', label: 'Im Plan' };
}

export function assignmentLabel(business: Business): string {
  return business.assignment.type === 'group'
    ? `Gruppe ${business.assignment.name}`
    : business.assignment.name;
}

export function assignmentIcon(business: Business): string {
  return business.assignment.type === 'group' ? 'groups' : 'person';
}

export function dueDateState(
  business: Business,
): 'overdue' | 'today' | 'upcoming' | 'none' {
  if (!business.dueDate) {
    return 'none';
  }
  const due = new Date(business.dueDate);
  const today = new Date();
  if (isBeforeDay(due, today)) {
    return 'overdue';
  }
  if (isSameDay(due, today)) {
    return 'today';
  }
  return 'upcoming';
}

export function trackByBusinessId(_: number, business: Business): string {
  return business.id;
}

export function businessElementId(id: string): string {
  return `business-${id}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isBeforeDay(a: Date, b: Date): boolean {
  const startA = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const startB = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return startA.getTime() < startB.getTime();
}

