import consola from "consola";
import { Config } from "@config/index";
import { RedisService } from "./services/redis";
import { AgentRegistry } from "./services/agent-registry";
import { PairingService } from "./services/pairing";
import { AllowedChatsService } from "./services/allowed-chats";
import { BlockedUsersService } from "./services/blocked-users";
import { createBot } from "./bot/index";
import { createMcpServer } from "./mcp/index";
import { cleanupStaleFiles, ensureMediaDir } from "./services/media";
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
    mcp_port: String(Config.mcpPort || ""),
  };

  const registry = new AgentRegistry(redis, profile);
  const pairing = new PairingService(redis, Config.agentId);
  const allowedChats = new AllowedChatsService(redis, Config.agentId);
  const seeded = await allowedChats.seedIfEmpty(Config.allowedChatIds);
  if (seeded > 0) {
    consola.info(`Seeded ${seeded} chat ids into Redis allowlist from env`);
  }
  const blockedUsers = new BlockedUsersService(redis, Config.agentId);

  // 3. Start Telegram bot
  const { bot, botUsername } = await createBot(redis, registry, pairing, allowedChats, blockedUsers);
  profile.bot_username = botUsername;
  consola.success(`Telegram bot ready: @${botUsername}`);

  // 4. Register agent in Redis
  await registry.register();
  consola.success("Agent registered in Redis");

  // 5. Start MCP server
  const { pushLoop } = await createMcpServer(redis, registry, pairing, bot);
  consola.success(`MCP server listening on port ${Config.mcpPort}`);

  // 6. Heartbeat
  const heartbeatInterval = setInterval(async () => {
    try {
      await registry.heartbeat();
    } catch (err) {
      consola.error("Heartbeat failed:", err);
    }
  }, 30_000);

  // 6b. Media cleanup — delete files older than 1 hour every 15 minutes
  await ensureMediaDir();
  const mediaCleanupInterval = setInterval(async () => {
    try {
      const deleted = await cleanupStaleFiles(3600 * 1000);
      if (deleted > 0) consola.info(`Media cleanup: removed ${deleted} stale files`);
    } catch (err) {
      consola.error("Media cleanup failed:", err);
    }
  }, 15 * 60_000);

  // 7. Start bot polling (with retry for getUpdates conflict)
  const startBot = async (retries = 3) => {
    for (let i = 0; i < retries; i++) {
      try {
        await bot.api.deleteWebhook({ drop_pending_updates: true });
        bot.start({
          drop_pending_updates: true,
          onStart: () => consola.success("Bot polling started"),
        });
        return;
      } catch (err: any) {
        if (err?.error_code === 409 && i < retries - 1) {
          consola.warn(`Polling conflict, retrying in 5s... (${i + 1}/${retries})`);
          await Bun.sleep(5000);
        } else {
          throw err;
        }
      }
    }
  };
  await startBot();

  // 8. Graceful shutdown
  const shutdown = async () => {
    consola.info("Shutting down...");
    clearInterval(heartbeatInterval);
    clearInterval(mediaCleanupInterval);
    pushLoop.stop();
    await bot.stop();
    await registry.goOffline("shutdown");
    await redis.disconnect();
    consola.success("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  consola.box(
    `Agent ${Config.agentId} is ready!\nTelegram: @${botUsername}\nMCP: http://localhost:${Config.mcpPort}/sse`
  );
}

main().catch((err) => {
  consola.error("Fatal:", err);
  process.exit(1);
});
