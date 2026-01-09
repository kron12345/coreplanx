import { ActivityAttributeValue as ActivityCatalogAttribute } from '../../core/services/activity-catalog.service';
import type { ActivityCategory, ActivityFieldKey, ActivityTimeMode } from '../../core/models/activity-definition';
import { ResourceKind } from '../../models/resource';

export interface ActivityCatalogOption {
  id: string; // activity key
  label: string;
  description?: string;
  defaultDurationMinutes: number | null;
  attributes: ActivityCatalogAttribute[];
  templateId: string | null;
  activityTypeId: string;
  relevantFor?: ResourceKind[] | null;
  category?: ActivityCategory | null;
  timeMode?: ActivityTimeMode | null;
  fields?: ActivityFieldKey[];
  isSystem?: boolean;
}

export interface ActivityTypePickerGroup {
  id: ActivityCategory;
  label: string;
  icon: string;
  items: ActivityCatalogOption[];
}
