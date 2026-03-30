# Agent Communication System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Docker-based multi-agent communication system where each agent runs an independent Telegram bot + MCP server, connected via Redis Streams, allowing any MCP-compatible AI client to receive push notifications and interact through Telegram.

**Architecture:** Each agent is a single Bun process running a Grammy.js Telegram bot and an MCP SSE server. Redis Streams serves as the message bus with per-agent consumer groups for fan-out delivery. Telegram provides the human interface; MCP provides the AI agent interface. Dual-handshake pairing (Telegram `/start` + MCP `agent_pair` tool) secures each bot.

**Tech Stack:** Bun, TypeScript, Grammy.js, `@modelcontextprotocol/sdk`, Redis (Streams), Docker Compose, Zod

**Spec:** `docs/superpowers/specs/2026-03-30-agent-communication-design.md`

---

## File Structure

```
config/
  index.ts                    — Config object from env vars (AGENT_ID, BOT_TOKEN, REDIS_URI, MCP_PORT, etc.)

src/
  index.ts                    — Entry point: starts Redis, bot, MCP server, heartbeat, graceful shutdown
  types.ts                    — StreamMessage interface, AgentProfile interface, shared types

  services/
    redis.ts                  — Redis client wrapper: connect, xadd, xreadgroup, xack, xrange, hash/set ops
    agent-registry.ts         — Register profile, heartbeat, broadcast intro, list agents, cleanup
    pairing.ts                — Generate pairing code, verify code, get paired user

  bot/
    index.ts                  — Grammy bot init, register middleware + commands + message handler
    middleware/
      pairing.ts              — Middleware: check ctx.from.id against paired user, pass /start through
    commands/
      start.ts                — /start: generate pairing code, send to user
      status.ts               — /status: show agent profile, online status, subscriptions
      channels.ts             — /channels: list subscribed channels
    handlers/
      message.ts              — Group context logging + inbox write with must_reply flag

  mcp/
    index.ts                  — MCP SSE server init, register all tools
    push.ts                   — Redis stream listener loop → mcpServer.sendNotification
    tools/
      agent-pair.ts           — Verify pairing code, bind Telegram user
      reply.ts                — Send Telegram message via bot to chat_id
      publish.ts              — XADD to stream:channel:{name}
      subscribe.ts            — Add channel to push loop + Redis set
      unsubscribe.ts          — Remove channel from push loop + Redis set
      list-agents.ts          — Read all agent profiles from registry
      get-history.ts          — XRANGE on any stream
      send-direct.ts          — XADD to stream:agent:{target}:inbox

Dockerfile                    — oven/bun:1-alpine, install deps, expose MCP_PORT
docker-compose.yml            — Redis + agent services with env vars, volumes, healthcheck
.env.example                  — Template for bot tokens and config
README.md                     — Setup guide including MCP client CLI commands
```

---

## Task 1: Project scaffolding and dependencies

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Create: `config/index.ts` (rewrite)
- Create: `src/types.ts`
- Create: `.env.example`

- [ ] **Step 1: Update package.json**

```json
{
  "name": "self-agents-communication",
  "module": "src/index.ts",
  "type": "module",
  "scripts": {
    "start": "bun ./src/index.ts",
    "dev": "bun --watch ./src/index.ts",
    "test": "bun test"
  },
  "devDependencies": {
    "@types/bun": "latest"
  },
  "peerDependencies": {
    "typescript": "^5.0.0"
  },
  "dependencies": {
    "@grammyjs/hydrate": "^1.4.1",
    "@grammyjs/parse-mode": "^1.10.0",
    "@modelcontextprotocol/sdk": "^1.28.0",
    "consola": "^3.3.3",
    "grammy": "1.30.0",
    "redis": "^4.7.0",
    "zod": "^3.24.0"
  }
}
```

Remove unused Grammy plugins: `@grammyjs/conversations`, `@grammyjs/emoji`, `@grammyjs/storage-file`, `@grammyjs/storage-free`, `axios`.

- [ ] **Step 2: Run `bun install`**

Run: `bun install`
Expected: lockfile updated, no errors

- [ ] **Step 3: Update tsconfig.json paths**

Replace the paths section — remove old aliases, add new ones matching the new structure:

```json
{
  "compilerOptions": {
    "lib": ["ESNext", "DOM"],
    "target": "ESNext",
    "module": "ESNext",
    "moduleDetection": "force",
    "allowJs": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noPropertyAccessFromIndexSignature": false,
    "paths": {
      "@config/*": ["./config/*"],
      "@src/*": ["./src/*"]
    }
  }
}
```

- [ ] **Step 4: Write config/index.ts**

```typescript
export const Config = {
  agentId: Bun.env.AGENT_ID || "default-agent",
  agentName: Bun.env.AGENT_NAME || "default-agent",
  agentRole: Bun.env.AGENT_ROLE || "general",
  agentDesc: Bun.env.AGENT_DESC || "",
  agentCaps: (Bun.env.AGENT_CAPS || "").split(",").filter(Boolean),
  agentProject: Bun.env.AGENT_PROJECT || "",
  botToken: Bun.env.BOT_TOKEN || "",
  redisUri: Bun.env.REDIS_URI || "redis://localhost:6379",
  mcpPort: parseInt(Bun.env.MCP_PORT || "3100"),
  allowedChatIds: (Bun.env.ALLOWED_CHAT_IDS || "").split(",").filter(Boolean),
};
```

- [ ] **Step 5: Write src/types.ts**

