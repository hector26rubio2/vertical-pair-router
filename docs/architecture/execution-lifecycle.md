# Execution lifecycle

Normal path:

```text
PENDING -> ANALYZING -> READY -> RUNNING -> VALIDATING -> REVIEW -> COMPLETED
```

Terminal alternatives are `BLOCKED`, `FAILED`, and `CANCELLED`.
`NEEDS_APPROVAL` is a suspended non-terminal state that must name the requested
operation and decision owner.

Each transition requires the expected current state, an actor, a reason, and
evidence where applicable. Repeating an already-applied command with the same
idempotency key returns the prior result. It may not emit a duplicate event.

Completion requires:

1. all required checks have current Evidence;
2. evidence postdates the last relevant file change;
3. review considered the real staged, unstaged, and untracked diff selected by
   policy; and
4. no unresolved blocking approval or P0 finding remains.

Timeout, truncated output, skipped checks, missing tools, or hook failure never
become green evidence.

