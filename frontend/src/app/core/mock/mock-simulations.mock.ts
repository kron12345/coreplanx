import { SimulationRecord } from '../models/simulation.model';

export const MOCK_SIMULATIONS: SimulationRecord[] = [
  {
    id: 'SIM-2029-A',
    label: 'Simulation A · Kurzkonzept FV 2029/30',
    timetableYearLabel: '2029/30',
    description: 'Frühe Varianten mit verkürzten Wenden für den ICE Nord-Süd-Korridor.',
  },
  {
    id: 'SIM-2030-B',
    label: 'Simulation B · RE West 2030',
    timetableYearLabel: '2030/31',
    description: 'Testfahrplan mit alternativen Trassenlagen und verlängerten Umläufen.',
  },
  {
    id: 'SIM-2030-C',
    label: 'Simulation C · Güterkorridor Rhein',
    timetableYearLabel: '2030/31',
    description: 'Kapazitätsstudie mit zusätzlichen Nachtlagen im Güterverkehr.',
  },
];