```typescript
export interface StreamMessage {
  id: string;
  from: string;
  from_name: string;
  type: "command" | "text" | "code" | "result" | "status" | "system";
  content: string;
  channel?: string;
  chat_id?: string;
  chat_type?: string;
  message_id?: string;
  must_reply?: "true" | "false";
  reply_to?: string;
  timestamp: string;
}

export interface AgentProfile {
  agent_id: string;
  name: string;
  role: string;
  description: string;
  capabilities: string[];
  project: string;
  bot_username: string;
}
```

- [ ] **Step 6: Write .env.example**

```bash
# Agent identity
AGENT_ID=frontend-agent
AGENT_NAME=frontend-agent
AGENT_ROLE=前端開發
AGENT_DESC=負責 React 前端專案
AGENT_CAPS=react,typescript,css
AGENT_PROJECT=/path/to/project

# Telegram
BOT_TOKEN=123456:ABC-DEF

# Infrastructure
REDIS_URI=redis://localhost:6379
MCP_PORT=3101

# Security
ALLOWED_CHAT_IDS=
```

- [ ] **Step 7: Remove old src/ files**

Delete the old codebase files that are being replaced:
- `src/Commands/` (entire directory)
- `src/Actions/` (entire directory)
- `src/Conversations/` (entire directory)
- `src/Database/` (entire directory)
- `src/utils/` (entire directory)
- `src/index.ts` (will be rewritten in Task 6)

Run: `rm -rf src/Commands src/Actions src/Conversations src/Database src/utils src/index.ts`

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: scaffold new project structure with dependencies"
```

---

## Task 2: Redis service layer

**Files:**
- Create: `src/services/redis.ts`
- Create: `src/services/__tests__/redis.test.ts`

- [ ] **Step 1: Write the test for Redis wrapper**

```typescript
// src/services/__tests__/redis.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { RedisService } from "../redis";

// Requires a running Redis instance at REDIS_URI or localhost:6379
const redis = new RedisService();

beforeAll(async () => {
  await redis.connect(Bun.env.REDIS_URI || "redis://localhost:6379");
  // Clean test keys
  await redis.client.del("test:stream", "test:hash", "test:set");
});

afterAll(async () => {
  await redis.client.del("test:stream", "test:hash", "test:set");
  await redis.disconnect();
});

