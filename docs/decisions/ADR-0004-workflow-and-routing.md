# ADR-0004: Workflow and routing

- Status: ACCEPTED (architecture; enforcement transition remains experimental)
- Date: 2026-11-09

## Decision

See ADR-0009 for the incremental evidence cycle. The owner-authorized consolidation
keeps routeWorkflow as the deep model-routing module and routeRequest as adapter
routing. The additive routeWork facade is shadow-only; this acceptance does not
authorize paid experiments or active evidence-based delegation.

Use one deterministic pipeline: protected policy, verified capabilities,
privacy, quality/risk, then cost/latency. Skill/workflow, executor/model, and
tools are separate decisions. The result lists selected and rejected routes
with evidence and rule origins.

Story is the canonical product need. `vpr-grill` produces a `StoryDraft` or
`StoryPatch` through `BacklogService`; a specification is optional. Tasks are
vertical and Runs begin only when execution starts.

## Consequences

No LLM call is required to route. No nested router may take authority from the
VPR coordinator. The same normalized request and configuration must produce the
same result.

