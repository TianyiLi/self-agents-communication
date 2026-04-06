import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RedisService } from "../../services/redis";
import { Config } from "@config/index";
import type { SessionManager } from "../session";
import { guardSession } from "./guard";

export function registerSendDirectTool(server: McpServer, redis: RedisService, sessionManager: SessionManager) {
  server.tool(
    "send_direct",
    "Send a direct message to a specific agent by their agent ID. The message goes straight " +
      "to their personal inbox and only they will receive it. Use for private communication, " +
      "specific task requests, questions meant for one team member, or when the information " +
      "is only relevant to that particular agent. Call list_agents first to find available " +
      "agent IDs and their capabilities.",
    {
      target_agent_id: z.string().describe(
        "The agent_id of the recipient. Use list_agents to discover available agent IDs."
      ),
      content: z.string().describe("The message content to send"),
      type: z.enum(["text", "code", "result", "status"]).default("text").describe(
        "Message type: 'text' for general messages, 'code' for code snippets, " +
          "'result' for task outputs, 'status' for progress/status updates"
      ),
      quote_content: z.string().optional().describe("Text being responded to, for context"),
    },
    async ({ target_agent_id, content, type, quote_content }, extra) => {
      const denied = guardSession(extra.sessionId ?? "", sessionManager);
      if (denied) return denied;
      const fields: Record<string, string> = {
        from: Config.agentId,
        from_name: Config.agentName,
        type,
        content,
        is_bot: "true",
        timestamp: Date.now().toString(),
      };
      if (quote_content) {
        fields.reply_to_content = quote_content;
        fields.reply_to_from = Config.agentName;
      }
      const msgId = await redis.xadd(
        `stream:agent:${target_agent_id}:inbox`,
        fields,
        1000
      );
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            status: "sent",
            message_id: msgId,
            target: target_agent_id,
          }),
        }],
      };
    }
  );
}
