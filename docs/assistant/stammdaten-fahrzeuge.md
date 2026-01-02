# Stammdaten · Fahrzeuge

Diese Seite beschreibt die Fahrzeug-Stammdaten in CorePlanX und die Pflege in der UI.

## Wo finde ich das?

- **Stammdaten → Fahrzeuge**
- Im Fahrzeug-Bereich gibt es oben einen Umschalter (Toggle) fuer Unteransichten:
  - **Fahrzeugdienstpools**
  - **Fahrzeugdienste**
  - **Fahrzeugpools**
  - **Fahrzeuge**
  - **Fahrzeugtypen**
  - **Kompositionen**
  - **System** (System-Pools fuer geloeschte Eintraege)

## Überblick

Die Fahrzeug-Stammdaten bilden eine Hierarchie:

- **Fahrzeugdienstpool** (`VehicleServicePool`) buendelt **Fahrzeugdienste**.
- **Fahrzeugdienst** (`VehicleService`) beschreibt ein serviceartiges Profil fuer Fahrzeuge.
- **Fahrzeugpool** (`VehiclePool`) buendelt konkrete **Fahrzeuge**.
- **Fahrzeug** (`Vehicle`) referenziert einen **Fahrzeugtyp** und kann mehreren Diensten zugeordnet sein.
- **Fahrzeugtyp** (`VehicleType`) beschreibt technische/kapazitative Eigenschaften.
- **Komposition** (`VehicleComposition`) beschreibt eine Zug-/Einheiten-Zusammenstellung aus Fahrzeugtypen.

## Fahrzeugdienstpools

### Feldlexikon

| Feld | Typ | Zweck | Pflicht |
| --- | --- | --- | --- |
| `name` | string | Poolname | ja |
| `description` | string | Beschreibung | nein |
| `dispatcher` | string | Leitstelle | nein |

### Regeln & Validierung

- `name` ist Pflicht.
- Beim Loeschen werden Fahrzeugdienste entkoppelt (Pool-ID wird entfernt).

## Fahrzeugdienste

### Feldlexikon

| Feld | Typ | Zweck | Pflicht |
| --- | --- | --- | --- |
| `name` | string | Dienstname | ja |
| `description` | string | Beschreibung | nein |
| `poolId` | string | Dienstpool | nein |
| `startTime` | time | Startzeit | nein |
| `endTime` | time | Endzeit | nein |
| `isOvernight` | boolean | Mit Nachtlage | nein |
| `primaryRoute` | string | Hauptlaufweg | nein |

### Regeln & Validierung

- Dienste ohne Pool erscheinen in **Ohne Pool**.

## Fahrzeugpools

### Feldlexikon

| Feld | Typ | Zweck | Pflicht |
| --- | --- | --- | --- |
| `name` | string | Poolname | ja |
| `description` | string | Beschreibung | nein |
| `depotManager` | string | Depotleitung | nein |

## Fahrzeuge

### Feldlexikon

| Feld | Typ | Zweck | Pflicht |
| --- | --- | --- | --- |
| `vehicleNumber` | string | Fahrzeugnummer | ja |
| `typeId` | string | Fahrzeugtyp | ja |
| `serviceIds` | string | Dienste (kommagetrennt) | nein |
| `poolId` | string | Fahrzeugpool | nein |
| `description` | string | Beschreibung | nein |
| `depot` | string | Depot | nein |

### Regeln & Validierung

- `typeId` muss auf einen existierenden Fahrzeugtyp zeigen.
- Fahrzeuge ohne Pool erscheinen in **Ohne Pool**.

## Fahrzeugtypen

### Feldlexikon (Auszug)

| Feld | Typ | Zweck | Pflicht |
| --- | --- | --- | --- |
| `label` | string | Bezeichnung | ja |
| `category` | string | Kategorie | nein |
| `capacity` | number | Sitzplaetze | nein |
| `lengthMeters` | number | Laenge | nein |
| `weightTons` | number | Masse | nein |
| `brakeType` | string | Bremssystem | nein |
| `tiltingCapability` | string | Neigetechnik | nein |
| `powerSupplySystems` | string | Energieversorgung | nein |
| `trainProtectionSystems` | string | Zugsicherung | nein |
| `etcsLevel` | string | ETCS-Level | nein |
| `gaugeProfile` | string | Lichtraumprofil | nein |
| `maxSpeed` | number | Hoechstgeschwindigkeit | nein |
| `maintenanceIntervalDays` | number | Wartung | nein |
| `energyType` | string | Energieart | nein |
| `manufacturer` | string | Hersteller | nein |
| `maxAxleLoad` | number | Achslast | nein |
| `noiseCategory` | string | Laermkategorie | nein |

## Kompositionen

### Feldlexikon

| Feld | Typ | Zweck | Pflicht |
| --- | --- | --- | --- |
| `name` | string | Name | ja |
| `entriesSerialized` | string | Typ:Anzahl je Zeile | nein |
| `turnaroundBuffer` | time | Wendezeit-Puffer | nein |
| `remark` | string | Bemerkung | nein |

### Regeln & Validierung

- Mindestens ein Fahrzeugtyp sollte enthalten sein.
- Ungueltige Typ-IDs fuehren zu unklaren Kompositionen.

## System (geloeschte Ressourcen)

- Es gibt System-Pools fuer geloeschte **Fahrzeugdienste** und **Fahrzeuge**.
- Eintraege lassen sich per Drag & Drop wieder einem normalen Pool zuordnen.

## Praxisbeispiele

- **Fahrzeugdienstpool Olten**
  - Pool anlegen, danach Dienste wie „IR 2510 Tagesumlauf“ erstellen.
- **Fahrzeugtyp „Re 460“**
  - Kategorie, Hoechstgeschwindigkeit und Energieart definieren.
- **Komposition „Re 460 + 8x EW IV“**
  - Eintraege als `Re460:1` und `EWIV:8` anlegen.

## Fehlerbilder & Loesungen

- **Fahrzeug speichert nicht**
  - Pruefen: `vehicleNumber` und `typeId` gesetzt?
- **Komposition ist leer**
  - `entriesSerialized` muss Typ-IDs enthalten.
- **Dienst erscheint nicht in Pool**
  - `poolId` fehlt oder zeigt auf geloeschten Pool.

## Kontext-FAQ

- **Woher kommen Fahrzeugtypen?**
  - Sie werden im Tab **Fahrzeugtypen** gepflegt.
- **Warum fehlen bestimmte Felder?**
  - Custom-Attribute koennen zusaetzliche Felder definieren.

## Abhaengigkeiten & Fluss

- Fahrzeugtypen → Fahrzeuge → Fahrzeugpools
- Fahrzeugdienste → Fahrzeugdienstpools
- Kompositionen → Planung (Zugzusammenstellung)

## Datenquellen & Persistenz (technisch)

Die Fahrzeug-Stammdaten sind Teil des **Ressourcen-Snapshots**:

- Laden: Backend liefert `vehicleServicePools`, `vehiclePools`, `vehicleTypes`, `vehicleCompositions`, `vehicleServices`, `vehicles`.
- Speichern: Aenderungen werden als kompletter Snapshot zurueckgeschrieben (replace).
- Reset: Backend liefert Beispielwerte fuer „vehicles“.

## Werkseinstellungen (Reset)

Ueber **„Werkseinstellungen“** kann der Fahrzeug-Scope auf Beispielwerte zurueckgesetzt werden.
