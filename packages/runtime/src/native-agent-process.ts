import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { SessionContext, SessionState } from "./native-agent-session.js";

export interface ProcessLaunch {
  args: string[];
  env: NodeJS.ProcessEnv;
}

export type StreamEvent = any;

export function runStreamingProcess(
  context: SessionContext,
  launch: ProcessLaunch,
  state: SessionState,
  observeEvent: (event: StreamEvent) => void,
): Promise<void> {
  return new Promise<void>((done) => {
    if (context.signal?.aborted) {
      state.failure = "cancelled";
      done();
      return;
    }
    const child = spawn(context.executable, launch.args, {
      cwd: context.cwd,
      env: launch.env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "ignore"],
    });
    let pending = "",
      bytes = 0;
    const decoder = new StringDecoder("utf8");
    const stop = () => {
      if (!child.pid) return;
      if (process.platform === "win32")
        spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        }).once("error", () => child.kill());
      else
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill();
        }
    };
    const cancel = () => {
      state.failure = "cancelled";
      stop();
    };
    context.signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => {
      state.failure = "deadline";
      stop();
    }, context.timeoutMs);
    const observe = (line: string) => {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      observeEvent(event);
    };
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 8_000_000) {
        state.failure = "output-limit";
        stop();
        return;
      }
      pending += decoder.write(chunk);
      const lines = pending.split(/\r?\n/u);
      pending = lines.pop() ?? "";
      for (const line of lines) observe(line);
    });
    child.stdin.on("error", () => {});
    child.once("error", () => {
      state.failure = "Native process unavailable";
      clearTimeout(timer);
      done();
    });
    child.once("close", (code) => {
      pending += decoder.end();
      if (pending) observe(pending);
      clearTimeout(timer);
      context.signal?.removeEventListener("abort", cancel);
      if (code !== 0) state.success = false;
      done();
    });
    child.stdin.end(context.prompt);
  });
}
