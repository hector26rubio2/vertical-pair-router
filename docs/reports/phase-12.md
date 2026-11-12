# Phase 12: portability and compatibility

Date: 2026-11-11

Moved provider-specific built-in descriptors from Core to Runtime. Core now
contains only public-contract-based routing, policy and lifecycle rules. Adapter
contract tests validate the catalog; advertised OS values now match the executed
Windows evidence. macOS/Linux remain experimental and NOT_RUN.

Added a working `pnpm vpr` entry point, sanitized personal/company profile
examples, adapter contribution requirements and installation/update/rollback/
removal instructions. Pre-release plugin loading uses Claude Code's observed
session-only `--plugin-dir` option; marketplace publication remains gated.

## Executed checks

- `pnpm check`: exit 0, 87/87 tests.
- `pwsh -NoProfile -File tools/verify-clean-windows.ps1`: exit 0. Fresh temporary
  copy without dependencies/build artifacts, frozen-lockfile install, build,
  87/87 tests and CLI usage smoke all passed. Temporary directory removed.
- CLI usage returned the expected exit code 2, explicitly asserted by the script.
- Prior Windows evidence includes Unicode paths, safe process timeout and
  cancellation, executable resolution, SQLite locking/backup and Git worktrees.

This proves a clean checkout on this Windows machine. A second physical machine,
provider-backed execution and remote CI execution are NOT_RUN.

Coordinator: `gpt-6.1-sol`, confirmed by the interface during this phase. Earlier
phases retain their historical unavailable model observations. No subagents or
provider calls. Token/cost consumption unavailable.

Phase 13 next evaluates local adversarial cases, acceptance coverage and supply
chain evidence. License/title/publication still require the owner.
