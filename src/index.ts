import consola from "consola";
import { Config } from "../config/index";
import { RedisService } from "./services/redis";
import { AgentRegistry } from "./services/agent-registry";
import { PairingService } from "./services/pairing";
import { createBot } from "./bot/index";
import type { AgentProfile } from "./types";

async function main() {
  consola.info(`Starting agent: ${Config.agentId} (${Config.agentRole})`);

  // 1. Connect Redis
  const redis = new RedisService();
  await redis.connect(Config.redisUri);
  consola.success("Redis connected");

  // 2. Agent registry
  const profile: AgentProfile = {
    agent_id: Config.agentId,
    name: Config.agentName,
    role: Config.agentRole,
    description: Config.agentDesc,
    capabilities: Config.agentCaps,
    project: Config.agentProject,
    bot_username: "", // Will be set after bot init
  };

  const registry = new AgentRegistry(redis, profile);
  const pairing = new PairingService(redis, Config.agentId);

  // 3. Start Telegram bot
  const { bot, botUsername } = await createBot(redis, registry, pairing);
  profile.bot_username = botUsername;
  consola.success(`Telegram bot ready: @${botUsername}`);

  // 4. Register agent in Redis
  await registry.register();
  consola.success("Agent registered in Redis");

  // 5. MCP server will be integrated from feat/mcp-server branch
  consola.info("MCP server placeholder — will be integrated from feat/mcp-server branch");

  // 6. Heartbeat
  const heartbeatInterval = setInterval(async () => {
    try {
      await registry.heartbeat();
    } catch (err) {
      consola.error("Heartbeat failed:", err);
    }
  }, 30_000);

  // 7. Start bot polling
  bot.start({
    onStart: () => consola.success("Bot polling started"),
  });

  // 8. Graceful shutdown
  const shutdown = async () => {
    consola.info("Shutting down...");
    clearInterval(heartbeatInterval);
    bot.stop();
    await registry.goOffline("shutdown");
    await redis.disconnect();
    consola.success("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  consola.box(
    `Agent ${Config.agentId} is ready!\nTelegram: @${botUsername}\nMCP: placeholder`
  );
}

main().catch((err) => {
  consola.error("Fatal:", err);
  process.exit(1);
});
