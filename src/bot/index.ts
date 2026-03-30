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
  bot.on("message:text", async (ctx, next) => {
    const isGroup =
      ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
    if (isGroup) {
      await redis.xadd(
        `stream:group:${ctx.chat!.id}`,
        {
          from_name: ctx.from?.first_name || "unknown",
          content: ctx.message?.text || "",
          timestamp: Date.now().toString(),
        },
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
  bot.on("message:text", createMessageHandler(redis, me.username));

  return { bot, botUsername: me.username };
}
