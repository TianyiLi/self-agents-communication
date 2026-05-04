import type { RedisService } from "./redis";
import type { AgentProfile } from "../types";

export class AgentRegistry {
  constructor(
    private redis: RedisService,
    private profile: AgentProfile
  ) {}

  get agentId(): string {
    return this.profile.agent_id;
  }

  async register() {
    const key = `agent:${this.profile.agent_id}:profile`;
    await this.redis.hset(key, {
      agent_id: this.profile.agent_id,
      name: this.profile.name,
      role: this.profile.role,
      description: this.profile.description,
      capabilities: JSON.stringify(this.profile.capabilities),
      project: this.profile.project,
      bot_username: this.profile.bot_username,
      mcp_port: this.profile.mcp_port ?? "",
    });
    await this.redis.sadd("idx:agents:registry", this.profile.agent_id);
    await this.heartbeat();
  }

  async heartbeat() {
    await this.redis.set(`agent:${this.profile.agent_id}:alive`, "1", 90);
  }

  async controllerHeartbeat() {
    await this.redis.set(`agent:${this.profile.agent_id}:controller_alive`, "1", 90);
  }

  async markControllerOnline() {
    const wasOnline = await this.redis.sismember("idx:agents:online", this.profile.agent_id);
    const wasReachable =
      wasOnline && (await this.redis.exists(`agent:${this.profile.agent_id}:controller_alive`));
    await this.redis.sadd("idx:agents:online", this.profile.agent_id);
    await this.controllerHeartbeat();
    if (!wasReachable) {
      await this.broadcastOnline(true);
    }
  }

  async markControllerOffline(reason: string) {
    const wasOnline = await this.redis.sismember("idx:agents:online", this.profile.agent_id);
    await this.redis.srem("idx:agents:online", this.profile.agent_id);
    await this.redis.del(`agent:${this.profile.agent_id}:controller_alive`);
    if (!wasOnline) return;
    await this.redis.xadd("stream:system:introductions", {
      event: "agent_offline",
      agent_id: this.profile.agent_id,
      reason,
      timestamp: Date.now().toString(),
    }, 500);
  }

  async goOffline(reason: string) {
    await this.markControllerOffline(reason);
    await this.redis.del(`agent:${this.profile.agent_id}:alive`);
  }

  async broadcastOnline(isNew: boolean) {
    await this.redis.xadd("stream:system:introductions", {
      event: "agent_online",
      agent_id: this.profile.agent_id,
      is_new: isNew.toString(),
      name: this.profile.name,
      role: this.profile.role,
      description: this.profile.description,
      capabilities: JSON.stringify(this.profile.capabilities),
      project: this.profile.project,
      timestamp: Date.now().toString(),
    }, 500);
  }

  async listAgents(onlyOnline = false): Promise<(AgentProfile & { online: boolean })[]> {
    const source = onlyOnline ? "idx:agents:online" : "idx:agents:registry";
    const ids = await this.redis.smembers(source);
    const onlineSet = new Set(await this.redis.smembers("idx:agents:online"));
    const agents: (AgentProfile & { online: boolean })[] = [];

    for (const id of ids) {
      const raw = await this.redis.hgetall(`agent:${id}:profile`);
      if (!raw.agent_id) continue;
      const controllerAlive = await this.redis.exists(`agent:${id}:controller_alive`);
      if (onlineSet.has(id) && !controllerAlive) {
        await this.redis.srem("idx:agents:online", id);
      }
      const online = onlineSet.has(id) && controllerAlive;
      if (onlyOnline && !online) continue;

      agents.push({
        agent_id: raw.agent_id,
        name: raw.name,
        role: raw.role,
        description: raw.description,
        capabilities: JSON.parse(raw.capabilities || "[]"),
        project: raw.project,
        bot_username: raw.bot_username,
        online,
      });
    }
    return agents;
  }

  async getSubscriptions(): Promise<string[]> {
    return await this.redis.smembers(`agent:${this.profile.agent_id}:subscriptions`);
  }

  async addSubscription(channel: string) {
    await this.redis.sadd(`agent:${this.profile.agent_id}:subscriptions`, channel);
  }

  async removeSubscription(channel: string) {
    await this.redis.srem(`agent:${this.profile.agent_id}:subscriptions`, channel);
  }
}
