# Architecture overview

VPR is a local application runtime with host adapters. Claude Code is the first
adapter, not the domain boundary.

```text
Claude Code plugin / CLI
          |
          v
Application services: Backlog, Policy, Routing, Quality, Execution
          |
          v
Domain: Story -> Task -> Run, Evidence, Event, Capability
          |
          +-- StorageAdapter -> local SQLite
          +-- HostAdapter -> Claude Code
          +-- ToolAdapter -> safe local processes
          +-- ExecutorAdapter -> approved execution host
          |
          v
Dashboard projections (local; no arbitrary shell)
```

The dependency graph points inward: adapters depend on contracts/application
services; the domain imports neither Claude Code nor UI/provider SDKs.

## First vertical slice

The first executable slice creates a Story, derives one Task, starts one Run,
records a real local check as Evidence, and completes the Run through valid
state transitions. It exercises contracts, policy, safe process execution, and
persistence without requiring a dashboard or provider call.

## Portability claim

Core and CLI are portable TypeScript. Windows 11 and Claude Code 2.1.312 are the
only verified initial integration. macOS/Linux and other hosts remain
experimental until CI/contract evidence exists.

