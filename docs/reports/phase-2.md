# Phase 2 report: profiles, capabilities, and policy

Date: 2026-11-09

## Implemented

- Versioned project profile proposal with stack/package-manager/check detection.
- `vpr init --project <path>` is preview-only; `--apply` is the explicit write
  decision. Apply verifies the preview hash, writes atomically, and backs up an
  existing profile before update.
- Versioned global/project profile parsers reject unsupported schema versions.
- Protected policy precedence: lower scopes may harden but cannot weaken
  booleans; provider destinations intersect; numeric limits use the strictest
  value; explain output records rule sources.
- Capability probes record state, version, exit code, duration, timestamp,
  expiry, executable reference, limitations, and measured Evidence.
- Capability Registry caches until expiry and supports explicit refresh.
- Shell-free executable resolution selects a concrete `.exe`/`.com` path on
  Windows and never treats `.cmd`/`.bat` as directly executable.
- `vpr doctor` probes Node, Git, pnpm, and PowerShell and persists a real local
  check Run.

## Discrepancy found and fixed

An initial `spawn("pnpm")` probe reported `9.0.0-alpha.4`, while the active
PowerShell command reported pnpm `11.1.2`. Multiple pnpm shims were present on
`PATH`. VPR now resolves and allowlists the concrete executable before spawning.
The repeated doctor probe reported pnpm `11.1.2` with no shell.

The later doctor ran under Node `24.18.0` and PowerShell `7.6.9`; the Phase 0
audit had observed Node `24.15.0` and PowerShell `7.6.5`. Both observations are
retained as measured evidence from their execution surfaces rather than being
silently normalized.

## TDD and checks

- Policy tests cover protected booleans, provider intersection, and strictest
  output limits.
- Profile tests cover detection, preview without write, explicit apply,
  idempotent no-op, and concurrent-change refusal.
- Capability tests cover available/degraded evidence, expiry, forced refresh,
  unknown IDs, deterministic PATH order, and Windows script exclusion.
- Latest `pnpm check`: exit 0; TypeScript build and 30/30 tests passed.
- Latest `git diff --check`: exit 0.
- Manual `vpr init --project .`: action `create`, applied `false`; no profile
  file was written.
- Manual `vpr doctor`: Run `COMPLETED`; Node, Git, pnpm, and PowerShell all
  reported `available`; measured pnpm version `11.1.2`.

## Route and usage

- Coordinator model: unavailable; no confirmed model receipt was exposed.
- Subagents: none; Orca structured coordination remains unavailable to this
  non-Orca Codex terminal.
- Tokens/cost: unavailable.
- External telemetry/provider transmission by VPR: none.

## Next phase

Phase 3 adds the Claude Code adapter and thin observable hooks. License and
release icon remain owner/release blockers, not runtime blockers.

