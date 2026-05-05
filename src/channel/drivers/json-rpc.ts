import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: Error) => void;
}

export class JsonRpcStdioClient extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private stdoutBuffer = "";

  constructor(
    private readonly command: string,
    private readonly args: string[],
    private readonly options: { cwd: string; env?: NodeJS.ProcessEnv }
  ) {
    super();
  }

  get pid() {
    return this.child?.pid;
  }

  start() {
    this.child = spawn(this.command, this.args, {
      cwd: this.options.cwd,
      env: this.options.env || process.env,
      stdio: "pipe",
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.handleStdout(chunk));
    this.child.stderr.on("data", (chunk) => process.stderr.write(String(chunk)));
    this.child.on("exit", (code, signal) => {
      const err = new Error(`${this.command} exited code=${code} signal=${signal ?? ""}`);
      for (const pending of this.pending.values()) pending.reject(err);
      this.pending.clear();
      this.emit("exit", { code, signal });
    });
    this.child.on("error", (err) => this.emit("error", err));
  }

  async request(method: string, params?: unknown): Promise<any> {
    if (!this.child) throw new Error("JSON-RPC process is not running");
    const id = this.nextId++;
    const payload = params === undefined
      ? { jsonrpc: "2.0", id, method }
      : { jsonrpc: "2.0", id, method, params };
    const response = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.child.stdin.write(JSON.stringify(payload) + "\n");
    return await response;
  }

  notify(method: string, params?: unknown) {
    if (!this.child) throw new Error("JSON-RPC process is not running");
    const payload = params === undefined
      ? { jsonrpc: "2.0", method }
      : { jsonrpc: "2.0", method, params };
    this.child.stdin.write(JSON.stringify(payload) + "\n");
  }

  stop(signal: NodeJS.Signals = "SIGTERM") {
    this.child?.kill(signal);
  }

  private handleStdout(chunk: string) {
    this.stdoutBuffer += chunk;
    while (true) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline === -1) break;
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      this.handleMessage(line);
    }
  }

  private handleMessage(line: string) {
    let message: any;
    try {
      message = JSON.parse(line);
    } catch {
      process.stderr.write(`[json-rpc] non-json stdout: ${line}\n`);
      return;
    }

    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method) this.emit("notification", message);
  }
}

