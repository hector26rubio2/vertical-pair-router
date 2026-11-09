# Vertical Pair Router

Vertical Pair Router (VPR) is a local-first, open-source runtime and Claude Code
plugin for running agent-assisted engineering work with explicit policy,
evidence, limits, and recovery.

The repository is being built in vertical slices from the authoritative product
plan dated 2026-11-09. Phase 0 records local compatibility and the architecture
decisions required by the first executable slice.

## Current status

- Phase 0: complete locally; owner decisions for public release remain open.
- Supported development host: Windows 11, PowerShell 7, Node.js 24 LTS.
- Initial host adapter: Claude Code 2.1.312 or later.
- Network telemetry: disabled by design.
- Runtime/package manager: Node.js >=24.15 and pnpm 11.

See [host capabilities](docs/research/host-capabilities.md), the
[architecture overview](docs/architecture/overview.md), and the
[execution backlog](docs/backlog/execution.md).

