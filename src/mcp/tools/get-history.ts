import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RedisService } from "../../services/redis";

export function registerGetHistoryTool(server: McpServer, redis: RedisService) {
  server.tool(
    "get_history",
    "Retrieve historical messages from any stream (channel, group, or agent inbox). " +
      "Use this to catch up on prior discussions before joining a conversation, review what " +
      "happened while you were offline, or understand the full context of a topic. " +
      "Stream keys follow the pattern: 'stream:channel:{name}' for channels, " +
      "'stream:group:{chat_id}' for Telegram groups, 'stream:agent:{id}:inbox' for inboxes.",
    {
      stream: z.string().describe(
        "Full stream key to read from. Examples: 'stream:channel:api-updates', " +
          "'stream:group:-100123456', 'stream:agent:frontend-agent:inbox'"
      ),
      count: z.number().default(20).describe(
        "Maximum number of messages to return. Default 20, maximum 50. " +
          "Messages are returned in chronological order (oldest first)."
      ),
    },
    async ({ stream, count }) => {
      const capped = Math.min(count, 50);
      const messages = await redis.xrange(stream, "-", "+", capped);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            messages: messages.map((m) => ({ id: m.id, ...m.message })),
            count: messages.length,
          }),
        }],
      };
    }
  );
}
