import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { execSync } from "node:child_process";
import { buildChannelInstructions, ChannelStreamReader } from "./channel/shared";

// --- CLI commands ---

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`agent-channel — Claude Code push notification server

Usage:
  agent-channel                  Start the channel server (stdio MCP)
  agent-channel --mcp-setup      Add to Claude Code MCP config
  agent-channel --mcp-remove     Remove from Claude Code MCP config
  agent-channel --help           Show this help

Environment:
  AGENT_ID      Agent identifier (default: default-agent)
  REDIS_URI     Redis connection (default: redis://localhost:6379)

MCP setup options:
  --agent-id    Override AGENT_ID for MCP config
  --redis-uri   Override REDIS_URI for MCP config
  --sse-url     Also add SSE tools server (e.g. http://localhost:3101/sse)`);
  process.exit(0);
}

if (args.includes("--mcp-setup")) {
  const agentId = getArg("--agent-id") || Bun.env.AGENT_ID || "frontend-agent";
  const redisUri = getArg("--redis-uri") || Bun.env.REDIS_URI || "redis://localhost:6379";
  const sseUrl = getArg("--sse-url");
  const bin = process.execPath;

  // Add SSE tools server if --sse-url provided
  if (sseUrl) {
    console.log(`Adding agent-comm (SSE tools) → ${sseUrl}`);
    try {
      execSync(`claude mcp add agent-comm --transport sse ${sseUrl}`, { stdio: "inherit" });
    } catch {
      console.error("Failed to add agent-comm. Is Claude Code installed?");
    }
    console.log("");
  }

  // Add stdio channel server
  console.log(`Adding agent-channel (stdio push) → ${bin}`);
  console.log(`  AGENT_ID=${agentId}`);
  console.log(`  REDIS_URI=${redisUri}`);
  try {
    execSync(
      `claude mcp add agent-channel -e AGENT_ID=${agentId} -e REDIS_URI=${redisUri} -- ${bin}`,
      { stdio: "inherit" }
    );
  } catch {
    console.error("Failed to add agent-channel. Is Claude Code installed?");
    process.exit(1);
  }

  console.log("");
  console.log("Done. Start Claude Code with:");
  console.log("  claude --channels server:agent-channel");
  process.exit(0);
}

if (args.includes("--mcp-remove")) {
  console.log("Removing MCP servers...");
  try { execSync("claude mcp remove agent-comm", { stdio: "inherit" }); } catch {}
  try { execSync("claude mcp remove agent-channel", { stdio: "inherit" }); } catch {}
  console.log("Done.");
  process.exit(0);
}

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

// --- Channel server (default: no args) ---

const AGENT_ID = Bun.env.AGENT_ID || "default-agent";
const AGENT_NAME = Bun.env.AGENT_NAME || AGENT_ID;
const AGENT_ROLE = Bun.env.AGENT_ROLE || "general";
const AGENT_DESC = Bun.env.AGENT_DESC || "";
const AGENT_CAPS = Bun.env.AGENT_CAPS || "";
const REDIS_URI = Bun.env.REDIS_URI || "redis://localhost:6379";

const server = new Server(
  { name: `agent-channel-${AGENT_ID}`, version: "1.0.0" },
  {
    capabilities: {
      experimental: { "claude/channel": {} },
    },
    instructions: buildChannelInstructions({
      agentId: AGENT_ID,
      agentName: AGENT_NAME,
      agentRole: AGENT_ROLE,
      agentDesc: AGENT_DESC,
      agentCaps: AGENT_CAPS,
      delivery: "claude-channel",
    }),
  }
);

const reader = new ChannelStreamReader({
  agentId: AGENT_ID,
  redisUri: REDIS_URI,
  mediaDirPrefix: "agent-channel-media",
});

async function start() {
  await reader.connect();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  listen();
}

async function listen() {
  while (true) {
    try {
      const messages = await reader.read(5000, 10);
      for (const message of messages) {
        const notifyStart = Date.now();
        const { stream, ...meta } = message.meta;
        await server.notification({
          method: "notifications/claude/channel",
          params: {
            content: message.content,
            meta,
          },
        });

        const notifyLatency = Date.now() - notifyStart;
        process.stderr.write(
          `[push] stream=${message.source} queue=${message.queueLatencyMs}ms media=${message.mediaLatencyMs}ms notify=${notifyLatency}ms\n`
        );
      }
    } catch (err) {
      process.stderr.write(`Channel listen error: ${err}\n`);
      await Bun.sleep(1000);
    }
  }
}

start().catch((err) => {
  process.stderr.write(`Channel server fatal: ${err}\n`);
  process.exit(1);
});