describe("RedisService", () => {
  test("xadd and xrange", async () => {
    const id = await redis.xadd("test:stream", { foo: "bar" });
    expect(id).toContain("-");

    const messages = await redis.xrange("test:stream", "-", "+", 10);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0].message.foo).toBe("bar");
  });

  test("hash operations", async () => {
    await redis.hset("test:hash", { name: "agent-a", role: "dev" });
    const data = await redis.hgetall("test:hash");
    expect(data.name).toBe("agent-a");
    expect(data.role).toBe("dev");
  });

  test("set operations", async () => {
    await redis.sadd("test:set", "a", "b");
    const members = await redis.smembers("test:set");
    expect(members).toContain("a");
    expect(members).toContain("b");
  });

  test("consumer group create and xreadgroup", async () => {
    await redis.ensureConsumerGroup("test:stream", "agent:test-agent");
    await redis.xadd("test:stream", { msg: "hello" });

    const results = await redis.xreadgroup(
      "agent:test-agent",
      "test-agent",
      ["test:stream"],
      1
    );
    expect(results.length).toBeGreaterThan(0);

    // ACK
    for (const r of results) {
      await redis.xack(r.streamKey, "agent:test-agent", r.messages.map(m => m.id));
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/services/__tests__/redis.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement RedisService**

```typescript
// src/services/redis.ts
import { createClient, type RedisClientType } from "redis";

export class RedisService {
  client!: RedisClientType;

  async connect(uri: string) {
    this.client = createClient({ url: uri });
    this.client.on("error", (err) => console.error("Redis error:", err));
    await this.client.connect();
  }

  async disconnect() {
    await this.client.quit();
  }

  // --- Streams ---

  async xadd(
    streamKey: string,
    fields: Record<string, string>,
    maxlen?: number
  ): Promise<string> {
    const args: any = {};
    if (maxlen) {
      args.TRIM = { strategy: "MAXLEN" as const, strategyModifier: "~" as const, threshold: maxlen };
    }
    return await this.client.xAdd(streamKey, "*", fields, args);
  }

  async xrange(
    streamKey: string,
    start: string,
    end: string,
    count: number
  ) {
    const raw = await this.client.xRange(streamKey, start, end, { COUNT: count });
    return raw.map((entry) => ({ id: entry.id, message: entry.message }));
  }

  async ensureConsumerGroup(streamKey: string, groupName: string) {
    try {
      await this.client.xGroupCreate(streamKey, groupName, "0", { MKSTREAM: true });
    } catch (e: any) {
      if (!e.message?.includes("BUSYGROUP")) throw e;
    }
  }

  async xreadgroup(
    groupName: string,
    consumerName: string,
    streamKeys: string[],
    count: number,
    block?: number
  ) {
    const streams = streamKeys.map((key) => ({ key, id: ">" }));
    const opts: any = { COUNT: count };
    if (block !== undefined) opts.BLOCK = block;

    const raw = await this.client.xReadGroup(groupName, consumerName, streams, opts);
    if (!raw) return [];

    return raw.map((entry) => ({
      streamKey: entry.name,
      messages: entry.messages.map((m) => ({ id: m.id, message: m.message })),
    }));
  }

  async xack(streamKey: string, groupName: string, ids: string[]) {
    if (ids.length === 0) return;
    await this.client.xAck(streamKey, groupName, ids);
  }

  // --- Hash ---

  async hset(key: string, fields: Record<string, string>) {
    await this.client.hSet(key, fields);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return (await this.client.hGetAll(key)) as Record<string, string>;
  }

  async hget(key: string, field: string): Promise<string | undefined> {
    return (await this.client.hGet(key, field)) ?? undefined;
  }

  // --- Set ---

  async sadd(key: string, ...members: string[]) {
    await this.client.sAdd(key, members);
  }

  async srem(key: string, ...members: string[]) {
    await this.client.sRem(key, members);
  }

  async smembers(key: string): Promise<string[]> {
    return await this.client.sMembers(key);
  }

  async sismember(key: string, member: string): Promise<boolean> {
    return await this.client.sIsMember(key, member);
  }

  // --- Key ---

  async set(key: string, value: string, ttl?: number) {
    if (ttl) {
      await this.client.set(key, value, { EX: ttl });
    } else {
      await this.client.set(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    return await this.client.get(key);
  }

  async del(...keys: string[]) {
    await this.client.del(keys);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) === 1;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/services/__tests__/redis.test.ts`
Expected: All tests PASS (requires Redis running on localhost:6379)

- [ ] **Step 5: Commit**

```bash
git add src/services/redis.ts src/services/__tests__/redis.test.ts
git commit -m "feat: add Redis service wrapper with Streams support"
```

---

## Task 3: Agent registry service

**Files:**
- Create: `src/services/agent-registry.ts`
- Create: `src/services/__tests__/agent-registry.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// src/services/__tests__/agent-registry.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { RedisService } from "../redis";
import { AgentRegistry } from "../agent-registry";

const redis = new RedisService();
let registry: AgentRegistry;

beforeAll(async () => {
  await redis.connect(Bun.env.REDIS_URI || "redis://localhost:6379");
  registry = new AgentRegistry(redis, {
    agent_id: "test-agent",
    name: "test-agent",
    role: "tester",
    description: "test agent",
    capabilities: ["testing"],
    project: "/tmp/test",
    bot_username: "test_bot",
  });
});

afterAll(async () => {
  // Cleanup
  await redis.client.del(
    "agent:test-agent:profile",
    "agent:test-agent:alive",
    "agent:test-agent:subscriptions"
  );
  await redis.srem("idx:agents:registry", "test-agent");
  await redis.srem("idx:agents:online", "test-agent");
  await redis.disconnect();
});

describe("AgentRegistry", () => {
  test("register stores profile and marks online", async () => {
    await registry.register();

    const profile = await redis.hgetall("agent:test-agent:profile");
    expect(profile.name).toBe("test-agent");
    expect(profile.role).toBe("tester");

    const isOnline = await redis.sismember("idx:agents:online", "test-agent");
    expect(isOnline).toBe(true);

    const isRegistered = await redis.sismember("idx:agents:registry", "test-agent");
    expect(isRegistered).toBe(true);
  });

  test("heartbeat refreshes alive key", async () => {
    await registry.heartbeat();
    const alive = await redis.get("agent:test-agent:alive");
    expect(alive).toBe("1");
  });

  test("listAgents returns all registered agents", async () => {
    const agents = await registry.listAgents();
    expect(agents.length).toBeGreaterThan(0);
    expect(agents.find((a) => a.agent_id === "test-agent")).toBeTruthy();
  });

  test("goOffline removes from online set", async () => {
    await registry.goOffline("shutdown");
    const isOnline = await redis.sismember("idx:agents:online", "test-agent");
    expect(isOnline).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/services/__tests__/agent-registry.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement AgentRegistry**

```typescript
// src/services/agent-registry.ts
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
    });
    await this.redis.sadd("idx:agents:registry", this.profile.agent_id);
    await this.redis.sadd("idx:agents:online", this.profile.agent_id);
    await this.heartbeat();
    await this.broadcastOnline(true);
  }

  async heartbeat() {
    await this.redis.set(`agent:${this.profile.agent_id}:alive`, "1", 90);
    await this.redis.sadd("idx:agents:online", this.profile.agent_id);
  }

  async goOffline(reason: string) {
    await this.redis.srem("idx:agents:online", this.profile.agent_id);
    await this.redis.del(`agent:${this.profile.agent_id}:alive`);
    await this.redis.xadd("stream:system:introductions", {
      event: "agent_offline",
      agent_id: this.profile.agent_id,
      reason,
      timestamp: Date.now().toString(),
    }, 500);
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
      agents.push({
        agent_id: raw.agent_id,
        name: raw.name,
        role: raw.role,
        description: raw.description,
        capabilities: JSON.parse(raw.capabilities || "[]"),
        project: raw.project,
        bot_username: raw.bot_username,
        online: onlineSet.has(id),
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/services/__tests__/agent-registry.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/agent-registry.ts src/services/__tests__/agent-registry.test.ts
git commit -m "feat: add agent registry service with profile persistence"
```

---

## Task 4: Pairing service

**Files:**
- Create: `src/services/pairing.ts`
- Create: `src/services/__tests__/pairing.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// src/services/__tests__/pairing.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { RedisService } from "../redis";
import { PairingService } from "../pairing";

const redis = new RedisService();
let pairing: PairingService;

beforeAll(async () => {
  await redis.connect(Bun.env.REDIS_URI || "redis://localhost:6379");
  pairing = new PairingService(redis, "test-agent");
});

afterAll(async () => {
  await redis.del("pairing:test-agent:pending", "agent:test-agent:paired_user");
  await redis.disconnect();
});

describe("PairingService", () => {
  test("generateCode creates a 6-digit code", async () => {
    const code = await pairing.generateCode("12345");
    expect(code).toMatch(/^\d{6}$/);

    const stored = await redis.get("pairing:test-agent:pending");
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed.code).toBe(code);
    expect(parsed.user_id).toBe("12345");
  });

  test("verifyCode succeeds with correct code", async () => {
    const code = await pairing.generateCode("67890");
    const result = await pairing.verifyCode(code);
    expect(result).toBe("67890");

    // Verify paired_user is set
    const paired = await pairing.getPairedUser();
    expect(paired).toBe("67890");
  });

  test("verifyCode fails with wrong code", async () => {
    await pairing.generateCode("11111");
    const result = await pairing.verifyCode("000000");
    expect(result).toBeNull();
  });

  test("isPaired returns true after pairing", async () => {
    await pairing.generateCode("99999");
    const code = (await redis.get("pairing:test-agent:pending"))!;
    await pairing.verifyCode(JSON.parse(code).code);
    expect(await pairing.isPaired()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/services/__tests__/pairing.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement PairingService**

```typescript
// src/services/pairing.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/services/__tests__/pairing.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/pairing.ts src/services/__tests__/pairing.test.ts
git commit -m "feat: add dual-handshake pairing service"
```

---

## Task 5: Telegram bot with pairing middleware and message handler

**Files:**
- Create: `src/bot/index.ts`
- Create: `src/bot/middleware/pairing.ts`
- Create: `src/bot/commands/start.ts`
- Create: `src/bot/commands/status.ts`
- Create: `src/bot/commands/channels.ts`
- Create: `src/bot/handlers/message.ts`

- [ ] **Step 1: Write pairing middleware**

```typescript
// src/bot/middleware/pairing.ts
import type { Context, NextFunction } from "grammy";
import type { PairingService } from "../../services/pairing";

export function createPairingMiddleware(pairing: PairingService) {
  return async (ctx: Context, next: NextFunction) => {
    // Always allow /start (triggers pairing flow)
    if (ctx.message?.text?.startsWith("/start")) return next();

    // Check if paired
    const pairedUser = await pairing.getPairedUser();
    if (!pairedUser) return; // Not paired yet, ignore all
    if (ctx.from?.id.toString() !== pairedUser) return; // Wrong user, ignore

    await next();
  };
}
```

- [ ] **Step 2: Write /start command**

```typescript
// src/bot/commands/start.ts (lowercase — all directories use lowercase convention)
import type { Context } from "grammy";
import type { PairingService } from "../../services/pairing";
import { InlineKeyboard } from "grammy";

export function createStartCommand(pairing: PairingService) {
  return async (ctx: Context) => {
    // Only in private chat
    if (ctx.chat?.type !== "private") {
      await ctx.reply("請在私訊中使用 /start 進行配對。");
      return;
    }

    // Already paired?
    const paired = await pairing.getPairedUser();
    if (paired) {
      if (ctx.from?.id.toString() === paired) {
        await ctx.reply("✅ 已配對，你可以開始使用。");
      }
      return;
    }

    // Generate code
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    const code = await pairing.generateCode(userId);
    await ctx.reply(
      `🔐 配對碼: <code>${code}</code>\n\n` +
      `請在你的 AI agent CLI 中使用 agent_pair tool 輸入此配對碼。\n` +
      `配對碼將在 120 秒後過期。`,
      { parse_mode: "HTML" }
    );
  };
}
```

- [ ] **Step 3: Write /status command**

```typescript
// src/bot/commands/status.ts
import type { Context } from "grammy";
import type { AgentRegistry } from "../../services/agent-registry";
import { Config } from "@config/index";

export function createStatusCommand(registry: AgentRegistry) {
  return async (ctx: Context) => {
    const subs = await registry.getSubscriptions();
    const agents = await registry.listAgents(true);
    const otherAgents = agents.filter((a) => a.agent_id !== Config.agentId);

    let text = `🤖 <b>${Config.agentName}</b>\n`;
    text += `角色: ${Config.agentRole}\n`;
    text += `狀態: ✅ 在線\n\n`;

    if (subs.length > 0) {
      text += `📡 訂閱的 channels:\n`;
      text += subs.map((s) => `  • #${s}`).join("\n") + "\n\n";
    }

    if (otherAgents.length > 0) {
      text += `👥 其他在線 agents:\n`;
      text += otherAgents
        .map((a) => `  • ${a.name} (${a.role}) ${a.online ? "✅" : "⚫"}`)
        .join("\n");
    }

    await ctx.reply(text, { parse_mode: "HTML" });
  };
}
```

- [ ] **Step 4: Write /channels command**

```typescript
// src/bot/commands/channels.ts
import type { Context } from "grammy";
import type { AgentRegistry } from "../../services/agent-registry";

export function createChannelsCommand(registry: AgentRegistry) {
  return async (ctx: Context) => {
    const subs = await registry.getSubscriptions();
    if (subs.length === 0) {
      await ctx.reply("目前沒有訂閱任何 channel。");
      return;
    }
    const text = `📡 訂閱的 channels:\n` +
      subs.map((s) => `  • #${s}`).join("\n");
    await ctx.reply(text);
  };
}
```

- [ ] **Step 5: Write message handler**

```typescript
// src/bot/handlers/message.ts
import type { Context } from "grammy";
import type { RedisService } from "../../services/redis";
import { Config } from "@config/index";

export function createMessageHandler(redis: RedisService, botUsername: string) {
  return async (ctx: Context) => {
    const text = ctx.message?.text || "";
    if (!text) return;

    // Note: group context logging happens BEFORE pairing middleware in bot/index.ts
    // This handler only runs for paired users.

    // ALLOWED_CHAT_IDS check
    if (
      Config.allowedChatIds.length > 0 &&
      !Config.allowedChatIds.includes(ctx.chat!.id.toString())
    ) {
      return;
    }

    // Write to agent inbox for MCP push
    const isMentioned = text.includes(`@${botUsername}`);
    await redis.xadd(
      `stream:agent:${Config.agentId}:inbox`,
      {
        from: "user",
        from_name: ctx.from?.first_name || "unknown",
        type: "command",
        content: text.replace(`@${botUsername}`, "").trim(),
        must_reply: isMentioned ? "true" : "false",
        chat_id: ctx.chat!.id.toString(),
        chat_type: ctx.chat!.type,
        message_id: ctx.message!.message_id.toString(),
        timestamp: Date.now().toString(),
      },
      1000
    );
  };
}
```

- [ ] **Step 6: Write bot/index.ts — assemble bot**

```typescript
// src/bot/index.ts
import { Bot } from "grammy";
import { hydrateReply } from "@grammyjs/parse-mode";
import { Config } from "@config/index";
import type { RedisService } from "../services/redis";
import type { AgentRegistry } from "../services/agent-registry";
import type { PairingService } from "../services/pairing";
import { createPairingMiddleware } from "./middleware/pairing";
import { createStartCommand } from "./commands/start";
import { createStatusCommand } from "./commands/status";
import { createChannelsCommand } from "./commands/channels";
import { createMessageHandler } from "./handlers/message";

export async function createBot(
  redis: RedisService,
  registry: AgentRegistry,
  pairing: PairingService
) {
  const bot = new Bot(Config.botToken);
  bot.use(hydrateReply);

  // /start bypasses pairing — handled inside the middleware
  bot.command("start", createStartCommand(pairing));

  // Group context logging — runs BEFORE pairing middleware
  // so ALL group messages are logged regardless of sender
  const me = await bot.api.getMe();
  bot.on("message:text", async (ctx, next) => {
    const isGroup = ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
    if (isGroup) {
      await redis.xadd(`stream:group:${ctx.chat!.id}`, {
        from_name: ctx.from?.first_name || "unknown",
        content: ctx.message?.text || "",
        timestamp: Date.now().toString(),
      }, 2000);
    }
    await next();
  });

  // Pairing middleware — blocks non-paired users after /start
  bot.use(createPairingMiddleware(pairing));

  // Commands (only accessible after pairing)
  bot.command("status", createStatusCommand(registry));
  bot.command("channels", createChannelsCommand(registry));

  // General message handler (only reached by paired users)
  bot.on("message:text", createMessageHandler(redis, me.username));

  return { bot, botUsername: me.username };
}
```

- [ ] **Step 7: Commit**

```bash
git add src/bot/
git commit -m "feat: add Telegram bot with pairing middleware and message handler"
```

---

## Task 6: MCP server with tools

**Files:**
- Create: `src/mcp/index.ts`
- Create: `src/mcp/push.ts`
- Create: `src/mcp/tools/agent-pair.ts`
- Create: `src/mcp/tools/reply.ts`
- Create: `src/mcp/tools/publish.ts`
- Create: `src/mcp/tools/subscribe.ts`
- Create: `src/mcp/tools/unsubscribe.ts`
- Create: `src/mcp/tools/list-agents.ts`
- Create: `src/mcp/tools/get-history.ts`
- Create: `src/mcp/tools/send-direct.ts`

- [ ] **Step 1: Write push.ts — Redis stream listener**

```typescript
// src/mcp/push.ts
import type { RedisService } from "../services/redis";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Config } from "@config/index";
import consola from "consola";

export class PushLoop {
  private running = false;
  private subscribedChannels = new Set<string>();
  private redis: RedisService;
  private server: Server;
  private agentId: string;

  constructor(redis: RedisService, server: Server) {
    this.redis = redis;
    this.server = server;
    this.agentId = Config.agentId;
  }

  addChannel(channel: string) {
    this.subscribedChannels.add(channel);
  }

  removeChannel(channel: string) {
    this.subscribedChannels.delete(channel);
  }

  getChannels(): string[] {
    return [...this.subscribedChannels];
  }

  async start() {
    this.running = true;

    // Ensure consumer groups for fixed streams
    const fixedStreams = [
      `stream:agent:${this.agentId}:inbox`,
      "stream:system:introductions",
    ];
    for (const stream of fixedStreams) {
      await this.redis.ensureConsumerGroup(stream, `agent:${this.agentId}`);
    }

    this.listen();
  }

  stop() {
    this.running = false;
  }

  private async listen() {
    while (this.running) {
      try {
        const streamKeys = [
          `stream:agent:${this.agentId}:inbox`,
          "stream:system:introductions",
          ...[...this.subscribedChannels].map((c) => `stream:channel:${c}`),
        ];

        // Ensure consumer groups exist for dynamic channels
        for (const key of streamKeys) {
          await this.redis.ensureConsumerGroup(key, `agent:${this.agentId}`);
        }

        const results = await this.redis.xreadgroup(
          `agent:${this.agentId}`,
          this.agentId,
          streamKeys,
          10,
          5000 // BLOCK 5 seconds
        );

        for (const result of results) {
          for (const msg of result.messages) {
            try {
              // Use the low-level Server to send a custom notification
              await this.server.sendLoggingMessage({
                level: "info",
                data: {
                  stream: result.streamKey,
                  ...msg.message,
                },
              });
            } catch {
              // SSE connection might not be established yet
            }
            await this.redis.xack(
              result.streamKey,
              `agent:${this.agentId}`,
              [msg.id]
            );
          }
        }
      } catch (err) {
        consola.error("Push loop error:", err);
        await Bun.sleep(1000); // Back off on error
      }
    }
  }
}
```

- [ ] **Step 2: Write agent-pair tool**

```typescript
// src/mcp/tools/agent-pair.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PairingService } from "../../services/pairing";

export function registerAgentPairTool(server: McpServer, pairing: PairingService) {
  server.tool(
    "agent_pair",
    "Complete the pairing handshake by entering the 6-digit code from Telegram. This should be the first tool you call after connecting.",
    { code: z.string().describe("The 6-digit pairing code from Telegram /start") },
    async ({ code }) => {
      const userId = await pairing.verifyCode(code);
      if (!userId) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ status: "error", message: "Invalid or expired pairing code. Ask the user to /start again in Telegram." }) }],
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ status: "paired", user_id: userId }) }],
      };
    }
  );
}
```

- [ ] **Step 3: Write reply tool**

```typescript
// src/mcp/tools/reply.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Bot } from "grammy";

