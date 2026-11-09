# ADR-0001: Runtime and toolchain

- Status: VERIFIED
- Date: 2026-11-09

## Decision

Use TypeScript on Node.js 24.15 or newer within the Node 24 LTS line, pnpm 11,
ES modules, and strict TypeScript. CI will add the next adopted LTS line once
the first slice is stable.

## Evidence and rationale

The host has Node 24.15.0 and pnpm 11.1.2. Node 24 is LTS and supported through
April 2028. Node 22 remains supported but its built-in SQLite API is at an older
stability point; Node 24.15 promotes that API to release-candidate stability.
Pinning 24.15 resolves the source-plan conflict without Python or Docker.

## Consequences

Windows x64 is the only verified platform. Package metadata and CI enforce the
minimum version. No global dependency installation is part of normal use.

