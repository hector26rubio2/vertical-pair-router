# Phase 8 report: bounded execution and recovery

Date: 2026-11-09

## Implemented

- VPR-controlled wall-time, retry and router-iteration budgets.
- Separate provider-internal limits and explicit token/cost capability states:
  `unavailable`, `observable` and `enforceable`.
- Progress-aware command/result cycle detection.
- Event-sourced lease acquisition/renewal/release with expiry and exclusive
  owner checks for checkpoint and external-effect mutation.
- Revisioned checkpoints, durable cancellation requests and crash resume.
- External/destructive/ambiguous approval requests with durable resolution.
- Stable external-effect idempotency keys; completed effects are not repeated,
  while started-without-completion effects stop as in-doubt for reconciliation.
- Terminal-state derivation only from concrete validation, error, cancellation
  or blocker observations.
- Idempotent replay of a Run transition to its current state.

## TDD and recovery evidence

- The first Phase 8 compile exposed a misplaced deterministic ID generator in
  the new test; it was moved into the recovery fixture.
- Latest `pnpm check`: exit 0; build plus 63/63 tests passed.
- The SQLite recovery test persists lease, checkpoint, cancellation, approval,
  completed effect and in-doubt effect, closes the database, reopens it and
  resumes without re-running the completed action. It also proves lease conflict
  and takeover only after expiry.
- Budget tests prove retries/iterations/wall time, distinguish observed-only from
  enforceable usage, and keep provider-internal limits separate.

## Route

- Coordinator model: unavailable; no confirmed model receipt.
- Subagents: none; sequential fallback remained active.
- Provider-backed calls: none. Usage and cost: unavailable.

## Existing blockers

- License/title/publication remain owner-only decisions.
- Provider-backed Skill evals remain `NOT_RUN` pending authorization and budget.

## Next phase

Phase 9 validates host worktree isolation and implements path-overlap locks,
traceable worktree ownership, bounded task coordination, integration review and
non-destructive cleanup.