export function registerReplyTool(server: McpServer, bot: Bot) {
  server.tool(
    "reply",
    "Reply to the user via Telegram. Use this to send results, answers, or status updates back to the chat.",
    {
      chat_id: z.string().describe("The Telegram chat ID to reply in (from the incoming message)"),
      content: z.string().describe("Message content (supports Markdown)"),
      reply_to_message_id: z.string().optional().describe("Optional: reply to a specific message ID for threading"),
    },
    async ({ chat_id, content, reply_to_message_id }) => {
      try {
        await bot.api.sendMessage(chat_id, content, {
          parse_mode: "Markdown",
          ...(reply_to_message_id ? { reply_parameters: { message_id: parseInt(reply_to_message_id) } } : {}),
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ status: "sent" }) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ status: "error", message: err.message }) }],
        };
      }
    }
  );
}
```

- [ ] **Step 4: Write publish tool**

```typescript
// src/mcp/tools/publish.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RedisService } from "../../services/redis";
import { Config } from "@config/index";

export function registerPublishTool(server: McpServer, redis: RedisService) {
  server.tool(
    "publish",
    "Publish a message to a channel. All agents subscribed to this channel will receive it. Use for cross-agent communication like sharing updates, requesting help, or broadcasting status.",
    {
      channel: z.string().describe("Channel name, e.g. 'api-updates', 'deploy-status'"),
      content: z.string().describe("Message content"),
      type: z.enum(["text", "code", "result", "status"]).default("text"),
    },
    async ({ channel, content, type }) => {
      const msgId = await redis.xadd(`stream:channel:${channel}`, {
        from: Config.agentId,
        from_name: Config.agentName,
        type,
        content,
        channel,
        timestamp: Date.now().toString(),
      }, 5000);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ status: "published", message_id: msgId, channel }) }],
      };
    }
  );
}
```

- [ ] **Step 5: Write subscribe and unsubscribe tools**

```typescript
// src/mcp/tools/subscribe.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RedisService } from "../../services/redis";
import type { AgentRegistry } from "../../services/agent-registry";
import type { PushLoop } from "../push";

