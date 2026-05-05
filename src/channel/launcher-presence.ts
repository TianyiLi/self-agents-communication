import type { RedisService } from "../services/redis";

const LAUNCHER_TTL_SECONDS = 30;
const CONTROLLER_TTL_SECONDS = 90;

export class LauncherPresence {
  readonly launcherId = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

  constructor(
    private readonly redis: RedisService,
    private readonly agentId: string,
    private readonly driver: string
  ) {}

  async acquireLock() {
    return await this.redis.setNx(this.lockKey(), this.launcherId, LAUNCHER_TTL_SECONDS);
  }

  async refresh(state: {
    status: string;
    pid?: number;
    threadId?: string;
    error?: string;
  }) {
    await this.redis.set(this.lockKey(), this.launcherId, LAUNCHER_TTL_SECONDS);
    await this.redis.set(`agent:${this.agentId}:launcher_driver`, this.driver, LAUNCHER_TTL_SECONDS);
    await this.redis.hset(`agent:${this.agentId}:launcher_status`, {
      driver: this.driver,
      state: state.status,
      pid: state.pid ? String(state.pid) : "",
      thread_id: state.threadId || "",
      updated_at: String(Date.now()),
      error: state.error || "",
    });
    await this.redis.expire(`agent:${this.agentId}:launcher_status`, LAUNCHER_TTL_SECONDS);
  }

  async markControllerOnline() {
    const wasOnline = await this.redis.sismember("idx:agents:online", this.agentId);
    const wasReachable = wasOnline && await this.redis.exists(`agent:${this.agentId}:controller_alive`);
    await this.redis.sadd("idx:agents:online", this.agentId);
    await this.redis.set(`agent:${this.agentId}:controller_alive`, "1", CONTROLLER_TTL_SECONDS);
    if (!wasReachable) {
      const profile = await this.redis.hgetall(`agent:${this.agentId}:profile`);
      await this.redis.xadd("stream:system:introductions", {
        event: "agent_online",
        agent_id: this.agentId,
        is_new: "true",
        name: profile.name || this.agentId,
        role: profile.role || "",
        description: profile.description || "",
        capabilities: profile.capabilities || "[]",
        project: profile.project || "",
        timestamp: Date.now().toString(),
      }, 500);
    }
  }

  async controllerHeartbeat() {
    await this.redis.set(`agent:${this.agentId}:controller_alive`, "1", CONTROLLER_TTL_SECONDS);
  }

  async markControllerOffline(reason: string) {
    const wasOnline = await this.redis.sismember("idx:agents:online", this.agentId);
    await this.redis.srem("idx:agents:online", this.agentId);
    await this.redis.del(`agent:${this.agentId}:controller_alive`);
    if (wasOnline) {
      await this.redis.xadd("stream:system:introductions", {
        event: "agent_offline",
        agent_id: this.agentId,
        reason,
        timestamp: Date.now().toString(),
      }, 500);
    }
  }

  async releaseLock() {
    const current = await this.redis.get(this.lockKey());
    if (current === this.launcherId) {
      await this.redis.del(this.lockKey());
    }
  }

  private lockKey() {
    return `agent:${this.agentId}:launcher_lock`;
  }
}

