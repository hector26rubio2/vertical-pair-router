# Host capability audit

Audit date: 2026-11-09 (America/Bogota)

The workspace was empty and was not a Git repository. No existing user changes
were present. Commands below were read-only except for the in-memory SQLite
smoke test.

## Local evidence

| Capability | Status | Local evidence | Decision / limitation |
|---|---|---|---|
| Windows | VERIFIED | `Microsoft Windows NT 10.0.26200.0` | Initial supported OS. CIM metadata was unavailable in the sandbox, so edition and architecture remain UNKNOWN. |
| PowerShell 7 | VERIFIED | `pwsh --version` -> 7.6.5 | Primary shell. Invoke scripts with `-NoProfile`. |
| Windows PowerShell | VERIFIED | 5.1.26100.9711 | Compatibility fallback only. |
| Node.js | VERIFIED | `node --version` -> v24.15.0 | Minimum 24.15.0; CI will also exercise the next supported LTS line. |
| npm | VERIFIED | 11.12.1 | Available, not the repository package manager. |
| Corepack | VERIFIED | 0.34.6 | Available locally; repository pins pnpm explicitly. |
| pnpm | VERIFIED | 11.1.2 | Selected package manager and lockfile authority. |
| Git | VERIFIED | 2.45.1.windows.1 | Basic CLI works. `git worktree --help` hit an MSYS named-object sandbox denial; functional worktree testing waits for a committed repository. |
| SQLite API | VERIFIED / DEGRADED | Node 24.15 in-memory create/insert/select returned `sqlite-smoke=ok` | `node:sqlite` is still release-candidate stability. Keep it behind `StorageAdapter`; require locking, backup, and migration tests. |
| Claude Code | VERIFIED | 2.1.312, native win32-x64, doctor exit 0 | Initial host adapter baseline. |
| Claude doctor | VERIFIED | Search OK; no installation issues | Managed settings not applicable to the reported Pro/Max account. This is host output, not a VPR entitlement claim. |
| Plugin list | VERIFIED | User, inline, and synced plugins listed successfully | Read-only inventory; VPR does not modify existing plugins/settings. |
| Plugin validation | VERIFIED | `claude plugin validate` exposes JSON, strict, and directory profile modes | Use strict validation in CI after plugin files exist. |
| Plugin eval | VERIFIED | `claude plugin eval` exposes ablation, concurrency, budget, mocks, and local report options | Running evals invokes a provider and is deferred until an explicit approved test fixture exists. |
| Session-only plugin loading | VERIFIED | `claude --help` exposes `--plugin-dir` and `--plugin-url` | Development does not require a marketplace or installation mutation. |
| Skills / agents / hooks layout | VERIFIED | Installed CLI help plus official manifest docs | Use root `skills/`, `agents/`, `hooks/`; only the manifest lives under `.claude-plugin/`. |
| Subagent model/effort | VERIFIED | Official current docs list `model` and `effort` frontmatter | Model names are host-specific. VPR records what the adapter reports and never claims an unconfirmed model. |
| Native worktree isolation | VERIFIED / DEGRADED | Current docs define `isolation: worktree` | PowerShell receives working-directory enforcement but not Bash command-text checks. VPR must add path ownership and diff validation. |
| Hooks on PowerShell | VERIFIED | Current docs support `shell: powershell`, auto-detect `pwsh`, fallback to 5.1 | Critical guards set explicit shell and failure semantics; hooks remain thin. |
| Orca runtime | DEGRADED | Orca 1.4.243 became ready and registered the repository, but `run-create` returned `no_active_sender_terminal` | This Codex session was not launched inside an Orca terminal and has no authoritative `ORCA_TERMINAL_HANDLE`. Structured supervised workers are unavailable here; do not forge a handle. Work proceeds sequentially. |
| Usage/tokens/cost | UNKNOWN | No safe local command proved complete provider usage fields | Store `unavailable` unless an adapter supplies measured/provider-reported data. |
| Coordinator model | UNKNOWN | This Codex surface did not expose a reliable selected-model receipt | Do not claim GPT-5.6 Sol/Terra. Record active model as unavailable until the host reports it. |

## Sources checked for changed facts

- Node release status: https://nodejs.org/en/about/previous-releases
- Node 24 SQLite API: https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html
- Claude plugin overview: https://code.claude.com/docs/en/plugins
- Claude plugin creation: https://code.claude.com/docs/en/plugins/create
- Claude manifest reference: https://code.claude.com/docs/en/plugins-reference
- Claude subagents: https://code.claude.com/docs/en/sub-agents
- Claude hooks: https://code.claude.com/docs/en/hooks

## Capability decisions

1. Reuse Claude's plugin loading, Skills, agents, eval runner, and native
   worktrees where their observed guarantees are sufficient.
2. Extend them with a host-independent runtime for policy, backlog, lifecycle,
   evidence, persistence, and path ownership.
3. Never rely on hook success alone for a quality verdict.
4. Do not transmit repository content to a different provider as part of local
   discovery. Provider-backed evals are a later, explicit Run.

## Phase 0 outcome

Gate passed for local implementation: the capability matrix is recorded, core
build/install is feasible without Python or Docker, and base ADRs exist. Public
release remains blocked on the owner confirming title and license. The audit did
not stop implementation.

## Later runtime observation

During Phase 2, a later Codex execution surface reported Node 24.18.0 and
PowerShell 7.6.9. A deterministic shell-free probe initially exposed ambiguous
pnpm shims (`pnpm` resolved to 9.0.0-alpha.4); after resolving the concrete
Volta executable, the same probe reported the intended pnpm 11.1.2. This
`DIFFERS` evidence led to exact executable references in capability records.

