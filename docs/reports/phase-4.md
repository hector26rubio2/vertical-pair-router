# Phase 4 report: VPR Skills and AI Hero adaptation

Date: 2026-11-09

## Upstream audit

- Repository: `mattpocock/skills`
- Pinned commit: `4ae2317ddb22b046e26455e4f9c9b3aaaf62212d`
- Catalog observed: 20 engineering + 7 productivity Skills.
- License observed: MIT, Copyright (c) 2026 Matt Pocock.
- Fourteen selected source files were read and SHA-256 pinned in
  `docs/architecture/ai-hero-adaptation.md`.
- The upstream package, scripts, agents, templates, and tracker setup are not
  runtime dependencies. Adapted VPR files use original Spanish wording and the
  VPR backlog/evidence contracts.

## Implemented

- Deterministic workflow registry with explicit reasons and rejected Skills.
- Routes: `vpr-init`, `vpr-plan`, `vpr-feature`, `vpr-grill`, `vpr-bugfix`,
  `vpr-diagnose`, `vpr-verify`, `vpr-review`, and `vpr-retro`.
- Ambiguous/multi-session features route to `vpr-grill`; clear small features
  remain light; missing/intermittent bug reproduction routes to diagnosis.
- `vpr-grill` produces `StoryDraft`/`StoryPatch` for `BacklogService`, searches
  duplicates, and never uses a spec file as mandatory persistence.
- Review preserves separate acceptance and standards/security axes and forbids
  recursive review fan-out.
- Third-party notice now includes the upstream MIT text and derivation record.

## Eval fixtures

Six official-layout cases cover simple change, ambiguous feature, missing
BacklogService, no-op verification, hostile repository instructions, and stale
evidence after context change. Each has bounded turns/tools and a deterministic
`tool_used` grader.

`claude plugin eval` was not run: every case would start provider-backed child
sessions. Status is `NOT_RUN`; usage/cost is `unavailable`. The cases can be run
later with an explicit budget and authorized account/data policy.

## Checks

- Latest `pnpm check`: exit 0; build plus 39/39 tests passed.
- Registry tests prove deterministic routes and one-to-one Skill directories.
- `claude plugin validate --strict --json .`: manifest/Skills/hooks accepted,
  with the pre-existing release findings for license and icon.
- `git diff --check`: exit 0 after whitespace correction.

## Route

- Coordinator model: unavailable (no confirmed model receipt).
- Subagents: none; sequential fallback remained active.

## Next phase

Phase 5 creates the canonical VPR dictionary/project glossary contracts, ADR and
context-pack/checkpoint formats, hashes, invalidation, and sensitive-path limits.

