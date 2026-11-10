# Execution engine, leases and recovery

The runtime engine records control events through `StorageAdapter`; it does not
hide Run progress in process memory. A restarted process folds the same project
event stream before resuming.

## VPR limits versus provider limits

VPR directly controls wall time, retry count and router iterations. Token and
cost limits are enforced only when an adapter declares them `enforceable`.
`observable` usage is reported but cannot be presented as a hard stop;
`unavailable` remains unavailable. Provider-internal settings such as maximum
turns are carried in a separate object and are never described as VPR limits.

## Lease and checkpoint

One non-expired lease owner may mutate a Run. Checkpoint and external-effect
operations require that owner. A checkpoint revision must increase; replaying
the identical revision is a no-op, while conflicting content is rejected.
After lease expiry another owner may acquire it and resume from the newest
checkpoint, cancellation request, approval state and effect ledger.

## External effects

Every external effect receives a stable idempotency key. The engine persists
`started` before calling the adapter and `completed` afterward. Repeating a
completed key does not call the adapter. If a crash or connection loss leaves a
started key without completion evidence, VPR raises `EffectInDoubtError` and
requires approval/reconciliation instead of blindly duplicating the action.

## Cancellation and approvals

Cancellation is a durable, idempotent request. The executor must observe it and
then use the corresponding terminal observation; the request alone is not
fabricated as a completed cancellation. External, destructive and ambiguous
actions produce durable approval requests with explicit approved/rejected
resolution.

## Terminal evidence and cycles

COMPLETED requires passed checks and review; FAILED, CANCELLED and BLOCKED each
require the matching concrete observation. Repeating a Run transition to its
already-observed state is idempotent.

Cycle detection counts repeated command/result fingerprints only while the
progress marker is unchanged. New output or real progress resets the count, so
valid iterative work is not stopped merely because a command repeats.
