import type { RedisService } from "./redis";

// Group-level allowlist for which Telegram chat_ids the agent listens to.
// Source of truth is a Redis Set; env ALLOWED_CHAT_IDS is only a one-time seed
// for first boot. After seeding, runtime mutations via /allow_here etc. win.
//
// Empty set preserves the legacy "no restriction" behaviour so existing
// deployments without ALLOWED_CHAT_IDS keep working unchanged.
export class AllowedChatsService {
  constructor(
    private redis: RedisService,
    private agentId: string,
  ) {}

  private get key() {
    return `agent:${this.agentId}:allowed_chats`;
  }

  async seedIfEmpty(chatIds: string[]): Promise<number> {
    if (chatIds.length === 0) return 0;
    const existing = await this.redis.scard(this.key);
    if (existing > 0) return 0;
    await this.redis.sadd(this.key, ...chatIds);
    return chatIds.length;
  }

  async isAllowed(chatId: string): Promise<boolean> {
    const size = await this.redis.scard(this.key);
    if (size === 0) return true;
    return await this.redis.sismember(this.key, chatId);
  }

  async add(chatId: string): Promise<void> {
    await this.redis.sadd(this.key, chatId);
  }

  async remove(chatId: string): Promise<void> {
    await this.redis.srem(this.key, chatId);
  }

  async list(): Promise<string[]> {
    return await this.redis.smembers(this.key);
  }
}
