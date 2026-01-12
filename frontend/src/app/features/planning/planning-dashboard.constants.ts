import type { Activity } from '../../models/activity';
import type { PlanningStageId } from './planning-stage.model';
import type { StageResourceGroupConfig } from './planning-dashboard-board.facade';

export interface PendingActivityState {
  stage: PlanningStageId;
  activity: Activity;
}

export interface ActivityEditPreviewState {
  stage: PlanningStageId;
  activity: Activity;
}

export const STAGE_RESOURCE_GROUPS: Record<PlanningStageId, StageResourceGroupConfig[]> = {
  base: [
    {
      category: 'vehicle-service',
      label: 'Fahrzeugdienste',
      description:
        'Umläufe und Fahrzeugdienste, die in den Pools der Planwoche entworfen werden.',
      icon: 'train',
    },
    {
      category: 'personnel-service',
      label: 'Personaldienste',
      description:
        'Dienstfolgen für Fahr- und Begleitpersonal innerhalb der Planwoche.',
      icon: 'badge',
    },
  ],
  operations: [
    {
      category: 'vehicle-service',
      label: 'Fahrzeugdienste (Pool)',
      description:
        'Standardisierte Dienste aus der Basisplanung als Grundlage für den Jahresausroll.',
      icon: 'train',
    },
    {
      category: 'personnel-service',
      label: 'Personaldienste (Pool)',
      description:
        'Personaldienste aus der Basisplanung zur Verknüpfung mit Ressourcen.',
      icon: 'assignment_ind',
    },
    {
      category: 'vehicle',
      label: 'Fahrzeuge',
      description:
        'Reale Fahrzeuge, die über das Jahr disponiert und mit Diensten verknüpft werden.',
      icon: 'directions_transit',
    },
    {
      category: 'personnel',
      label: 'Personal',
      description:
        'Einsatzkräfte mit Verfügbarkeiten, Leistungen sowie Ruhetagen und Ferien.',
      icon: 'groups',
    },
  ],
};
