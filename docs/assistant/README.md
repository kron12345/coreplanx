# Assistant Docs

Diese Markdown-Dateien sind die interne Wissensbasis für den CorePlanX Assistant.

## Struktur

- `docs/assistant/stammdaten-*.md`: Dokumentation pro Stammdaten-Bereich (Personal, Fahrzeuge, …)
- `docs/assistant/einstellungen-*.md`: Dokumentation pro Einstellungsbereich (Attribut-Editor, Activity-Editor, …)
- `docs/assistant/auftragsmanager-*.md`: Dokumentation pro Auftragsmanager-Bereich (Aufträge, …)
- `docs/assistant/planung-*.md`: Dokumentation zu Planungsansichten (Betriebsplanung, Gantt, …)

## Verwendung im Assistant

Das Backend lädt (je nach UI-Kontext/Breadcrumbs) automatisch passende Ausschnitte aus diesen Dateien
und liefert sie als System-Kontext an das LLM.

Konventionen für gute Treffergenauigkeit:

- Nutze eine Sektion `## Wo finde ich das?`
- Nutze optional `## Überblick` oder `## Zweck`
- Nutze für Unterbereiche klare `## <Name>` Überschriften, die den UI-Breadcrumbs entsprechen
  (z. B. `Dienstpools`, `Fahrzeugtypen`, `Operational Points`).

## Screenshots & Assets

- Screenshots werden im UI über `/assets/...` geladen.
- Lege die Dateien in `frontend/public/assets/` ab und verwende in Markdown z. B. `./assets/<pfad>`.

## Kontext-Limits

Um lokale Modelle nicht zu überlasten, werden die Dokumentationsausschnitte und UI-Daten serverseitig gekürzt.
Konfigurierbar via `.env`:

- `ASSISTANT_MAX_DOC_CHARS`
- `ASSISTANT_MAX_UI_DATA_CHARS`
