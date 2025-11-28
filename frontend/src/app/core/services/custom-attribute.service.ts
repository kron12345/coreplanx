import { Injectable, Signal, computed, signal } from '@angular/core';

export type CustomAttributePrimitiveType = 'string' | 'number' | 'boolean' | 'date' | 'time';

export interface CustomAttributeDefinition {
  id: string;
  key: string;
  label: string;
  type: CustomAttributePrimitiveType;
  description?: string;
  entityId: string;
  createdAt?: string;
  updatedAt?: string;
  /**
   * Kennzeichnet Attribute, die eine zeitliche Historie haben
   * (z. B. Werte mit Gültig-ab/-bis im Stammdatenformular).
   */
  temporal?: boolean;
  /**
   * Markiert Attribute als Pflichtfeld im Editor.
   */
  required?: boolean;
}

export interface CustomAttributeInput {
  label: string;
  type: CustomAttributePrimitiveType;
  description?: string;
  key?: string;
  temporal?: boolean;
  required?: boolean;
}

export interface CustomAttributeTarget {
  id: string;
  label: string;
  group: 'personal' | 'vehicle' | 'general';
  description: string;
}

export type CustomAttributeState = Record<string, CustomAttributeDefinition[]>;

const DEFAULT_STATE: CustomAttributeState = {
  'personnel-service-pools': [
    {
      id: 'attr-psp-coordinator',
      key: 'shiftCoordinator',
      label: 'Schichtkoordinator:in',
      type: 'string',
      description: 'Verantwortliche Person für die Dienstkoordination.',
      entityId: 'personnel-service-pools',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    {
      id: 'attr-psp-contact-email',
      key: 'contactEmail',
      label: 'Kontakt E-Mail',
      type: 'string',
      description: 'E-Mail-Adresse für kurzfristige Abstimmungen.',
      entityId: 'personnel-service-pools',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
  ],
  'personnel-services': [
    {
      id: 'attr-ps-start',
      key: 'startTime',
      label: 'Dienstbeginn',
      type: 'time',
      description: 'Geplanter Beginn der Schicht.',
      entityId: 'personnel-services',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    {
      id: 'attr-ps-end',
      key: 'endTime',
      label: 'Dienstende',
      type: 'time',
      description: 'Geplantes Ende der Schicht.',
      entityId: 'personnel-services',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    {
      id: 'attr-ps-night',
      key: 'isNightService',
      label: 'Nachtleistung',
      type: 'boolean',
      description: 'Kennzeichnet Schichten mit Nachtarbeitsanteilen.',
      entityId: 'personnel-services',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
  ],
  'personnel-pools': [
    {
      id: 'attr-pp-location',
      key: 'locationCode',
      label: 'Standortcode',
      type: 'string',
      description: 'Kurzkennung des Heimatstandortes.',
      entityId: 'personnel-pools',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
  ],
  personnel: [
    {
      id: 'attr-personnel-home',
      key: 'homeStation',
      label: 'Heimatbahnhof',
      type: 'string',
      description: 'Station, an der das Personal regulär startet.',
      entityId: 'personnel',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    {
      id: 'attr-personnel-status',
      key: 'availabilityStatus',
      label: 'Verfügbarkeitsstatus',
      type: 'string',
      description: 'Aktueller Dispositionsstatus.',
      entityId: 'personnel',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    {
      id: 'attr-personnel-qual-expiry',
      key: 'qualificationExpires',
      label: 'Qualifikation gültig bis',
      type: 'date',
      description: 'Nächstes Ablaufdatum der wichtigsten Berechtigungen.',
      entityId: 'personnel',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    {
      id: 'attr-personnel-reserve',
      key: 'isReserve',
      label: 'In Reserveplanung',
      type: 'boolean',
      description: 'Markiert Personal, das als Reserve geführt wird.',
      entityId: 'personnel',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
  ],
  'vehicle-service-pools': [
    {
      id: 'attr-vsp-dispatcher',
      key: 'dispatcher',
      label: 'Leitstelle',
      type: 'string',
      description: 'Zuständige Dispositionseinheit.',
      entityId: 'vehicle-service-pools',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
  ],
  'vehicle-services': [
    {
      id: 'attr-vs-start',
      key: 'startTime',
      label: 'Planstart',
      type: 'time',
      description: 'Planmäßiger Startzeitpunkt des Umlaufs.',
      entityId: 'vehicle-services',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    {
      id: 'attr-vs-end',
      key: 'endTime',
      label: 'Planende',
      type: 'time',
      description: 'Planmäßiger Endzeitpunkt des Umlaufs.',
      entityId: 'vehicle-services',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    {
      id: 'attr-vs-route',
      key: 'primaryRoute',
      label: 'Hauptlaufweg',
      type: 'string',
      description: 'Kurzbeschreibung der Strecke.',
      entityId: 'vehicle-services',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    {
      id: 'attr-vs-overnight',
      key: 'isOvernight',
      label: 'Mit Nachtlage',
      type: 'boolean',
      description: 'Enthält nächtliche Abstellung oder Nachtfahrt.',
      entityId: 'vehicle-services',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
  ],
  'vehicle-pools': [
    {
      id: 'attr-vp-manager',
      key: 'depotManager',
      label: 'Depotleitung',
      type: 'string',
      description: 'Verantwortliche Leitung des Fuhrparkstandorts.',
      entityId: 'vehicle-pools',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
  ],
  vehicles: [
    {
      id: 'attr-vehicle-wifi',
      key: 'hasWifi',
      label: 'WLAN an Bord',
      type: 'boolean',
      description: 'Verfügt das Fahrzeug über WLAN für Fahrgäste?',
      entityId: 'vehicles',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    {
      id: 'attr-vehicle-status',
      key: 'fleetStatus',
      label: 'Flottenstatus',
      type: 'string',
      description: 'Aktueller Einsatzstatus des Fahrzeugs.',
      entityId: 'vehicles',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    {
      id: 'attr-vehicle-inspection',
      key: 'lastInspectionDate',
      label: 'Letzte HU',
      type: 'date',
      description: 'Datum der letzten Hauptuntersuchung.',
      entityId: 'vehicles',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    {
      id: 'attr-vehicle-range',
      key: 'rangeKm',
      label: 'Reichweite (km)',
      type: 'number',
      description: 'Effektive Reichweite ohne Nachladung.',
      entityId: 'vehicles',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    {
      id: 'attr-vehicle-seat-res',
      key: 'seatReservation',
      label: 'Sitzplatzreservierung',
      type: 'boolean',
      description: 'Unterstützt das Fahrzeug Reservierungen?',
      entityId: 'vehicles',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
  ],
  'vehicle-types': [
    {
      id: 'attr-vt-max-speed',
      key: 'maxSpeed',
      label: 'Höchstgeschwindigkeit (km/h)',
      type: 'number',
      description: 'Technisch zugelassene Geschwindigkeit.',
      entityId: 'vehicle-types',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    {
      id: 'attr-vt-maintenance',
      key: 'maintenanceIntervalDays',
      label: 'Wartungsintervall (Tage)',
      type: 'number',
      description: 'Abstand zwischen turnusmäßigen Werkstattaufenthalten.',
      entityId: 'vehicle-types',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    {
      id: 'attr-vt-energy',
      key: 'energyType',
      label: 'Energieart',
      type: 'string',
      description: 'Primäre Energiequelle des Fahrzeugs.',
      entityId: 'vehicle-types',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    {
      id: 'attr-vt-manufacturer',
      key: 'manufacturer',
      label: 'Hersteller',
      type: 'string',
      description: 'Produzent des Fahrzeugtyps.',
      entityId: 'vehicle-types',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
  ],
  'vehicle-compositions': [
    {
      id: 'attr-vc-turnaround',
      key: 'turnaroundBuffer',
      label: 'Wendezeit Puffer',
      type: 'time',
      description: 'Geplanter Zeitpuffer zwischen zwei Einsätzen.',
      entityId: 'vehicle-compositions',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    {
      id: 'attr-vc-remark',
      key: 'remark',
      label: 'Bemerkung',
      type: 'string',
      description: 'Zusätzliche Hinweise zur Verwendung.',
      entityId: 'vehicle-compositions',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
  ],
  'topology-replacement-stops': [
    {
      id: 'attr-topology-rs-name',
      key: 'name',
      label: 'Name',
      type: 'string',
      description: 'Anzeigename der Ersatzhaltestelle.',
      entityId: 'topology-replacement-stops',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      temporal: true,
      required: true,
    },
    {
      id: 'attr-topology-rs-stop-code',
      key: 'stopCode',
      label: 'Stop-Code',
      type: 'string',
      description: 'Interner Code der Ersatzhaltestelle.',
      entityId: 'topology-replacement-stops',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      temporal: true,
    },
    {
      id: 'attr-topology-rs-op',
      key: 'nearestUniqueOpId',
      label: 'Nächster OP (uniqueOpId)',
      type: 'string',
      description: 'UniqueOpId der Betriebsstelle, zu der der Ersatzhalt gehört.',
      entityId: 'topology-replacement-stops',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      temporal: true,
    },
    {
      id: 'attr-topology-rs-lat',
      key: 'lat',
      label: 'Latitude',
      type: 'number',
      description: 'Geografische Breite des Ersatzhalts.',
      entityId: 'topology-replacement-stops',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      temporal: true,
      required: true,
    },
    {
      id: 'attr-topology-rs-lng',
      key: 'lng',
      label: 'Longitude',
      type: 'number',
      description: 'Geografische Länge des Ersatzhalts.',
      entityId: 'topology-replacement-stops',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      temporal: true,
      required: true,
    },
    {
      id: 'attr-topology-rs-shelter',
      key: 'shelter',
      label: 'Haltestellenüberdachung',
      type: 'string',
      description: 'Art der Haltestellenüberdachung (z. B. Überdacht, Offen).',
      entityId: 'topology-replacement-stops',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      temporal: true,
    },
  ],
  'topology-operational-points': [
    {
      id: 'attr-topology-op-unique-id',
      key: 'uniqueOpId',
      label: 'Unique OP ID',
      type: 'string',
      description: 'Technische ID der Betriebsstelle.',
      entityId: 'topology-operational-points',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      required: true,
    },
    {
      id: 'attr-topology-op-name',
      key: 'name',
      label: 'Name',
      type: 'string',
      description: 'Anzeigename der Betriebsstelle.',
      entityId: 'topology-operational-points',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      temporal: true,
      required: true,
    },
    {
      id: 'attr-topology-op-country',
      key: 'countryCode',
      label: 'Land (ISO)',
      type: 'string',
      description: 'Ländercode des OP.',
      entityId: 'topology-operational-points',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      temporal: true,
      required: true,
    },
    {
      id: 'attr-topology-op-type',
      key: 'opType',
      label: 'OP-Typ',
      type: 'string',
      description: 'Art der Betriebsstelle.',
      entityId: 'topology-operational-points',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      temporal: true,
      required: true,
    },
    {
      id: 'attr-topology-op-lat',
      key: 'lat',
      label: 'Latitude',
      type: 'number',
      description: 'Geografische Breite.',
      entityId: 'topology-operational-points',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      temporal: true,
      required: true,
    },
    {
      id: 'attr-topology-op-lng',
      key: 'lng',
      label: 'Longitude',
      type: 'number',
      description: 'Geografische Länge.',
      entityId: 'topology-operational-points',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      temporal: true,
      required: true,
    },
  ],
  'topology-sections-of-line': [
    {
      id: 'attr-topology-sol-start',
      key: 'startUniqueOpId',
      label: 'Start-OP',
      type: 'string',
      description: 'UniqueOpId des Startpunkts.',
      entityId: 'topology-sections-of-line',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      required: true,
    },
    {
      id: 'attr-topology-sol-end',
      key: 'endUniqueOpId',
      label: 'End-OP',
      type: 'string',
      description: 'UniqueOpId des Endpunkts.',
      entityId: 'topology-sections-of-line',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      required: true,
    },
    {
      id: 'attr-topology-sol-length',
      key: 'lengthKm',
      label: 'Länge (km)',
      type: 'number',
      description: 'Streckenlänge in Kilometern.',
      entityId: 'topology-sections-of-line',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    {
      id: 'attr-topology-sol-nature',
      key: 'nature',
      label: 'Nature',
      type: 'string',
      description: 'REGULAR oder LINK.',
      entityId: 'topology-sections-of-line',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      required: true,
    },
  ],
  'topology-personnel-sites': [
    {
      id: 'attr-topology-site-name',
      key: 'name',
      label: 'Name',
      type: 'string',
      description: 'Bezeichnung der Personaleinsatzstelle.',
      entityId: 'topology-personnel-sites',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      temporal: true,
      required: true,
    },
    {
      id: 'attr-topology-site-type',
      key: 'siteType',
      label: 'Typ',
      type: 'string',
      description: 'Art der Einsatzstelle.',
      entityId: 'topology-personnel-sites',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      required: true,
    },
    {
      id: 'attr-topology-site-op',
      key: 'uniqueOpId',
      label: 'Zugeordneter OP',
      type: 'string',
      description: 'Optionaler Bezug zu einem Operational Point.',
      entityId: 'topology-personnel-sites',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    {
      id: 'attr-topology-site-lat',
      key: 'lat',
      label: 'Latitude',
      type: 'number',
      description: 'Geografische Breite.',
      entityId: 'topology-personnel-sites',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      required: true,
    },
    {
      id: 'attr-topology-site-lng',
      key: 'lng',
      label: 'Longitude',
      type: 'number',
      description: 'Geografische Länge.',
      entityId: 'topology-personnel-sites',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      required: true,
    },
    {
      id: 'attr-topology-site-hours',
      key: 'openingHoursJson',
      label: 'Öffnungszeiten (JSON)',
      type: 'string',
      description: 'Frei definierte Öffnungszeiten im JSON-Format.',
      entityId: 'topology-personnel-sites',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
  ],
  'topology-replacement-routes': [
    {
      id: 'attr-topology-rr-name',
      key: 'name',
      label: 'Name',
      type: 'string',
      description: 'Bezeichnung der Ersatzlinie.',
      entityId: 'topology-replacement-routes',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      required: true,
    },
    {
      id: 'attr-topology-rr-operator',
      key: 'operator',
      label: 'Betreiber',
      type: 'string',
      description: 'Verantwortlicher Betreiber.',
      entityId: 'topology-replacement-routes',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
  ],
  'topology-replacement-edges': [
    {
      id: 'attr-topology-re-route',
      key: 'replacementRouteId',
      label: 'Route',
      type: 'string',
      description: 'ID der zugehörigen Ersatzlinie.',
      entityId: 'topology-replacement-edges',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      required: true,
    },
    {
      id: 'attr-topology-re-from',
      key: 'fromStopId',
      label: 'Von (Stop)',
      type: 'string',
      description: 'Start-Ersatzhalt.',
      entityId: 'topology-replacement-edges',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      required: true,
    },
    {
      id: 'attr-topology-re-to',
      key: 'toStopId',
      label: 'Nach (Stop)',
      type: 'string',
      description: 'Ziel-Ersatzhalt.',
      entityId: 'topology-replacement-edges',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      required: true,
    },
    {
      id: 'attr-topology-re-seq',
      key: 'seq',
      label: 'Sequenz',
      type: 'number',
      description: 'Sortierreihenfolge innerhalb der Route.',
      entityId: 'topology-replacement-edges',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      required: true,
    },
    {
      id: 'attr-topology-re-duration',
      key: 'avgDurationSec',
      label: 'Dauer (Sek.)',
      type: 'number',
      description: 'Durchschnittliche Fahrzeit.',
      entityId: 'topology-replacement-edges',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    {
      id: 'attr-topology-re-distance',
      key: 'distanceM',
      label: 'Distanz (Meter)',
      type: 'number',
      description: 'Streckenlänge in Metern.',
      entityId: 'topology-replacement-edges',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
  ],
  'topology-op-replacement-links': [
    {
      id: 'attr-topology-link-op',
      key: 'uniqueOpId',
      label: 'Operational Point',
      type: 'string',
      description: 'UniqueOpId der Betriebsstelle.',
      entityId: 'topology-op-replacement-links',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      required: true,
    },
    {
      id: 'attr-topology-link-stop',
      key: 'replacementStopId',
      label: 'Replacement Stop',
      type: 'string',
      description: 'Verknüpfter Ersatzhalt.',
      entityId: 'topology-op-replacement-links',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      required: true,
    },
    {
      id: 'attr-topology-link-relation',
      key: 'relationType',
      label: 'Relation',
      type: 'string',
      description: 'Art der Verknüpfung.',
      entityId: 'topology-op-replacement-links',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      required: true,
    },
    {
      id: 'attr-topology-link-walking',
      key: 'walkingTimeSec',
      label: 'Fußweg (Sek.)',
      type: 'number',
      description: 'Gehzeit zwischen OP und Ersatzhalt.',
      entityId: 'topology-op-replacement-links',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    {
      id: 'attr-topology-link-distance',
      key: 'distanceM',
      label: 'Distanz (Meter)',
      type: 'number',
      description: 'Distanz zwischen OP und Ersatzhalt.',
      entityId: 'topology-op-replacement-links',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
  ],
  'topology-transfer-edges': [
    {
      id: 'attr-topology-te-from-kind',
      key: 'fromKind',
      label: 'Von - Typ',
      type: 'string',
      description: 'OP, PERSONNEL_SITE oder REPLACEMENT_STOP.',
      entityId: 'topology-transfer-edges',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      required: true,
    },
    {
      id: 'attr-topology-te-from-ref',
      key: 'fromRef',
      label: 'Von - Referenz',
      type: 'string',
      description: 'UniqueOpId, SiteId oder ReplacementStopId.',
      entityId: 'topology-transfer-edges',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      required: true,
    },
    {
      id: 'attr-topology-te-to-kind',
      key: 'toKind',
      label: 'Nach - Typ',
      type: 'string',
      description: 'OP, PERSONNEL_SITE oder REPLACEMENT_STOP.',
      entityId: 'topology-transfer-edges',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      required: true,
    },
    {
      id: 'attr-topology-te-to-ref',
      key: 'toRef',
      label: 'Nach - Referenz',
      type: 'string',
      description: 'UniqueOpId, SiteId oder ReplacementStopId.',
      entityId: 'topology-transfer-edges',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      required: true,
    },
    {
      id: 'attr-topology-te-mode',
      key: 'mode',
      label: 'Modus',
      type: 'string',
      description: 'Transfermodus (WALK/SHUTTLE/INTERNAL).',
      entityId: 'topology-transfer-edges',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      required: true,
    },
    {
      id: 'attr-topology-te-duration',
      key: 'avgDurationSec',
      label: 'Dauer (Sek.)',
      type: 'number',
      description: 'Durchschnittliche Dauer.',
      entityId: 'topology-transfer-edges',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    {
      id: 'attr-topology-te-distance',
      key: 'distanceM',
      label: 'Distanz (Meter)',
      type: 'number',
      description: 'Geschätzte Distanz.',
      entityId: 'topology-transfer-edges',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    {
      id: 'attr-topology-te-bidirectional',
      key: 'bidirectional',
      label: 'Bidirektional',
      type: 'boolean',
      description: 'Ist die Kante in beide Richtungen gültig?',
      entityId: 'topology-transfer-edges',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      required: true,
    },
  ],
};

export const CUSTOM_ATTRIBUTE_TARGETS: CustomAttributeTarget[] = [
  {
    id: 'personnel-service-pools',
    label: 'Personaldienstpools',
    group: 'personal',
    description: 'Zusätzliche Attribute für Personaldienstpools',
  },
  {
    id: 'personnel-services',
    label: 'Personaldienste',
    group: 'personal',
    description: 'Attribute für einzelne Personaldienste',
  },
  {
    id: 'personnel-pools',
    label: 'Personalpools',
    group: 'personal',
    description: 'Attribute für Personalpools',
  },
  {
    id: 'personnel',
    label: 'Mitarbeitende',
    group: 'personal',
    description: 'Attribute für einzelne Mitarbeitende',
  },
  {
    id: 'vehicle-service-pools',
    label: 'Fahrzeugdienstpools',
    group: 'vehicle',
    description: 'Attribute für Fahrzeugdienstpools',
  },
  {
    id: 'vehicle-services',
    label: 'Fahrzeugdienste',
    group: 'vehicle',
    description: 'Attribute für einzelne Fahrzeugdienste',
  },
  {
    id: 'vehicle-pools',
    label: 'Fahrzeugpools',
    group: 'vehicle',
    description: 'Attribute für Fahrzeugpools',
  },
  {
    id: 'vehicles',
    label: 'Fahrzeuge',
    group: 'vehicle',
    description: 'Attribute für einzelne Fahrzeuge',
  },
  {
    id: 'vehicle-types',
    label: 'Fahrzeugtypen',
    group: 'vehicle',
    description: 'Attribute für Fahrzeugtypen',
  },
  {
    id: 'vehicle-compositions',
    label: 'Fahrzeugkompositionen',
    group: 'vehicle',
    description: 'Attribute für Fahrzeugkompositionen',
  },
  {
    id: 'topology-operational-points',
    label: 'Topologie – Betriebsstellen',
    group: 'general',
    description: 'Attribute für Operational Points im Planungsnetz.',
  },
  {
    id: 'topology-sections-of-line',
    label: 'Topologie – Streckenabschnitte',
    group: 'general',
    description: 'Attribute für Sections of Line.',
  },
  {
    id: 'topology-personnel-sites',
    label: 'Topologie – Personaleinsatzstellen',
    group: 'general',
    description: 'Attribute für Personnel Sites (Meldestellen, Pausenräume etc.).',
  },
  {
    id: 'topology-replacement-stops',
    label: 'Topologie – Ersatzhaltestellen',
    group: 'general',
    description: 'Attribute für Replacement Stops im SEV.',
  },
  {
    id: 'topology-replacement-routes',
    label: 'Topologie – Ersatzlinien',
    group: 'general',
    description: 'Attribute für Replacement Routes im SEV.',
  },
  {
    id: 'topology-replacement-edges',
    label: 'Topologie – Ersatzkanten',
    group: 'general',
    description: 'Attribute für Replacement Edges zwischen Ersatzhaltestellen.',
  },
  {
    id: 'topology-op-replacement-links',
    label: 'Topologie – OP↔SEV-Verknüpfungen',
    group: 'general',
    description: 'Attribute für Links zwischen Operational Points und Replacement Stops.',
  },
  {
    id: 'topology-transfer-edges',
    label: 'Topologie – Transferkanten',
    group: 'general',
    description: 'Attribute für Transfer Edges (Fußwege, Shuttles, interne Wege).',
  },
];

@Injectable({
  providedIn: 'root',
})
export class CustomAttributeService {
  private readonly state = signal<CustomAttributeState>(structuredClone(DEFAULT_STATE));
  private readonly dirty = signal(false);

  readonly definitions: Signal<CustomAttributeState> = computed(() => this.state());
  readonly isDirty: Signal<boolean> = computed(() => this.dirty());

  getTargets(): CustomAttributeTarget[] {
    return CUSTOM_ATTRIBUTE_TARGETS;
  }

  list(entityId: string): CustomAttributeDefinition[] {
    const map = this.state();
    return map[entityId] ?? [];
  }

  add(entityId: string, input: CustomAttributeInput): CustomAttributeDefinition {
    const id = this.generateId();
    const key = this.generateKey(entityId, input.key ?? input.label);
    const now = new Date().toISOString();
    const definition: CustomAttributeDefinition = {
      id,
      key,
      label: input.label.trim(),
      type: input.type,
      description: input.description?.trim() || undefined,
      entityId,
      createdAt: now,
      updatedAt: now,
      temporal: input.temporal ?? false,
      required: input.required ?? false,
    };

    this.state.update((current) => {
      const next = { ...current };
      const list = next[entityId] ? [...next[entityId]] : [];
      list.push(definition);
      next[entityId] = list;
      return next;
    });
    this.markDirty();
    return definition;
  }

  update(
    entityId: string,
    id: string,
    updates: Partial<
      Pick<
        CustomAttributeDefinition,
        'label' | 'type' | 'description' | 'key' | 'temporal' | 'required'
      >
    >,
  ): void {
    this.state.update((current) => {
      const list = current[entityId];
      if (!list) {
        return current;
      }

      const nextList = list.map((definition) => {
        if (definition.id !== id) {
          return definition;
        }

        const label = updates.label?.trim() ?? definition.label;
        const description = updates.description?.trim() ?? definition.description;
        const nextKey =
          updates.key && updates.key !== definition.key
            ? this.generateKey(entityId, updates.key, id)
            : definition.key;

        return {
          ...definition,
          label,
          description: description || undefined,
          type: updates.type ?? definition.type,
          key: nextKey,
          temporal: updates.temporal ?? definition.temporal,
          required: updates.required ?? definition.required,
          updatedAt: new Date().toISOString(),
        };
      });

      return {
        ...current,
        [entityId]: nextList,
      };
    });
    this.markDirty();
  }

  remove(entityId: string, id: string): void {
    this.state.update((current) => {
      const list = current[entityId];
      if (!list) {
        return current;
      }

      const nextList = list.filter((definition) => definition.id !== id);
      const nextState = { ...current };
      if (nextList.length > 0) {
        nextState[entityId] = nextList;
      } else {
        delete nextState[entityId];
      }
      return nextState;
    });
    this.markDirty();
  }

  loadFromServer(snapshot: CustomAttributeState): void {
    this.state.set(structuredClone(snapshot));
    this.dirty.set(false);
  }

  preparePersistPayload(): CustomAttributeState {
    return structuredClone(this.state());
  }

  markPersisted(): void {
    this.dirty.set(false);
  }

  private markDirty(): void {
    if (!this.dirty()) {
      this.dirty.set(true);
    }
  }

  private generateId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return `attr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private generateKey(entityId: string, base: string, skipId?: string): string {
    let slugBase = this.slugify(base);
    if (!slugBase) {
      slugBase = 'feld';
    }
    const existing = new Set(
      (this.state()[entityId] ?? [])
        .filter((definition) => definition.id !== skipId)
        .map((definition) => definition.key),
    );

    if (!existing.has(slugBase)) {
      return slugBase;
    }

    let counter = 1;
    let candidate = `${slugBase}-${counter}`;
    while (existing.has(candidate)) {
      counter += 1;
      candidate = `${slugBase}-${counter}`;
    }
    return candidate;
  }

  private slugify(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');
  }
}
