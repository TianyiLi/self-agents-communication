import http from "node:http";
import { RedisService } from "../services/redis";
import { ChannelStreamReader } from "./shared";

const DEFAULT_PORT = 3200;
const MAX_BLOCK_MS = 30000;
const MAX_COUNT = 100;

interface HubConfig {
  redisUri: string;
  port: number;
  host: string;
}

export function channelHubConfigFromEnv(): HubConfig {
  return {
    redisUri: Bun.env.REDIS_URI || "redis://localhost:6379",
    port: parsePositiveInteger(Bun.env.CHANNEL_HUB_PORT, DEFAULT_PORT),
    host: Bun.env.CHANNEL_HUB_HOST || "0.0.0.0",
  };
}

export async function startChannelHub(config = channelHubConfigFromEnv()) {
  const readers = new Map<string, ChannelStreamReader>();
  const readQueues = new Map<string, Promise<void>>();

  const getReader = async (agentId: string) => {
    let reader = readers.get(agentId);
    if (!reader) {
      reader = new ChannelStreamReader({
        agentId,
        redisUri: config.redisUri,
        mediaDirPrefix: "agent-channel-hub-media",
      });
      readers.set(agentId, reader);
    }
    await reader.connect();
    return reader;
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

      if (req.method === "GET" && url.pathname === "/health") {
        writeJson(res, 200, {
          ok: true,
          readers: readers.size,
        });
        return;
      }

      const eventsMatch = url.pathname.match(/^\/agents\/([^/]+)\/events$/);
      if (req.method === "GET" && eventsMatch) {
        const agentId = decodeURIComponent(eventsMatch[1]);
        if (!isValidAgentId(agentId)) {
          writeJson(res, 400, { error: "invalid agent id" });
          return;
        }

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write(": connected\n\n");

        let closed = false;
        req.once("close", () => {
          closed = true;
        });

        while (!closed && !res.writableEnded) {
          const messages = await serializeAgentRead(readQueues, agentId, async () => {
            const reader = await getReader(agentId);
            return await reader.read(30000, 50);
          });

          if (messages.length === 0) {
            res.write(": keepalive\n\n");
            continue;
          }

          res.write(`event: messages\n`);
          res.write(`data: ${JSON.stringify({
            agent_id: agentId,
            messages,
            count: messages.length,
          })}\n\n`);
        }
        return;
      }

      const match = url.pathname.match(/^\/agents\/([^/]+)\/messages$/);
      if (req.method === "GET" && match) {
        const agentId = decodeURIComponent(match[1]);
        if (!isValidAgentId(agentId)) {
          writeJson(res, 400, { error: "invalid agent id" });
          return;
        }

        const blockMs = clampInteger(url.searchParams.get("block_ms"), 5000, 0, MAX_BLOCK_MS);
        const count = clampInteger(url.searchParams.get("count"), 10, 1, MAX_COUNT);
        const messages = await serializeAgentRead(readQueues, agentId, async () => {
          const reader = await getReader(agentId);
          return await reader.read(blockMs, count);
        });
        writeJson(res, 200, {
          agent_id: agentId,
          messages,
          count: messages.length,
        });
        return;
      }

      writeJson(res, 404, { error: "not found" });
    } catch (err) {
      writeJson(res, 500, { error: String(err) });
    }
  });

  server.listen(config.port, config.host);
  process.stderr.write(`agent-channel hub listening on http://${config.host}:${config.port}\n`);

  const shutdown = async () => {
    server.close();
    await Promise.all([...readers.values()].map((reader) => reader.disconnect()));
  };

  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

  return { server, readers };
}

function writeJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function isValidAgentId(agentId: string) {
  return /^[a-zA-Z0-9._:-]+$/.test(agentId);
}

function clampInteger(raw: string | null, fallback: number, min: number, max: number) {
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function parsePositiveInteger(raw: string | undefined, fallback: number) {
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function serializeAgentRead<T>(
  queues: Map<string, Promise<void>>,
  agentId: string,
  read: () => Promise<T>
): Promise<T> {
  const previous = queues.get(agentId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current, () => current);
  queues.set(agentId, queued);

  await previous.catch(() => {});
  try {
    return await read();
  } finally {
    release();
    if (queues.get(agentId) === queued) {
      queues.delete(agentId);
    }
  }
}
