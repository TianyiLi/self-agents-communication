import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { RedisService } from "../services/redis";

export interface ChannelRuntimeConfig {
  agentId: string;
  redisUri: string;
  mediaDirPrefix?: string;
}

export interface ChannelMessage {
  id: string;
  stream: string;
  source: string;
  content: string;
  meta: Record<string, string>;
  queueLatencyMs: number;
  mediaLatencyMs: number;
}

interface MediaDescriptor {
  id: string;
  filename: string;
  mime: string;
}

export class ChannelStreamReader {
  readonly redis = new RedisService();
  private readonly mediaDir: string;
  private readonly groupName: string;
  private readonly createdGroups = new Set<string>();
  private connected = false;

  constructor(private readonly config: ChannelRuntimeConfig) {
    const prefix = config.mediaDirPrefix || "agent-channel-media";
    this.mediaDir = path.join(os.tmpdir(), prefix, config.agentId);
    this.groupName = `channel:agent:${config.agentId}`;
  }

  async connect() {
    if (this.connected) return;
    await this.redis.connect(this.config.redisUri);
    await fs.mkdir(this.mediaDir, { recursive: true });
    await this.redis.sadd(`agent:${this.config.agentId}:subscriptions`, "team");
    await this.ensureFixedGroups();
    await this.ackPendingFixedMessages();
    this.connected = true;
  }

  async disconnect() {
    if (!this.connected) return;
    await this.redis.disconnect();
    this.connected = false;
  }

  async read(blockMs = 5000, count = 10): Promise<ChannelMessage[]> {
    await this.connect();

    const fixedStreams = this.fixedStreams();
    const subscriptions = await this.redis.smembers(`agent:${this.config.agentId}:subscriptions`);
    const channelStreams = subscriptions.map((c) => `stream:channel:${c}`);
    const allStreams = [...fixedStreams, ...channelStreams];

    for (const stream of channelStreams) {
      await this.ensureGroup(stream);
    }

    const results = await this.redis.xreadgroup(
      this.groupName,
      this.config.agentId,
      allStreams,
      count,
      blockMs
    );

    const messages: ChannelMessage[] = [];
    for (const result of results) {
      for (const msg of result.messages) {
        if (msg.message.from === this.config.agentId) {
          await this.redis.xack(result.streamKey, this.groupName, [msg.id]);
          continue;
        }

        const recvAt = Date.now();
        const xaddTs = parseInt(msg.message.timestamp || "0");
        const queueLatencyMs = xaddTs ? recvAt - xaddTs : -1;
        const source = sourceFromStream(result.streamKey);

        let mediaPaths: string[] = [];
        const mediaStart = Date.now();
        if (msg.message.media) {
          mediaPaths = await this.downloadMedia(
            msg.message.from || this.config.agentId,
            msg.message.media
          );
        }

        messages.push({
          id: msg.id,
          stream: result.streamKey,
          source,
          content: msg.message.content || JSON.stringify(msg.message),
          meta: {
            source,
            stream: result.streamKey,
            from: msg.message.from || "",
            from_name: msg.message.from_name || "",
            type: msg.message.type || "",
            must_reply: msg.message.must_reply || "false",
            chat_id: msg.message.chat_id || "",
            message_id: msg.message.message_id || "",
            is_bot: msg.message.is_bot || "false",
            media_paths: mediaPaths.length > 0 ? mediaPaths.join(",") : "",
          },
          queueLatencyMs,
          mediaLatencyMs: Date.now() - mediaStart,
        });

        await this.redis.xack(result.streamKey, this.groupName, [msg.id]);
      }
    }

    return messages;
  }

  private fixedStreams() {
    return [
      `stream:agent:${this.config.agentId}:inbox`,
      "stream:system:introductions",
    ];
  }

  private async ensureFixedGroups() {
    for (const stream of this.fixedStreams()) {
      await this.ensureGroup(stream);
    }
  }

  private async ensureGroup(stream: string) {
    if (this.createdGroups.has(stream)) return;
    await this.redis.ensureConsumerGroup(stream, this.groupName);
    this.createdGroups.add(stream);
  }

