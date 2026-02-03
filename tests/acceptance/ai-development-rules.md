# Acceptance Test: AI Development Workflow

## Related Spec
- `/specs/ai-development-rules.md` (Rules: R1, R2, R3, R4, R5)

## Preconditions
- Repository has `/specs`, `/prompts/codex`, `/docs` directories.

## Steps
1. Propose a behavior change.
2. Verify a spec exists under `/specs` and update it first (R1).
3. Create/update a prompt under `/prompts/codex/` referencing rule IDs (R2).
4. Create/update acceptance or golden tests reflecting spec rules (R3).
5. Update existing documentation under `/docs` with LLM-friendly structure and screenshots where helpful (R4).
6. Implement the code changes (R5).

## Expected Results
- Specs, prompts, tests, and documentation are updated before code changes.
- Rule IDs are referenced in prompts and tests.
