export type ReviewAxis = "acceptance" | "standards-security";
export type FindingSeverity = "low" | "medium" | "high" | "critical";
export type FindingConfidence = "low" | "medium" | "high";

export interface ReviewFindingInput {
  readonly axis: ReviewAxis;
  readonly file: string;
  readonly line: number;
  readonly evidence: string;
  readonly severity: FindingSeverity;
  readonly confidence: FindingConfidence;
}

export interface ReviewFinding extends ReviewFindingInput {
  readonly snapshotHash: string;
  readonly status: "proposed" | "validated";
}

export interface ReviewAxisResult {
  readonly verdict: "pass" | "fail";
  readonly findings: readonly ReviewFinding[];
}

export interface DualReview {
  readonly snapshotHash: string;
  readonly author: string;
  readonly reviewer: string;
  readonly acceptance: ReviewAxisResult;
  readonly standardsSecurity: ReviewAxisResult;
}

export class ReviewPolicyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ReviewPolicyError";
  }
}

export function createDualReview(input: {
  readonly snapshotHash: string;
  readonly author: string;
  readonly reviewer: string;
  readonly separationAvailable: boolean;
  readonly separationBeneficial: boolean;
  readonly depth: number;
  readonly acceptance: { readonly verdict: "pass" | "fail"; readonly findings: readonly ReviewFindingInput[] };
  readonly standardsSecurity: { readonly verdict: "pass" | "fail"; readonly findings: readonly ReviewFindingInput[] };
}): DualReview {
  if (input.depth !== 0) throw new ReviewPolicyError("Review cannot recursively fan out another review");
  if (
    input.separationAvailable &&
    input.separationBeneficial &&
    input.author === input.reviewer
  ) {
    throw new ReviewPolicyError("A separate reviewer is required when available and beneficial");
  }
  return {
    snapshotHash: input.snapshotHash,
    author: input.author,
    reviewer: input.reviewer,
    acceptance: axis(input.acceptance, "acceptance", input.snapshotHash),
    standardsSecurity: axis(input.standardsSecurity, "standards-security", input.snapshotHash)
  };
}

export function validateFinding(
  finding: ReviewFinding,
  currentSnapshotHash: string
): ReviewFinding {
  if (finding.snapshotHash !== currentSnapshotHash) {
    throw new ReviewPolicyError("Finding is stale for the current workspace snapshot");
  }
  if (finding.file.trim().length === 0 || !Number.isInteger(finding.line) || finding.line < 1) {
    throw new TypeError("Finding requires a precise file and positive line");
  }
  if (finding.evidence.trim().length === 0 || finding.confidence === "low") {
    throw new TypeError("Finding requires evidence and at least medium confidence");
  }
  return { ...finding, status: "validated" };
}

function axis(
  result: { readonly verdict: "pass" | "fail"; readonly findings: readonly ReviewFindingInput[] },
  expected: ReviewAxis,
  snapshotHash: string
): ReviewAxisResult {
  if (result.findings.some((finding) => finding.axis !== expected)) {
    throw new ReviewPolicyError(`Findings must belong to the ${expected} review axis`);
  }
  if (result.verdict === "pass" && result.findings.length > 0) {
    throw new ReviewPolicyError("A passing review cannot contain unresolved findings");
  }
  if (result.verdict === "fail" && result.findings.length === 0) {
    throw new ReviewPolicyError("A failing review must contain a finding");
  }
  return {
    verdict: result.verdict,
    findings: result.findings.map((finding) => ({
      ...finding,
      snapshotHash,
      status: "proposed" as const
    }))
  };
}
