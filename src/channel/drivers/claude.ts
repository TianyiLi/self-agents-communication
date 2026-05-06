import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import type { ChannelMessage } from "../shared";
import type { DriverStatus, SessionDriver } from "./types";

export interface ClaudeDriverConfig {
  agentId: string;
  redisUri: string;
  channelHubUrl?: string;
  cwd: string;
  sseUrl?: string;
  skipMcpSetup: boolean;
}

export class ClaudeDriver implements SessionDriver {
  private child?: ChildProcess;
  private state: DriverStatus["state"] = "stopped";
  private lastError?: string;
  private exitPromise?: Promise<void>;

  constructor(private readonly config: ClaudeDriverConfig) {}

  async start() {
    this.state = "starting";
    if (!this.config.skipMcpSetup) this.runMcpSetup();

    this.child = spawn("claude", ["--channels", "server:agent-channel"], {
      cwd: this.config.cwd,
      stdio: "inherit",
      env: process.env,
    });
    this.state = "ready";
    this.exitPromise = new Promise((resolve) => {
      this.child?.once("exit", (code, signal) => {
        this.state = code === 0 ? "stopped" : "failed";
        this.lastError = code === 0 ? undefined : `claude exited code=${code} signal=${signal ?? ""}`;
        resolve();
      });
      this.child?.once("error", (err) => {
        this.state = "failed";
        this.lastError = err.message;
        resolve();
      });
    });
  }

  async send(_messages: ChannelMessage[]) {
    if (!this.child || this.child.exitCode !== null) {
      throw new Error("Claude child process is not running");
    }
  }

  async interrupt() {
    this.child?.kill("SIGINT");
  }

  async status(): Promise<DriverStatus> {
    return {
      kind: "claude",
      state: this.state,
      pid: this.child?.pid,
      lastError: this.lastError,
    };
  }

  async stop() {
    if (!this.child || this.child.exitCode !== null) {
      this.state = "stopped";
      return;
    }
    this.state = "stopping";
    this.child.kill("SIGTERM");
    await Promise.race([this.exitPromise, Bun.sleep(3000)]);
    if (this.child.exitCode === null) this.child.kill("SIGKILL");
    this.state = "stopped";
  }

  private runMcpSetup() {
    const args = [
      "mcp",
      "add",
      "agent-channel",
      "-e",
      `AGENT_ID=${this.config.agentId}`,
    ];
    if (this.config.channelHubUrl) {
      args.push("-e", `CHANNEL_HUB_URL=${this.config.channelHubUrl}`);
    } else {
      args.push("-e", `REDIS_URI=${this.config.redisUri}`);
    }
    args.push("--", process.execPath);
    execFileSync("claude", args, { stdio: "inherit" });

    if (this.config.sseUrl) {
      execFileSync("claude", [
        "mcp",
        "add",
        "agent-comm",
        "--transport",
        "sse",
        this.config.sseUrl,
      ], { stdio: "inherit" });
    }
  }
}
