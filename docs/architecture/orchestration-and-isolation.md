# Orchestration and Git isolation

VPR has one coordinator. An adapter may start a bounded worker for an assigned
Task, but worker output that delegates the full plan to another router is
rejected.

## Scheduling and locks

The scheduler selects only `READY` Tasks whose dependencies are completed and
never exceeds configured active parallelism. A path lock compares normalized
project-relative ancestors. Overlap is rejected in a shared workspace and
permitted only when both assignments identify different isolated worktrees.

## Assignment trace

The event-sourced registry stores Run, Task, owner, branch, worktree, base
commit, allowed paths and lock owner. Worker submission must include its minimal
context-pack handoff, worker commit, changed paths, required check evidence and
review/diff snapshot hashes. After validation, integration records the resulting
main commit. The chain remains recoverable as:

`Task → Run → assignment/base → worker commit → integrated commit`.

## Integration and cleanup

The coordinator rejects changes outside allowed paths, missing/failed/stale
checks, stale review and mismatched Task/Run identity before integration. A
moved base or conflict requires revalidation; if resolution could discard work,
the result is `needs-help` rather than an automatic conflict choice.

Cleanup is permitted only after integration and only for a clean worktree with
no untracked paths. Otherwise VPR preserves the worktree and reports why.
