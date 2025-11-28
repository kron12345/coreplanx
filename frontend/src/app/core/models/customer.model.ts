export interface CustomerContact {
  id: string;
  name: string;
  role?: string;
  email?: string;
  phone?: string;
}

export interface Customer {
  id: string;
  name: string;
  customerNumber: string;
  projectNumber?: string;
  address?: string;
  contacts: CustomerContact[];
  notes?: string;
}
