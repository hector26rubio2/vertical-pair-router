# Portability and reversible lifecycle

## Evidence matrix

| Surface | Windows 11 | macOS | Linux |
|---|---|---|---|
| Core policy, lifecycle and routing | VERIFIED locally | EXPERIMENTAL / NOT_RUN | EXPERIMENTAL / NOT_RUN |
| Node/pnpm clean checkout | VERIFIED locally | NOT_RUN | NOT_RUN |
| SQLite/WAL/backup/locking | VERIFIED locally | NOT_RUN | NOT_RUN |
| Safe process execution and quoting | VERIFIED locally, `shell: false` | NOT_RUN | NOT_RUN |
| Git worktree create/remove | VERIFIED locally | NOT_RUN | NOT_RUN |
| Claude Code plugin manifest/hooks | VERIFIED locally | NOT_RUN | NOT_RUN |
| Local dashboard | VERIFIED locally | NOT_RUN | NOT_RUN |

The built-in adapter descriptors advertise only `win32`. macOS and Linux are
valid contract values for future adapters, but VPR does not claim operational
support until their clean install, filesystem, process, SQLite, worktree, hook
and dashboard suites run on real CI hosts.

## Prerequisites

- Windows 11 and PowerShell 7 for the currently verified path.
- Git.
- Node.js `>=24.15 <27`.
- pnpm `>=11 <12` (the repository pins 11.1.2).
- Claude Code 2.1.319 only for the optional native host adapter. Core and CLI
  tests do not require a Claude account.

Docker and Python are not required.

## Checkout install and smoke test

```powershell
git clone <authorized-repository-url> vertical-pair-router
Set-Location vertical-pair-router
pnpm install --frozen-lockfile
pnpm check
pnpm vpr init --project .
claude --plugin-dir .
```

`vpr init` previews by default. Add `--apply` only after reviewing the proposed
profile. `claude --plugin-dir .` is session-scoped and is the only supported
pre-release plugin load path; it does not modify an installed marketplace
plugin. Do not use `claude plugin install` until a licensed release and
marketplace entry exist.

Run `pwsh -File tools/verify-clean-windows.ps1` to copy only Git-visible files
to a new temporary directory, install from the frozen lockfile, run all checks,
smoke the CLI usage path, and remove that directory. The script verifies its
cleanup target remains under the OS temporary root.

## Update, rollback and removal

Before an update, export project data and retain the prior commit/tag:

```powershell
pnpm vpr data export --db <db> --project-id <id> --out <new-file.jsonl>
git fetch --tags
git switch --detach <reviewed-commit-or-tag>
pnpm install --frozen-lockfile
pnpm check
```

Rollback repeats the last three commands with the previous reviewed commit/tag.
Schema readers reject future versions; backups never overwrite an existing
target. No automatic downgrade migration is claimed.

For a session-scoped plugin, exit the Claude Code session to unload it. To
remove the checkout, first export or explicitly delete local project data, then
remove the checkout with the user's normal filesystem workflow. VPR does not
write API credentials, global provider tokens or marketplace settings.

## Profiles

`examples/profiles/personal-global.json` demonstrates protected personal policy.
`examples/profiles/company-project.json` demonstrates repository-owned checks,
glossary and stricter local policy without proprietary rules or secrets. The
project profile belongs at `.vpr/profile.json`; do not copy private company
configuration into a global distributable package.
