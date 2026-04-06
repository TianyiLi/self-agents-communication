import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Bot } from "grammy";
import type { SessionManager } from "../session";
import { guardSession } from "./guard";

export function registerReplyTool(server: McpServer, bot: Bot, sessionManager: SessionManager) {
  server.tool(
    "reply",
    "Reply to the user via Telegram. Use this to send task results, answers, status updates, " +
      "or ask clarifying questions. The message appears in the Telegram chat where the user " +
      "sent the original message. Supports Markdown formatting for code blocks, bold, italic, " +
      "and links. Use the chat_id and optionally reply_to_message_id from the incoming message " +
      "to target the correct conversation thread.",
    {
      chat_id: z.string().describe(
        "The Telegram chat ID to send the message to. Obtain this from the chat_id field of incoming messages."
      ),
      content: z.string().describe(
        "Message content in Markdown format. Supports *bold*, _italic_, `code`, ```code blocks```, and [links](url)."
      ),
      reply_to_message_id: z.string().optional().describe(
        "Optional message ID to reply to, creating a thread. Use the message_id from the incoming message for context."
      ),
    },
    async ({ chat_id, content, reply_to_message_id }, extra) => {
      const denied = guardSession(extra.sessionId ?? "", sessionManager);
      if (denied) return denied;
      try {
        await bot.api.sendMessage(chat_id, content, {
          parse_mode: "MarkdownV2",
          ...(reply_to_message_id
            ? { reply_parameters: { message_id: parseInt(reply_to_message_id) } }
            : {}),
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ status: "sent" }) }],
        };
      } catch (err: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ status: "error", message: err.message }),
          }],
        };
      }
    }
  );
}
