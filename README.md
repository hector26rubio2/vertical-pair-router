# Vertical Pair Router

Vertical Pair Router (VPR) is a local-first, open-source runtime and Claude Code
plugin for running agent-assisted engineering work with explicit policy,
evidence, limits, and recovery.

The repository is being built in vertical slices from the authoritative product
plan dated 2026-11-09. Phases 0–11 are complete locally; release and publication
remain blocked on owner decisions.

## Current status

The local CLI and dashboard are usable development builds. End-to-end agent
execution and provider pilots are still pending; publication is not the only
remaining work. To try the dashboard run `pwsh -File tools/start-local.ps1` and
open the local URL printed. To load the Claude Code plugin for a session run
`pwsh -File tools/start-local.ps1 -Mode plugin`.

The root Markdown files describe contribution, conduct, support, security and
third-party attribution. They are documentation rather than runtime features.

- Phases 0–11: complete locally; owner decisions for public release remain open.
- Supported development host: Windows 11, PowerShell 7, Node.js 24 LTS.
- Initial host adapter: Claude Code 2.1.319 measured locally.
- Network telemetry: disabled by design.
- Runtime/package manager: Node.js >=24.15 and pnpm 11.

## Local checkout

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm vpr init --project .
claude --plugin-dir .
```

`--plugin-dir` loads the plugin for that Claude Code session only. It does not
publish or persistently install VPR. Marketplace installation remains
unavailable until the license and publication gates are resolved.

See [host capabilities](docs/research/host-capabilities.md), the
[architecture overview](docs/architecture/overview.md), and the
[execution backlog](docs/backlog/execution.md). Installation, rollback and the
evidence-based OS matrix are in [portability and lifecycle](docs/operations/portability.md).

