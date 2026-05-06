import type { ChannelMessage, ChannelRuntimeConfig } from "./shared";
import { ChannelStreamReader } from "./shared";

export interface ChannelMessageReader {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  read(blockMs?: number, count?: number): Promise<ChannelMessage[]>;
}

export interface ChannelHubClientConfig {
  agentId: string;
  hubUrl: string;
}

export class ChannelHubClient implements ChannelMessageReader {
  private readonly baseUrl: string;

  constructor(private readonly config: ChannelHubClientConfig) {
    this.baseUrl = config.hubUrl.replace(/\/+$/, "");
  }

  async connect() {
    const res = await fetch(`${this.baseUrl}/health`);
    if (!res.ok) {
      throw new Error(`channel hub health check failed: ${res.status}`);
    }
  }

  async disconnect() {
    // HTTP long-polling client has no persistent resources to close.
  }

  async read(blockMs = 5000, count = 10): Promise<ChannelMessage[]> {
    const url = new URL(`${this.baseUrl}/agents/${encodeURIComponent(this.config.agentId)}/messages`);
    url.searchParams.set("block_ms", String(blockMs));
    url.searchParams.set("count", String(count));

    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`channel hub read failed: ${res.status}${body ? ` ${body}` : ""}`);
    }

    const payload = await res.json() as { messages?: ChannelMessage[] };
    return Array.isArray(payload.messages) ? payload.messages : [];
  }
}

export function createChannelMessageReader(
  config: ChannelRuntimeConfig & { channelHubUrl?: string }
): ChannelMessageReader {
  if (config.channelHubUrl) {
    return new ChannelHubClient({
      agentId: config.agentId,
      hubUrl: config.channelHubUrl,
    });
  }

  return new ChannelStreamReader(config);
}
