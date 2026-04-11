import type { Context } from "grammy";
import type { RedisService } from "../../services/redis";
import { Config } from "@config/index";
import { saveMedia, type MediaDescriptor } from "../../services/media";
import consola from "consola";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB (Telegram Bot API limit)

export function createMessageHandler(
  redis: RedisService,
  botUsername: string
) {
  return async (ctx: Context) => {
    const text = ctx.message?.text || ctx.message?.caption || "";
    const hasMedia = !!(ctx.message?.photo || ctx.message?.document);

    if (!text && !hasMedia) return;

    // Note: group context logging happens BEFORE pairing middleware in bot/index.ts
    // This handler only runs for paired users.

    // ALLOWED_CHAT_IDS check
    if (
      Config.allowedChatIds.length > 0 &&
      !Config.allowedChatIds.includes(ctx.chat!.id.toString())
    ) {
      return;
    }

    // Download media if present
    const mediaDescriptors: MediaDescriptor[] = [];
    try {
      if (ctx.message?.photo) {
        // Largest photo size (last in array)
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const descriptor = await downloadTelegramFile(
          ctx,
          redis,
          photo.file_id,
          `photo_${photo.file_unique_id}.jpg`,
          "image/jpeg"
        );
        if (descriptor) mediaDescriptors.push(descriptor);
      }
      if (ctx.message?.document) {
        const doc = ctx.message.document;
        const descriptor = await downloadTelegramFile(
          ctx,
          redis,
          doc.file_id,
          doc.file_name || `doc_${doc.file_unique_id}`,
          doc.mime_type || "application/octet-stream"
        );
        if (descriptor) mediaDescriptors.push(descriptor);
      }
    } catch (err) {
      consola.warn("Media download failed:", err);
    }

    // Write to agent inbox for MCP push
    const isMentioned = text.includes(`@${botUsername}`);
    const fields: Record<string, string> = {
      from: "user",
      from_name: ctx.from?.first_name || "unknown",
      type: "command",
      content: text.replace(`@${botUsername}`, "").trim(),
      must_reply: isMentioned ? "true" : "false",
      chat_id: ctx.chat!.id.toString(),
      chat_type: ctx.chat!.type,
      message_id: ctx.message!.message_id.toString(),
      user_id: ctx.from?.id.toString() || "",
      username: ctx.from?.username || "",
      is_bot: ctx.from?.is_bot ? "true" : "false",
      timestamp: Date.now().toString(),
    };
    if (ctx.message?.reply_to_message) {
      fields.reply_to_content = ctx.message.reply_to_message.text || "";
      fields.reply_to_from = ctx.message.reply_to_message.from?.first_name || "";
    }
    if (mediaDescriptors.length > 0) {
      fields.media = JSON.stringify(mediaDescriptors);
    }
    await redis.xadd(
      `stream:agent:${Config.agentId}:inbox`,
      fields,
      1000
    );
  };
}

async function downloadTelegramFile(
  ctx: Context,
  redis: RedisService,
  fileId: string,
  filename: string,
  mime: string
): Promise<MediaDescriptor | null> {
  const file = await ctx.api.getFile(fileId);
  if (file.file_size && file.file_size > MAX_FILE_SIZE) {
    consola.warn(`File ${filename} exceeds ${MAX_FILE_SIZE} bytes, skipping`);
    return null;
  }
  if (!file.file_path) return null;

  const token = ctx.api.token;
  const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) {
    consola.warn(`Telegram file fetch failed: ${res.status}`);
    return null;
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return await saveMedia(redis, buffer, filename, mime);
}
