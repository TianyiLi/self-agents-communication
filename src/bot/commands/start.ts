import type { Context } from "grammy";
import type { PairingService } from "../../services/pairing";

export function createStartCommand(pairing: PairingService) {
  return async (ctx: Context) => {
    // Only in private chat
    if (ctx.chat?.type !== "private") {
      await ctx.reply("Please use /start in a private message for pairing.");
      return;
    }

    // Already paired?
    const paired = await pairing.getPairedUser();
    if (paired) {
      if (ctx.from?.id.toString() === paired) {
        await ctx.reply(
          "You're already paired with this bot. " +
            "Just keep chatting — your connected AI will pick up messages here."
        );
      }
      return;
    }

    // Generate code
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    const code = await pairing.generateCode(userId);
    await ctx.reply(
      `<b>Pairing code:</b> <code>${code}</code>\n\n` +
        `Go back to your AI assistant (Claude Code, Cursor, etc.) ` +
        `and paste this code into the chat. ` +
        `It will claim this Telegram session automatically — ` +
        `you don't need to type any special command.\n\n` +
        `⏱ Expires in 2 minutes.`,
      { parse_mode: "HTML" }
    );
  };
}
