export function securityMain(): number;
export function secretFindings(
  path: string,
  content: string,
): { path: string; rule: string; line: number }[];
export function checkStagedSecurity(
  cwd?: string,
  options?: { now?: number; base?: string },
): {
  passed: boolean;
  filesScanned: number;
  findings: readonly { path: string; rule: string; line: number | null }[];
  approvalRequests: readonly {
    repository: string;
    path: string;
    sha256: string;
    expiresAt: string;
    signingText: string;
  }[];
  inferenceTokens: 0;
  scope: string;
};
