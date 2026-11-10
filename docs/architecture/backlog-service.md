# BacklogService and planning boundary

`@vpr/backlog` is the canonical mutation boundary for Stories, Tasks and their
Runs. Skills convert `vpr-grill` output to `StoryDraft`/`StoryPatch`; the CLI and
future dashboard call the same service. Neither adapter writes SQLite directly.

## Mutation protocol

1. Parse and validate a draft or patch.
2. Preview the action and deterministic duplicate match without persisting it.
3. Require confirmation when configured.
4. Re-read the event stream and reject a stale preview/revision.
5. Append a versioned domain event and rebuild projections from the stream.

No hard delete is exposed: an audited event history cannot be erased through
the product CRUD boundary. Work leaves active flow through explicit terminal or
blocked states. Destructive retention is a later owner/policy operation.

## Story and Task readiness

A Story is `READY` only with at least one acceptance criterion and no open
question. `vpr-grill` keeps ambiguous results in `DRAFT` and creates no Tasks.
Specs are optional attachment paths, not an intermediate source of truth.

The planner receives vertical slices with an observable outcome, falsifiable
criteria, demo path, allowed paths, required checks and dependency indexes. It
rejects invalid/cyclic DAGs. A dependent Task stays `PENDING` until all of its
dependencies are `COMPLETED`, then is promoted by an event.

Infrastructure, difficult bugfixes, high-risk slices and public API changes set
`requiresHumanReview`. The planning handoff includes Story revision, Task IDs,
that review decision and the next action, without duplicating source context.

## Recovery

Story versions, current Tasks and Run transitions are folded from the project
event stream. Reopening the SQLite adapter reconstructs the same aggregates;
the service never treats a process-local cache as authoritative.
