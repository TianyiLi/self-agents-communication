import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildChannelNotification } from "./format";
import { buildChannelInstructions, ChannelStreamReader } from "./shared";

const CHANNEL_BATCH_READ_COUNT = 100;
const CHANNEL_BATCH_MAX_MESSAGES = 500;

export interface ChannelServerConfig {
  agentId: string;
  agentName: string;
  agentRole: string;
  agentDesc: string;
  agentCaps: string;
  redisUri: string;
}

export function configFromEnv(): ChannelServerConfig {
  const agentId = Bun.env.AGENT_ID || "default-agent";
  return {
    agentId,
    agentName: Bun.env.AGENT_NAME || agentId,
    agentRole: Bun.env.AGENT_ROLE || "general",
    agentDesc: Bun.env.AGENT_DESC || "",
    agentCaps: Bun.env.AGENT_CAPS || "",
    redisUri: Bun.env.REDIS_URI || "redis://localhost:6379",
  };
}

export async function startChannelServer(config = configFromEnv()) {
  const server = new Server(
    { name: `agent-channel-${config.agentId}`, version: "1.0.0" },
    {
      capabilities: {
        experimental: { "claude/channel": {} },
      },
      instructions: buildChannelInstructions({
        agentId: config.agentId,
        agentName: config.agentName,
        agentRole: config.agentRole,
        agentDesc: config.agentDesc,
        agentCaps: config.agentCaps,
        delivery: "claude-channel",
      }),
    }
  );

  const reader = new ChannelStreamReader({
    agentId: config.agentId,
    redisUri: config.redisUri,
    mediaDirPrefix: "agent-channel-media",
  });

  await reader.connect();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  while (true) {
    try {
      const messages = await readAvailableBatch(reader);
      if (messages.length === 0) continue;

      const notifyStart = Date.now();
      await server.notification({
        method: "notifications/claude/channel",
        params: buildChannelNotification(messages),
      });

      const notifyLatency = Date.now() - notifyStart;
      const maxQueueLatency = Math.max(...messages.map((m) => m.queueLatencyMs));
      const totalMediaLatency = messages.reduce((sum, m) => sum + m.mediaLatencyMs, 0);
      process.stderr.write(
        `[push] batch=${messages.length} streams=${[...new Set(messages.map((m) => m.source))].join(",")} queue=${maxQueueLatency}ms media=${totalMediaLatency}ms notify=${notifyLatency}ms\n`
      );
    } catch (err) {
      process.stderr.write(`Channel listen error: ${err}\n`);
      await Bun.sleep(1000);
    }
  }
}

export async function readAvailableBatch(reader: ChannelStreamReader) {
  const messages = await reader.read(5000, CHANNEL_BATCH_READ_COUNT);
  if (messages.length === 0) return messages;

  while (messages.length < CHANNEL_BATCH_MAX_MESSAGES) {
    const next = await reader.read(1, CHANNEL_BATCH_READ_COUNT);
    if (next.length === 0) break;
    messages.push(...next);
  }

  return messages;
}

