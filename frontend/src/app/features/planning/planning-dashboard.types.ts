import { ActivityAttributeValue as ActivityCatalogAttribute } from '../../core/services/activity-catalog.service';
import { ActivityTypeDefinition, ActivityCategory } from '../../core/services/activity-type.service';
import { ResourceKind } from '../../models/resource';

export interface ActivityCatalogOption {
  id: string; // activity key
  label: string;
  description?: string;
  defaultDurationMinutes: number | null;
  attributes: ActivityCatalogAttribute[];
  templateId: string | null;
  activityTypeId: string;
  typeDefinition: ActivityTypeDefinition;
  relevantFor?: ResourceKind[];
  category?: ActivityCategory;
}
