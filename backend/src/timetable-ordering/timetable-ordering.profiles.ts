import {
  OrderingEventTuple,
  OrderingProcessProfileId,
  SimulatorResponseType,
  TimetableOrderingProfileSummary,
} from './timetable-ordering.types';

export interface OrderingRequiredAttributeDefinition {
  key: string;
  label: string;
  scope: 'case' | 'provided';
  path: string;
}

export interface OrderingActionDefinition {
  id: string;
  label: string;
  fromStates: string[];
  event: OrderingEventTuple;
  requiresCompleteRequired?: boolean;
}

export interface OrderingTransitionDefinition {
  fromState: string;
  toState: string;
  event: OrderingEventTuple;
  description: string;
}

export interface OrderingProcessProfileDefinition {
  id: OrderingProcessProfileId;
  label: string;
  description: string;
  initialState: string;
  terminalStates: string[];
  requiredAttributes: OrderingRequiredAttributeDefinition[];
  actions: OrderingActionDefinition[];
  transitions: OrderingTransitionDefinition[];
}

const RU: OrderingEventTuple['actor'] = 'RAILWAY_UNDERTAKING';
const IM: OrderingEventTuple['actor'] = 'INFRASTRUCTURE_MANAGER';

const COMMON_REQUIRED: OrderingRequiredAttributeDefinition[] = [
  {
    key: 'train_plan_id',
    label: 'Verknüpfter Fahrplan',
    scope: 'case',
    path: 'trainPlanId',
  },
  {
    key: 'path_request_id',
    label: 'PathRequestID',
    scope: 'case',
    path: 'pathRequestId',
  },
  {
    key: 'responsible_ru',
    label: 'Verantwortliches EVU',
    scope: 'provided',
    path: 'responsibleRu',
  },
  {
    key: 'train_number',
    label: 'Zugnummer',
    scope: 'provided',
    path: 'trainNumber',
  },
  {
    key: 'origin_location',
    label: 'Start-Betriebsstelle',
    scope: 'provided',
    path: 'originLocationCode',
  },
  {
    key: 'destination_location',
    label: 'Ziel-Betriebsstelle',
    scope: 'provided',
    path: 'destinationLocationCode',
  },
  {
    key: 'rolling_stock_segments',
    label: 'Fahrzeugsegmente',
    scope: 'provided',
    path: 'rollingStock.segments',
  },
  {
    key: 'ttt_phase',
    label: 'TTT-Phase',
    scope: 'provided',
    path: 'tttPhase',
  },
  {
    key: 'ttr_phase',
    label: 'TTR-Phase',
    scope: 'provided',
    path: 'ttrPhase',
  },
  {
    key: 'valid_from',
    label: 'Gültig von',
    scope: 'case',
    path: 'validFrom',
  },
  {
    key: 'valid_to',
    label: 'Gültig bis',
    scope: 'case',
    path: 'validTo',
  },
];

const ANNUAL_REQUIRED: OrderingRequiredAttributeDefinition[] = [
  ...COMMON_REQUIRED,
  {
    key: 'annual_window',
    label: 'Jahresbestellfenster-Referenz',
    scope: 'provided',
    path: 'annualRequestWindow',
  },
];

const OCCASIONAL_REQUIRED: OrderingRequiredAttributeDefinition[] = [
  ...COMMON_REQUIRED,
  {
    key: 'requested_departure_time',
    label: 'Gewünschte Abfahrtszeit',
    scope: 'provided',
    path: 'requestedDepartureTime',
  },
];

