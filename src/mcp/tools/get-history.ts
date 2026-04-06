import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RedisService } from "../../services/redis";
import type { SessionManager } from "../session";
import { Config } from "@config/index";
import { guardSession } from "./guard";

/** Validate that the requested stream is accessible to this agent. */
async function validateStreamAccess(stream: string, redis: RedisService): Promise<string | null> {
  const agentId = Config.agentId;

  // Own inbox
  if (stream === `stream:agent:${agentId}:inbox`) return null;

  // System introductions
  if (stream === "stream:system:introductions") return null;

  // Group streams (stream:group:{chat_id})
  if (/^stream:group:-?\d+$/.test(stream)) return null;

  // Subscribed channels only
  if (stream.startsWith("stream:channel:")) {
    const channelName = stream.replace("stream:channel:", "");
    const subscribed = await redis.sismember(`agent:${agentId}:subscriptions`, channelName);
    if (subscribed) return null;
    return `Access denied: not subscribed to channel '${channelName}'. Use subscribe tool first.`;
  }

  return `Access denied: cannot read stream '${stream}'. Only own inbox, subscribed channels, group streams, and system streams are accessible.`;
}

export function registerGetHistoryTool(server: McpServer, redis: RedisService, sessionManager: SessionManager) {
  server.tool(
    "get_history",
    "Retrieve historical messages from a stream you have access to (own inbox, subscribed channels, " +
      "group streams, or system introductions). Use this to catch up on prior discussions before " +
      "joining a conversation, review what happened while you were offline, or understand the full " +
      "context of a topic.",
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
    async ({ stream, count }, extra) => {
      const denied = guardSession(extra.sessionId ?? "", sessionManager);
      if (denied) return denied;

      const accessError = await validateStreamAccess(stream, redis);
      if (accessError) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: accessError }) }],
          isError: true,
        };
      }

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
