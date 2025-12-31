# CorePlanX – Architektur: Automatische Dienstplanung (Roadmap bis OR-Tools)

## Ausgangslage (Ist)
- Es gibt einen **ConstraintChecker**, der:
  - harte Regeln prüft (Zeit/Ort/AZG/Quali/…)
  - **automatische Pausen** platzieren kann
  - **Dienstanfang/-ende** erzeugen kann
- Es existiert bereits eine **teilautomatische Planung** (manuell + Assistenz)

Ziel:
1) **Build**: Aus vielen Activities einen vollständigen Dienstplan erzeugen (von Null).
2) **Repair**: Existierenden Dienstplan bei Störung/Verspätung minimal-invasiv reparieren.
3) **LLM** liefert nur **Ziele/Gewichte/Präferenzen** und erklärt Vorschläge – keine “Wahrheitslogik”.

---

## Leitprinzipien
- **Single Source of Truth**: ConstraintChecker entscheidet Machbarkeit.
- **Ziel-Funktion** (ScoreModel) getrennt von Constraints.
- **Moves** als explizite Operationen (Swap/Relocate/BlockMove/…) → UI + Audit + Erklärbarkeit.
- **Asynchron**: Optimierung läuft als Job (Queue), UI erhält Status & Vorschläge via WebSocket/SSE.
- **Später OR-Tools**: als “Engine-Plugin”, nicht als Komplett-Umbau.

---

## Domänenmodell (Kern-DTOs)

### Activity (Input)
- id
- startTime, endTime
- fromLocation, toLocation
- attributes (trainType, line, traction, …)
- optional: fixed (darf nicht verschoben), priority

### Duty (Dienst)
- id
- crewId (optional)
- startAnchor, endAnchor (können synthetisch sein)
- blocks: ActivityBlock[]
- derived:
  - totalWorkMinutes
  - drivingMinutes
  - deadheadMinutes
  - breaks[] (auto gesetzt)

### Plan (Dienstplan)
- planId
- horizon (from/to)
- duties: Duty[]
- unassignedActivities: {activityId, reasonCodes[]}[]
- metadata: score, feasibility, createdAt, version

### Move (Änderung / Vorschlag)
- moveId
- type: RELOCATE | SWAP_ACTIVITIES | SWAP_BLOCKS | REASSIGN_BLOCK | INSERT_BUFFER | …
- params: {…}
- diff: PlanDiff (was ändert sich)
- effects:
  - hardViolations: []
  - scoreDelta: {metric: delta}
  - kpisDelta: {…}
- explanation: string (LLM oder templated)

---

## Services (NestJS) – Verantwortlichkeiten

### 1) Planning API (Controller)
- POST `/planning/jobs` (startet Build/Repair Job)
- GET `/planning/jobs/:id` (Status)
- GET `/planning/jobs/:id/proposals` (Vorschläge)
- POST `/planning/jobs/:id/apply/:proposalId` (Apply)
- WS `/planning/ws` (Job-Updates, Proposal Streams)

### 2) OptimizerRunner (Job Worker)
- Nimmt `PlanningProblem` an
- Ruft Optimizer Engine auf (Heuristik/LocalSearch/OR-Tools)
- Persistiert Ergebnisse (Plan + Proposals + Audit)

### 3) Constraint Service (Wrapper um deinen Checker)
- `checkDuty(duty) -> CheckResult`
- `checkPlan(plan) -> PlanCheckResult`
- `tryInsertBreaks(duty) -> duty'`
- `tryCreateAnchors(duty) -> duty'`
- Wichtig: **Delta Checks**:
  - `canAppend(activity, dutyEndState) -> boolean + cost`
  - `checkMove(plan, move) -> MoveCheckResult`

### 4) ScoreModel Service
- Metriken & Penalties:
  - duty_length_variance
  - route_diversity
  - deadhead_minutes
  - break_quality
  - plan_change_cost (für Repair)
- `score(plan, weights) -> ScoreBreakdown`
- `scoreDelta(plan, move, weights) -> ScoreDelta`

