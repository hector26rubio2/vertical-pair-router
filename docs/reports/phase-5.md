# Phase 5 report: knowledge and resumable context

Date: 2026-11-09

## Implemented

- `@vpr/knowledge` resolves the profile-selected glossary within the project and
  rejects a second conventional authoritative glossary.
- Glossary terms require definition, avoid-list, links, source, date and owner.
  Proposals carry their originating Story, expose a diff, make no write during
  preview, and produce an explicit accepted/rejected resolution. Accepted writes
  use a reviewed base hash and atomic replacement.
- `GLOSSARY.md` is the sole canonical project glossary. The separate technical
  dictionary is deliberately small and links back to it. The reviewed project
  profile was applied through `vpr init --apply` and configures exactly that
  canonical path.
- ADR rendering requires context, decision, alternatives, status and
  consequences. ADR-0007 records reference-based context packs.
- Context packs retain relative paths, optional line ranges, commit, SHA-256,
  byte sizes and pending work. They reject root escapes, external symlinks,
  sensitive paths and configured file/byte limits; validation reports stale or
  missing sources.
- The SHA-256 cache keys entries by path, size and mtime and supports targeted or
  full invalidation. Handoffs contain only references, Git/check evidence and a
  next action.

## TDD evidence

- Initial `pnpm typecheck`: exit 1 because the tested knowledge contract did not
  yet exist (expected red state).
- First implementation `pnpm check`: exit 1 on exact optional-property typing;
  the emitted context reference was corrected rather than loosening types.
- Latest `pnpm check`: exit 0; build plus 46/46 tests passed.
- Tests cover glossary root containment/conflict/concurrency and explicit
  resolution; complete ADRs; stale, sensitive and oversized context sources;
  and body-free handoffs.

## Route and consumption

- Coordinator model: unavailable (the interface did not expose a confirmed
  model receipt).
- Subagents: none. Structured Orca dispatch was unavailable from this session;
  the documented sequential fallback was used.
- Provider-backed calls: none. Usage and cost: unavailable.

## Release blockers unchanged

- No owner-approved repository license/title/publication authorization exists.
  `LICENSE` remains intentionally absent and publication remains blocked.
- Model-backed plugin evals remain `NOT_RUN` pending explicit authorization and
  budget.

## Next phase

Phase 6 implements BacklogService, CRUD/transitions, Story patches from
`vpr-grill`, Task DAG planning and shared CLI/adapter consumption.
