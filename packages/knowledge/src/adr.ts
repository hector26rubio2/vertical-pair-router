export type AdrStatus = "PROPOSED" | "ACCEPTED" | "SUPERSEDED" | "REJECTED";

export interface AdrInput {
  readonly id: `ADR-${string}`;
  readonly title: string;
  readonly status: AdrStatus;
  readonly date: string;
  readonly context: string;
  readonly decision: string;
  readonly alternatives: readonly string[];
  readonly consequences: readonly string[];
}

export function createAdr(input: AdrInput): string {
  for (const [name, value] of [
    ["id", input.id],
    ["title", input.title],
    ["date", input.date],
    ["context", input.context],
    ["decision", input.decision]
  ] as const) {
    if (value.trim().length === 0) throw new TypeError(`${name} is required`);
  }
  if (input.alternatives.length === 0) throw new TypeError("alternatives are required");
  if (input.consequences.length === 0) throw new TypeError("consequences are required");

  return [
    `# ${input.id}: ${input.title}`,
    "",
    `- Status: ${input.status}`,
    `- Date: ${input.date}`,
    "",
    "## Context",
    "",
    input.context.trim(),
    "",
    "## Decision",
    "",
    input.decision.trim(),
    "",
    "## Alternatives",
    "",
    ...input.alternatives.map((item) => `- ${item}`),
    "",
    "## Consequences",
    "",
    ...input.consequences.map((item) => `- ${item}`),
    ""
  ].join("\n");
}
