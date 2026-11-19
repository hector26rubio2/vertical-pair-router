# Execution backlog

## STORY-000: Establish an executable VPR foundation

**Need:** start from an empty folder with a reproducible, host-independent core
and verifiable Windows toolchain.

**Acceptance criteria**

- The monorepo installs and checks from a clean clone on Node 24.15+ / pnpm 11.
- Contracts represent Story, Task, Run, Evidence, Event, Capability, Policy, and
  routing without importing Claude Code.
- A first end-to-end test persists a Story/Task/Run and real check evidence.
- Safe process execution demonstrates timeout, cancellation, output bounds, and
  no shell interpolation.
- Plugin metadata validates strictly without changing user settings.

### Tasks

1. `TASK-001` Bootstrap workspace, contracts, and core state machine.
2. `TASK-002` Build safe process/evidence primitives and tests.
3. `TASK-003` Build SQLite adapter and recovery/migration tests.
4. `TASK-004` Add CLI vertical slice and minimal Claude plugin integration.
5. `TASK-005` Run final checks, diff review, and Phase 1 evidence report.

Tasks 2 and 3 may run independently after Task 1 defines interfaces. Their
file ownership must not overlap.

## Phase status

| Phase | Status | Next gate |
|---|---|---|
| 0 Audit and ADRs | COMPLETE with owner blockers recorded | Commit baseline and prove worktree behavior |
| 1 Open-source repo and contracts | COMPLETE LOCALLY; MIT CONFIRMED | Release requires executed package/CI checks |
| 2 Configuration/capabilities/policy | COMPLETE LOCALLY | Adapter consumes effective policy and capability evidence |
| 3 Claude Code adapter/hooks | VERIFIED LOCALLY | Native usage, guarded execution and reversible installation tested; other OS jobs pending |
| 4 Skills/AI Hero adaptation | VERIFIED LOCALLY | Bounded provider experiments recorded; no general quality/savings claim |
| 5 Knowledge/context packs | COMPLETE LOCALLY | BacklogService consumes Story-linked proposals and handoffs |
| 6 Story/Task/Run and planner | COMPLETE LOCALLY | Quality Guard consumes required checks and real diff state |
| 7 Quality Guard | COMPLETE LOCALLY | Execution engine persists fresh check/review evidence |
| 8 Execution/recovery | COMPLETE LOCALLY | Orchestrator uses leases, checkpoints and approvals |
| 9 Orchestration/isolation | COMPLETE LOCALLY | OmniRouter consumes capability and assignment boundaries |
| 10 OmniRouter/adapters | VERIFIED LOCALLY; PROVIDER LIMITATIONS RECORDED | Claude and Codex real edits/checks verified; corporate Copilot inference acceptance pending |
| 11 Usage/event log/dashboard | VERIFIED LOCALLY | Native account/model/phase ledger displayed with authenticated DTO; no inference for reads |
| 12 Portability/compatibility | PACKAGE/LIFECYCLE VERIFIED ON THREE SYSTEMS | Release pipeline requires the complete Node 24/26 matrix; generative provider tests remain Windows-only |
| 13 Evaluation/security/pilot | BOUNDED EXPERIMENTS COMPLETE | 17 tasks/119 trials in the local report; mixed quality, not a general savings guarantee |
| 14 Release/publication | RELEASE PIPELINE ACTIVE; 0.1.0 PUBLISHED | GitHub Releases records published versions; every new tag requires the complete verification matrix before upload |

## Verification update — 2026-11-18

The owner confirmed MIT and `Vertical Pair Router contributors`. Windows clean
installation, npm/pnpm archive installation, native plugin install/update/
rollback/uninstall, Husky rejection of staged sensitive content, Graphify query,
and pinned Archify rendering were exercised. The native dashboard displays
observed counts without inference. No raw Finanzas snapshot, local benchmark
data, personal project profile, credential or run database belongs in the release.

Real Finanzas implementation case F02 passed with Sonnet after one correction
(9 external criteria, original regressions, full build, fresh review). The
Haiku recipes did not reach the same acceptance in this trial; Opus direct
timed out and the triple recipe exhausted planning turns before implementation.
These are bounded outcomes, not a ranking of general model intelligence.

The resumed Codex pilot used the independent official npm CLI 0.170.0. Both a
direct invocation and `/vpr-run` from Claude edited only the authorized SKU file
and passed five acceptance cases. The Claude immediate command used no main-model
inference. The larger F02 Sonnet→Terra and Sonnet→Sol recipes passed all nine
external criteria, original regressions and the full Angular build. Terra had
only low review findings; Sol retained one medium finding. The Opus→Codex recipes
exhausted planning turns before dispatch and are not Codex implementation results.

Copilot now uses the official Microsoft SDK 2.0.1 with CLI 1.0.114, explicit stdio
ownership and native sign-in. The real account-free inference check authenticated
to GitHub but listed no entitled models; no Copilot generation was attempted.
The corporate machine must validate its own permitted models and execution.


## Deferred routing objectives — 2026-11-19

The `tokens` and `subscription-quota` objectives are accepted in the profile, but
`routeWorkflow` only ranks candidates for `reference-cost`; the other objectives
fall back to the rule-based decision. `decideLocalExecution` used to cover them
and was removed because it had no callers. Pending: add token and quota figures to
`WorkflowCase` if ranking by those objectives is needed.
