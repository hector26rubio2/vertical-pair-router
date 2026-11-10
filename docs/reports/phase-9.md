# Phase 9 report: orchestration and Git isolation

Date: 2026-11-09

## Local capability audit

- Claude Code 2.1.319 advertises native `--worktree`; no provider-backed session
  was started.
- Native Git worktree create/status/HEAD/remove succeeded on Windows against
  commit `a0e6c96` and left no auxiliary worktree.
- Orca CLI 1.4.243 is installed, but its local runtime reported disconnected
  `stale_bootstrap`; the sequential fallback remains factual.

## Implemented

- DAG scheduler with explicit maximum parallelism and dependency readiness.
- Project-relative hierarchical path locks; overlap blocks shared workspaces and
  requires distinct confirmed isolation IDs to proceed concurrently.
- Event-sourced assignment registry recording Task/Run, owner, branch, worktree,
  base, allowed paths and lock owner, followed by worker and integrated commits.
- Worker validation requires minimal context handoff, allowed changed paths,
  required fresh checks and review on the same diff.
- Nested full-plan delegation is rejected so only one coordinator owns routing.
- Integration returns `needs-help` when conflict/base movement could discard
  work; cleanup preserves dirty, untracked or unintegrated worktrees.

## Checks

- Latest `pnpm check`: exit 0; build plus 68/68 tests passed.
- SQLite proves the assignment→validated worker commit→integrated commit trace.
- Unit tests cover parallelism, dependencies, shared-vs-isolated overlap,
  out-of-scope paths, stale checks/review, nested orchestration, conflict
  escalation and non-destructive cleanup.

## Route

- Coordinator model: unavailable; no confirmed model receipt.
- Subagents: none. Orca runtime was disconnected and no authorized Claude
  provider session was started.
- Provider usage/cost: unavailable; no provider-backed call was made.

## Next phase

Phase 10 implements deterministic OmniRouter policy/capability/privacy/quality/
cost-latency evaluation and documented adapter contracts without credential
extraction.
