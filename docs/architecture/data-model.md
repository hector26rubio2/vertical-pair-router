# Data model

## Aggregates

- **Story**: user need, desired outcome, acceptance criteria, exclusions,
  assumptions/open questions, priority/status, glossary/ADR references, origin,
  author, and timestamps.
- **Task**: parent Story, executable outcome, falsifiable criteria,
  dependencies, allowed paths, required checks, and status.
- **Run**: one Task attempt, effective route, limits, lifecycle state,
  timestamps, events, errors, and Evidence references.
- **Evidence**: command/check identity, safe output summary, exit code, duration,
  tool version, timestamp, and source hash/reference.
- **Capability**: state, version, probe, timestamp, expiry, and evidence.

Identifiers are opaque strings with stable prefixes (`story_`, `task_`,
`run_`, `evt_`, `evd_`). Persisted records carry `schemaVersion`.

## Event envelope

Every event includes `eventId`, `occurredAt`, `projectId`, optional
`storyId/taskId/runId`, `actor`, `type`, `schemaVersion`, and a redacted payload.
Events are append-only. Projections are rebuildable and never become a second
authority.

## Sensitive data rule

Prompts, source file contents, tokens, cookies, credentials, and unrestricted
stdout/stderr are not domain fields. Evidence stores bounded summaries and
references, after redaction.

