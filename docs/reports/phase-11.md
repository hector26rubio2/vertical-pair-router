# Phase 11 report: usage, event log and dashboard

Date: 2026-11-11

## Implemented

- `@vpr/observability` projections for Runs, checks, retries, intervention,
  duration, tokens and cost with explicit measurement sources and unavailable
  values.
- Comparable baseline/plugin samples require the same Story and commit and
  disclose small samples.
- Recursive persisted-payload guard against credentials, prompts, source and raw
  process output.
- JSONL export, preview/apply retention, exact-confirmation deletion,
  non-overwriting backup/restore, Unicode paths, lock-contention behavior and
  future-schema rejection.
- A loopback-only dashboard with bearer auth, CSRF/origin/Host checks, bounded
  requests and strict browser security headers.
- Read views for usage, Stories, Tasks and glossary plus browser previews and
  approvals through `BacklogService` and hash-checked canonical glossary APIs.
- Search by term/alias with definition, canonical state, provenance, references
  and matching Story/Task identifiers. No browser endpoint can execute a shell.
- CLI commands for dashboard, export, retention and deletion.

## Verification

- Focused build/tests after the persistence and browser changes: exit 0; 12/12
  storage/dashboard/CLI tests passed.
- Local browser QA after the last UI change: authenticated snapshot loaded,
  unavailable token/cost values rendered honestly, eight canonical glossary
  terms and their aliases/references rendered, and both Story and glossary
  preview forms expanded successfully.
- A served-JavaScript syntax defect discovered by browser QA was fixed before
  the successful second inspection.
- Final repository-wide `pnpm check`: exit 0; build plus 84/84 tests passed
  after the last code and documentation changes.
- `claude plugin validate --strict --json .`: manifest success with no manifest
  warnings; directory publication remains blocked by `LICENSE_MISSING` and the
  optional icon remains absent.

## Route and usage

- Coordinator model: unavailable; the interface exposed no confirmed model
  receipt.
- Subagents: none. The requested model-per-subagent selection was unavailable in
  this surface, so this phase ran sequentially.
- Provider-backed calls: none. Browser QA and all checks were local.
- Token/cost consumption: unavailable.

## Existing blockers

- License, title and publication remain owner-only decisions; `LICENSE` is not
  created by this phase.
- Provider-backed Skill/adapter evals remain `NOT_RUN` pending explicit
  authorization and budget.

## Next phase

Phase 12 validates clean Windows installation and reversible lifecycle, declares
the evidence-based OS support matrix, and documents adapter contribution without
claiming untested macOS/Linux support.
