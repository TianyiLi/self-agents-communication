import type { RedisService } from "./redis";

export class PairingService {
  constructor(
    private redis: RedisService,
    private agentId: string
  ) {}

  async generateCode(userId: string): Promise<string> {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await this.redis.set(
      `pairing:${this.agentId}:pending`,
      JSON.stringify({ code, user_id: userId }),
      120 // TTL 120 seconds
    );
    return code;
  }

  async verifyCode(code: string): Promise<string | null> {
    const raw = await this.redis.get(`pairing:${this.agentId}:pending`);
    if (!raw) return null;

    const pending = JSON.parse(raw);
    if (pending.code !== code) return null;

    // Bind user
    await this.redis.set(`agent:${this.agentId}:paired_user`, pending.user_id);
    // Cleanup pending
    await this.redis.del(`pairing:${this.agentId}:pending`);
    return pending.user_id;
  }

  async getPairedUser(): Promise<string | null> {
    return await this.redis.get(`agent:${this.agentId}:paired_user`);
  }

  async isPaired(): Promise<boolean> {
    return await this.redis.exists(`agent:${this.agentId}:paired_user`);
  }
}
