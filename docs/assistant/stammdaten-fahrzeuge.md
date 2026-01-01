# Stammdaten · Fahrzeuge

Diese Seite beschreibt die Fahrzeug-Stammdaten in CorePlanX und die Pflege in der UI.

## Wo finde ich das?

- **Stammdaten → Fahrzeuge**
- Im Fahrzeug-Bereich gibt es oben einen Umschalter (Toggle) für Unteransichten:
  - **Fahrzeugdienstpools**
  - **Fahrzeugdienste**
  - **Fahrzeugpools**
  - **Fahrzeuge**
  - **Fahrzeugtypen**
  - **Kompositionen**

## Überblick: Datenmodell & Begriffe

Die Fahrzeug-Stammdaten bilden eine Hierarchie:

- **Fahrzeugdienstpool** (`VehicleServicePool`) bündelt **Fahrzeugdienste**.
- **Fahrzeugdienst** (`VehicleService`) beschreibt ein serviceartiges Profil für Fahrzeuge.
- **Fahrzeugpool** (`VehiclePool`) bündelt konkrete **Fahrzeuge**.
- **Fahrzeug** (`Vehicle`) referenziert einen **Fahrzeugtyp** und kann mehreren Diensten zugeordnet sein.
- **Fahrzeugtyp** (`VehicleType`) beschreibt technische/kapazitative Eigenschaften.
- **Komposition** (`VehicleComposition`) beschreibt eine Zug-/Einheiten-Zusammenstellung aus Fahrzeugtypen.

## Fahrzeugdienstpools

Wichtige Felder:

- `name` (Pflicht)
- `description` (optional)
- `dispatcher` (optional)

Konsistenz:

- Beim Löschen von Pools werden zugeordnete Fahrzeugdienste entkoppelt (Pool-Zuordnung wird entfernt), um Referenzen konsistent zu halten.

## Fahrzeugdienste

Wichtige Felder:

- `name` (Pflicht)
- `description` (optional)
- `poolId` (optional)
- `startTime`, `endTime` (optional)
- `isOvernight` (optional)
- `primaryRoute` (optional)

UI-Hinweis:

- Fahrzeugdienste können nach Pools gruppiert angezeigt werden.

## Fahrzeugpools

Wichtige Felder:

- `name` (Pflicht)
- `description` (optional)
- `depotManager` (optional)

## Fahrzeuge

Wichtige Felder:

- `vehicleNumber` (Pflicht)
- `typeId` (Pflicht; Verweis auf Fahrzeugtyp)
- `poolId` (optional)
- `serviceIds` (optional; Liste)
- `description`, `depot` (optional)

UI-Hinweis:

- Fahrzeuge werden häufig nach Fahrzeugpool gruppiert.
- Fahrzeuge ohne Pool werden in einer Gruppe „Ohne Pool“ angezeigt.

## Fahrzeugtypen

Fahrzeugtypen definieren technische Eigenschaften, z. B.:

- `label` (Pflicht)
- `category` (z. B. Lokomotive/Wagen/Triebzug)
- Kapazität, Länge, Gewicht
- Bremsdaten, ETCS/Neigetechnik
- Energie-/Herstellerdaten
- weitere technische Attribute (erweiterbar)

## Kompositionen

Kompositionen modellieren Zugzusammenstellungen aus Fahrzeugtypen.
Typisch ist eine Liste von Einträgen (Typ + Anzahl).

Validierung:

- Mindestens ein Fahrzeugtyp muss enthalten sein.

## Werkseinstellungen (Reset)

Über **„Werkseinstellungen“** kann der Fahrzeug-Scope auf Beispielwerte zurückgesetzt werden (Scope „vehicles“ im Ressourcen-Snapshot).

## Datenquellen & Persistenz (technisch)

Die Fahrzeug-Stammdaten sind Teil des **Ressourcen-Snapshots**:

- Laden: Backend liefert u. a. `vehicleServicePools`, `vehiclePools`, `vehicleTypes`, `vehicleCompositions`, `vehicleServices`, `vehicles`.
- Speichern: Änderungen werden als kompletter Snapshot zurückgeschrieben (replace).
- Reset: Backend liefert Beispielwerte für „vehicles“.

## Typische Aufgaben (Beispiele)

- „Neuen Fahrzeugtyp anlegen“ → Fahrzeugtypen → Label setzen.
- „Fahrzeug einem Typ zuordnen“ → Fahrzeuge → `typeId` setzen.
- „Komposition aus 2× Typ A, 1× Typ B“ → Kompositionen → Einträge pflegen.