export function registerSubscribeTool(
  server: McpServer,
  redis: RedisService,
  registry: AgentRegistry,
  pushLoop: PushLoop
) {
  server.tool(
    "subscribe",
    "Subscribe to a channel to receive messages from other agents. Returns recent history for context.",
    { channel: z.string().describe("Channel name to subscribe to") },
    async ({ channel }) => {
      await registry.addSubscription(channel);
      pushLoop.addChannel(channel);

      // Return recent history
      const streamKey = `stream:channel:${channel}`;
      await redis.ensureConsumerGroup(streamKey, `agent:${registry.agentId}`);
      const history = await redis.xrange(streamKey, "-", "+", 10);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            status: "subscribed",
            channel,
            recent_messages: history.map((h) => h.message),
          }),
        }],
      };
    }
  );
}
```

```typescript
// src/mcp/tools/unsubscribe.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgentRegistry } from "../../services/agent-registry";
import type { PushLoop } from "../push";

export function registerUnsubscribeTool(
  server: McpServer,
  registry: AgentRegistry,
  pushLoop: PushLoop
) {
  server.tool(
    "unsubscribe",
    "Unsubscribe from a channel to stop receiving its messages.",
    { channel: z.string().describe("Channel name to unsubscribe from") },
    async ({ channel }) => {
      await registry.removeSubscription(channel);
      pushLoop.removeChannel(channel);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ status: "unsubscribed", channel }) }],
      };
    }
  );
}
```

- [ ] **Step 6: Write list-agents, get-history, send-direct tools**

```typescript
// src/mcp/tools/list-agents.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgentRegistry } from "../../services/agent-registry";

