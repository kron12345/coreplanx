# Spec: Order List Create Focus And CTA Contrast

## Overview
- Problem/goal: Improve visibility of the `Neuer Auftrag` CTA on the orders hero section and keep the newly created order in focus so users can continue editing immediately.
- Non-goals: Redesign of the full orders page visual language, changes to filtering behavior, or backend order creation logic.
- Stakeholders: Disposition, Auftragsmanager users, support/docs teams.

## Rules
- R1: The hero CTA `Neuer Auftrag` must have clear visual contrast against the blue hero background.
- R2: After successfully creating an order, the orders page must focus the newly created order card in the list.
- R3: Focusing a newly created order means it is scrolled into view and opened/expanded for immediate follow-up work.
- R4: Existing filters/search state must remain unchanged; if a created order is not visible due filters, no automatic filter reset is performed.
- R5: Focus scrolling should position the order card as close to the top of the visible list area as possible so enough space remains below for expanded order items.

## Behavior
- Inputs:
  - User clicks `Neuer Auftrag` and saves the dialog with valid values.
  - User cancels/closes the dialog without saving.
- Outputs:
  - CTA is visibly readable/clickable on hero background (R1).
  - On save: created order card receives focus behavior (scroll near top + expand) (R2, R3, R5).
  - On cancel: no focus action is triggered.
- Edge cases:
  - If the created order card is not currently rendered (e.g. due active filters), focus attempt is skipped without changing filters (R4).

## Acceptance Criteria
- AC1: `Neuer Auftrag` CTA is visually distinct from the blue hero background (R1).
- AC2: Creating an order scrolls the list to the created order card (R2, R3).
- AC3: The created order card is expanded after creation (R3).
- AC4: Active filters/search remain unchanged after creating an order (R4).
- AC5: The focused created card appears near the upper edge of the visible area so expanded item content has maximum remaining space below (R5).
