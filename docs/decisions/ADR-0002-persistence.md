# ADR-0002: Persistence

- Status: PROPOSED
- Date: 2026-11-09

## Decision

Use SQLite as the canonical local store through a versioned `StorageAdapter`.
The first implementation uses Node's built-in `node:sqlite`; JSONL is export
only, not a second source of truth.

## Evidence and rationale

An in-memory create/insert/select smoke test passed on Node 24.15.0. The built-in
driver avoids Python, Docker, postinstall compilation, and third-party native
binaries.

## Risk and gate

The API is release-candidate stability. Before this ADR becomes VERIFIED, tests
must cover WAL/locking, multi-process contention, migrations, backup/restore,
crash recovery, Unicode paths, and a replaceable adapter contract. If those
fail, evaluate a pinned driver with compatible Windows prebuilds and license.

