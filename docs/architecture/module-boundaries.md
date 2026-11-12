# Module boundaries

Only packages with an immediate consumer are created.

| Module | Owns | Must not own/import |
|---|---|---|
| `contracts` | Public schemas and adapter interfaces | Host SDKs, persistence implementations, UI |
| `core` | Entities, state transitions, policy/routing evaluation | Claude Code, filesystem/process APIs, UI |
| `runtime` | Application services, orchestration of ports | Provider-specific authentication |
| `runtime/adapter-descriptors` | Host/provider descriptor catalog | Core policy rules, credentials |
| `cli` | Argument parsing and human/machine output | Domain rules duplicated from core |
| `adapters-claude-code` | Plugin metadata, hooks, Skill/agent integration | Core policy decisions |
| `quality` | Check catalog, execution request, evidence assessment | Shell interpolation, arbitrary browser execution |
| `storage-sqlite` | Migrations, transactions, projections | Business decisions |
| `dashboard` | Local queries and controlled backlog actions | Arbitrary commands or direct table mutation |
| `observability` | Source-labelled event projections and comparisons | Billing claims, provider credential access |

Allowed dependency direction:

```text
contracts <- core <- runtime <- cli
                    ^       ^
                    |       +-- dashboard
                    +-- adapters / quality / storage
```

Cross-package imports use exported contracts. Host and storage errors are
translated into typed application errors at their boundary.