const ANNUAL_PROFILE: OrderingProcessProfileDefinition = {
  id: 'annual_order',
  label: 'Jahresbestellung',
  description:
    'Profil für Netzfahrplan-/Jahresbestellung mit Draft Offer, Final Offer und Buchungsabschluss.',
  initialState: 'DRAFT',
  terminalStates: ['BOOKED', 'INACTIVE'],
  requiredAttributes: ANNUAL_REQUIRED,
  actions: [
    {
      id: 'send_request',
      label: 'Bestellung senden',
      fromStates: ['DRAFT'],
      event: {
        actor: RU,
        messageType: 2006,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 4,
      },
      requiresCompleteRequired: true,
    },
    {
      id: 'request_revision',
      label: 'Überarbeitung anfordern',
      fromStates: ['DRAFT_OFFER', 'FINAL_OFFER'],
      event: {
        actor: RU,
        messageType: 2004,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 27,
      },
    },
    {
      id: 'accept_offer',
      label: 'Angebot annehmen',
      fromStates: ['FINAL_OFFER'],
      event: {
        actor: RU,
        messageType: 2002,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 17,
      },
    },
    {
      id: 'reject_offer',
      label: 'Angebot ablehnen',
      fromStates: ['FINAL_OFFER'],
      event: {
        actor: RU,
        messageType: 2004,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 25,
      },
    },
    {
      id: 'withdraw_request',
      label: 'Bestellung zurückziehen',
      fromStates: [
        'DRAFT',
        'PATH_REQUEST_SENT',
        'PLANNING',
        'DRAFT_OFFER',
        'REVISION_REQUESTED',
        'FINAL_OFFER',
      ],
      event: {
        actor: RU,
        messageType: 2006,
        messageStatus: 3,
        typeOfRequest: 2,
        typeOfInformation: 29,
      },
    },
  ],
  transitions: [
    {
      description: 'Bestellung absenden',
      fromState: 'DRAFT',
      toState: 'PATH_REQUEST_SENT',
      event: {
        actor: RU,
        messageType: 2006,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 4,
      },
    },
    {
      description: 'Bestätigung erhalten',
      fromState: 'PATH_REQUEST_SENT',
      toState: 'PLANNING',
      event: {
        actor: IM,
        messageType: 2007,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 4,
      },
    },
    {
      description: 'Bestätigung erhalten (Update)',
      fromState: 'PATH_REQUEST_SENT',
      toState: 'PLANNING',
      event: {
        actor: IM,
        messageType: 2007,
        messageStatus: 2,
        typeOfRequest: 2,
        typeOfInformation: 4,
      },
    },
    {
      description: 'Draft Offer erhalten',
      fromState: 'PLANNING',
      toState: 'DRAFT_OFFER',
      event: {
        actor: IM,
        messageType: 2003,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 9,
      },
    },
    {
      description: 'Überarbeitung angefordert',
      fromState: 'DRAFT_OFFER',
      toState: 'REVISION_REQUESTED',
      event: {
        actor: RU,
        messageType: 2004,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 27,
      },
    },
    {
      description: 'Final Offer erhalten',
      fromState: 'DRAFT_OFFER',
      toState: 'FINAL_OFFER',
      event: {
        actor: IM,
        messageType: 2003,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 16,
      },
    },
    {
      description: 'Final Offer erhalten (neu)',
      fromState: 'REVISION_REQUESTED',
      toState: 'FINAL_OFFER',
      event: {
        actor: IM,
        messageType: 2003,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 16,
      },
    },
    {
      description: 'Final Offer erhalten (geändert)',
      fromState: 'REVISION_REQUESTED',
      toState: 'FINAL_OFFER',
      event: {
        actor: IM,
        messageType: 2003,
        messageStatus: 2,
        typeOfRequest: 2,
        typeOfInformation: 16,
      },
    },
    {
      description: 'Angebot angenommen',
      fromState: 'FINAL_OFFER',
      toState: 'FINAL_OFFER_ACCEPTED',
      event: {
        actor: RU,
        messageType: 2002,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 17,
      },
    },
    {
      description: 'Buchungsbestätigung',
      fromState: 'FINAL_OFFER_ACCEPTED',
      toState: 'BOOKED',
      event: {
        actor: IM,
        messageType: 2003,
        messageStatus: 2,
        typeOfRequest: 2,
        typeOfInformation: 22,
      },
    },
    {
      description: 'Angebot abgelehnt',
      fromState: 'FINAL_OFFER',
      toState: 'INACTIVE',
      event: {
        actor: RU,
        messageType: 2004,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 25,
      },
    },
    {
      description: 'Kein Pfad verfügbar',
      fromState: 'PLANNING',
      toState: 'INACTIVE',
      event: {
        actor: IM,
        messageType: 2003,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 21,
      },
    },
    {
      description: 'Rückzug/Abbruch durch IM',
      fromState: '*',
      toState: 'INACTIVE',
      event: {
        actor: IM,
        messageType: 2003,
        messageStatus: 3,
        typeOfRequest: 2,
        typeOfInformation: 29,
      },
    },
    {
      description: 'Rückzug',
      fromState: '*',
      toState: 'INACTIVE',
      event: {
        actor: RU,
        messageType: 2006,
        messageStatus: 3,
        typeOfRequest: 2,
        typeOfInformation: 29,
      },
    },
  ],
};

