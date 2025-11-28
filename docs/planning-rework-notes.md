# Planung: Basis- vs. Betriebsplanung

## Aktueller Stand

- **Neue Datenobjekte** unter `src/app/models/planning-template.ts` beschreiben Planwochen, Gültigkeiten, WeekInstances und Rollout-Anfragen.
- **PlanningTemplateApiService** (`src/app/core/api/planning-template-api.service.ts`) stellt dedizierte Endpunkte für Basis- (`/planning/base/*`) und Betriebsplanung (`/planning/operations/*`) bereit.

## Offene Aufgaben / nächste Schritte

1. **Backend-Anpassungen**
   - Implementierung der neuen Endpunkte (Templates, Validities, Rollouts, WeekInstances).
   - Persistenzmodell klären (Versionierung, Statuswechsel Draft → Rollout).

2. **Frontend: Basisplanung**
   - Separate Views/Stores für PlanWeekTemplates + Zeitscheiben.
   - Zeitscheiben-Editor + Rollout-Trigger (Request an `/templates:rollout`).

3. **Frontend: Betriebsplanung**
   - Wocheninstanzen laden (ggf. lazily per Fahrplanjahr).
   - Mapping von WeekInstances auf Plantafeln (pro KW) + Assignment UI.

4. **Synchronisation / Migration**
   - Strategie definieren, wie bestehende Stage-Daten in die neuen Strukturen überführt werden.
   - Realtime-Events auf neue Payloads anpassen (WeekInstance-Updates, etc.).

5. **Ressourcen-Zuordnung**
   - Feine Abstimmung, wie Pools/Ressourcen zwischen Basis- und Betriebsplanung geteilt werden (z. B. Lookup über Template → Pool).

> Diese Liste dient als Reminder, damit zukünftige Iterationen gezielt daran anknüpfen können.
