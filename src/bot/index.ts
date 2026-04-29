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

  // When the bot is added to a group, post a hint so the user knows the
  // exact command needed to authorize it. my_chat_member fires regardless
  // of privacy mode, so this is the one signal we can rely on before
  // /setprivacy → Disable has been done.
  bot.on("my_chat_member", async (ctx) => {
    const update = ctx.myChatMember;
    if (!update) return;
    const chat = update.chat;
    if (chat.type !== "group" && chat.type !== "supergroup") return;
    const wasMember = ["member", "administrator"].includes(update.old_chat_member.status);
    const nowMember = ["member", "administrator"].includes(update.new_chat_member.status);
    if (wasMember || !nowMember) return;
    const username = (await bot.api.getMe()).username;
    try {
      await ctx.api.sendMessage(
        chat.id,
        `Hi! I'm @${username}. To authorize me to listen here, the paired user must run:\n` +
          `<code>/allow_here@${username}</code>\n\n` +
          `If that command shows no response, disable group privacy in @BotFather ` +
          `(<code>/setprivacy</code> → Disable), then kick and re-add me.`,
        { parse_mode: "HTML" }
      );
    } catch (err) {
      console.error(`[${username}] failed to post join hint in chat ${chat.id}:`, err);
    }
  });

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
      console.error(
        `[${me.username}] saw group msg chat=${ctx.chat!.id} from=${ctx.from?.id} text=${JSON.stringify((ctx.message?.text || ctx.message?.caption || "").slice(0, 80))}`
      );
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
  bot.command("allow_here", createAllowHereCommand(allowedChats, pairing));
  bot.command("disallow_here", createDisallowHereCommand(allowedChats, pairing));
  bot.command("allowed", createAllowedCommand(allowedChats));
  bot.command("block", createBlockCommand(blockedUsers, pairing));
  bot.command("unblock", createUnblockCommand(blockedUsers, pairing));
  bot.command("blocked", createBlockedCommand(blockedUsers));

  // General message handler — reached by paired user (DM) or any
  // non-blocked group member (in allowlisted groups).
  // Fires for text, photo, and document messages.
  const handler = createMessageHandler(redis, me.username);
  bot.on("message:text", handler);
  bot.on("message:photo", handler);
  bot.on("message:document", handler);

  return { bot, botUsername: me.username };
}
