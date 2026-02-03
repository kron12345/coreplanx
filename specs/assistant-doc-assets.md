# Spec: Assistant Documentation Assets

## Overview
Ensure assistant help pages can load referenced images in the UI without 404s.

## Rules
- R1: Images referenced from assistant docs must be available via the frontend `/assets/...` path.
- R2: Images used in `docs/assistant/*.md` are stored under `frontend/public/assets/` with matching paths.
- R3: Help pages must not reference images that return 404 in the browser.

## Behavior
- Markdown image links such as `./assets/<path>` resolve to `/assets/<path>` in the UI.
- The build/serve pipeline exposes `frontend/public` as `/` static assets.

## Acceptance Criteria
- AC1: Requests to documented image URLs return HTTP 200.
- AC2: No 404s for assistant help images in the browser console.
