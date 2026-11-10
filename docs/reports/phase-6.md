# Phase 6 report: BacklogService and vertical planning

Date: 2026-11-09

## Implemented

- `@vpr/backlog` is an event-sourced domain service shared by the grill adapter
  and CLI, with a stable boundary for the dashboard in Phase 11.
- Story create/update uses preview, configurable explicit confirmation,
  normalized-title deduplication, optimistic revision/event-count checks and a
  complete version history. No-op patches do not create versions.
- `vpr-grill` output becomes a `StoryDraft`; unresolved questions keep it in
  `DRAFT` with optional spec attachments and produce no Tasks.
- Seven workflow routes cover feature, simple/complex bugfix, refactor,
  documentation, infrastructure and research.
- The planner validates vertical outcomes, falsifiable criteria, demo paths,
  checks, allowed paths and an acyclic dependency graph. Dependencies promote
  from `PENDING` only after all prerequisites complete.
- Story, Task and Run transitions are evented and validated. Runs can only start
  from executable Task states.
- High-risk, public-API, infrastructure and complex-bugfix slices require human
  review. A minimal planning handoff exposes the Story revision, Task IDs,
  review requirement and next action.
- `vpr story --db ... --project-id ... --input ... [--apply]` previews and
  confirms through the same service; direct adapter writes are not duplicated.
- Hard delete is intentionally absent from the product boundary because it
  would violate the audit log; terminal/blocked transitions handle lifecycle.

## TDD and recovery evidence

- Initial Phase 6 `pnpm typecheck`: expected red state; backlog modules did not
  exist.
- First implementation reached the assertions but exposed Windows SQLite WAL
  teardown ordering; cleanup now closes the adapter before removing fixtures.
- Latest `pnpm check`: exit 0; build plus 52/52 tests passed.
- A real SQLite test creates and transitions Story/Task/Run, closes the adapter,
  reopens it and recovers the same state. Other tests cover confirmation,
  duplicates, stale revisions, versions, no-op patches, all workflow routes,
  DAG promotion, review gates and CLI preview/apply.

## Route and consumption

- Coordinator model: unavailable; the interface provided no confirmed model
  receipt.
- Subagents: none; sequential fallback remained in force.
- Provider-backed calls: none. Usage and cost: unavailable.

## Existing blockers

- License/title/publication remain owner decisions; no `LICENSE` was fabricated.
- Provider-backed Skill evals remain `NOT_RUN` without explicit authorization
  and budget.

## Next phase

Phase 7 adds the Quality Guard: typed check catalog, real TDD evidence,
regression-test assessment, dual diff review and freshness enforcement.
