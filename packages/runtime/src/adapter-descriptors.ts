import type { AdapterDescriptor } from "@vpr/contracts";

export function builtInAdapterDescriptors(): readonly AdapterDescriptor[] {
  return [
    {
      id: "claude-code-native",
      provider: "claude",
      displayName: "Claude Code native",
      authentication: "host-session",
      credentialHandling: "host-managed",
      capabilities: ["checks", "code", "agent", "worktree"],
      availability: "unknown",
      quality: "high",
      operatingSystems: ["win32"],
      transmittedData: ["selected-context", "prompts"],
      limits: {},
      cost: { source: "unavailable" },
      latency: { source: "unavailable" }
    },
    {
      id: "local-tools",
      provider: "local",
      displayName: "Local tools",
      authentication: "none",
      credentialHandling: "none",
      capabilities: ["checks", "code"],
      availability: "unknown",
      quality: "standard",
      operatingSystems: ["win32"],
      transmittedData: [],
      limits: { concurrency: 1 },
      cost: { source: "measured", estimatedUsd: 0 },
      latency: { source: "unavailable" }
    }
  ];
}
