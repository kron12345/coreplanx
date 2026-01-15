from typing import Any, Dict, List, Optional, Tuple

from fastapi import FastAPI
from ortools.sat.python import cp_model
from pydantic import BaseModel, Field

app = FastAPI(title="CorePlanX Solver Service")


class SolverOptions(BaseModel):
    max_per_service_type: int = 1
    max_per_service: Optional[int] = None
    weight_key: str = "gapMinutes"
    default_weight: int = 1
    time_limit_seconds: Optional[float] = None
    random_seed: Optional[int] = None


class SolverCandidate(BaseModel):
    id: str
    templateId: str
    type: str
    params: Dict[str, Any] = Field(default_factory=dict)


class SolverGroupActivity(BaseModel):
    id: str
    startMs: int
    endMs: int


class SolverGroupEdge(BaseModel):
    fromId: str
    toId: str
    gapMinutes: int
    travelMinutes: int
    missingTravel: Optional[bool] = None
    missingLocation: Optional[bool] = None


class SolverGroup(BaseModel):
    id: str
    ownerId: str
    ownerKind: str
    dayKey: str
    activities: List[SolverGroupActivity]
    edges: List[SolverGroupEdge]


class SolverProblem(BaseModel):
    groups: List[SolverGroup] = Field(default_factory=list)


class SolverRequest(BaseModel):
    rulesetId: str
    rulesetVersion: str
    candidates: List[SolverCandidate]
    problem: Optional[SolverProblem] = None
    options: SolverOptions = Field(default_factory=SolverOptions)


class SolverStats(BaseModel):
    totalCandidates: int
    selectedCandidates: int
    groupCount: int


class SolverDutyGroup(BaseModel):
    groupId: str
    ownerId: Optional[str] = None
    ownerKind: Optional[str] = None
    dayKey: Optional[str] = None
    duties: List[List[str]] = Field(default_factory=list)


class SolverResponse(BaseModel):
    summary: str
    selectedIds: List[str]
    dutyGroups: List[SolverDutyGroup] = Field(default_factory=list)
    score: Optional[int] = None
    status: str
    stats: SolverStats


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/solve", response_model=SolverResponse)
def solve(request: SolverRequest) -> SolverResponse:
    if request.problem and request.problem.groups:
        return solve_problem(request)
    return solve_candidates(request)


def solve_problem(request: SolverRequest) -> SolverResponse:
    groups = request.problem.groups if request.problem else []
    if not groups:
        return solve_candidates(request)

    duty_groups: List[SolverDutyGroup] = []
    total_edges = 0
    selected_edges = 0
    total_activities = 0
    duty_count = 0
    statuses: List[str] = []

    for group in groups:
        duties, edge_count, selected_count, status_name = solve_group(
            group, request.options
        )
        duty_groups.append(
            SolverDutyGroup(
                groupId=group.id,
                ownerId=group.ownerId,
                ownerKind=group.ownerKind,
                dayKey=group.dayKey,
                duties=duties,
            )
        )
        total_edges += edge_count
        selected_edges += selected_count
        total_activities += len(group.activities)
        duty_count += len(duties)
        statuses.append(status_name)

    overall_status = aggregate_status(statuses)
    summary = (
        f"{duty_count} duties from {total_activities} activities"
        f" (status: {overall_status})."
    )

    return SolverResponse(
        summary=summary,
        selectedIds=[],
        dutyGroups=duty_groups,
        status=overall_status,
        stats=SolverStats(
            totalCandidates=total_edges,
            selectedCandidates=selected_edges,
            groupCount=len(groups),
        ),
    )


def solve_group(
    group: SolverGroup, options: SolverOptions
) -> Tuple[List[List[str]], int, int, str]:
    activities = group.activities
    if not activities:
        return [], 0, 0, "NO_ACTIVITIES"

    sorted_activities = sorted(
        activities, key=lambda entry: (entry.startMs, entry.endMs, entry.id)
    )
    ordered_ids = [entry.id for entry in sorted_activities]
    activity_ids = set(ordered_ids)

    if not group.edges:
        return [[activity_id] for activity_id in ordered_ids], 0, 0, "OPTIMAL"

    model = cp_model.CpModel()
    incoming: Dict[str, List[cp_model.IntVar]] = {aid: [] for aid in ordered_ids}
    outgoing: Dict[str, List[cp_model.IntVar]] = {aid: [] for aid in ordered_ids}
    edge_vars: List[Tuple[SolverGroupEdge, cp_model.IntVar]] = []

    for index, edge in enumerate(group.edges):
        if edge.fromId not in activity_ids or edge.toId not in activity_ids:
            continue
        var = model.NewBoolVar(f"g_{group.id}_e_{index}")
        edge_vars.append((edge, var))
        incoming[edge.toId].append(var)
        outgoing[edge.fromId].append(var)

    for activity_id in ordered_ids:
        model.Add(sum(incoming[activity_id]) <= 1)
        model.Add(sum(outgoing[activity_id]) <= 1)

    weighted_terms = []
    for edge, var in edge_vars:
        weight = compute_edge_weight(edge)
        weighted_terms.append(weight * var)

    if weighted_terms:
        model.Maximize(sum(weighted_terms))
    else:
        return [[activity_id] for activity_id in ordered_ids], 0, 0, "OPTIMAL"

    solver = cp_model.CpSolver()
    if options.time_limit_seconds is not None:
        solver.parameters.max_time_in_seconds = options.time_limit_seconds
    if options.random_seed is not None:
        solver.parameters.random_seed = options.random_seed

    status = solver.Solve(model)
    status_name = solver.StatusName(status)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return [[activity_id] for activity_id in ordered_ids], len(edge_vars), 0, status_name

    selected = [
        edge for edge, var in edge_vars if solver.Value(var) == 1
    ]
    duties = build_duties(ordered_ids, selected)
    return duties, len(edge_vars), len(selected), status_name


