import type { Context } from "grammy";
import type { RedisService } from "../../services/redis";
import { Config } from "@config/index";

export function createMessageHandler(
  redis: RedisService,
  botUsername: string
) {
  return async (ctx: Context) => {
    const text = ctx.message?.text || "";
    if (!text) return;

    // Note: group context logging happens BEFORE pairing middleware in bot/index.ts
    // This handler only runs for paired users.

    // ALLOWED_CHAT_IDS check
    if (
      Config.allowedChatIds.length > 0 &&
      !Config.allowedChatIds.includes(ctx.chat!.id.toString())
    ) {
      return;
    }

    // Write to agent inbox for MCP push
    const isMentioned = text.includes(`@${botUsername}`);
    await redis.xadd(
      `stream:agent:${Config.agentId}:inbox`,
      {
        from: "user",
        from_name: ctx.from?.first_name || "unknown",
        type: "command",
        content: text.replace(`@${botUsername}`, "").trim(),
        must_reply: isMentioned ? "true" : "false",
        chat_id: ctx.chat!.id.toString(),
        chat_type: ctx.chat!.type,
        message_id: ctx.message!.message_id.toString(),
        timestamp: Date.now().toString(),
      },
      1000
    );
  };
}
