# Phase 7 report: Quality Guard

Date: 2026-11-09

## Implemented

- Typed check catalog for unit/integration tests, lint, typecheck, build and
  explicitly approved scanners, including program/args, cwd, timeout, output
  bound, stack, category and permission.
- Shell-free check execution produces measured evidence and keeps failure,
  timeout, cancellation and truncation distinct.
- A real Git snapshot includes staged, unstaged and bounded untracked content;
  durable freshness uses SHA-256 rather than copied diff bodies.
- Final verification requires the newest evidence for every Task-required check
  to match the current snapshot exactly.
- TDD records enforce measured RED/GREEN on the same test and green REFACTOR;
  `NOT_APPLICABLE` requires a reason.
- Regression assessment reports unreproduced defects, non-observable assertions,
  internal mocks and tautological expectations.
- Dual review separates acceptance from standards/security, prevents recursive
  review fan-out, requests a separate reviewer when available/beneficial, and
  validates located/evidenced/confident findings against the current snapshot.

## TDD and checks

- Initial `pnpm typecheck`: expected red state; the new Quality Guard exports did
  not exist.
- Latest `pnpm check`: exit 0; build plus 58/58 tests passed before the final
  documentation-only update.
- The Git integration test creates a repository with simultaneous staged,
  unstaged and untracked changes, proves all are captured, then changes an
  untracked file and observes a new snapshot hash.
- Unit tests cover scanner approval, check status, stale evidence, TDD sequence,
  regression warnings, reviewer separation, recursion prevention and finding
  freshness.

## Route

- Coordinator model: unavailable; no model receipt was exposed.
- Separate review agent: unavailable in this session, so the same-author fallback
  is declared rather than represented as independent review.
- Provider-backed calls: none. Usage and cost: unavailable.

## Existing blockers

- License/title/publication remain owner-only decisions.
- Provider-backed Skill evals remain `NOT_RUN` pending authorization and budget.

## Next phase

Phase 8 adds bounded execution, retries/iterations, repeated-cycle detection,
cancellation, leases, crash recovery, resume and approval requests.
