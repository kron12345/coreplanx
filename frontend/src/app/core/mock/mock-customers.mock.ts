import { Customer } from '../models/customer.model';

export const MOCK_CUSTOMERS: Customer[] = [
  {
    id: 'cust-db-001',
    name: 'DB Fernverkehr',
    customerNumber: 'C-90001',
    projectNumber: 'P-23-ICE',
    address: 'Europa-Allee 78, 60486 Frankfurt',
    contacts: [
      {
        id: 'dbf-contact-1',
        name: 'Andrea Fuchs',
        role: 'Projektleitung',
        email: 'andrea.fuchs@dbfernverkehr.de',
        phone: '+49 69 1234 5678',
      },
      {
        id: 'dbf-contact-2',
        name: 'Silvan Lauterbach',
        role: 'Disposition',
        email: 'silvan.lauterbach@dbfernverkehr.de',
        phone: '+49 69 9876 5432',
      },
    ],
    notes: 'Rahmenvertrag für Fernverkehrstrassen, jährliche Abrufe.',
  },
  {
    id: 'cust-sbb-001',
    name: 'SBB Personenverkehr',
    customerNumber: 'C-74015',
    projectNumber: 'P-24-CH-Sprinter',
    address: 'Zollstrasse 60, 8005 Zürich',
    contacts: [
      {
        id: 'sbb-contact-1',
        name: 'Nora Widmer',
        role: 'Key Account',
        email: 'nora.widmer@sbb.ch',
        phone: '+41 44 123 45 67',
      },
    ],
    notes: 'Projekt mit Fokus auf Nachtverbindungen, monatliche Statuscalls.',
  },
  {
    id: 'cust-cargon-001',
    name: 'CargoNet Europe',
    customerNumber: 'C-30122',
    projectNumber: 'P-22-Freight-Nord',
    address: 'Brynsveien 5, 0667 Oslo',
    contacts: [
      {
        id: 'cne-contact-1',
        name: 'Mats Ødegård',
        role: 'Operations',
        email: 'mats.odegard@cargoneteu.com',
        phone: '+47 21 98 76 54',
      },
      {
        id: 'cne-contact-2',
        name: 'Lena Boström',
        role: 'Commercial',
        email: 'lena.bostrom@cargoneteu.com',
      },
    ],
    notes: 'Bedarfsgerechte Trassen, Fokus auf nordeuropäische Relationen.',
  },
];
