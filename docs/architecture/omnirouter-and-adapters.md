# OmniRouter and execution adapters

OmniRouter is a deterministic rule pipeline, not an LLM. Given identical
request, effective policy and adapter observations, it returns the same sorted
route and explanation.

## Pipeline

1. **Policy:** provider must be in `EffectivePolicy.allowedProviders`.
2. **Capability:** OS, required functions and observed availability must match.
   `unknown`, `degraded` and `unavailable` are rejected.
3. **Privacy:** `local-only` rejects every adapter that declares transmitted
   data.
4. **Quality:** high-quality work rejects standard-only adapters.
5. **Cost/latency:** remaining adapters are ranked deterministically; unavailable
   values receive an unknown penalty and are never treated as zero/free.

Preferred-provider fallback returns `approval-required` unless the project has
explicitly opted in. An accepted fallback explains the provider change, data
categories and cost source.

## Adapter contract

`ExecutionAdapter` exposes a descriptor and an abortable `execute` method with a
Run/Task, reference-only context and stable idempotency key. Descriptors declare:

- provider, display name and OS support;
- authentication and credential handling;
- capabilities and quality tier;
- observed availability plus evidence;
- transmitted data categories;
- limits and cost/latency source.

Direct provider authentication uses only a caller-supplied `SecretResolver`.
Host-session adapters leave credentials host-managed. Registration rejects any
attempt to declare host credential extraction.

## Built-ins

- `local-tools`: no authentication or transmitted data; checks/code.
- `claude-code-native`: host-session authentication; checks/code/agent/worktree;
  selected context and prompts may be transmitted.

Built-in descriptors live in the runtime boundary rather than Core and start
with availability `unknown`. They currently advertise only the locally verified
`win32` path. The capability registry
must hydrate an observed state before routing; a catalog entry is not evidence
that the executable or account is usable. No alternative provider adapter is
included until an ADR selects it and an authorized end-to-end test exists.
