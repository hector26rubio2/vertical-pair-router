# Phase 13 checkpoint: integral evaluation and security

Date: 2026-11-11
Status: IN PROGRESS; provider pilot and release gates are pending.

## Executed evidence

- `pnpm check`: 88/88 tests passed after the security changes.
- `pnpm audit --json`: exit 0, zero advisories across three development
  dependencies; no third-party production dependencies. This is a point-in-time
  registry audit, not a guarantee of absence of defects.
- `pnpm licenses list --json`: TypeScript 5.9.3 Apache-2.0,
  @types/node 24.10.1 MIT, undici-types 7.16.0 MIT.
- Strict Claude plugin manifest validation passed in Phase 11. Directory
  publication remains blocked by the missing owner-selected license.
- Windows fresh dependency install and full suite passed in Phase 12.

## Security correction

Retention previously selected all old events. That could invalidate event
replay for existing Stories and Runs. The storage deletion predicate, CLI
preview and observability preview now select only `UsageObserved` and
`UsageSampleRecorded`. A regression test proves a durable old Story event
survives rotation. Explicit whole-project deletion retains exact-ID confirmation.

Added executed adversarial coverage for literal shell metacharacters, a forged
HTTP Host, foreign Origin and bodies exceeding 64 KiB. Existing tests cover
timeouts, cancellation, huge process output, secret-shaped event fields,
unsupported profiles, stale glossary/context and disallowed provider fallback.

## Acceptance matrix

| Gate | Evidence/status |
|---|---|
| Core, policy, routing, lifecycle | PASS local unit/contract suite |
| CLI, SQLite recovery, backup, locking | PASS local integration suite |
| Dashboard auth, mutation and canonical glossary | PASS integration; browser QA Phase 11 |
| Windows clean install | PASS same-machine clean temporary checkout |
| Host hooks and plugin manifest | PASS local hooks/schema tests and strict manifest validation |
| Feature/bug/multilayer provider pilots | NOT_RUN; fixtures are not provider execution evidence |
| Baseline/plugin comparison | Comparison contract tested; real pilot samples NOT_RUN |
| Provider authentication/execution | NOT_RUN pending authorized account/budget |
| macOS/Linux and second physical machine | NOT_RUN |
| Public license/title/publication | Owner decision pending |

No general token/time savings are claimed. The three planned pilot cases must
share base commits, criteria and checks across baseline/plugin arms and record
human intervention and quality. Their outcomes must be exploratory.

Coordinator: gpt-6.1-sol (interface-confirmed). No subagents. Tokens/cost
unavailable. No provider-backed inference calls were made.
