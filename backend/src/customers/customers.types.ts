export interface CustomerContact {
  id: string;
  name: string;
  role?: string;
  email?: string;
  phone?: string;
}

export interface CustomerDto {
  id: string;
  name: string;
  customerNumber: string;
  projectNumber?: string;
  address?: string;
  notes?: string;
  contacts: CustomerContact[];
  createdAt?: string;
  updatedAt?: string;
}

export interface CustomerSearchRequest {
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface CustomerSearchResponse {
  customers: CustomerDto[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface CreateCustomerPayload {
  name: string;
  customerNumber: string;
  projectNumber?: string;
  address?: string;
  notes?: string;
  contacts?: CustomerContact[];
}

export type UpdateCustomerPayload = Partial<CreateCustomerPayload>;
