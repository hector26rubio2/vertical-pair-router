# Usage Engine, event log and local dashboard

## Canonical data and projections

SQLite `domain_events` is the only operational source of truth. Events are
append-only during normal execution; Story, Task, Run and usage views are
replayed from them. JSONL is a portable export, never an independently writable
store. Explicit retention and full-project deletion are exceptional destructive
operations: CLI previews retention first and requires the exact project ID to
apply either operation.

Retention rotates only `UsageObserved` and `UsageSampleRecorded` metrics.
Story/Task/Run, evidence and recovery events are retained to preserve replay.

`@vpr/observability` projects only values present in events. Durations are
`measured`; tokens and cost retain their provider/measurement source. Missing
values are `unavailable`, not zero. Baseline/plugin comparisons require the same
Story and commit and flag either sample below five observations.

Persisted event payloads reject credential-, prompt-, source-code- and raw
stdout/stderr-shaped keys recursively. Legitimate aggregate fields such as
tokens, duration and cost may be stored only with an explicit source.

## Storage operations

- SQLite uses WAL, `synchronous=FULL`, foreign keys and a bounded busy timeout.
- Schema version 1 is bootstrapped idempotently by SQLite DDL and newer
  schemas are rejected rather than guessed.
- `backupTo` reserves a new destination and refuses replacement.
- JSONL export uses ordered project events.
- Retention is preview-first; apply and whole-project deletion require exact
  project-ID confirmation and an immediate transaction.

## Browser boundary

The dashboard binds an ephemeral port on `127.0.0.1` only. A random bearer token
and CSRF token are delivered in the URL fragment, removed from browser history,
and never appear in HTTP request URLs. API access requires the exact local Host;
mutations additionally require same Origin and the CSRF header. Responses use a
restrictive CSP, no-store, no-referrer and nosniff headers; request bodies are
bounded to 64 KiB.

The browser has no process or shell endpoint. Story preview/apply calls the same
`BacklogService` used by CLI. Glossary search reads the profile-selected
canonical Markdown and includes aliases, provenance, canonical state,
references and matching Story/Task IDs. Glossary mutations return a diff and
write only after an explicit approval call whose base hash is still current.

## CLI

```text
vpr dashboard --db <path> --project-id <id> --project <path>
vpr data export --db <path> --project-id <id> --out <new.jsonl>
vpr data retention --db <path> --project-id <id> --before <iso>
vpr data retention ... --apply --confirm <project-id>
vpr data delete --db <path> --project-id <id> --confirm <project-id>
```

The dashboard reads `glossaryPath` from `.vpr/profile.json`. It is local-only;
there is no publication, remote telemetry or external provider call.
