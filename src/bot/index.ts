import { Bot } from "grammy";
import { Config } from "@config/index";
import type { RedisService } from "../services/redis";
import type { AgentRegistry } from "../services/agent-registry";
import type { PairingService } from "../services/pairing";
import type { AllowedChatsService } from "../services/allowed-chats";
import type { BlockedUsersService } from "../services/blocked-users";
import { createPairingMiddleware } from "./middleware/pairing";
import { createStartCommand } from "./commands/start";
import { createStatusCommand } from "./commands/status";
import { createChannelsCommand } from "./commands/channels";
import {
  createAllowHereCommand,
  createDisallowHereCommand,
  createAllowedCommand,
} from "./commands/allowed";
import {
  createBlockCommand,
  createUnblockCommand,
  createBlockedCommand,
} from "./commands/blocked";
import { createMessageHandler } from "./handlers/message";

export async function createBot(
  redis: RedisService,
  registry: AgentRegistry,
  pairing: PairingService,
  allowedChats: AllowedChatsService,
  blockedUsers: BlockedUsersService
) {
  const bot = new Bot(Config.botToken);

  // /start bypasses pairing — handled inside the middleware
  bot.command("start", createStartCommand(pairing));

  // Group context logging + alias caching — runs BEFORE pairing middleware
  // so ALL group messages are logged regardless of sender, and any
  // username we see gets cached for /block @handle resolution.
  const me = await bot.api.getMe();
  bot.on("message", async (ctx, next) => {
    if (ctx.from?.username && ctx.from?.id) {
      await blockedUsers.rememberAlias(ctx.from.username, ctx.from.id.toString());
    }

    const fromId = ctx.from?.id?.toString();
    if (fromId && (await blockedUsers.isBlocked(fromId))) {
      return; // drop entirely — no group log, no inbox, no further middleware
    }

    const isGroup =
      ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
    if (isGroup) {
      if (!(await allowedChats.isAllowed(ctx.chat!.id.toString()))) {
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

  // Access middleware — pairing + allowlist + blocklist
  bot.use(createPairingMiddleware(pairing, allowedChats, blockedUsers));

  // Commands (gated by middleware: paired user in DM, any non-blocked
  // member in allowlisted groups). Per-command admin checks live inside
  // the command handlers (e.g. /block requires paired user).
  bot.command("status", createStatusCommand(registry));
  bot.command("channels", createChannelsCommand(registry));
  bot.command("allow_here", createAllowHereCommand(allowedChats));
  bot.command("disallow_here", createDisallowHereCommand(allowedChats));
  bot.command("allowed", createAllowedCommand(allowedChats));
  bot.command("block", createBlockCommand(blockedUsers, pairing));
  bot.command("unblock", createUnblockCommand(blockedUsers, pairing));
  bot.command("blocked", createBlockedCommand(blockedUsers));

  // General message handler — reached by paired user (DM) or any
  // non-blocked group member (in allowlisted groups).
  // Fires for text, photo, and document messages.
  const handler = createMessageHandler(redis, me.username, allowedChats);
  bot.on("message:text", handler);
  bot.on("message:photo", handler);
  bot.on("message:document", handler);

  return { bot, botUsername: me.username };
}
