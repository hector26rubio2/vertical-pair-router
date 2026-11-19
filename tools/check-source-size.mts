import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { inspectSourceSize, generatedSourceExclusions } from "./lib/source-size.mts";

const staged = process.argv.includes("--staged");
const args = staged
  ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]
  : ["ls-files", "--cached", "--others", "--exclude-standard", "-z"];
const files = execFileSync("git", args, { encoding: "utf8", windowsHide: true })
  .split("\0")
  .filter(Boolean);
const findings = [];
for (const file of new Set(files)) {
  if (!/^(?:tools|packages)\//u.test(file) || !/\.(?:[cm]?[jt]sx?|css|html)$/u.test(file)) continue;
  const source = staged
    ? execFileSync("git", ["show", "--no-textconv", ":" + file], {
        encoding: "utf8",
        windowsHide: true,
      })
    : await readFile(file, "utf8");
  findings.push(...inspectSourceSize(file, source));
}
console.log(
  JSON.stringify(
    {
      passed: findings.length === 0,
      maxLineLength: 300,
      maxFunctionStatements: 250,
      generatedSourceExclusions,
      findings,
    },
    null,
    2,
  ),
);
process.exitCode = findings.length ? 1 : 0;
