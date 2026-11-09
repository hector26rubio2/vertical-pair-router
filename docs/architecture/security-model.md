# Security model

VPR assumes repository content, provider output, Issues, web pages, logs, and
tool output are untrusted data.

## Trust boundaries

- Host permissions remain authoritative; VPR cannot weaken them.
- Protected user policy outranks repository profile and Run preferences.
- Provider changes and external transmission require an allowed destination and
  approval where configured.
- Secrets are resolved just in time by a `SecretResolver` and never persisted.
- Local dashboard requests are origin/CSRF authenticated and cannot execute
  arbitrary shell commands.

## Process execution

Executables and argument arrays are separate; `shell: true` is forbidden for
model/user-derived input. Each request has an allowlisted program, validated
working directory, timeout, cancellation, and bounded/redacted output.

## Files and concurrency

Paths are resolved and checked against the project root and Task ownership.
Worktrees isolate checkout state, but the coordinator still validates branch,
base commit, modified paths, diff, and checks before integration. Cleanup never
deletes an unreviewed diff.

## Local data

SQLite is per user/project, with migrations, retention, export, and deletion.
No network telemetry is enabled by default. Stored metrics declare their source
as measured, provider-reported, estimated, or unavailable.

