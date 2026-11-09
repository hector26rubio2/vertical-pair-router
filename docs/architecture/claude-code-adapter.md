# Claude Code adapter

Verified baseline: Claude Code 2.1.312 on Windows.

The adapter uses the native plugin layout. The manifest is the only file under
`.claude-plugin/`; Skills, agents, and hooks live at the plugin root. Core and
contracts do not import Claude Code APIs.

## Hook policy

Phase 3 registers only `SessionStart`. It reads bounded JSON from stdin and, if
present, a bounded `.vpr/profile.json` below the supplied absolute project cwd.
It emits a short factual `additionalContext` summary containing schema/project
ID, safe check names, privacy default, and the rule that only current CLI
Evidence can make a check green.

The hook does not persist session IDs, transcript paths, prompts, model names,
source files, or credentials. It does not run checks, call a provider, write a
profile, or claim quality success. Invalid/oversized input exits nonzero so the
host reports a hook failure; an absent/invalid profile is represented explicitly
and does not block session startup.

No PreToolUse/PostToolUse/Stop hook is registered yet. A host hook is not a
sufficient enforcement boundary for policy or final verification, and adding a
no-op/logging hook would increase latency and sensitive-data risk without a
product guarantee. Later phases may add an event only when the runtime has a
bounded, redacted contract for it.

## Local development

Validate without invoking a model:

```powershell
claude plugin validate --strict --json .
pnpm check
```

For an explicitly authorized interactive smoke session, load the checkout only
for that session:

```powershell
claude --plugin-dir D:\estudio\vertical-pair-router
```

This does not edit user settings or install a marketplace entry. Provider-backed
smoke/eval runs transmit their prompts through the user's configured Claude Code
account and are not run automatically by VPR.

