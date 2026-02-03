# Codex Prompt: Topology List Search & Infinite Scroll

## Purpose
Add server-side search and infinite scroll for topology master data lists.

## Context
- Related spec: `/specs/topology-list-search-scroll.md` (Rules: R1, R2, R3, R4)

## Instructions
- Wire search field to backend `query` parameter (R1).
- Replace button-based paging with automatic lazy loading on scroll (R2).
- Reset paging when search term changes (R3).
- Preserve UI responsiveness and show counts (R4).

## Expected Output
- Updated UI/Store/API to support server search + infinite scroll.
