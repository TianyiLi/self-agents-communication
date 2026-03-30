import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RedisService } from "./services/redis";

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

  // Connect stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Start listening to Redis streams
  listen();
}

async function listen() {
  const groupName = `agent:${AGENT_ID}`;

  // Fixed streams
  const fixedStreams = [
    `stream:agent:${AGENT_ID}:inbox`,
    "stream:system:introductions",
  ];

  for (const stream of fixedStreams) {
    await redis.ensureConsumerGroup(stream, groupName);
  }

  while (true) {
    try {
      // Get dynamic subscriptions from Redis
      const subscriptions = await redis.smembers(`agent:${AGENT_ID}:subscriptions`);
      const channelStreams = subscriptions.map((c) => `stream:channel:${c}`);

      const allStreams = [...fixedStreams, ...channelStreams];

      // Ensure consumer groups for dynamic channels
      for (const stream of channelStreams) {
        await redis.ensureConsumerGroup(stream, groupName);
      }

      const results = await redis.xreadgroup(
        groupName,
        AGENT_ID,
        allStreams,
        10,
        5000 // BLOCK 5s
      );

      for (const result of results) {
        for (const msg of result.messages) {
          // Determine source type from stream key
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
    } catch (err) {
      // Backoff on error
      await Bun.sleep(1000);
    }
  }
}

start().catch((err) => {
  process.stderr.write(`Channel server fatal: ${err}\n`);
  process.exit(1);
});