export function registerListAgentsTool(server: McpServer, registry: AgentRegistry) {
  server.tool(
    "list_agents",
    "List all registered agents and their status. Use this to discover your team members and their capabilities.",
    {
      only_online: z.boolean().default(false).describe("Only list agents that are currently online"),
    },
    async ({ only_online }) => {
      const agents = await registry.listAgents(only_online);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ agents }) }],
      };
    }
  );
}
```

```typescript
// src/mcp/tools/get-history.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RedisService } from "../../services/redis";

export function registerGetHistoryTool(server: McpServer, redis: RedisService) {
  server.tool(
    "get_history",
    "Get historical messages from a channel or group stream. Use to understand prior context.",
    {
      stream: z.string().describe("Stream key, e.g. 'stream:channel:api-updates' or 'stream:group:12345'"),
      count: z.number().default(20).describe("Max messages to return (default 20, max 50)"),
    },
    async ({ stream, count }) => {
      const capped = Math.min(count, 50);
      const messages = await redis.xrange(stream, "-", "+", capped);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ messages: messages.map((m) => ({ id: m.id, ...m.message })), count: messages.length }) }],
      };
    }
  );
}
```

```typescript
// src/mcp/tools/send-direct.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RedisService } from "../../services/redis";
import { Config } from "@config/index";

