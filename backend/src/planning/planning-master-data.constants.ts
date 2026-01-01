export const SYSTEM_POOL_IDS = {
  personnelServicePool: 'SYS-PERSONNEL-SERVICE-POOL',
  personnelPool: 'SYS-PERSONNEL-POOL',
  vehicleServicePool: 'SYS-VEHICLE-SERVICE-POOL',
  vehiclePool: 'SYS-VEHICLE-POOL',
} as const;

export const SYSTEM_POOL_LABELS = {
  personnelServicePool: 'System: Gelöschte Personaldienste',
  personnelPool: 'System: Gelöschtes Personal',
  vehicleServicePool: 'System: Gelöschte Fahrzeugdienste',
  vehiclePool: 'System: Gelöschte Fahrzeuge',
} as const;

export const SYSTEM_POOL_DESCRIPTIONS = {
  personnelServicePool: 'System-Pool für gelöschte oder nicht zugeordnete Personaldienste.',
  personnelPool: 'System-Pool für gelöschtes oder nicht zugeordnetes Personal.',
  vehicleServicePool: 'System-Pool für gelöschte oder nicht zugeordnete Fahrzeugdienste.',
  vehiclePool: 'System-Pool für gelöschte oder nicht zugeordnete Fahrzeuge.',
} as const;
