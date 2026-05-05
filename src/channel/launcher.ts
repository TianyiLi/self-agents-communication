import { RedisService } from "../services/redis";
import { ChannelStreamReader } from "./shared";
import { readAvailableBatch } from "./server";
import type { LauncherCliConfig } from "./cli";
import { LauncherPresence } from "./launcher-presence";
import type { SessionDriver } from "./drivers/types";
import { ClaudeDriver } from "./drivers/claude";
import { CodexAppServerDriver } from "./drivers/codex-app-server";

export async function startLauncher(driverKind: "claude" | "codex", config: LauncherCliConfig) {
  const redis = new RedisService();
  await redis.connect(config.redisUri);
  const presence = new LauncherPresence(redis, config.agentId, driverKind);
  if (!await presence.acquireLock()) {
    throw new Error(`launcher already running for agent ${config.agentId}`);
  }

  let stopping = false;
  const stopHandlers: Array<() => Promise<void>> = [];
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    for (const stop of stopHandlers) await stop();
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  try {
    let restarts = 0;
    while (!stopping) {
      const driver = createDriver(driverKind, config, redis);
      stopHandlers.push(async () => {
        await driver.stop();
        await presence.markControllerOffline("launcher shutdown");
      });

      try {
        await driver.start();
        await presence.markControllerOnline();
        await refreshPresence(presence, driver);

        if (driverKind === "claude") {
          await runLifecycleOnlyLoop(driver, presence, config, () => stopping);
        } else {
          await runCodexReadLoop(driver, presence, config, () => stopping);
        }

        const status = await driver.status();
        if (!config.restart || status.state === "stopped" || config.once) break;
        restarts++;
        if (config.maxRestarts !== undefined && restarts > config.maxRestarts) break;
        await Bun.sleep(config.restartDelayMs);
      } catch (err) {
        await presence.markControllerOffline(String(err));
        await presence.refresh({ status: "failed", error: String(err) });
        await driver.stop();
        if (!config.restart || stopping || config.once) throw err;
        restarts++;
        if (config.maxRestarts !== undefined && restarts > config.maxRestarts) throw err;
        await Bun.sleep(config.restartDelayMs);
      } finally {
        stopHandlers.pop();
      }
    }
  } finally {
    await presence.markControllerOffline("launcher stopped");
    await presence.releaseLock();
    await redis.disconnect();
  }
}

function createDriver(
  driverKind: "claude" | "codex",
  config: LauncherCliConfig,
  redis: RedisService
): SessionDriver {
  if (driverKind === "claude") {
    return new ClaudeDriver({
      agentId: config.agentId,
      redisUri: config.redisUri,
      cwd: config.cwd,
      sseUrl: config.sseUrl,
      skipMcpSetup: config.skipMcpSetup,
    });
  }

  return new CodexAppServerDriver({
    agentId: config.agentId,
    agentName: Bun.env.AGENT_NAME || config.agentId,
    agentRole: Bun.env.AGENT_ROLE || "general",
    agentDesc: Bun.env.AGENT_DESC || "",
    agentCaps: Bun.env.AGENT_CAPS || "",
    cwd: config.cwd,
    model: config.model,
    approvalPolicy: config.approvalPolicy,
    sandbox: config.sandbox,
  }, redis);
}

async function runLifecycleOnlyLoop(
  driver: SessionDriver,
  presence: LauncherPresence,
  config: LauncherCliConfig,
  isStopping: () => boolean
) {
  while (!isStopping()) {
    await refreshPresence(presence, driver);
    const status = await driver.status();
    if (status.state === "failed") throw new Error(status.lastError || "driver failed");
    if (status.state === "stopped") return;
    if (config.once) return;
    await Bun.sleep(5000);
  }
}

async function runCodexReadLoop(
  driver: SessionDriver,
  presence: LauncherPresence,
  config: LauncherCliConfig,
  isStopping: () => boolean
) {
  const reader = new ChannelStreamReader({
    agentId: config.agentId,
    redisUri: config.redisUri,
    mediaDirPrefix: "agent-channel-media",
  });
  await reader.connect();
  try {
    while (!isStopping()) {
      await refreshPresence(presence, driver);
      const messages = config.once ? await reader.read(1, 100) : await readAvailableBatch(reader);
      if (messages.length === 0) {
        if (config.once) return;
        continue;
      }
      const sendStart = Date.now();
      await driver.send(messages);
      const status = await driver.status();
      const maxQueueLatency = Math.max(...messages.map((m) => m.queueLatencyMs));
      const totalMediaLatency = messages.reduce((sum, m) => sum + m.mediaLatencyMs, 0);
      process.stderr.write(
        `[launcher] driver=${status.kind} batch=${messages.length} streams=${[...new Set(messages.map((m) => m.source))].join(",")} queue=${maxQueueLatency}ms media=${totalMediaLatency}ms driver=${Date.now() - sendStart}ms thread=${status.threadId || ""}\n`
      );
      if (status.state === "failed") throw new Error(status.lastError || "driver failed");
      if (config.once) return;
    }
  } finally {
    await reader.disconnect();
  }
}

async function refreshPresence(presence: LauncherPresence, driver: SessionDriver) {
  const status = await driver.status();
  await presence.controllerHeartbeat();
  await presence.refresh({
    status: status.state,
    pid: status.pid,
    threadId: status.threadId,
    error: status.lastError,
  });
}
