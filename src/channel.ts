import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RedisService } from "./services/redis";
import { execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

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
const LOCAL_MEDIA_DIR = path.join(os.tmpdir(), "agent-channel-media", AGENT_ID);

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
      `If meta.media_paths is non-empty, it contains comma-separated local file paths for images or documents attached to the message. Use the Read tool on each path to view them.`,
    ].join("\n"),
  }
);

const redis = new RedisService();

async function start() {
  await redis.connect(REDIS_URI);
  await fs.mkdir(LOCAL_MEDIA_DIR, { recursive: true });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  listen();
}

interface MediaDescriptor {
  id: string;
  filename: string;
  mime: string;
}

/** Resolve an agent's MCP port from its Redis profile. */
async function resolveAgentPort(fromAgentId: string): Promise<string | null> {
  try {
    const port = await redis.hget(`agent:${fromAgentId}:profile`, "mcp_port");
    return port || null;
  } catch {
    return null;
  }
}

/** Download media files referenced in a message to a local temp dir. Returns local paths. */
async function downloadMedia(
  fromAgentId: string,
  mediaJson: string
): Promise<string[]> {
  let descriptors: MediaDescriptor[];
  try {
    descriptors = JSON.parse(mediaJson);
  } catch {
    return [];
  }
  if (!Array.isArray(descriptors) || descriptors.length === 0) return [];

  const port = await resolveAgentPort(fromAgentId);
  if (!port) {
    process.stderr.write(`Cannot resolve port for agent ${fromAgentId}\n`);
    return [];
  }

  const paths: string[] = [];
  for (const desc of descriptors) {
    try {
      const url = `http://localhost:${port}/media/${desc.id}`;
      const res = await fetch(url);
      if (!res.ok) {
        process.stderr.write(`Media fetch failed: ${url} (${res.status})\n`);
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      const ext = path.extname(desc.filename) || "";
      const localPath = path.join(LOCAL_MEDIA_DIR, `${desc.id}${ext}`);
      await fs.writeFile(localPath, buffer);
      paths.push(localPath);
    } catch (err) {
      process.stderr.write(`Media download error: ${err}\n`);
    }
  }
  return paths;
}

async function listen() {
  // Use distinct group name from PushLoop (agent:{id}) to enable fan-out delivery
  const groupName = `channel:agent:${AGENT_ID}`;
  const createdGroups = new Set<string>();

  const fixedStreams = [
    `stream:agent:${AGENT_ID}:inbox`,
    "stream:system:introductions",
  ];

  async function ensureGroup(stream: string) {
    if (createdGroups.has(stream)) return;
    await redis.ensureConsumerGroup(stream, groupName);
    createdGroups.add(stream);
  }

  for (const stream of fixedStreams) {
    await ensureGroup(stream);
  }

  // Recover pending messages from prior crash (ID "0" returns unacknowledged)
  try {
    const pending = await redis.xreadgroup(groupName, AGENT_ID, fixedStreams, 100, undefined, "0");
    for (const result of pending) {
      for (const msg of result.messages) {
        await redis.xack(result.streamKey, groupName, [msg.id]);
      }
    }
  } catch {
    // First run — no pending messages
  }

  while (true) {
    try {
      const subscriptions = await redis.smembers(`agent:${AGENT_ID}:subscriptions`);
      const channelStreams = subscriptions.map((c) => `stream:channel:${c}`);
      const allStreams = [...fixedStreams, ...channelStreams];

      for (const stream of channelStreams) {
        await ensureGroup(stream);
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

          // Download media if referenced
          let mediaPaths: string[] = [];
          if (msg.message.media) {
            mediaPaths = await downloadMedia(
              msg.message.from || AGENT_ID,
              msg.message.media
            );
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
                media_paths: mediaPaths.length > 0 ? mediaPaths.join(",") : "",
              },
            },
          });

          await redis.xack(result.streamKey, groupName, [msg.id]);
        }
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
