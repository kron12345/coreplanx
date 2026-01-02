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


class SolverRequest(BaseModel):
    rulesetId: str
    rulesetVersion: str
    candidates: List[SolverCandidate]
    options: SolverOptions = Field(default_factory=SolverOptions)


class SolverStats(BaseModel):
    totalCandidates: int
    selectedCandidates: int
    groupCount: int


class SolverResponse(BaseModel):
    summary: str
    selectedIds: List[str]
    score: Optional[int] = None
    status: str
    stats: SolverStats


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/solve", response_model=SolverResponse)
def solve(request: SolverRequest) -> SolverResponse:
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

    selected_ids = [
        candidate.id for candidate, var in variables if solver.Value(var) == 1
    ] if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else []

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