  private async ackPendingFixedMessages() {
    try {
      const fixedStreams = this.fixedStreams();
      const pending = await this.redis.xreadgroup(
        this.groupName,
        this.config.agentId,
        fixedStreams,
        100,
        undefined,
        "0"
      );
      for (const result of pending) {
        for (const msg of result.messages) {
          await this.redis.xack(result.streamKey, this.groupName, [msg.id]);
        }
      }
    } catch {
      // First run or no pending messages.
    }
  }

  private async resolveAgentPort(fromAgentId: string): Promise<string | null> {
    try {
      const port = await this.redis.hget(`agent:${fromAgentId}:profile`, "mcp_port");
      return port || null;
    } catch {
      return null;
    }
  }

  private async downloadMedia(fromAgentId: string, mediaJson: string): Promise<string[]> {
    let descriptors: MediaDescriptor[];
    try {
      descriptors = JSON.parse(mediaJson);
    } catch {
      return [];
    }
    if (!Array.isArray(descriptors) || descriptors.length === 0) return [];

    const port = await this.resolveAgentPort(fromAgentId);
    if (!port) {
      process.stderr.write(`Cannot resolve port for agent ${fromAgentId}\n`);
      return [];
    }

    const paths: string[] = [];
    for (const desc of descriptors) {
      try {
        const url = `http://localhost:${port}/media/${desc.id}`;
        const res = await fetch(url);
        if (!res.ok) {
          process.stderr.write(`Media fetch failed: ${url} (${res.status})\n`);
          continue;
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        const ext = path.extname(desc.filename) || "";
        const localPath = path.join(this.mediaDir, `${desc.id}${ext}`);
        await fs.writeFile(localPath, buffer);
        paths.push(localPath);
      } catch (err) {
        process.stderr.write(`Media download error: ${err}\n`);
      }
    }
    return paths;
  }
}

export function sourceFromStream(streamKey: string) {
  if (streamKey.startsWith("stream:channel:")) {
    return "channel:" + streamKey.replace("stream:channel:", "");
  }
  if (streamKey === "stream:system:introductions") {
    return "system";
  }
  return "inbox";
}

export function buildChannelInstructions(config: {
  agentId: string;
  agentName: string;
  agentRole: string;
  agentDesc: string;
  agentCaps: string;
  delivery: "claude-channel" | "polling";
}) {
  const delivery =
    config.delivery === "claude-channel"
      ? `Messages arrive as <channel> tags from Telegram users and other agents.`
      : `Call poll_channel_messages to receive Telegram and inter-agent messages.`;

  return [
    `You are ${config.agentName} (agent_id: ${config.agentId}).`,
    `Role: ${config.agentRole}. ${config.agentDesc}`,
    config.agentCaps ? `Capabilities: ${config.agentCaps}` : "",
    ``,
    delivery,
    `- source="inbox": direct message or Telegram command for you`,
    `- source="channel:<name>": cross-agent broadcast you subscribed to (e.g. "team")`,
    `- source="system": agent online/offline event`,
    ``,
    `## Response rules`,
    `- meta.must_reply="true" -> You MUST respond using agent-comm tools (reply, publish, send_direct).`,
    `- meta.must_reply="false" -> Decide based on YOUR ROLE whether to respond. Stay silent if the topic is outside your expertise or already concluded.`,
    `- If meta.from="${config.agentId}", IGNORE - that is your own message echoing back (should be filtered, but double-check).`,
    `- If meta.is_bot="true", the sender is another agent. Keep exchanges focused and concise. Do not respond to pleasantries or acknowledgments - let the conversation end.`,
    ``,
    `## Inter-agent communication`,
    `- Use send_direct to ask a specific agent a question or delegate work. Pass quote_content when referencing a previous message.`,
    `- Use publish to "team" channel (auto-subscribed) to broadcast status/results visible to all agents.`,
    `- Use reply to send results back to the Telegram user via chat_id from meta.`,
    `- Call list_agents first to discover who is available and their roles before send_direct.`,
    ``,
    `## Media`,
    `- If meta.media_paths is non-empty, it contains comma-separated local file paths. Read each path to view images/documents.`,
  ].filter(Boolean).join("\n");
}