const OCCASIONAL_PROFILE: OrderingProcessProfileDefinition = {
  id: 'occasional_traffic',
  label: 'Gelegenheitsverkehr',
  description:
    'Profil für kurzfristige/gelegenheitsbezogene Bestellungen mit Offer- und Revision-Flow.',
  initialState: 'DRAFT',
  terminalStates: ['BOOKED', 'INACTIVE'],
  requiredAttributes: OCCASIONAL_REQUIRED,
  actions: [
    {
      id: 'send_request',
      label: 'Bestellung senden',
      fromStates: ['DRAFT'],
      event: {
        actor: RU,
        messageType: 2006,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 4,
      },
      requiresCompleteRequired: true,
    },
    {
      id: 'request_revision',
      label: 'Überarbeitung anfordern',
      fromStates: ['OFFER'],
      event: {
        actor: RU,
        messageType: 2004,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 27,
      },
    },
    {
      id: 'accept_offer',
      label: 'Angebot annehmen',
      fromStates: ['OFFER'],
      event: {
        actor: RU,
        messageType: 2002,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 17,
      },
    },
    {
      id: 'reject_offer',
      label: 'Angebot ablehnen',
      fromStates: ['OFFER'],
      event: {
        actor: RU,
        messageType: 2004,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 25,
      },
    },
    {
      id: 'withdraw_request',
      label: 'Bestellung zurückziehen',
      fromStates: [
        'DRAFT',
        'PATH_REQUEST_SENT',
        'PLANNING',
        'OFFER',
        'REVISION_REQUESTED',
      ],
      event: {
        actor: RU,
        messageType: 2006,
        messageStatus: 3,
        typeOfRequest: 2,
        typeOfInformation: 29,
      },
    },
  ],
  transitions: [
    {
      description: 'Bestellung absenden',
      fromState: 'DRAFT',
      toState: 'PATH_REQUEST_SENT',
      event: {
        actor: RU,
        messageType: 2006,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 4,
      },
    },
    {
      description: 'Bestätigung erhalten',
      fromState: 'PATH_REQUEST_SENT',
      toState: 'PLANNING',
      event: {
        actor: IM,
        messageType: 2007,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 4,
      },
    },
    {
      description: 'Offer erhalten',
      fromState: 'PLANNING',
      toState: 'OFFER',
      event: {
        actor: IM,
        messageType: 2003,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 16,
      },
    },
    {
      description: 'Kein Pfad verfügbar',
      fromState: 'PLANNING',
      toState: 'INACTIVE',
      event: {
        actor: IM,
        messageType: 2003,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 21,
      },
    },
    {
      description: 'Angebot angenommen',
      fromState: 'OFFER',
      toState: 'OFFER_ACCEPTED',
      event: {
        actor: RU,
        messageType: 2002,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 17,
      },
    },
    {
      description: 'Buchungsbestätigung',
      fromState: 'OFFER_ACCEPTED',
      toState: 'BOOKED',
      event: {
        actor: IM,
        messageType: 2003,
        messageStatus: 2,
        typeOfRequest: 2,
        typeOfInformation: 22,
      },
    },
    {
      description: 'Überarbeitung angefordert',
      fromState: 'OFFER',
      toState: 'REVISION_REQUESTED',
      event: {
        actor: RU,
        messageType: 2004,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 27,
      },
    },
    {
      description: 'Finales Angebot (neu)',
      fromState: 'REVISION_REQUESTED',
      toState: 'OFFER',
      event: {
        actor: IM,
        messageType: 2003,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 16,
      },
    },
    {
      description: 'Finales Angebot (geändert)',
      fromState: 'REVISION_REQUESTED',
      toState: 'OFFER',
      event: {
        actor: IM,
        messageType: 2003,
        messageStatus: 2,
        typeOfRequest: 2,
        typeOfInformation: 16,
      },
    },
    {
      description: 'Angebot abgelehnt',
      fromState: 'OFFER',
      toState: 'INACTIVE',
      event: {
        actor: RU,
        messageType: 2004,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 25,
      },
    },
    {
      description: 'Rückzug/Abbruch durch IM',
      fromState: '*',
      toState: 'INACTIVE',
      event: {
        actor: IM,
        messageType: 2003,
        messageStatus: 3,
        typeOfRequest: 2,
        typeOfInformation: 29,
      },
    },
    {
      description: 'Rückzug',
      fromState: '*',
      toState: 'INACTIVE',
      event: {
        actor: RU,
        messageType: 2006,
        messageStatus: 3,
        typeOfRequest: 2,
        typeOfInformation: 29,
      },
    },
  ],
};

