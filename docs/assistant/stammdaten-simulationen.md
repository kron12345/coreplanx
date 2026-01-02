# Stammdaten · Simulationen

Diese Seite beschreibt Simulationen (Varianten) in CorePlanX und die Pflege in der Stammdaten-UI.
Sie ist als Referenz fuer den CorePlanX Assistant gedacht.

## Wo finde ich das?

Navigation:

- **Stammdaten → Simulationen**

## Überblick

Simulationen sind Varianten innerhalb eines Fahrplanjahres.
Sie erlauben es, Planungen zu testen oder zu veraendern, ohne produktive Daten zu ueberschreiben.

## Simulationen

### Feldlexikon

| Feld | Typ | Zweck | Pflicht |
| --- | --- | --- | --- |
| `label` | string | Titel/Name der Simulation | ja |
| `timetableYearLabel` | string | Fahrplanjahr (z. B. `2026/27`) | ja |
| `description` | string | Freitext | nein |

### Regeln & Validierung

- `label` ist Pflicht.
- `timetableYearLabel` ist Pflicht.
- **Fahrplanjahr kann nach dem Anlegen nicht geaendert werden.**
  - Wenn das Jahr falsch ist, muss eine neue Simulation erstellt werden.
- In der UI werden **nur nicht-produktive** Simulationen angezeigt und bearbeitet.

### Produktiv vs. Simulation

CorePlanX unterscheidet Varianten nach `kind`:

- **productive**: produktive Variante pro Fahrplanjahr (systemseitig verwaltet).
- **simulation**: von Nutzern gepflegte Test-Variante.

Die Stammdaten-UI zeigt und editiert ausschliesslich `simulation`.

## Praxisbeispiele

- **Neue Variante fuer 2026/27**
  - `label=Variante A`, `timetableYearLabel=2026/27`, `description=Sommerfahrplan`.
- **Simulation umbenennen**
  - Titel anpassen, Beschreibung ergaenzen.
- **Falsches Fahrplanjahr**
  - Neue Simulation anlegen (Jahr ist nicht editierbar).

## Fehlerbilder & Loesungen

- **"Titel ist erforderlich."**
  - `label` setzen.
- **"Fahrplanjahr ist erforderlich."**
  - `timetableYearLabel` setzen (am besten ein bestehendes Fahrplanjahr).
- **"Fahrplanjahr kann nach dem Anlegen nicht geaendert werden."**
  - Neue Simulation anlegen und alte ggf. loeschen.
- **"Simulation konnte nicht gespeichert werden."**
  - Backend-Fehler pruefen (Konsole/Netzwerk).

## Kontext-FAQ

- **Warum sehe ich eine Simulation nicht?**
  - Die UI zeigt nur `simulation`-Varianten (nicht `productive`).
  - Backend-Loading/Fehler pruefen.
- **Kann ich die produktive Variante bearbeiten?**
  - Nein, produktive Varianten sind systemseitig verwaltet.

## Abhaengigkeiten & Fluss

- Fahrplanjahr → Simulation (jede Simulation gehoert zu genau einem Jahr)
- Simulation → Planung/Varianten-Auswahl

## Datenquellen & Persistenz (technisch)

- **Backend-Quelle:** `GET /timetable-years/variants`
- **Create/Update/Delete:**
  - `POST /timetable-years/variants`
  - `PUT /timetable-years/variants/{id}`
  - `DELETE /timetable-years/variants/{id}`
- **IDs** werden vom Backend erzeugt (encodieren das Fahrplanjahr).
