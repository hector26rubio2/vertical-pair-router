# ADR-0002: Persistence

- Status: VERIFIED LOCALLY
- Date: 2026-11-09

## Decision

Use SQLite as the canonical local store through a versioned `StorageAdapter`.
The first implementation uses Node's built-in `node:sqlite`; JSONL is export
only, not a second source of truth.

## Evidence and rationale

An in-memory create/insert/select smoke test passed on Node 24.15.0. The built-in
driver avoids Python, Docker, postinstall compilation, and third-party native
binaries.

## Verification and remaining risk

The adapter enables WAL, full synchronous writes, foreign keys, a bounded busy
timeout, and an explicit schema version. Tests cover reopen/crash recovery,
idempotent events, lock contention, first-version bootstrap, rejection of a
newer schema, non-overwriting backup/restore, Unicode paths and the replaceable
`StorageAdapter` boundary. JSONL remains export-only.

`node:sqlite` stability is still a portability risk outside the verified Node
and Windows matrix. A later schema must add an ordered migration before raising
the supported version; silently opening a future schema is forbidden.