### 5) LLM Service (Interpretation & Erklärung)
- Input: User-Text + Kontext (horizon, KPIs, Konflikte)
- Output: `PlanningIntent` JSON:
  - mode BUILD/REPAIR
  - weights
  - toggles (allowedMoves, freezeUntil, windowHours, strictness)
  - constraints preferences (nur soft!)
- Optional: `explain(move, effects) -> text`

---

## PlanningProblem (Eingabe an Optimizer)
```json
{
  "mode": "BUILD",
  "horizon": {"from":"...", "to":"..."},
  "activities": [...],
  "existingPlan": null,
  "weights": {...},
  "hardParams": {...},
  "allowedMoves": ["RELOCATE","SWAP_BLOCKS"],
  "limits": {"maxRuntimeMs": 8000, "maxProposals": 10}
}
````

Für REPAIR zusätzlich:

* existingPlan
* disturbanceEvents (delay, vehicleChange, crewMissing)
* freezeUntil (fixe Zone)
* window (Re-Opt Bereich)

---

## Roadmap – Stufenplan

# Phase 0 – Stabilisierung (jetzt)

**Ziel:** deinen bestehenden Checker als “Engine” absichern.

* [ ] Einheitliche DTOs (Activity, Duty, Plan, Move)
* [ ] Persistenz von CheckResults & ReasonCodes (für UI)
* [ ] Delta-Checks ergänzen (Append/Insert/Swap schnell prüfen)
* [ ] “AutoBreaks + Anchors” als idempotente Transformation

Deliverable:

* `constraint-service` mit stabiler API und Tests.

---

# Phase 1 – Build: Greedy Construction

**Ziel:** aus 100–1000 Activities schnell einen vollständigen Plan bauen.

Algorithmus (Construction):

1. Sortiere Activities (startTime, location clusters optional)
2. Halte Liste “open duties” mit End-State
3. Für jede Activity:

   * finde beste Duty zum Anhängen (min incremental cost)
   * falls keine passt: neue Duty erstellen (Anchors)
4. Nach jedem Insert: AutoBreaks & QuickCheck
5. Unassigned → ReasonCodes (why)

Wichtig:

* Übergangskostenfunktion `transitionCost(i->j)`:

  * transfer time
  * deadhead
  * route monotony
  * early/late slack

Deliverable:

* `optimizer/greedy-builder.ts`
* KPI-Übersicht + ScoreBreakdown.

---

# Phase 2 – Improvement: Local Search (Moves)

**Ziel:** Plan verbessern, ohne alles neu zu bauen.

Move Library (Start):

* RELOCATE_ACTIVITY (Activity aus Duty A → Duty B)
* SWAP_ACTIVITIES (A_i ↔ B_j)
* SWAP_BLOCKS (zusammenhängende Blöcke)
* REASSIGN_BLOCK (Block komplett zu anderem Dienst)
* OPTIONAL: MERGE_SPLIT (Dienste zusammenlegen/teilen)

Search Strategy:

* Hill-climbing + Random restarts
* Stop-Kriterien: maxRuntimeMs, noImprovementSteps

Deliverable:

* `optimizer/local-search.ts`
* `MoveGenerator` + `MoveEvaluator` + `applyMove()` + `revertMove()`.

---

# Phase 3 – Repair: Freeze + Window + Minimal Change

**Ziel:** bei Verspätungen/Störungen Reparaturvorschläge.

Mechanik:

* Freeze: alles vor `freezeUntil` fix
* Window: nur betroffene Duties/Activities im Zeitfenster ändern
* Objective: `plan_change_cost` hoch gewichten + punctuality constraints

Moves für Repair (wichtig):

* SWAP_FOLLOWUP (Folgeleistungen tauschen)
* REASSIGN_BLOCK (Block auf Reserve/anderen Fahrer)
* INSERT_BUFFER (Standby/Leerfahrt wenn erlaubt)

Deliverable:

* `optimizer/repair.ts` (nutzt gleiche Move-Library)
* UI: “Proposals” mit Diff & Effekten.

---

# Phase 4 – LLM-Integration (Command UI)

**Ziel:** Chatfenster steuert Gewichte & Betriebsmodus.

Flow:

1. Angular Chat: User Text
2. NestJS LLM: Text → `PlanningIntent` (JSON)
3. OptimizerRunner: Problem bauen & Job starten
4. UI zeigt Proposals + Apply/Reject

Sicherheitsregeln:

* LLM darf nur **soft** parameterisieren (weights, allowedMoves)
* Harte Parameter (AZG) kommen aus Konfiguration/DB

Deliverable:

* `llm-intent.schema.json`
* “Explain” Texte für Moves.

---

# Phase 5 – OR-Tools Vorbereitung (ohne sofort CP-SAT)

**Ziel:** Daten so strukturieren, dass OR-Tools später plugbar ist.

Schritte:

* [ ] Formale Variable-Definitionen überlegen:

  * assignment(activity -> duty)
  * successor(activity -> nextActivity) (Graph)
* [ ] Transition Matrix / Feasibility Cache:

  * `feasible[i][j]` + cost[i][j]
* [ ] Segmentierung:

  * Cluster nach Zeitfenstern oder Depots, um Probleme kleiner zu machen

Deliverable:

* `feasibility-cache` (precompute)
* “subproblem builder” (Cluster/Window).

---

# Phase 6 – OR-Tools CP-SAT (Plugin Engine)

**Ziel:** optionaler Optimizer, der schwierige Instanzen besser löst.

Integration als Engine:

* `IOptimizerEngine` Interface:

  * `solve(problem) -> PlanResult`
  * `propose(problem) -> Proposal[]`

CP-SAT Modell (high level):

* Variablen:

  * x[a,d] ∈ {0,1} Activity a assigned to duty d
  * order constraints via successor vars oder time-indexing
* Harte Constraints:

  * jede Activity genau 1 duty
  * duty feasibility (Zeit/Ort) über successor edges
  * max duty length, breaks, etc. (modellieren oder via decomposition)
* Objective:

  * min Σ(weights * penalties)

Pragmatisch (realistisch):

* CP-SAT zuerst für **Repair Window** oder **kleine Cluster**,
  nicht sofort für “alles in einem riesigen Modell”.

Betrieb:

* OR-Tools läuft ggf. als Python Microservice
* NestJS spricht per HTTP/gRPC
* gleiche DTOs (Plan/Move/Score)

Deliverable:

* `optimizer-engine-ortools` (python) + contracts
* Feature-Flag: engine = "heuristic" | "ortools"

---

## Schnittstellen (Interfaces)

### IConstraintChecker

* checkDuty(duty): CheckResult
* checkPlan(plan): PlanCheckResult
* applyAutoBreaks(duty): duty
* computeEndState(duty): DutyEndState
* canTransition(endState, activity): TransitionResult

### IScoreModel

* score(plan, weights): ScoreBreakdown
* scoreDelta(plan, move, weights): ScoreDelta

### IOptimizerEngine

* solve(problem): PlanResult
* propose(problem): Proposal[]

---

## UI/UX – Was angezeigt werden soll

* Unassigned Activities + Grund (ReasonCodes)
* Vorschläge als Cards:

  * “Move”
  * “Effekte” (KPIs/ScoreDelta)
  * “Regelstatus” (0 violations)
  * “Diff Preview” im Gantt (ghost bars)
* Apply/Reject + Undo (Plan Versioning)

---

## Teststrategie (wichtig)

* Unit Tests:

  * checker delta checks
  * move apply/revert
  * score deltas
* Property Tests (optional):

  * zufällige Activities → Plan bleibt feasible
* Golden Files:

  * bekannte Szenarien (Build/Repair) mit erwarteten KPIs

---

## Nächster konkreter Schritt (empfohlen)

1. DTOs festziehen (Activity/Duty/Plan/Move)
2. Move-Library minimal (RELOCATE, SWAP_BLOCKS)
3. Greedy Builder + ScoreBreakdown
4. Job Runner + WS Updates
5. Repair Window
6. Erst dann LLM “Command” oben drauf
7. OR-Tools als Engine Plugin (später)


