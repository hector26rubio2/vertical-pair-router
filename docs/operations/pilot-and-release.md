# Pilot and release runbook

## Reproducible pilot

Run three cases: a small feature with observable acceptance criteria; a
reproduced bug with a regression test; and a multilayer change with an ADR.
Create their Stories using `vpr story` preview/apply or the dashboard. Plan
Tasks through BacklogService, and create a Run before execution.

For each case, start baseline and VPR in separate clean checkouts of the same
base commit. Use identical acceptance criteria, tool versions, tests and time
limits. Authenticate with the owner's own host account. Obtain provider/budget
authorization before starting inference. Record commit, Story, model receipt,
checks, review findings, interventions, duration and tokens/cost with source.
Missing provider values remain unavailable. Record failed and cancelled runs.

Use `UsageSampleRecorded` for comparable measurements with `storyId`, `commit`,
`label` (baseline/plugin), `metric`, `source`, and `sampleSize`. Do not combine
different units into one sample. Export evidence through `vpr data export`.
Three cases provide exploratory evidence only; they cannot substantiate a
general savings claim. Provider pilots remain NOT_RUN until actually executed.

## Local release preparation

Run the following after the final code change:

```powershell
pnpm check
pwsh -NoProfile -File tools/verify-clean-windows.ps1
pnpm audit --json
claude plugin validate --strict --json .
node tools/release-audit.mjs --out <new-audit.json>
```

The audit inventories Git-tracked source files with SHA-256 hashes, excludes
local profiles/databases/logs/credentials/build outputs, and produces a
CycloneDX dependency inventory from the installed frozen-lockfile dependency
tree. It records the lockfile hash and source commit. Install dependencies
first. `--release` returns nonzero while the license gate is open. The audit
is preparation evidence; it does not authorize publication or certify security.

Approve ownership/license and public destination, finish the real pilot and a
second-machine lifecycle test, then create a reviewed release tag and archive
only the inventory's approved files. Include LICENSE, notices, changelog,
support matrix and the generated SBOM. Verify the archive inventory and checksums
before upload. Public upload and invitations require owner authorization.

## Onboarding

Follow portability.md to install with the user's own account. Start in a public
fixture repository with local-only policy; review the proposed profile and
glossary. Preview a Story, approve it, run its checks and inspect evidence and
usage. Stop the session to unload the development plugin. Follow the documented
rollback/removal path. Report redacted feedback through the repository template.

The second-machine acceptance record must include install, update, rollback,
unload/removal, OS/host versions, commands, actual exit codes and any assistance
needed. A same-machine temporary checkout does not close that gate.
