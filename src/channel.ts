import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RedisService } from "./services/redis";
import { execSync } from "node:child_process";

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
const REDIS_URI = Bun.env.REDIS_URI || "redis://localhost:6379";

const server = new Server(
  { name: `agent-channel-${AGENT_ID}`, version: "1.0.0" },
  {
    capabilities: {
      experimental: { "claude/channel": {} },
    },
    instructions: [
      `You are ${AGENT_NAME}. Messages arrive as <channel> tags from Telegram users and other agents.`,
      `When source="inbox", it's a direct message or Telegram command for you.`,
      `When source="channel", it's a cross-agent broadcast you subscribed to.`,
      `When source="system", it's an agent online/offline event.`,
      `If must_reply="true", you MUST respond using the agent-comm MCP tools (reply, publish, etc).`,
      `If must_reply="false", decide based on your role whether to respond.`,
    ].join("\n"),
  }
);

const redis = new RedisService();

async function start() {
  await redis.connect(REDIS_URI);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  listen();
}

async function listen() {
  const groupName = `agent:${AGENT_ID}`;

  const fixedStreams = [
    `stream:agent:${AGENT_ID}:inbox`,
    "stream:system:introductions",
  ];

  for (const stream of fixedStreams) {
    await redis.ensureConsumerGroup(stream, groupName);
  }

  while (true) {
    try {
      const subscriptions = await redis.smembers(`agent:${AGENT_ID}:subscriptions`);
      const channelStreams = subscriptions.map((c) => `stream:channel:${c}`);
      const allStreams = [...fixedStreams, ...channelStreams];

      for (const stream of channelStreams) {
        await redis.ensureConsumerGroup(stream, groupName);
      }

      const results = await redis.xreadgroup(
        groupName,
        AGENT_ID,
        allStreams,
        10,
        5000
      );

      for (const result of results) {
        for (const msg of result.messages) {
          let source = "inbox";
          if (result.streamKey.startsWith("stream:channel:")) {
            source = "channel:" + result.streamKey.replace("stream:channel:", "");
          } else if (result.streamKey === "stream:system:introductions") {
            source = "system";
          }

          await server.notification({
            method: "notifications/claude/channel",
            params: {
              content: msg.message.content || JSON.stringify(msg.message),
              meta: {
                source,
                from: msg.message.from || "",
                from_name: msg.message.from_name || "",
                type: msg.message.type || "",
                must_reply: msg.message.must_reply || "false",
                chat_id: msg.message.chat_id || "",
                message_id: msg.message.message_id || "",
              },
            },
          });

          await redis.xack(result.streamKey, groupName, [msg.id]);
        }
      }
    } catch {
      await Bun.sleep(1000);
    }
  }
}

start().catch((err) => {
  process.stderr.write(`Channel server fatal: ${err}\n`);
  process.exit(1);
});
