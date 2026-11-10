# Windows worktree isolation audit

Date: 2026-11-09

## Observed locally

- Claude Code: `2.1.319`.
- `claude --help` exposes `-w, --worktree [name]`, background agents and agent
  management. This confirms local CLI capability, not a successful provider
  session.
- No Claude worktree session was started: that would be provider-backed and no
  explicit budget/data authorization was supplied.
- Git created a detached worktree from commit
  `a0e6c96f66bd9a6dd0f8595bb6b15b9226d533ad` in a validated OS temp path,
  reported a clean status, returned the same HEAD, and removed it cleanly.
- The final `git worktree list --porcelain` contained only the main worktree.
- Orca CLI: `1.4.243`; `orca status --json` reported app not running, runtime
  `stale_bootstrap`/disconnected and graph not running. Structured worker
  coordination is therefore unavailable from this session.

## Decision

Prefer host-native Claude worktree isolation when an authorized Claude session
is actually used. VPR does not create a competing worktree implementation. Its
runtime owns provider-neutral scheduling, path locks, assignment evidence,
worker-output validation, integration decisions and cleanup safety; a host
adapter supplies the worktree operations.

When isolation is unavailable, overlapping paths are locked and parallel Tasks
are not scheduled together. Different confirmed worktrees may hold overlapping
path scopes, but integration still revalidates base, diff, checks and review.
