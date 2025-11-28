import { Business } from '../models/business.model';

export const MOCK_BUSINESSES: Business[] = [
  {
    id: 'BUS-ICE-01',
    title: 'TTT Abstimmung ICE 1501',
    description: 'Abstimmen der Splitting-Zeiten mit InfraGO und Köln Hbf.',
    createdAt: '2030-01-04T09:15:00',
    dueDate: '2030-02-01T15:00:00',
    status: 'in_arbeit',
    assignment: {
      type: 'group',
      name: 'Fernverkehr Betrieb',
    },
    documents: [
      { id: 'BUS-ICE-01-DOC-1', name: 'TTT-Angebot.pdf', url: '#' },
      { id: 'BUS-ICE-01-DOC-2', name: 'Splitting-Checkliste.xlsx', url: '#' },
    ],
    linkedOrderItemIds: ['ORD-2030-001-OP-001', 'ORD-2030-001-OP-002'],
    tags: ['DE-Nord', 'Rollout', 'HighImpact'],
  },
  {
    id: 'BUS-RE-01',
    title: 'RVK Bern – Zürich',
    description: 'Rahmenvertragskapazität prüfen und Abnahme dokumentieren.',
    createdAt: '2030-01-10T08:00:00',
    dueDate: '2030-01-20T17:00:00',
    status: 'neu',
    assignment: {
      type: 'person',
      name: 'Luca Nef',
    },
    linkedOrderItemIds: ['ORD-2030-002-OP-001'],
    tags: ['CH', 'Pitch', 'Premiumkunde'],
  },
  {
    id: 'BUS-CARGO-01',
    title: 'Korridor Night Slot Basel',
    description: 'Sperrzeiten Basel RB abstimmen und Ersatzfenster kommunizieren.',
    createdAt: '2030-01-12T12:30:00',
    dueDate: '2030-02-05T09:00:00',
    status: 'pausiert',
    assignment: {
      type: 'group',
      name: 'CargoNet Dispatch',
    },
    linkedOrderItemIds: ['ORD-2030-003-OP-001'],
    tags: ['Basel', 'Nacht', 'Escalation'],
  },
];