export function registerSendDirectTool(server: McpServer, redis: RedisService) {
  server.tool(
    "send_direct",
    "Send a direct message to another specific agent. The message goes to their inbox.",
    {
      target_agent_id: z.string().describe("The agent ID to send to"),
      content: z.string().describe("Message content"),
      type: z.enum(["text", "code", "result", "status"]).default("text"),
    },
    async ({ target_agent_id, content, type }) => {
      const msgId = await redis.xadd(`stream:agent:${target_agent_id}:inbox`, {
        from: Config.agentId,
        from_name: Config.agentName,
        type,
        content,
        timestamp: Date.now().toString(),
      }, 1000);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ status: "sent", message_id: msgId, target: target_agent_id }) }],
      };
    }
  );
}
```

- [ ] **Step 7: Write mcp/index.ts — assemble MCP server**

```typescript
// src/mcp/index.ts
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Config } from "@config/index";
import type { RedisService } from "../services/redis";
import type { AgentRegistry } from "../services/agent-registry";
import type { PairingService } from "../services/pairing";
import type { Bot } from "grammy";
import { PushLoop } from "./push";
import { registerAgentPairTool } from "./tools/agent-pair";
import { registerReplyTool } from "./tools/reply";
import { registerPublishTool } from "./tools/publish";
import { registerSubscribeTool } from "./tools/subscribe";
import { registerUnsubscribeTool } from "./tools/unsubscribe";
import { registerListAgentsTool } from "./tools/list-agents";
import { registerGetHistoryTool } from "./tools/get-history";
import { registerSendDirectTool } from "./tools/send-direct";

export async function createMcpServer(
  redis: RedisService,
  registry: AgentRegistry,
  pairing: PairingService,
  bot: Bot
) {
  const mcpServer = new McpServer({
    name: `agent-comm-${Config.agentId}`,
    version: "1.0.0",
  });

  // PushLoop uses the low-level Server for notifications
  const pushLoop = new PushLoop(redis, mcpServer.server);

  // Restore subscriptions from Redis
  const subs = await registry.getSubscriptions();
  for (const channel of subs) {
    pushLoop.addChannel(channel);
  }

  // Register tools
  registerAgentPairTool(mcpServer, pairing);
  registerReplyTool(mcpServer, bot);
  registerPublishTool(mcpServer, redis);
  registerSubscribeTool(mcpServer, redis, registry, pushLoop);
  registerUnsubscribeTool(mcpServer, registry, pushLoop);
  registerListAgentsTool(mcpServer, registry);
  registerGetHistoryTool(mcpServer, redis);
  registerSendDirectTool(mcpServer, redis);

  // Start push loop
  await pushLoop.start();

  // SSE HTTP server — uses node:http because SSEServerTransport
  // requires Node.js ServerResponse (not Bun's Web API Response)
  const transports = new Map<string, SSEServerTransport>();

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url!, `http://localhost:${Config.mcpPort}`);

    if (url.pathname === "/sse") {
      const transport = new SSEServerTransport("/messages", res);
      transports.set(transport.sessionId, transport);

      transport.onclose = () => {
        transports.delete(transport.sessionId);
      };

      await mcpServer.connect(transport);
      return;
    }

    if (url.pathname === "/messages" && req.method === "POST") {
      const sessionId = url.searchParams.get("sessionId");
      const transport = sessionId ? transports.get(sessionId) : undefined;
      if (transport) {
        await transport.handlePostMessage(req, res);
        return;
      }
      res.writeHead(404);
      res.end("Session not found");
      return;
    }

    res.writeHead(200);
    res.end(`Agent Communication MCP Server: ${Config.agentId}`);
  });

  httpServer.listen(Config.mcpPort);

  return { mcpServer, pushLoop, httpServer };
}
```

- [ ] **Step 8: Commit**

```bash
git add src/mcp/
git commit -m "feat: add MCP server with SSE transport and all tools"
```

---

## Task 7: Entry point and graceful shutdown

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Write src/index.ts**

```typescript
// src/index.ts
import consola from "consola";
import { Config } from "@config/index";
import { RedisService } from "./services/redis";
import { AgentRegistry } from "./services/agent-registry";
import { PairingService } from "./services/pairing";
import { createBot } from "./bot/index";
import { createMcpServer } from "./mcp/index";
import type { AgentProfile } from "./types";

