# CorePlanX Rulesets – Architektur & Pipeline

Dieses Dokument beschreibt die neue Regeln-Schicht fuer CorePlanX. Ziel ist eine **einheitliche YAML-Regelquelle**, die in ein **Intermediate Representation (IR)** kompiliert wird und von **Autopilot** (heuristisch) sowie **Solver** (OR-Tools) genutzt werden kann.

## Zielbild

Eine Regelquelle (YAML) wird:

1. geladen und validiert (JSON-Schema),
2. in ein IR kompiliert,
3. an Engines uebergeben:
   - **Autopilot Engine** (heuristisch, erzeugt Plan-Patches)
   - **Solver Engine** (OR-Tools, arbeitet mit Templates/Kandidaten)

Regeln sind dadurch **auditierbar**, **sicher** (keine direkten DB-CRUDs) und **versionierbar**.

## Dateistruktur

```
backend/
  rulesets/
    schema/
      ruleset.schema.json
    coreplanx/
      v1.yaml
```

## Ruleset YAML (Beispiel)

```yaml
id: coreplanx
version: v1
label: CorePlanX Default Ruleset

actions:
  - id: autopilot.insert_break
    when:
      op: gt
      left: { var: duty.work_minutes }
      right: { value: 360 }
    action:
      type: insert_break
      params:
        durationMinutes: 30

templates:
  - id: break-30
    when:
      op: gt
      left: { var: duty.work_minutes }
      right: { value: 360 }
    template:
      type: break
      params:
        durationMinutes: 30
```

## Kernprinzipien

- **Single Source of Truth:** YAML ist die einzige Quelle, IR ist nur ein abgeleitetes Artefakt.
- **Whitelisted Actions:** Actions sind typisiert und koennen nur sichere Plan-Patches beschreiben.
- **Solver-Sicherheit:** Im Solver-Modus werden nur Templates genutzt, keine direkten Actions.
- **Versionierung:** Jede Aenderung ist eindeutig (ruleset id + version).

## Pipeline

1. **Load**: `PlanningRulesetService` laedt YAML aus `backend/rulesets`.
2. **Validate**: JSON-Schema verhindert freie Felder / untypisierte Actions.
3. **Compile**: Normalisierung + Zusammenfuehrung von Includes.
4. **Execute**:
   - Autopilot: Actions -> Plan-Patches
   - Solver: Templates -> Kandidaten/Constraints

## API (intern)

- `GET /planning/rulesets` listet Rule-IDs
- `GET /planning/rulesets/{rulesetId}/versions` listet Versionen
- `GET /planning/rulesets/{rulesetId}/{version}` liefert das Ruleset
- `GET /planning/rulesets/{rulesetId}/{version}/ir` liefert das komp. IR
- `POST /planning/rulesets/validate` validiert Ruleset-Payloads (JSON oder YAML-String)
- `POST /planning/rulesets/preview` liefert IR fuer Payloads (optional mit Includes)
- `POST /planning/stages/{stageId}/autopilot/preview` zeigt Autopilot-Vorschlaege
- `POST /planning/stages/{stageId}/optimizer/candidates` erzeugt Solver-Kandidaten
- `POST /planning/stages/{stageId}/optimizer/solve` startet Solver-Preview

## Solver Service (Python + OR-Tools)

Der Solver laeuft als separater Python-Service (FastAPI) und wird vom Backend
ueber HTTP angesprochen. Standard-URL: `http://localhost:8099`.

Pfad: `tools/solver_service`

Starten:

```bash
cd tools/solver_service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8099
```

Konfiguration im Backend:

- `PLANNING_SOLVER_URL` (default `http://localhost:8099`)
- `PLANNING_SOLVER_MODE` (`python` | `local` | `auto`)
- `PLANNING_SOLVER_TIMEOUT_MS` (HTTP Timeout)
- `PLANNING_SOLVER_TIME_LIMIT_SECONDS` (CP-SAT Zeitlimit)

## Naechste Integrationsschritte

1. Autopilot Engine erweitert, um IR-Actions zu interpretieren.
2. Candidate Builder (Break/Travel/DutySplit) fuer Solver.
3. Solver-Service (OR-Tools) + Explain/KPI-Outputs.
4. UI Preview fuer Patches + Explain-Tree.
