import { buildChannelInstructions } from "../shared";
import { formatChannelBatchForTurn } from "../format";
import type { ChannelMessage } from "../shared";
import type { RedisService } from "../../services/redis";
import type { DriverStatus, SessionDriver } from "./types";
import { JsonRpcStdioClient } from "./json-rpc";

export interface CodexDriverConfig {
  agentId: string;
  agentName: string;
  agentRole: string;
  agentDesc: string;
  agentCaps: string;
  cwd: string;
  model?: string;
  approvalPolicy?: string;
  sandbox?: string;
}

export class CodexAppServerDriver implements SessionDriver {
  private rpc?: JsonRpcStdioClient;
  private state: DriverStatus["state"] = "stopped";
  private threadId?: string;
  private activeTurnId?: string;
  private lastError?: string;
  private currentTurnCompletion?: Promise<void>;
  private resolveCurrentTurn?: () => void;

  constructor(
    private readonly config: CodexDriverConfig,
    private readonly redis: RedisService
  ) {}

  async start() {
    this.state = "starting";
    this.rpc = new JsonRpcStdioClient("codex", ["app-server", "--listen", "stdio://"], {
      cwd: this.config.cwd,
      env: process.env,
    });
    this.rpc.on("notification", (message) => this.handleNotification(message));
    this.rpc.on("exit", (event) => {
      this.state = "failed";
      this.lastError = `codex app-server exited code=${event.code} signal=${event.signal ?? ""}`;
      this.resolveCurrentTurn?.();
    });
    this.rpc.on("error", (err) => {
      this.state = "failed";
      this.lastError = err.message;
      this.resolveCurrentTurn?.();
    });
    this.rpc.start();

    await this.rpc.request("initialize", {
      clientInfo: {
        name: "agent-channel",
        title: "Agent Channel Launcher",
        version: "1.0.0",
      },
      capabilities: {
        experimentalApi: true,
        optOutNotificationMethods: [],
      },
    });
    this.rpc.notify("initialized");

    await this.openThread();
    this.state = "ready";
  }

  async send(messages: ChannelMessage[]): Promise<void> {
    if (!this.rpc || !this.threadId) throw new Error("Codex app-server is not ready");
    const input = [{
      type: "text",
      text: formatChannelBatchForTurn(messages),
      text_elements: [],
    }];

    if (this.activeTurnId) {
      const hasMandatoryMessage = messages.some((message) => message.meta.must_reply === "true");
      if (hasMandatoryMessage) {
        this.state = "turn_active";
        if (!this.currentTurnCompletion) {
          this.currentTurnCompletion = new Promise((resolve) => {
            this.resolveCurrentTurn = resolve;
          });
        }
        await this.rpc.request("turn/steer", {
          threadId: this.threadId,
          expectedTurnId: this.activeTurnId,
          input,
        });
      } else {
        await this.currentTurnCompletion;
        return await this.send(messages);
      }
    } else {
      this.state = "turn_active";
      this.currentTurnCompletion = new Promise((resolve) => {
        this.resolveCurrentTurn = resolve;
      });
      const result = await this.rpc.request("turn/start", {
        threadId: this.threadId,
        input,
        cwd: this.config.cwd,
        model: this.config.model ?? null,
        approvalPolicy: this.config.approvalPolicy ?? null,
      });
      this.activeTurnId = result?.turn?.id;
    }

    await this.currentTurnCompletion;
    const status = await this.status();
    if (status.state !== "failed") this.state = "ready";
  }

  async interrupt() {
    if (!this.rpc || !this.threadId || !this.activeTurnId) return;
    await this.rpc.request("turn/interrupt", {
      threadId: this.threadId,
      turnId: this.activeTurnId,
    });
  }

  async status(): Promise<DriverStatus> {
    return {
      kind: "codex",
      state: this.state,
      pid: this.rpc?.pid,
      threadId: this.threadId,
      lastError: this.lastError,
    };
  }

  async stop() {
    this.state = "stopping";
    this.rpc?.stop("SIGTERM");
    await Bun.sleep(250);
    this.state = "stopped";
  }

  private async openThread() {
    const persistedThreadId = await this.redis.get(this.threadKey());
    if (persistedThreadId) {
      try {
        const result = await this.rpc!.request("thread/resume", {
          threadId: persistedThreadId,
          ...this.threadOptions(),
          excludeTurns: true,
        });
        this.threadId = result?.thread?.id || persistedThreadId;
        return;
      } catch (err) {
        process.stderr.write(`[codex] failed to resume thread ${persistedThreadId}: ${err}\n`);
        await this.redis.del(this.threadKey());
      }
    }

    const result = await this.rpc!.request("thread/start", {
      ...this.threadOptions(),
      serviceName: "agent-channel",
      sessionStartSource: "startup",
    });
    this.threadId = result?.thread?.id;
    if (!this.threadId) throw new Error("Codex thread/start did not return a thread id");
    await this.redis.set(this.threadKey(), this.threadId);
  }

  private threadOptions() {
    return {
      cwd: this.config.cwd,
      model: this.config.model ?? null,
      approvalPolicy: this.config.approvalPolicy ?? null,
      sandbox: this.config.sandbox ?? null,
      developerInstructions: buildChannelInstructions({
        agentId: this.config.agentId,
        agentName: this.config.agentName,
        agentRole: this.config.agentRole,
        agentDesc: this.config.agentDesc,
        agentCaps: this.config.agentCaps,
        delivery: "polling",
      }).replace(
        "Call poll_channel_messages to receive Telegram and inter-agent messages.",
        "Telegram and inter-agent messages are injected into this thread by the agent-channel launcher."
      ),
    };
  }

  private handleNotification(message: any) {
    switch (message.method) {
      case "turn/started":
        this.activeTurnId = message.params?.turn?.id || this.activeTurnId;
        this.state = "turn_active";
        break;
      case "turn/completed":
        if (!this.threadId || message.params?.threadId === this.threadId) {
          this.activeTurnId = undefined;
          this.resolveCurrentTurn?.();
          this.resolveCurrentTurn = undefined;
          this.currentTurnCompletion = undefined;
        }
        break;
      case "item/agentMessage/delta":
        if (message.params?.delta) process.stderr.write(message.params.delta);
        break;
      case "error":
      case "warning":
      case "guardianWarning":
      case "configWarning":
        process.stderr.write(`[codex] ${message.method}: ${JSON.stringify(message.params)}\n`);
        break;
    }
  }

  private threadKey() {
    return `agent:${this.config.agentId}:codex_thread`;
  }
}
