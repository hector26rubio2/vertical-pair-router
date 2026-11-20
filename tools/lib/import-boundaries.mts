import ts from 'typescript';
import {dirname, resolve} from 'node:path';
export interface ImportFinding {readonly path: string; readonly line: number; readonly specifier: string}
export function inspectImportBoundaries(path: string, source: string): ImportFinding[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const own = /(?:^|\/)packages\/([^/]+)\//u.exec(path.replaceAll('\\', '/'))?.[1];
  const findings: ImportFinding[] = [];
  function check(node: ts.Node, specifier: string) {
    if (specifier.startsWith('@vpr/')) return;
    const absolute = specifier.startsWith('.') ? resolve(dirname(path), specifier) : specifier;
    const target = /(?:^|\/)packages\/([^/]+)\/(?:src|dist)(?:\/|$)/u.exec(absolute.replaceAll('\\', '/'))?.[1];
    if (target && target !== own) findings.push({path, specifier, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1});
  }
  function visit(node: ts.Node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      check(node, node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
      const argument = node.arguments[0]; if (argument && ts.isStringLiteral(argument)) check(node, argument.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(file); return findings;
}
