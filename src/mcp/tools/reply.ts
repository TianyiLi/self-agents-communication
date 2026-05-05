import { z } from "zod";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InputFile, type Bot } from "grammy";
import type { SessionManager } from "../session";
import { guardSession } from "./guard";

const MAX_MESSAGE_LENGTH = 4096;
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const PHOTO_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

export function registerReplyTool(server: McpServer, bot: Bot, sessionManager: SessionManager) {
  server.tool(
    "reply",
    "Reply to the user via Telegram. Use this to send task results, answers, status updates, " +
      "or ask clarifying questions. The message appears in the Telegram chat where the user " +
      "sent the original message. Supports plain text by default, optional MarkdownV2, " +
      "automatic text chunking, and file attachments. Use the chat_id and optionally " +
      "reply_to_message_id from the incoming message to target the correct conversation thread.",
    {
      chat_id: z.string().describe(
        "The Telegram chat ID to send the message to. Obtain this from the chat_id field of incoming messages."
      ),
      content: z.string().default("").describe(
        "Message content to send. Long messages are automatically split into Telegram-sized chunks. May be empty when files are provided."
      ),
      reply_to_message_id: z.string().optional().describe(
        "Optional message ID to reply to, creating a thread. Use the message_id from the incoming message for context."
      ),
      files: z.array(z.string()).optional().describe(
        "Optional absolute file paths to attach after the text. Images (.jpg/.png/.gif/.webp) send as photos; other files send as documents. Max 50MB each."
      ),
      format: z.enum(["text", "markdownv2"]).default("text").describe(
        "Rendering mode. Default 'text' sends plain text. Use 'markdownv2' only when content is escaped for Telegram MarkdownV2."
      ),
    },
    async ({ chat_id, content, reply_to_message_id, files, format }, extra) => {
      const denied = guardSession(extra.sessionId ?? "", sessionManager);
      if (denied) return denied;
      try {
        const replyParameters = reply_to_message_id
          ? { reply_parameters: { message_id: parseInt(reply_to_message_id) } }
          : {};
        const parseMode = format === "markdownv2" ? { parse_mode: "MarkdownV2" as const } : {};
        const sentIds: number[] = [];

        for (const file of files ?? []) {
          if (!path.isAbsolute(file)) {
            throw new Error(`file path must be absolute: ${file}`);
          }
          const fileStat = await stat(file);
          if (fileStat.size > MAX_ATTACHMENT_BYTES) {
            throw new Error(`file too large: ${file} (${(fileStat.size / 1024 / 1024).toFixed(1)}MB, max 50MB)`);
          }
        }

        if (content.trim() || (files ?? []).length === 0) {
          for (const chunk of chunkText(content, MAX_MESSAGE_LENGTH)) {
            const sent = await bot.api.sendMessage(chat_id, chunk, {
              ...parseMode,
              ...replyParameters,
            });
            sentIds.push(sent.message_id);
          }
        }

        for (const file of files ?? []) {
          const input = new InputFile(file);
          const ext = path.extname(file).toLowerCase();
          const sent = PHOTO_EXTS.has(ext)
            ? await bot.api.sendPhoto(chat_id, input, replyParameters)
            : await bot.api.sendDocument(chat_id, input, replyParameters);
          sentIds.push(sent.message_id);
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              status: "sent",
              message_ids: sentIds.map(String),
              parts: sentIds.length,
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

function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const paragraph = rest.lastIndexOf("\n\n", limit);
    const line = rest.lastIndexOf("\n", limit);
    const space = rest.lastIndexOf(" ", limit);
    const cut = paragraph > limit / 2
      ? paragraph
      : line > limit / 2
        ? line
        : space > 0
          ? space
          : limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  if (rest) chunks.push(rest);
  return chunks;
}
