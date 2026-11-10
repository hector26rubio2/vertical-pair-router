# ADR-0008: Initial execution adapters

- Status: ACCEPTED
- Date: 2026-11-09

## Context

VPR needs an extensible execution boundary without extracting host credentials,
silently moving code to another provider or claiming untested integrations.

## Decision

The initial catalog contains local tools and a Claude Code native descriptor.
Claude authentication remains inside the user's host session. Local tools have
no authentication and transmit no data. Both start unavailable-to-route until
capability evidence marks them available.

Community/enterprise adapters implement the public `ExecutionAdapter` contract.
Direct API adapters may receive a narrowly scoped secret only through
`SecretResolver`; they cannot read Claude/Codex credentials or reuse a Business
seat as API authority.

No alternative provider is enabled in this phase. Adding one requires a new ADR,
declared data/billing authority and an authorized end-to-end test.

## Alternatives

- LLM-based routing: rejected because decisions would not be reproducible.
- Assume every registered adapter is available: rejected because metadata is
  not capability evidence.
- Reuse host session credentials for direct APIs: rejected for security,
  ownership and billing reasons.

## Consequences

- Routing works offline and explains every rejection/stage.
- Claude provider execution remains untested until explicitly authorized.
- Missing cost/latency can reduce preference but can never be reported as zero.
- New adapters do not require a Core fork, but registration alone cannot make
  them eligible.
