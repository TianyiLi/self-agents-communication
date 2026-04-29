import type { Context } from "grammy";
import type { AllowedChatsService } from "../../services/allowed-chats";
import type { PairingService } from "../../services/pairing";

async function ensurePairedUser(ctx: Context, pairing: PairingService): Promise<boolean> {
  const paired = await pairing.getPairedUser();
  return !!paired && ctx.from?.id.toString() === paired;
}

export function createAllowHereCommand(
  allowedChats: AllowedChatsService,
  pairing: PairingService,
) {
  return async (ctx: Context) => {
    const chat = ctx.chat;
    if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) {
      await ctx.reply("Use /allow_here in the group you want to authorize.");
      return;
    }
    if (!(await ensurePairedUser(ctx, pairing))) return;
    await allowedChats.add(chat.id.toString());
    await ctx.reply(`Group authorized. (chat_id: <code>${chat.id}</code>)`, {
      parse_mode: "HTML",
    });
  };
}

export function createDisallowHereCommand(
  allowedChats: AllowedChatsService,
  pairing: PairingService,
) {
  return async (ctx: Context) => {
    const chat = ctx.chat;
    if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) {
      await ctx.reply("Use /disallow_here in the group you want to remove.");
      return;
    }
    if (!(await ensurePairedUser(ctx, pairing))) return;
    await allowedChats.remove(chat.id.toString());
    await ctx.reply(`Group removed from allowlist. (chat_id: <code>${chat.id}</code>)`, {
      parse_mode: "HTML",
    });
  };
}

export function createAllowedCommand(allowedChats: AllowedChatsService) {
  return async (ctx: Context) => {
    if (ctx.chat?.type !== "private") {
      await ctx.reply("Use /allowed in a private message.");
      return;
    }
    const ids = await allowedChats.list();
    if (ids.length === 0) {
      await ctx.reply(
        "Allowlist is empty — bot listens to all groups (legacy behaviour).\n" +
          "Use /allow_here in a group to start scoping access."
      );
      return;
    }
    const body = ids.map((id) => `  - <code>${id}</code>`).join("\n");
    await ctx.reply(`<b>Allowed chats:</b>\n${body}`, { parse_mode: "HTML" });
  };
}
