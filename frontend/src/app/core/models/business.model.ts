export type BusinessStatus = 'neu' | 'pausiert' | 'in_arbeit' | 'erledigt';

export type BusinessAssignmentType = 'group' | 'person';

export interface BusinessAssignment {
  type: BusinessAssignmentType;
  name: string;
}

export interface BusinessDocument {
  id: string;
  name: string;
  url?: string;
}

export interface Business {
  id: string;
  title: string;
  description: string;
  createdAt: string; // ISO date
  dueDate?: string; // ISO date
  status: BusinessStatus;
  assignment: BusinessAssignment;
  documents?: BusinessDocument[];
  linkedOrderItemIds?: string[];
  tags?: string[];
}
