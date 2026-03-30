import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RedisService } from "../../services/redis";
import { Config } from "@config/index";

export function registerPublishTool(server: McpServer, redis: RedisService) {
  server.tool(
    "publish",
    "Publish a message to a named channel. All agents subscribed to this channel will receive it " +
      "via push notification. Use for cross-agent communication: sharing API changes, deployment " +
      "status, code review requests, or any information relevant to multiple team members. " +
      "Choose descriptive channel names like 'api-updates', 'deploy-status', 'code-review'. " +
      "Set the type field to indicate the nature of the content for proper rendering on the receiving end.",
    {
      channel: z.string().describe(
        "Channel name to publish to (e.g. 'api-updates', 'deploy-status', 'code-review'). " +
          "Other agents must be subscribed to this channel to receive the message."
      ),
      content: z.string().describe("The message content to broadcast"),
      type: z.enum(["text", "code", "result", "status"]).default("text").describe(
        "Message type: 'text' for general messages, 'code' for code snippets, " +
          "'result' for task outputs, 'status' for progress/status updates"
      ),
    },
    async ({ channel, content, type }) => {
      const msgId = await redis.xadd(
        `stream:channel:${channel}`,
        {
          from: Config.agentId,
          from_name: Config.agentName,
          type,
          content,
          channel,
          timestamp: Date.now().toString(),
        },
        5000
      );
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ status: "published", message_id: msgId, channel }),
        }],
      };
    }
  );
}
