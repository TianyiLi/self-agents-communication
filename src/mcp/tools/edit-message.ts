import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Bot } from "grammy";
import type { SessionManager } from "../session";
import { guardSession } from "./guard";

export function registerEditMessageTool(
  server: McpServer,
  bot: Bot,
  sessionManager: SessionManager
) {
  server.tool(
    "edit_message",
    "Edit a Telegram message previously sent by this bot. Useful for progress updates such as 'working...' -> final status. Telegram only allows editing the bot's own messages.",
    {
      chat_id: z.string().describe("Telegram chat ID containing the message."),
      message_id: z.string().describe("Bot-sent Telegram message ID to edit."),
      content: z.string().describe("Replacement message text."),
      format: z.enum(["text", "markdownv2"]).default("text").describe(
        "Rendering mode. Default 'text' sends plain text. Use 'markdownv2' only when content is escaped for Telegram MarkdownV2."
      ),
    },
    async ({ chat_id, message_id, content, format }, extra) => {
      const denied = guardSession(extra.sessionId ?? "", sessionManager);
      if (denied) return denied;
      try {
        const parseMode = format === "markdownv2" ? { parse_mode: "MarkdownV2" as const } : {};
        const edited = await bot.api.editMessageText(
          chat_id,
          parseInt(message_id),
          content,
          parseMode
        );
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              status: "edited",
              message_id: typeof edited === "object" ? String(edited.message_id) : message_id,
            }),
          }],
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
