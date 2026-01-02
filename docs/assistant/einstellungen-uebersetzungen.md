# Einstellungen · Übersetzungen

Diese Seite beschreibt den Übersetzungsbereich und dient als Referenz fuer den CorePlanX Assistant.

## Wo finde ich das?

Navigation:

- **Einstellungen → Übersetzungen**

## Ueberblick

Hier werden **UI-Übersetzungen** pro Sprache (Locale) gepflegt.
Jeder Eintrag hat einen Schluessel und optionale Labels/Abkuerzungen.
Die Daten werden **serverseitig** ueber die Planning-Catalog-API gespeichert und lassen sich auf
Werkseinstellungen zuruecksetzen.

## Übersetzungen

### Feldlexikon

| Feld | Typ | Zweck | Hinweise |
| --- | --- | --- | --- |
| `locale` | string | Sprache | z. B. `de`, `en` |
| `key` | string | Uebersetzungsschluessel | stabil halten |
| `label` | string | Standardanzeige | optional |
| `abbreviation` | string | Kurzlabel | optional |

### Wie funktioniert es?

- Sprache auswählen oder neue Locale anlegen.
- Uebersetzungen pro Key bearbeiten (Label und Abkuerzung).
- Schluessel koennen geloescht werden, gesamte Locale kann entfernt werden.

### Schluessel-Logik

- Ein Key ist frei waehlbar, sollte aber stabil sein (z. B. `activityType:service`).
- **Label** ist die Standardanzeige.
- **Abkuerzung** wird verwendet, wenn wenig Platz ist.
- Fehlt ein Eintrag, wird ein Fallback-Label angezeigt.

### Presets

- Es gibt Presets aus Activity-Types (z. B. `activityType:<id>`).
- Damit lassen sich Type-Labels zentral uebersetzen.

## Praxisbeispiele

- **Activity-Type uebersetzen**
  - Key: `activityType:service`
  - Label: `Dienstleistung`
  - Abkuerzung: `DL`
- **Eigene UI-Begriffe**
  - Key: `ui:conflict`
  - Label: `Konflikt`

## Fehlerbilder & Loesungen

- **Uebersetzung wirkt nicht**
  - Pruefen: Key exakt gleich? Richtige Locale aktiv?
- **Abkuerzung fehlt**
  - Falls UI keine Abkuerzung abfragt, wird nur Label genutzt.

## Kontext-FAQ

- **Wo werden die Daten gespeichert?**
  - Serverseitig (Planning-Catalog-API, gemeinsam fuer alle Clients).
- **Wie loesche ich alle Uebersetzungen?**
  - Werkseinstellungen oder Locale loeschen.

## Abhaengigkeiten & Fluss

- Uebersetzungen → Anzeige im UI (z. B. Activity-Type Labels)

## Wo wirken die Einstellungen?

- **Planung / Activity-Auswahl**: Activity-Types werden ueber `activityType:<id>` uebersetzt.
- Ueberall dort, wo der jeweilige Uebersetzungs-Key verwendet wird (Label oder Abkuerzung).
