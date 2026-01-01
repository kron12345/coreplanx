# Stammdaten · Topologie

Diese Seite beschreibt die Topologie-Stammdaten (Planungs-Masterdaten) in CorePlanX.

## Wo finde ich das?

- **Stammdaten → Topologie**
- In der Topologie-Ansicht gibt es Tabs für verschiedene Entitätstypen:
  - Operational Points
  - Sections of Line
  - Personnel Sites
  - Replacement Stops
  - Replacement Routes
  - Replacement Edges
  - OP ↔ Replacement Links
  - Transfer Edges

## Zweck

Topologie-Daten bilden das Netz-/Ortsmodell, das andere Bereiche verwenden:

- Heimdepots referenzieren „Personnel Sites“
- Streckenabschnitte verbinden Operational Points
- Ersatzverkehr (SEV) wird über Replacement-Entitäten modelliert
- Transfer-Kanten modellieren Umstiege/Wegezeiten zwischen Knoten

## Operational Points

Operational Points sind Betriebsstellen/Orte.

Typische Eigenschaften:

- eindeutige ID (Unique OP ID)
- Name/Label

Wichtig:

- Viele andere Entitäten referenzieren Operational Points über `uniqueOpId`.
- Beim Ändern von `uniqueOpId` müssen Referenzen in abhängigen Entitäten mitgezogen werden.

## Sections of Line

Sections of Line verbinden zwei Operational Points:

- Start-OP (`startUniqueOpId`)
- End-OP (`endUniqueOpId`)

Validierung:

- Start und Ende dürfen nicht gleich sein (keine Loops).

## Personnel Sites

Personnel Sites sind planungsrelevante Orte für Personal:

- optional an Operational Point gekoppelt (`uniqueOpId`)
- werden z. B. in Heimdepots als Start-/End-/Pausen-/Übernachtungsorte referenziert

## Replacement (SEV)

Für Ersatzverkehr gibt es mehrere Entitätstypen:

- Replacement Stops
- Replacement Routes
- Replacement Edges
- OP ↔ Replacement Links

Diese Daten bilden das Ersatznetz und die Verknüpfung zum regulären Netz.

## Transfer Edges

Transfer Edges modellieren Wegezeiten/Umstiege zwischen Transfer-Knoten.
Knoten können z. B. sein:

- Operational Point
- Personnel Site
- Replacement Stop

## Werkseinstellungen (Reset)

In der UI gibt es **„Werkseinstellungen“** für Topologie:

- setzt Beispiel-Daten für Haltepunkte, Strecken und SEV zurück

## Datenquellen & Persistenz (technisch)

Topologie wird über dedizierte Backend-Endpunkte gelesen/geschrieben:

- je Entitätstyp `GET`/`PUT` auf `/planning/topology/...`
- Reset via `POST /planning/topology/reset`
- Import (optional) via `/planning/topology/import` (+ Events)

## Typische Aufgaben (Beispiele)

- „Neuen Operational Point anlegen“ → Tab Operational Points → hinzufügen → speichern.
- „Neue Strecke zwischen A und B“ → Sections of Line → Start/End OP wählen.
- „Heimdepot braucht Pausenort“ → Personnel Sites anlegen → im Heimdepot referenzieren.

