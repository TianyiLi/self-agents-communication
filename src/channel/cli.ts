export type ChannelCliMode =
  | { kind: "server" }
  | { kind: "help" }
  | { kind: "mcp-setup"; agentId: string; redisUri: string; channelHubUrl?: string; sseUrl?: string }
  | { kind: "mcp-remove" }
  | { kind: "launcher"; driver: "claude" | "codex"; config: LauncherCliConfig };

export interface LauncherCliConfig {
  agentId: string;
  redisUri: string;
  channelHubUrl?: string;
  cwd: string;
  restart: boolean;
  restartDelayMs: number;
  maxRestarts?: number;
  once: boolean;
  logJson: boolean;
  sseUrl?: string;
  skipMcpSetup: boolean;
  model?: string;
  approvalPolicy?: string;
  sandbox?: string;
}

export function parseChannelCli(args: string[], env: Record<string, string | undefined> = Bun.env): ChannelCliMode {
  if (has(args, "--help") || has(args, "-h")) return { kind: "help" };
  if (has(args, "--mcp-remove")) return { kind: "mcp-remove" };

  const agentId = getArg(args, "--agent-id") || env.AGENT_ID || "default-agent";
  const redisUri = getArg(args, "--redis-uri") || env.REDIS_URI || "redis://localhost:6379";
  const channelHubUrl = getArg(args, "--channel-hub-url") || env.CHANNEL_HUB_URL;

  if (has(args, "--mcp-setup")) {
    return {
      kind: "mcp-setup",
      agentId: getArg(args, "--agent-id") || env.AGENT_ID || "frontend-agent",
      redisUri,
      channelHubUrl,
      sseUrl: getArg(args, "--sse-url"),
    };
  }

  const driver = has(args, "--claude") ? "claude" : has(args, "--codex") ? "codex" : undefined;
  if (!driver) return { kind: "server" };

  const maxRestartsRaw = getArg(args, "--max-restarts");
  return {
    kind: "launcher",
    driver,
    config: {
      agentId,
      redisUri,
      channelHubUrl,
      cwd: getArg(args, "--cwd") || process.cwd(),
      restart: has(args, "--restart"),
      restartDelayMs: parsePositiveInteger(getArg(args, "--restart-delay-ms"), 2000),
      maxRestarts: maxRestartsRaw === undefined ? undefined : parsePositiveInteger(maxRestartsRaw, 0),
      once: has(args, "--once"),
      logJson: has(args, "--log-json"),
      sseUrl: getArg(args, "--sse-url"),
      skipMcpSetup: has(args, "--skip-mcp-setup"),
      model: getArg(args, "--model"),
      approvalPolicy: getArg(args, "--approval-policy"),
      sandbox: getArg(args, "--sandbox"),
    },
  };
}

export function channelHelpText() {
  return `agent-channel - Claude Code push server and optional session launcher

Usage:
  agent-channel                  Start the channel server (stdio MCP)
  agent-channel --mcp-setup      Add to Claude Code MCP config
  agent-channel --mcp-remove     Remove from Claude Code MCP config
  agent-channel --claude         Launch Claude Code with channels enabled
  agent-channel --codex          Launch Codex app-server and feed channel messages
  agent-channel --help           Show this help

Environment:
  AGENT_ID      Agent identifier (default: default-agent)
  REDIS_URI     Redis connection (default: redis://localhost:6379)
  CHANNEL_HUB_URL  Central channel hub URL for clients (optional)

MCP setup options:
  --agent-id    Override AGENT_ID for MCP config
  --redis-uri   Override REDIS_URI for MCP config
  --sse-url     Also add SSE tools server (e.g. http://localhost:3101/sse)

Launcher options:
  --cwd PATH
  --channel-hub-url URL
  --restart
  --restart-delay-ms N
  --max-restarts N
  --once
  --log-json

Claude launcher options:
  --sse-url URL
  --skip-mcp-setup

Codex launcher options:
  --model MODEL
  --approval-policy POLICY
  --sandbox MODE`;
}

function has(args: string[], flag: string) {
  return args.includes(flag);
}

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

function parsePositiveInteger(raw: string | undefined, fallback: number) {
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
