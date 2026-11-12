# Adding a host or provider adapter

Adapters extend public contracts; they do not fork Core. Provider/host-specific
descriptors and implementations live outside `@vpr/core`, while Core owns only
deterministic validation, policy and routing.

## Required contract

1. Implement `ExecutionAdapter` and an immutable `AdapterDescriptor`.
2. Declare the exact provider, capabilities, quality tier and operating systems
   with executed evidence. Untested OS values must not be advertised.
3. Declare every transmitted data category, observable limit, and cost/latency
   source. Unknown values remain `unavailable`.
4. Use `host-session`/`host-managed` for a native authenticated host, or accept a
   caller-supplied `SecretResolver` for direct provider auth. Never read another
   host's credential store, environment dump, browser cookies or config tokens.
5. Honor `AbortSignal`, the stable idempotency key and reference-only context.
   Return bounded summaries and observed usage; do not persist prompts/code.
6. Register through `AdapterCatalog` and begin with availability `unknown`.
   Routing requires a fresh capability observation; descriptor presence is not
   availability evidence.

## Acceptance checklist

- Contract tests cover descriptor registration, duplicate IDs, auth/credential
  invariants, OS rejection and missing capability.
- Execution tests cover success, provider failure, timeout/cancellation,
  idempotent retry, output bounds and unavailable usage fields.
- Privacy tests prove local-only work cannot select an adapter that transmits
  data and fallback cannot change provider without opt-in.
- OS-specific tests exercise real path separators, executable resolution,
  quoting and `shell: false` on each advertised OS.
- An authorized end-to-end test uses the user's own account and records the host
  version, capability evidence, transmitted categories and measurement source.
- New providers receive an ADR for auth, privacy, license/dependency and eval
  decisions. Provider-backed evals remain `NOT_RUN` until explicitly approved.

An adapter is not eligible for the built-in catalog merely because it compiles.
All checklist evidence must be reviewable, and release artifacts must exclude
credentials, local SQLite files, logs and private profiles.
