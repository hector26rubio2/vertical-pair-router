# ADR-0003: Privacy and credentials

- Status: VERIFIED
- Date: 2026-11-09

## Decision

VPR is local-first with external telemetry off. It never reads or intermediates
Claude/Codex session credentials. Direct provider adapters, if later approved,
receive secrets from a `SecretResolver` and declare transmitted data and billing
authority.

Prompts, code, secrets, cookies, and unrestricted command output are excluded
from persistence. Route fallback across providers is opt-in and cannot silently
change the data destination.

