# Acceptance Test: Assistant Documentation Assets

## Related Spec
- `/specs/assistant-doc-assets.md` (Rules: R1, R2, R3)

## Preconditions
- Assistant help page is accessible in the UI.

## Steps
1. Open **Stammdaten → Topologie** help panel.
2. Verify screenshots render without broken image icons.
3. Check network tab for requests to `/assets/...` images.

## Expected Results
- All assistant doc images return HTTP 200.
- No 404 errors for referenced images (R3).