def build_duties(
    ordered_ids: List[str], selected_edges: List[SolverGroupEdge]
) -> List[List[str]]:
    successors: Dict[str, str] = {}
    predecessors: Dict[str, str] = {}
    for edge in selected_edges:
        successors[edge.fromId] = edge.toId
        predecessors[edge.toId] = edge.fromId

    duties: List[List[str]] = []
    visited: set[str] = set()
    for activity_id in ordered_ids:
        if activity_id in visited:
            continue
        if activity_id in predecessors:
            continue
        path: List[str] = []
        cursor = activity_id
        while cursor and cursor not in visited:
            path.append(cursor)
            visited.add(cursor)
            cursor = successors.get(cursor)
        if path:
            duties.append(path)

    for activity_id in ordered_ids:
        if activity_id not in visited:
            duties.append([activity_id])
            visited.add(activity_id)

    return duties


EDGE_BASE_WEIGHT = 100_000
MISSING_TRAVEL_PENALTY = 50_000
MISSING_LOCATION_PENALTY = 50_000


def compute_edge_weight(edge: SolverGroupEdge) -> int:
    penalty = int(edge.gapMinutes) + int(edge.travelMinutes)
    if edge.missingTravel:
        penalty += MISSING_TRAVEL_PENALTY
    if edge.missingLocation:
        penalty += MISSING_LOCATION_PENALTY
    return max(1, EDGE_BASE_WEIGHT - penalty)


def aggregate_status(statuses: List[str]) -> str:
    if not statuses:
        return "OPTIMAL"
    if any(status == "INFEASIBLE" for status in statuses):
        return "INFEASIBLE"
    if any(status == "FEASIBLE" for status in statuses):
        return "FEASIBLE"
    return "OPTIMAL"


def solve_candidates(request: SolverRequest) -> SolverResponse:
    if not request.candidates:
        return SolverResponse(
            summary="No candidates provided.",
            selectedIds=[],
            status="NO_CANDIDATES",
            stats=SolverStats(totalCandidates=0, selectedCandidates=0, groupCount=0),
        )

    model = cp_model.CpModel()
    variables: List[Tuple[SolverCandidate, cp_model.IntVar]] = []
    grouped: Dict[Tuple[str, str], List[cp_model.IntVar]] = {}
    grouped_by_service: Dict[str, List[cp_model.IntVar]] = {}

    for index, candidate in enumerate(request.candidates):
        var = model.NewBoolVar(f"cand_{index}")
        variables.append((candidate, var))
        service_id = str(candidate.params.get("serviceId") or "_")
        grouped.setdefault((service_id, candidate.type), []).append(var)
        if request.options.max_per_service is not None:
            grouped_by_service.setdefault(service_id, []).append(var)

    limit_per_type = max(1, int(request.options.max_per_service_type))
    for vars_in_group in grouped.values():
        model.Add(sum(vars_in_group) <= limit_per_type)

    if request.options.max_per_service is not None:
        limit_total = max(1, int(request.options.max_per_service))
        for vars_in_group in grouped_by_service.values():
            model.Add(sum(vars_in_group) <= limit_total)

    weighted_terms = []
    for candidate, var in variables:
        weight = compute_weight(candidate, request.options)
        weighted_terms.append(weight * var)

    model.Maximize(sum(weighted_terms))

    solver = cp_model.CpSolver()
    if request.options.time_limit_seconds is not None:
        solver.parameters.max_time_in_seconds = request.options.time_limit_seconds
    if request.options.random_seed is not None:
        solver.parameters.random_seed = request.options.random_seed

    status = solver.Solve(model)
    status_name = solver.StatusName(status)

    selected_ids = (
        [candidate.id for candidate, var in variables if solver.Value(var) == 1]
        if status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
        else []
    )

    score = int(solver.ObjectiveValue()) if selected_ids else None
    summary = build_summary(status_name, len(selected_ids), len(request.candidates))

    return SolverResponse(
        summary=summary,
        selectedIds=selected_ids,
        score=score,
        status=status_name,
        stats=SolverStats(
            totalCandidates=len(request.candidates),
            selectedCandidates=len(selected_ids),
            groupCount=len(grouped),
        ),
    )

def compute_weight(candidate: SolverCandidate, options: SolverOptions) -> int:
    value = candidate.params.get(options.weight_key)
    if value is None and options.weight_key != "gapMinutes":
        value = candidate.params.get("gapMinutes")
    if value is None:
        value = candidate.params.get("durationMinutes")
    numeric = coerce_number(value)
    if numeric is None:
        return max(1, int(options.default_weight))
    return max(1, int(round(numeric)))


def coerce_number(value: Any) -> Optional[float]:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return None
    return None


def build_summary(status: str, selected: int, total: int) -> str:
    return f"{selected} of {total} candidates selected (status: {status})."
