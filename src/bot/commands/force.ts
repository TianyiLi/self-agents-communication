import type { Context } from "grammy";
import { Config } from "@config/index";
import type { FocusService } from "../../services/focus";
import type { PairingService } from "../../services/pairing";
import type { RedisService } from "../../services/redis";

export function createForceCommand(
  redis: RedisService,
  focus: FocusService,
  pairing: PairingService
) {
  return async (ctx: Context) => {
    const pairedUser = await pairing.getPairedUser();
    if (!pairedUser || ctx.from?.id.toString() !== pairedUser) {
      await ctx.reply("Only the paired user can force focus mode off.");
      return;
    }

    const wasFocused = await focus.isFocused();
    await focus.disable();

    const forceText = extractCommandPayload(ctx.message?.text || "", "force");
    await ctx.reply(wasFocused ? "Focus mode 已解除。" : "Focus mode 目前未啟用。");

    if (!forceText) return;

    await redis.xadd(
      `stream:agent:${Config.agentId}:inbox`,
      {
        from: "user",
        from_name: ctx.from?.first_name || "unknown",
        type: "command",
        content: forceText,
        must_reply: "true",
        chat_id: ctx.chat!.id.toString(),
        chat_type: ctx.chat!.type,
        message_id: ctx.message!.message_id.toString(),
        user_id: ctx.from?.id.toString() || "",
        username: ctx.from?.username || "",
        is_bot: ctx.from?.is_bot ? "true" : "false",
        timestamp: Date.now().toString(),
      },
      1000
    );
  };
}

function extractCommandPayload(text: string, command: string): string {
  const match = text.match(
    new RegExp(`^/${command}(?:@\\w+)?(?:\\s+([\\s\\S]+))?$`)
  );
  return match?.[1]?.trim() || "";
}