const PROFILE_MAP: Record<OrderingProcessProfileId, OrderingProcessProfileDefinition> = {
  annual_order: ANNUAL_PROFILE,
  occasional_traffic: OCCASIONAL_PROFILE,
};

export function buildOrderingEventKey(event: OrderingEventTuple): string {
  const tuple = [
    event.actor,
    event.messageType ?? '-',
    event.messageStatus ?? '-',
    event.typeOfRequest ?? '-',
    event.typeOfInformation ?? '-',
  ];
  return tuple.join(':');
}

export function getOrderingProfile(
  profileId: OrderingProcessProfileId,
): OrderingProcessProfileDefinition {
  return PROFILE_MAP[profileId];
}

export function listOrderingProfiles(): TimetableOrderingProfileSummary[] {
  return Object.values(PROFILE_MAP).map((profile) => ({
    id: profile.id,
    label: profile.label,
    description: profile.description,
    initialState: profile.initialState,
    terminalStates: [...profile.terminalStates],
    requiredAttributes: profile.requiredAttributes.map((required) => ({
      key: required.key,
      label: required.label,
      scope: required.scope,
      path: required.path,
    })),
    actions: profile.actions.map((action) => ({
      id: action.id,
      label: action.label,
      fromStates: [...action.fromStates],
    })),
  }));
}

export function resolveSimulatorEvent(
  response: SimulatorResponseType,
): OrderingEventTuple {
  switch (response) {
    case 'receipt':
      return {
        actor: IM,
        messageType: 2007,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 4,
      };
    case 'draft_offer':
      return {
        actor: IM,
        messageType: 2003,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 9,
      };
    case 'final_offer':
      return {
        actor: IM,
        messageType: 2003,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 16,
      };
    case 'final_offer_changed':
      return {
        actor: IM,
        messageType: 2003,
        messageStatus: 2,
        typeOfRequest: 2,
        typeOfInformation: 16,
      };
    case 'booked':
      return {
        actor: IM,
        messageType: 2003,
        messageStatus: 2,
        typeOfRequest: 2,
        typeOfInformation: 22,
      };
    case 'not_available':
      return {
        actor: IM,
        messageType: 2003,
        messageStatus: 1,
        typeOfRequest: 2,
        typeOfInformation: 21,
      };
    case 'withdrawn':
      return {
        actor: IM,
        messageType: 2003,
        messageStatus: 3,
        typeOfRequest: 2,
        typeOfInformation: 29,
      };
    case 'error':
    default:
      return {
        actor: IM,
        messageType: 9000,
        messageStatus: 1,
        typeOfRequest: null,
        typeOfInformation: null,
      };
  }
}
