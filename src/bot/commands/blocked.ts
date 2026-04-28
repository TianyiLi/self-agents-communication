import type { Context } from "grammy";
import type { BlockedUsersService } from "../../services/blocked-users";
import type { PairingService } from "../../services/pairing";

async function ensurePairedUser(
  ctx: Context,
  pairing: PairingService,
): Promise<boolean> {
  const paired = await pairing.getPairedUser();
  if (!paired || ctx.from?.id.toString() !== paired) {
    await ctx.reply("Only the paired user can manage the blocklist.");
    return false;
  }
  return true;
}

async function resolveTarget(
  ctx: Context,
  blockedUsers: BlockedUsersService,
): Promise<{ userId: string; label: string } | null> {
  const reply = ctx.message?.reply_to_message;
  if (reply?.from) {
    const handle = reply.from.username ? `@${reply.from.username}` : `id:${reply.from.id}`;
    return { userId: reply.from.id.toString(), label: handle };
  }

  const text = ctx.message?.text?.trim() ?? "";
  const arg = text.split(/\s+/).slice(1)[0];
  if (!arg) return null;

  if (/^\d+$/.test(arg)) return { userId: arg, label: `id:${arg}` };

  if (arg.startsWith("@")) {
    const id = await blockedUsers.resolveAlias(arg);
    if (!id) return null;
    return { userId: id, label: arg };
  }

  return null;
}

const USAGE_HINT =
  "Usage: reply to a message with /block, or `/block @username`, or `/block <user_id>`.\n" +
  "@username only resolves for users the bot has seen in this group before.";

export function createBlockCommand(
  blockedUsers: BlockedUsersService,
  pairing: PairingService,
) {
  return async (ctx: Context) => {
    if (!(await ensurePairedUser(ctx, pairing))) return;

    const target = await resolveTarget(ctx, blockedUsers);
    if (!target) {
      await ctx.reply(USAGE_HINT, { parse_mode: "Markdown" });
      return;
    }
    await blockedUsers.block(target.userId);
    await ctx.reply(`Blocked ${target.label} (id: <code>${target.userId}</code>).`, {
      parse_mode: "HTML",
    });
  };
}

export function createUnblockCommand(
  blockedUsers: BlockedUsersService,
  pairing: PairingService,
) {
  return async (ctx: Context) => {
    if (!(await ensurePairedUser(ctx, pairing))) return;

    const target = await resolveTarget(ctx, blockedUsers);
    if (!target) {
      await ctx.reply(USAGE_HINT.replace(/block/g, "unblock"), { parse_mode: "Markdown" });
      return;
    }
    await blockedUsers.unblock(target.userId);
    await ctx.reply(`Unblocked ${target.label}.`);
  };
}

export function createBlockedCommand(blockedUsers: BlockedUsersService) {
  return async (ctx: Context) => {
    if (ctx.chat?.type !== "private") {
      await ctx.reply("Use /blocked in a private message.");
      return;
    }
    const ids = await blockedUsers.list();
    if (ids.length === 0) {
      await ctx.reply("No users blocked.");
      return;
    }
    const body = ids.map((id) => `  - <code>${id}</code>`).join("\n");
    await ctx.reply(`<b>Blocked users:</b>\n${body}`, { parse_mode: "HTML" });
  };
}
