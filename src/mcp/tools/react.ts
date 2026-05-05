import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Bot } from "grammy";
import type { ReactionTypeEmoji } from "grammy/types";
import type { SessionManager } from "../session";
import { guardSession } from "./guard";

export function registerReactTool(server: McpServer, bot: Bot, sessionManager: SessionManager) {
  server.tool(
    "react",
    "Add an emoji reaction to a Telegram message. Use this for lightweight acknowledgement without sending a full reply. Telegram only accepts its fixed emoji reaction whitelist.",
    {
      chat_id: z.string().describe("Telegram chat ID from incoming message meta."),
      message_id: z.string().describe("Telegram message ID to react to."),
      emoji: z.string().describe("Emoji reaction, e.g. 👍, 👀, ❤️, 🔥, ✅, ❌."),
    },
    async ({ chat_id, message_id, emoji }, extra) => {
      const denied = guardSession(extra.sessionId ?? "", sessionManager);
      if (denied) return denied;
      try {
        await bot.api.setMessageReaction(chat_id, parseInt(message_id), [
          { type: "emoji", emoji: emoji as ReactionTypeEmoji["emoji"] },
        ]);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ status: "reacted" }) }],
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
