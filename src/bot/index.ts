import { Bot } from "grammy";
import { Config } from "@config/index";
import type { RedisService } from "../services/redis";
import type { AgentRegistry } from "../services/agent-registry";
import type { PairingService } from "../services/pairing";
import { createPairingMiddleware } from "./middleware/pairing";
import { createStartCommand } from "./commands/start";
import { createStatusCommand } from "./commands/status";
import { createChannelsCommand } from "./commands/channels";
import { createMessageHandler } from "./handlers/message";

export async function createBot(
  redis: RedisService,
  registry: AgentRegistry,
  pairing: PairingService
) {
  const bot = new Bot(Config.botToken);

  // /start bypasses pairing — handled inside the middleware
  bot.command("start", createStartCommand(pairing));

  // Group context logging — runs BEFORE pairing middleware
  // so ALL group messages are logged regardless of sender
  const me = await bot.api.getMe();
  bot.on("message", async (ctx, next) => {
    const isGroup =
      ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
    if (isGroup) {
      // Phase 4b: ALLOWED_CHAT_IDS guard for group logging
      if (
        Config.allowedChatIds.length > 0 &&
        !Config.allowedChatIds.includes(ctx.chat!.id.toString())
      ) {
        return next();
      }
      const content =
        ctx.message?.text || ctx.message?.caption || "";
      // Skip messages with no textual content and no media
      const hasMedia = !!(ctx.message?.photo || ctx.message?.document);
      if (!content && !hasMedia) return next();

      const fields: Record<string, string> = {
        from_name: ctx.from?.first_name || "unknown",
        content,
        user_id: ctx.from?.id.toString() || "",
        username: ctx.from?.username || "",
        is_bot: ctx.from?.is_bot ? "true" : "false",
        timestamp: Date.now().toString(),
      };
      if (ctx.message?.reply_to_message) {
        fields.reply_to_content = ctx.message.reply_to_message.text || "";
        fields.reply_to_from = ctx.message.reply_to_message.from?.first_name || "";
      }
      if (hasMedia) {
        fields.has_media = "true";
      }
      await redis.xadd(
        `stream:group:${ctx.chat!.id}`,
        fields,
        2000
      );
    }
    await next();
  });

  // Pairing middleware — blocks non-paired users after /start
  bot.use(createPairingMiddleware(pairing));

  // Commands (only accessible after pairing)
  bot.command("status", createStatusCommand(registry));
  bot.command("channels", createChannelsCommand(registry));

  // General message handler (only reached by paired users)
  // Fires for text, photo, and document messages
  const handler = createMessageHandler(redis, me.username);
  bot.on("message:text", handler);
  bot.on("message:photo", handler);
  bot.on("message:document", handler);

  return { bot, botUsername: me.username };
}
