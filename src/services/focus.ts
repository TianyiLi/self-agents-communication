import type { RedisService } from "./redis";

export interface FocusState {
  enabled: true;
  reason?: string;
  started_at: string;
  expires_at?: string;
}

export class FocusService {
  constructor(
    private redis: RedisService,
    private agentId: string
  ) {}

  private key(agentId = this.agentId) {
    return `agent:${agentId}:focus`;
  }

  async enable(reason?: string, durationMinutes?: number): Promise<FocusState> {
    const now = Date.now();
    const ttlSeconds = durationMinutes
      ? Math.max(1, Math.floor(durationMinutes * 60))
      : undefined;
    const state: FocusState = {
      enabled: true,
      ...(reason ? { reason } : {}),
      started_at: String(now),
      ...(ttlSeconds ? { expires_at: String(now + ttlSeconds * 1000) } : {}),
    };

    await this.redis.set(this.key(), JSON.stringify(state), ttlSeconds);
    return state;
  }

  async disable(): Promise<void> {
    await this.redis.del(this.key());
  }

  async get(agentId = this.agentId): Promise<FocusState | null> {
    const raw = await this.redis.get(this.key(agentId));
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as Partial<FocusState>;
      if (parsed.enabled !== true) return null;
      return {
        enabled: true,
        ...(parsed.reason ? { reason: parsed.reason } : {}),
        started_at: parsed.started_at || "0",
        ...(parsed.expires_at ? { expires_at: parsed.expires_at } : {}),
      };
    } catch {
      return null;
    }
  }

  async isFocused(agentId = this.agentId): Promise<boolean> {
    return (await this.get(agentId)) !== null;
  }
}
