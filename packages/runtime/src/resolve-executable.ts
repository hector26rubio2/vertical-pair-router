import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, extname, isAbsolute, join, normalize } from "node:path";

export async function resolveExecutable(
  program: string,
  environment: Readonly<Record<string, string | undefined>> = process.env
): Promise<string | null> {
  if (program.includes("\0")) throw new TypeError("Program must not contain NUL bytes");
  if (isAbsolute(program)) {
    return (await isExecutable(program)) ? normalize(program) : null;
  }
  if (program.includes("/") || program.includes("\\")) {
    throw new TypeError("Program must be an absolute path or bare executable name");
  }

  const pathValue = environment.PATH ?? environment.Path ?? environment.path ?? "";
  const directories = pathValue.split(delimiter).filter(Boolean);
  const candidates = process.platform === "win32"
    ? windowsCandidates(program, environment.PATHEXT)
    : [program];

  for (const directory of directories) {
    for (const candidate of candidates) {
      const path = join(directory, candidate);
      if (await isExecutable(path)) return normalize(path);
    }
  }
  return null;
}

function windowsCandidates(program: string, pathExt: string | undefined): readonly string[] {
  const extension = extname(program).toLowerCase();
  if (extension.length > 0) {
    return extension === ".exe" || extension === ".com" ? [program] : [];
  }
  const configured = (pathExt ?? ".COM;.EXE")
    .split(";")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value === ".exe" || value === ".com");
  const extensions = configured.length > 0 ? [...new Set(configured)] : [".exe", ".com"];
  return extensions.map((value) => `${program}${value}`);
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

