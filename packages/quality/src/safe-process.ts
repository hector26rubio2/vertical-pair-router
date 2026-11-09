import { spawn } from "node:child_process";
import { isAbsolute, normalize } from "node:path";

import type { ProcessRequest, ProcessResult } from "@vpr/contracts";

export class ProgramNotAllowedError extends Error {
  public readonly program: string;

  public constructor(program: string) {
    super(`Program is not allowlisted: ${program}`);
    this.name = "ProgramNotAllowedError";
    this.program = program;
  }
}

function programKey(program: string): string {
  const normalized = normalize(program);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function validateRequest(request: ProcessRequest): void {
  if (!isAbsolute(request.cwd)) {
    throw new TypeError("Process cwd must be absolute");
  }
  if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs <= 0) {
    throw new TypeError("Process timeoutMs must be a positive integer");
  }
  if (!Number.isSafeInteger(request.maxOutputBytes) || request.maxOutputBytes <= 0) {
    throw new TypeError("Process maxOutputBytes must be a positive integer");
  }
  if ([request.program, ...request.args].some((value) => value.includes("\0"))) {
    throw new TypeError("Process program and arguments must not contain NUL bytes");
  }
}

export function createSafeProcessRunner(
  allowedPrograms: readonly string[]
): (request: ProcessRequest) => Promise<ProcessResult> {
  const allowlist = new Set(allowedPrograms.map(programKey));

  return async (request) => {
    validateRequest(request);
    if (!allowlist.has(programKey(request.program))) {
      throw new ProgramNotAllowedError(request.program);
    }

    const startedAt = performance.now();
    let timedOut = false;
    let cancelled = false;
    let outputTruncated = false;
    let capturedBytes = 0;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    const child = spawn(request.program, [...request.args], {
      cwd: request.cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const capture = (target: Buffer[], chunk: Buffer): void => {
      const remaining = request.maxOutputBytes - capturedBytes;
      if (remaining <= 0) {
        outputTruncated = true;
        return;
      }
      if (chunk.length > remaining) {
        target.push(chunk.subarray(0, remaining));
        capturedBytes += remaining;
        outputTruncated = true;
        return;
      }
      target.push(chunk);
      capturedBytes += chunk.length;
    };

    child.stdout.on("data", (chunk: Buffer) => capture(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => capture(stderr, chunk));

    const terminate = (): void => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
      }
    };

    const onAbort = (): void => {
      cancelled = true;
      terminate();
    };
    request.signal?.addEventListener("abort", onAbort, { once: true });
    if (request.signal?.aborted === true) {
      onAbort();
    }

    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, request.timeoutMs);

    return await new Promise<ProcessResult>((resolve, reject) => {
      child.once("error", (error) => {
        clearTimeout(timeout);
        request.signal?.removeEventListener("abort", onAbort);
        reject(error);
      });
      child.once("close", (exitCode) => {
        clearTimeout(timeout);
        request.signal?.removeEventListener("abort", onAbort);
        resolve({
          exitCode,
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
          outputTruncated,
          timedOut,
          cancelled
        });
      });
    });
  };
}

