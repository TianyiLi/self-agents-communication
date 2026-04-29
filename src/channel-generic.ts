import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { buildChannelInstructions, ChannelStreamReader } from "./channel/shared";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`agent-channel-generic - portable stdio MCP channel reader

Usage:
  agent-channel-generic              Start the portable channel server (stdio MCP)
  agent-channel-generic --help       Show this help

Environment:
  AGENT_ID      Agent identifier (default: default-agent)
  AGENT_NAME    Display name (default: AGENT_ID)
  AGENT_ROLE    Role description (default: general)
  AGENT_DESC    Detailed description
  AGENT_CAPS    Comma-separated capabilities
  REDIS_URI     Redis connection (default: redis://localhost:6379)

Client setup:
  Add this binary as a stdio MCP server in Codex, Cursor, or any MCP client.
  Also add the agent-comm SSE server for reply/publish/send_direct tools.

Behavior:
  This portable server cannot force client-specific auto-trigger behavior.
  The agent should call poll_channel_messages to wait for inbox/channel messages.`);
  process.exit(0);
}

const AGENT_ID = Bun.env.AGENT_ID || "default-agent";
const AGENT_NAME = Bun.env.AGENT_NAME || AGENT_ID;
const AGENT_ROLE = Bun.env.AGENT_ROLE || "general";
const AGENT_DESC = Bun.env.AGENT_DESC || "";
const AGENT_CAPS = Bun.env.AGENT_CAPS || "";
const REDIS_URI = Bun.env.REDIS_URI || "redis://localhost:6379";

const reader = new ChannelStreamReader({
  agentId: AGENT_ID,
  redisUri: REDIS_URI,
  mediaDirPrefix: "agent-channel-media",
});

const server = new McpServer(
  { name: `agent-channel-generic-${AGENT_ID}`, version: "1.0.0" },
  {
    instructions: buildChannelInstructions({
      agentId: AGENT_ID,
      agentName: AGENT_NAME,
      agentRole: AGENT_ROLE,
      agentDesc: AGENT_DESC,
      agentCaps: AGENT_CAPS,
      delivery: "polling",
    }),
  }
);

server.tool(
  "poll_channel_messages",
  "Wait for new Telegram or inter-agent messages for this agent. Call this when idle, after finishing a response, or when asked to check for channel work. Returns an empty list on timeout.",
  {
    block_ms: z.number().min(0).max(30000).default(5000).describe(
      "How long to wait for messages, in milliseconds. Default 5000, maximum 30000."
    ),
    count: z.number().min(1).max(20).default(10).describe(
      "Maximum number of messages to return. Default 10, maximum 20."
    ),
  },
  async ({ block_ms, count }) => {
    const messages = await reader.read(block_ms, count);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          agent_id: AGENT_ID,
          messages: messages.map((message) => ({
            id: message.id,
            source: message.source,
            stream: message.stream,
            content: message.content,
            meta: message.meta,
          })),
          count: messages.length,
        }),
      }],
    };
  }
);

server.tool(
  "channel_status",
  "Return the current channel reader status and subscriptions for this agent.",
  {},
  async () => {
    await reader.connect();
    const subscriptions = await reader.redis.smembers(`agent:${AGENT_ID}:subscriptions`);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          agent_id: AGENT_ID,
          redis_uri: REDIS_URI,
          subscriptions,
          inbox_stream: `stream:agent:${AGENT_ID}:inbox`,
        }),
      }],
    };
  }
);

async function start() {
  await reader.connect();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

start().catch((err) => {
  process.stderr.write(`Generic channel server fatal: ${err}\n`);
  process.exit(1);
});
