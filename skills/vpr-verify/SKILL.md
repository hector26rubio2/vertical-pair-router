---
name: vpr-verify
description: Verify the Vertical Pair Router repository after a change and report observed evidence without inventing green checks.
allowed-tools: Bash(pnpm check), PowerShell(pnpm check), Read, Grep, Glob
---

# VPR verify

Use this Skill only inside the trusted Vertical Pair Router repository.

1. Inspect the real Git status and diff relevant to the requested change.
2. Run `pnpm check` from the repository root.
3. Report the command, exit status, test totals, and any truncation or skipped
   checks. A command that was not run is `NOT_RUN`, never passed.
4. If files changed after the check, mark the evidence stale and run it again.
5. Do not change settings, permissions, credentials, release state, or remote
   resources. Do not publish or install the plugin.

