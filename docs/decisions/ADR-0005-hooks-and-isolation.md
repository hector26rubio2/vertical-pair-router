# ADR-0005: Hooks and isolation

- Status: VERIFIED
- Date: 2026-11-09

## Decision

Claude hooks are thin host notifications/guards. Heavy checks run in the local
runtime. A critical policy is enforced again in CLI/CI and never depends only
on a hook.

Prefer Claude native or Orca-managed Git worktrees for independent Tasks. VPR
adds explicit allowed-path ownership, branch/base recording, diff inspection,
and final validation.

## Evidence and limitation

Claude 2.1.312 exposes plugin, agent, hook, eval, and worktree features. Current
documentation states that PowerShell worktree isolation checks working
directory but lacks Bash's command-text validation. Therefore isolation alone
is insufficient for concurrency safety on Windows.

