# Contributing

VPR accepts small, reviewable changes tied to a Story and Task. Before editing,
state the executable outcome, allowed paths, and required checks. Use TDD for
observable behavior and preserve red/green evidence in the Run report.

## Local checks

Requirements: Node.js 24.15+ and pnpm 11.

```powershell
pnpm install --frozen-lockfile
pnpm check
claude plugin validate --strict .
```

Do not commit databases, logs, prompts, source snapshots, `.env` files, or
credentials. Dependency additions require a license/security rationale and an
updated third-party notice when applicable.

No contributor may publish a release or change the project license without the
owner's explicit authorization.

