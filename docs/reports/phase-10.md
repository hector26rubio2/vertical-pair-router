# Phase 10 report: OmniRouter and adapters

Date: 2026-11-09

## Implemented

- Public `RouteRequest`, `RouteResult`, `AdapterDescriptor`, `ExecutionAdapter`
  and `SecretResolver` contracts.
- Deterministic policy → capability/availability → privacy → quality →
  cost/latency pipeline with per-stage accepted/rejected explanation.
- Stable ranking independent of input catalog order.
- Explicit preferred-provider fallback approval and explanation of changed
  provider, transmitted data and cost source.
- Unknown cost/latency is penalized rather than treated as free/fast.
- Adapter catalog validates auth/credential declarations and rejects host
  credential extraction.
- Initial local-tools and Claude Code native descriptors; both require capability
  evidence before routing. No unselected alternative provider was added.

## Checks

- Latest `pnpm check`: exit 0; build plus 74/74 tests passed.
- Tests cover determinism, policy denial, missing/unverified capability,
  local-only privacy, high quality, fallback denial/opt-in, provider-change
  explanation, unavailable cost and invalid credential declarations.

## Route

- Coordinator model: unavailable; no confirmed model receipt.
- Provider-backed calls: none. Claude native execution remains untested and is
  not represented as available by descriptor metadata alone.
- Usage/cost: unavailable.

## Existing blockers

- License/title/publication remain owner-only decisions.
- Provider-backed Skill/adapter evals remain `NOT_RUN` pending authorization and
  budget.

## Next phase

Phase 11 builds usage projections, retention/export/delete controls and the
local dashboard over the same BacklogService/glossary sources.
