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
| 1 Open-source repo and contracts | COMPLETE LOCALLY / RELEASE BLOCKED | Owner confirms license; directory profile becomes publishable |
| 2 Configuration/capabilities/policy | COMPLETE LOCALLY | Adapter consumes effective policy and capability evidence |
| 3 Claude Code adapter/hooks | COMPLETE LOCALLY | Provider-backed smoke remains explicit/authorized |
| 4 Skills/AI Hero adaptation | COMPLETE LOCALLY | Provider-backed eval cases remain NOT_RUN |
| 5 Knowledge/context packs | COMPLETE LOCALLY | BacklogService consumes Story-linked proposals and handoffs |
| 6 Story/Task/Run and planner | COMPLETE LOCALLY | Quality Guard consumes required checks and real diff state |
| 7 Quality Guard | COMPLETE LOCALLY | Execution engine persists fresh check/review evidence |
| 8 Execution/recovery | COMPLETE LOCALLY | Orchestrator uses leases, checkpoints and approvals |
| 9 Orchestration/isolation | COMPLETE LOCALLY | OmniRouter consumes capability and assignment boundaries |
| 10 OmniRouter/adapters | COMPLETE LOCALLY | Usage engine records route/adapter measurement sources |
| 11 Usage/event log/dashboard | COMPLETE LOCALLY | Portability matrix consumes storage/dashboard evidence |
| 12 Portability/compatibility | COMPLETE LOCALLY | Windows clean install passed; macOS/Linux experimental |
| 13 Evaluation/security/pilot | IN PROGRESS | Local security checkpoint passed; provider pilots NOT_RUN |
| 14 Release/publication | BLOCKED on owner authorization | License/title/publication decision |

