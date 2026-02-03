# CorePlanX – AI Development Rules

These rules apply to all AI-assisted changes in this repository.

## Workflow (Mandatory)
1. **Before writing or changing code**
   - Check whether a spec exists under `/specs`.
   - If missing, **create a spec first**.
   - If existing, **update it** whenever behavior changes.

2. **Prompts**
   - Store or update prompts under `/prompts/codex/`.
   - Reference spec rule IDs (R1, R2, …).

3. **Tests**
   - Create or update acceptance tests or golden tests.
   - Tests must reflect **spec rules**, not implementation details.

4. **Documentation (existing docs)**
   - Update the existing documentation under `/docs` when behavior changes.
   - Documentation must be LLM-friendly: use subpages, clear structure, and include screenshots where helpful.

5. **Code**
   - Code is an implementation detail.
   - Specs and tests are the source of truth.

**Never change behavior without updating specs and tests first.**
