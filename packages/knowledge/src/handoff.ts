export interface HandoffInput {
  readonly contextPackPath: string;
  readonly commit: string;
  readonly gitStatus: string;
  readonly checks: readonly {
    readonly name: string;
    readonly status: "passed" | "failed" | "not-run";
    readonly evidence: string;
  }[];
  readonly nextAction: string;
}

export function createHandoff(input: HandoffInput): string {
  return [
    "# VPR handoff",
    "",
    `- Context pack: ${input.contextPackPath}`,
    `- Commit: ${input.commit}`,
    `- Git status: ${input.gitStatus}`,
    "- Checks:",
    ...input.checks.map((check) => `  - ${check.name}: ${check.status} (${check.evidence})`),
    `- Next action: ${input.nextAction}`,
    ""
  ].join("\n");
}
