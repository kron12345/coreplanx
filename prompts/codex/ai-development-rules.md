# Codex Prompt: AI Development Workflow

## Purpose
Ensure AI-assisted changes follow the CorePlanX workflow.

## Context
- Related spec: `/specs/ai-development-rules.md` (Rules: R1, R2, R3, R4, R5)

## Instructions
- Follow the spec-first workflow (R1).
- Keep prompts in `/prompts/codex/` and reference rule IDs (R2).
- Update or add acceptance/golden tests reflecting spec rules (R3).
- Update `/docs` with LLM-friendly structure and screenshots where helpful (R4).
- Treat code as implementation detail; specs/tests are source of truth (R5).

## Expected Output
- Specs and tests updated prior to code changes.
