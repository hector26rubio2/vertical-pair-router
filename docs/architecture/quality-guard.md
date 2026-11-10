# Quality Guard and evidence freshness

`@vpr/quality` turns checks and reviews into evidence tied to one exact worktree
snapshot. A green command is not reusable after staged, unstaged or untracked
content changes.

## Check contract

Every check declares an ID, stack, category, executable plus argument array,
working directory, timeout, output bound and required permission. Categories are
unit test, integration test, lint, typecheck, build and scanner. A scanner is
absent unless its caller explicitly approves it; the standard Node catalog marks
the audit command as networked rather than treating it as an ordinary local
check.

Execution stays shell-free through the allowlisted `ProcessRunner`. Evidence is
`measured` and distinguishes failed exit, timeout, cancellation and truncation.
No one of those states is green.

## Workspace snapshot

The diff capture reads all three local surfaces:

- `git diff --cached` for staged changes;
- `git diff` for unstaged changes;
- `git ls-files --others --exclude-standard` plus bounded local reads for
  untracked files.

The transient review object contains bounded bodies. Durable evidence uses a
SHA-256 over both diffs and untracked path/hash/size metadata. Ignored files are
not opened. Root containment is rechecked after realpath resolution.

Final verification selects the newest evidence for every required check and
requires its snapshot hash to equal the current hash. Missing, stale, failed,
timed-out, cancelled and truncated checks remain separate results.

## TDD and regression assessment

A TDD record requires a measured failing RED and a measured passing GREEN for
the same test reference; optional REFACTOR entries must stay green. Work where
TDD does not apply records `NOT_APPLICABLE` with a concrete reason. Regression
assessment warns when a defect is not reproducible, the assertion does not test
observable behavior, mocks couple to internals, or expected data is derived from
the actual value.

## Dual review

Acceptance and standards/security are independent axes over the same snapshot.
Findings carry file, line, evidence, severity and confidence and must be
revalidated against the current hash before acceptance. A separate reviewer is
required when the capability exists and separation is beneficial. Review depth
must remain zero: a reviewer cannot recursively spawn another review fan-out.
