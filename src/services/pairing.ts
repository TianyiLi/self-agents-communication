import { randomInt } from "node:crypto";
import type { RedisService } from "./redis";

const MAX_PAIRING_ATTEMPTS = 5;

export class PairingService {
  constructor(
    private redis: RedisService,
    private agentId: string
  ) {}

  async generateCode(userId: string): Promise<string> {
    const code = String(randomInt(100000, 1000000));
    await this.redis.set(
      `pairing:${this.agentId}:pending`,
      JSON.stringify({ code, user_id: userId }),
      120 // TTL 120 seconds
    );
    // Reset attempt counter
    await this.redis.del(`pairing:${this.agentId}:attempts`);
    return code;
  }

  async verifyCode(code: string): Promise<string | null> {
    const raw = await this.redis.get(`pairing:${this.agentId}:pending`);
    if (!raw) return null;

    const pending = JSON.parse(raw);
    if (pending.code !== code) {
      // Increment attempt counter
      const attempts = await this.redis.client.incr(`pairing:${this.agentId}:attempts`);
      await this.redis.client.expire(`pairing:${this.agentId}:attempts`, 120);
      if (attempts >= MAX_PAIRING_ATTEMPTS) {
        // Too many attempts — delete pending code
        await this.redis.del(`pairing:${this.agentId}:pending`, `pairing:${this.agentId}:attempts`);
      }
      return null;
    }

    // Bind user
    await this.redis.set(`agent:${this.agentId}:paired_user`, pending.user_id);
    // Cleanup
    await this.redis.del(`pairing:${this.agentId}:pending`, `pairing:${this.agentId}:attempts`);
    return pending.user_id;
  }

  async getPairedUser(): Promise<string | null> {
    return await this.redis.get(`agent:${this.agentId}:paired_user`);
  }

  async isPaired(): Promise<boolean> {
    return await this.redis.exists(`agent:${this.agentId}:paired_user`);
  }
}
