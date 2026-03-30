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
        await ctx.reply("Already paired. You can start using the bot.");
      }
      return;
    }

    // Generate code
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    const code = await pairing.generateCode(userId);
    await ctx.reply(
      `<b>Pairing Code:</b> <code>${code}</code>\n\n` +
        `Use the <code>agent_pair</code> tool in your AI agent CLI to enter this code.\n` +
        `The code expires in 120 seconds.`,
      { parse_mode: "HTML" }
    );
  };
}
