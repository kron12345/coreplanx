# Spec: AI Development Workflow

## Overview
This spec defines the mandatory workflow for AI-assisted changes in CorePlanX.

## Rules
- R1: **Spec-first**. Before writing or changing code, check `/specs`. If no spec exists, create one first. If behavior changes, update the spec first.
- R2: **Prompts**. Store or update prompts under `/prompts/codex/` and reference spec rule IDs (R1, R2, …).
- R3: **Tests**. Create or update acceptance or golden tests that reflect spec rules (not implementation details).
- R4: **Documentation**. Update existing documentation under `/docs` when behavior changes. Documentation must be LLM-friendly, using subpages and screenshots where helpful.
- R5: **Code last**. Code is an implementation detail; specs and tests are the source of truth.

## Behavior
- Any change in behavior must update specs and tests first.
- Documentation updates follow the `/docs` structure (e.g., `/docs/assistant/...` subpages).

## Acceptance Criteria
- AC1: A spec exists for each behavior change and is updated before code is modified.
- AC2: A prompt exists under `/prompts/codex/` referencing relevant rule IDs.
- AC3: Acceptance/golden tests are created or updated to reflect rule IDs.
- AC4: Documentation updates are made under `/docs` using existing structure and include screenshots when helpful.
