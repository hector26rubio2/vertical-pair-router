# Running the local workflow

Build with `pnpm build`. All commands below run through `pnpm vpr`.

1. `init --project <repo>` previews a profile. Review it and use `--apply` to
   write `.vpr/profile.json`. Check commands are executable/argument arrays.
2. `story --db <db> --project-id <profile-project-id> --input <story.json>`
   previews the Story; add `--apply` after review.
3. `task plan --project <repo> --db <db> --story-id <id> --input <plan.json>`
   previews a plan. Add `--apply` to create Tasks in the same BacklogService.
4. `task check --project <repo> --db <db> --task-id <id>` previews the exact
   profile-defined commands. Add `--approve-checks` to run them locally.
5. `task list --project <repo> --db <db>` recovers Stories, Tasks and Runs.
6. Inspect the actual code diff and check evidence, write a review file, then
   `task review --project <repo> --db <db> --run-id <id> --approve-review
   --review-reference <review.md>` explicitly closes the Run and Task.

A plan input has `workflow` and `slices`. Each slice supplies `outcome`,
`acceptanceCriteria`, `demoPath`, `allowedPaths`, `requiredChecks`, `risk`,
`changesPublicApi`, and `dependsOn` (zero-based earlier slice indexes).

Checks have a 60-second timeout each, bounded output, Ctrl+C cancellation and
no shell. Unknown checks/programs fail before a Run starts. Failed checks produce
a FAILED Run; cancelled checks produce CANCELLED. Passing checks reach REVIEW.
Only metadata is persisted; arbitrary command output is discarded. The review
is an explicit human attestation, not an automatic code review or coding agent.

`dashboard --project <repo> --db <db> --project-id <profile-project-id>` opens
a loopback-only read/preview control plane. Browser actions do not execute
checks. Use CLI for execution. Provider-assisted implementation remains a
separate host workflow; this command verifies existing working-tree code.