async function main() {
  consola.info(`Starting agent: ${Config.agentId} (${Config.agentRole})`);

  // 1. Connect Redis
  const redis = new RedisService();
  await redis.connect(Config.redisUri);
  consola.success("Redis connected");

  // 2. Agent registry
  const profile: AgentProfile = {
    agent_id: Config.agentId,
    name: Config.agentName,
    role: Config.agentRole,
    description: Config.agentDesc,
    capabilities: Config.agentCaps,
    project: Config.agentProject,
    bot_username: "", // Will be set after bot init
  };

  const registry = new AgentRegistry(redis, profile);
  const pairing = new PairingService(redis, Config.agentId);

  // 3. Start Telegram bot
  const { bot, botUsername } = await createBot(redis, registry, pairing);
  profile.bot_username = botUsername;
  consola.success(`Telegram bot ready: @${botUsername}`);

  // 4. Register agent in Redis
  await registry.register();
  consola.success("Agent registered in Redis");

  // 5. Start MCP server
  const { pushLoop, httpServer } = await createMcpServer(
    redis,
    registry,
    pairing,
    bot
  );
  consola.success(`MCP server listening on port ${Config.mcpPort}`);

  // 6. Heartbeat
  const heartbeatInterval = setInterval(async () => {
    try {
      await registry.heartbeat();
    } catch (err) {
      consola.error("Heartbeat failed:", err);
    }
  }, 30_000);

  // 7. Start bot polling
  bot.start({
    onStart: () => consola.success("Bot polling started"),
  });

  // 8. Graceful shutdown
  const shutdown = async () => {
    consola.info("Shutting down...");
    clearInterval(heartbeatInterval);
    pushLoop.stop();
    bot.stop();
    await registry.goOffline("shutdown");
    await redis.disconnect();
    consola.success("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  consola.box(`Agent ${Config.agentId} is ready!\nTelegram: @${botUsername}\nMCP: http://localhost:${Config.mcpPort}/sse`);
}

main().catch((err) => {
  consola.error("Fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify it compiles**

Run: `bunx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add entry point with lifecycle management"
```

---

## Task 8: Docker setup

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`

- [ ] **Step 1: Write Dockerfile**

```dockerfile
FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY . .

EXPOSE ${MCP_PORT:-3100}

CMD ["bun", "run", "src/index.ts"]
```

- [ ] **Step 2: Write docker-compose.yml**

```yaml
services:
  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --notify-keyspace-events Ex
    volumes:
      - redis-data:/data
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      retries: 3

  frontend-agent:
    build: .
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped
    volumes:
      - ./src:/app/src
      - ./config:/app/config
      - ./package.json:/app/package.json
    command: ["bun", "run", "--watch", "src/index.ts"]
    environment:
      AGENT_ID: frontend-agent
      AGENT_NAME: frontend-agent
      AGENT_ROLE: 前端開發
      AGENT_DESC: 負責 React 前端專案，擅長 UI/UX 實作和效能優化
      AGENT_CAPS: react,typescript,css,testing
      AGENT_PROJECT: /project/frontend-app
      BOT_TOKEN: ${FRONTEND_BOT_TOKEN}
      MCP_PORT: 3101
      REDIS_URI: redis://redis:6379
      ALLOWED_CHAT_IDS: ${ALLOWED_CHAT_IDS:-}
    ports:
      - "3101:3101"

  backend-agent:
    build: .
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped
    volumes:
      - ./src:/app/src
      - ./config:/app/config
      - ./package.json:/app/package.json
    command: ["bun", "run", "--watch", "src/index.ts"]
    environment:
      AGENT_ID: backend-agent
      AGENT_NAME: backend-agent
      AGENT_ROLE: 後端開發
      AGENT_DESC: 負責 API 服務，擅長資料庫設計和系統架構
      AGENT_CAPS: typescript,postgresql,redis,api-design
      AGENT_PROJECT: /project/backend-api
      BOT_TOKEN: ${BACKEND_BOT_TOKEN}
      MCP_PORT: 3102
      REDIS_URI: redis://redis:6379
      ALLOWED_CHAT_IDS: ${ALLOWED_CHAT_IDS:-}
    ports:
      - "3102:3102"

volumes:
  redis-data:
```

- [ ] **Step 3: Build and verify**

Run: `docker compose build`
Expected: Build completes without errors

- [ ] **Step 4: Commit**

```bash
git add Dockerfile docker-compose.yml
git commit -m "feat: add Docker setup with Redis and agent services"
```

---

## Task 9: README with MCP client setup instructions

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write README.md**

Cover: project overview, prerequisites, quick start, MCP client setup (Claude Code, Gemini CLI, Cursor), pairing flow, adding new agents, architecture overview.

Key section — MCP client CLI commands:

```bash
# Claude Code — add MCP server connection
claude mcp add agent-comm --transport sse http://localhost:3101/sse

# Verify
claude mcp list

# Gemini CLI — add to .gemini/settings.json
# {
#   "mcpServers": {
#     "agent-comm": { "uri": "http://localhost:3101/sse" }
#   }
# }

# Cursor — Settings > MCP Servers > Add SSE Server
# URL: http://localhost:3101/sse
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup instructions for multiple MCP clients"
```

---

## Task 10: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md to reflect new architecture**

Replace the old architecture documentation with the new system description: Docker-based multi-agent communication, Redis Streams, MCP SSE server, pairing flow. Keep the commands section updated with new scripts.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for new agent communication architecture"
```

---

## Task 11: End-to-end smoke test

**Files:**
- No new files — manual verification

- [ ] **Step 1: Start Redis locally**

Run: `docker compose up redis -d`
Expected: Redis container healthy

- [ ] **Step 2: Run the service locally (without Docker)**

Create a `.env` file with a test bot token, then:

Run: `bun run src/index.ts`
Expected: Console shows "Agent X is ready!" with bot username and MCP port

- [ ] **Step 3: Test pairing flow**

1. Private message the bot on Telegram with `/start`
2. Receive a 6-digit pairing code
3. Connect an MCP client to `http://localhost:3101/sse`
4. Call `agent_pair` tool with the code
5. Verify: bot sends "配對成功 ✓"

- [ ] **Step 4: Test message flow**

1. Send a message to the bot in a group or private chat
2. Verify the MCP client receives a notification with the message content
3. Call the `reply` tool to send a response
4. Verify the response appears in Telegram

- [ ] **Step 5: Test cross-agent communication (if two bots available)**

1. Start a second agent on a different port with a different bot token
2. From agent A, call `publish` to a channel
3. From agent B, call `subscribe` to the same channel
4. Verify agent B receives the published message

- [ ] **Step 6: Test full Docker Compose**

Run: `docker compose up -d`
Expected: Redis + all agent containers start, logs show "Agent X is ready!"

- [ ] **Step 7: Commit any fixes discovered during testing**

```bash
git add -A
git commit -m "fix: address issues found during smoke testing"
```
