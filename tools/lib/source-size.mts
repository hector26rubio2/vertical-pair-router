import ts from "typescript";

export interface SizeFinding {
  path: string;
  line: number;
  rule: "line-length" | "function-size";
  measured: number;
  limit: number;
}

export const generatedSourceExclusions = ["node_modules/", "dist/", "generated/", ".tmp/"] as const;

export function inspectSourceSize(
  path: string,
  source: string,
  options: { maxLineLength?: number; maxFunctionStatements?: number } = {},
): SizeFinding[] {
  const local = path.replaceAll("\\", "/");
  if (!/^(tools|packages)\//u.test(local)) return [];
  if (!/\.(?:[cm]?[jt]sx?|css|html)$/u.test(local)) return [];
  if (generatedSourceExclusions.some((part) => ("/" + local).includes("/" + part))) return [];
  const maxLineLength = options.maxLineLength ?? 300;
  const maxFunctionStatements = options.maxFunctionStatements ?? 250;
  const findings: SizeFinding[] = [];
  source.split(/\r?\n/u).forEach((line, index) => {
    if (line.length > maxLineLength) {
      findings.push({
        path,
        line: index + 1,
        rule: "line-length",
        measured: line.length,
        limit: maxLineLength,
      });
    }
  });
  if (/\.(?:css|html)$/u.test(local)) return findings;
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const isFunction = (node: ts.Node): node is ts.FunctionLikeDeclaration =>
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node);
  function visit(node: ts.Node) {
    if (isFunction(node) && node.body && ts.isBlock(node.body)) {
      const body = node.body;
      let statements = 0;
      function count(child: ts.Node) {
        if (child !== body && isFunction(child)) return;
        if (ts.isStatement(child) && !ts.isBlock(child)) statements++;
        ts.forEachChild(child, count);
      }
      count(node.body);
      if (statements > maxFunctionStatements) {
        findings.push({
          path,
          line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
          rule: "function-size",
          measured: statements,
          limit: maxFunctionStatements,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return findings;
}
