import type { RedisService } from "./redis";

// Per-agent blocklist of Telegram user_ids. Anyone in this set is silently
// dropped before reaching Claude, even in allowlisted groups.
//
// Also maintains a username -> user_id cache so /block @handle works for
// users who have spoken in groups the bot can see (Telegram's bot API
// doesn't expose username lookups any other way).
export class BlockedUsersService {
  constructor(
    private redis: RedisService,
    private agentId: string,
  ) {}

  private get blockKey() {
    return `agent:${this.agentId}:blocked_users`;
  }

  private get aliasKey() {
    return `agent:${this.agentId}:user_aliases`;
  }

  async block(userId: string): Promise<void> {
    await this.redis.sadd(this.blockKey, userId);
  }

  async unblock(userId: string): Promise<void> {
    await this.redis.srem(this.blockKey, userId);
  }

  async isBlocked(userId: string): Promise<boolean> {
    return await this.redis.sismember(this.blockKey, userId);
  }

  async list(): Promise<string[]> {
    return await this.redis.smembers(this.blockKey);
  }

  async rememberAlias(username: string, userId: string): Promise<void> {
    await this.redis.hset(this.aliasKey, { [username.toLowerCase()]: userId });
  }

  async resolveAlias(username: string): Promise<string | null> {
    const handle = username.startsWith("@") ? username.slice(1) : username;
    const v = await this.redis.hget(this.aliasKey, handle.toLowerCase());
    return v ?? null;
  }
}
