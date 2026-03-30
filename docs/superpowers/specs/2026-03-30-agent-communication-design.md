# Agent Communication System — Design Spec

## 問題

AI agent 之間缺乏可靠的跨 session 通訊機制，內建 channel 會漏訊息且不同 session 之間無法互相溝通。需要一個**與 AI client 無關**的通訊基礎設施，讓任何支援 MCP protocol 的 agent CLI（Claude Code、Gemini CLI、Cursor、Windsurf、Codex 等）都能透過 Telegram 接收用戶指令、互相通訊、自主判斷是否回應。

## 核心設計決策

| 決策 | 選擇 | 原因 |
|------|------|------|
| 訊息匯流排 | Redis Streams（非 Pub/Sub） | 持久化、consumer group、ACK、離線重放，解決漏訊息問題 |
| 架構 | 每個 agent 獨立 container（TG bot + MCP server） | 徹底隔離，每個 agent 不同專案不同角色 |
| 訊息推送 | Redis → MCP server: long-poll (XREADGROUP BLOCK)；MCP server → AI client: push (SSE notification) | 標準 MCP SSE transport，任何 MCP client 都能接收推送 |
| MCP 相容性 | 標準 MCP protocol（SSE transport） | 不綁定特定 AI client，Claude Code / Gemini CLI / Cursor / Windsurf / Codex 等皆可使用 |
| Telegram | 每個 agent 一個獨立 bot | 在 group 中有獨立身份，自然的聊天室體驗 |
| 安全 | Pairing（Telegram user 身份驗證） | 防止未授權用戶操作 bot |
| Agent 差異化 | 共用 code + 環境變數控制 | MVP 簡單，之後可擴展 |

## 架構總覽

```
┌──────────────────── Docker Compose ────────────────────┐
│                                                        │
│  ┌─────────┐                                           │
│  │  Redis   │  (Streams 訊息匯流排)                     │
│  └────┬────┘                                           │
│       │                                                │
│       ├───────────────┬───────────────┐                │
│       │               │               │                │
│  ┌────▼─────┐   ┌────▼─────┐   ┌────▼─────┐          │
│  │ Agent A  │   │ Agent B  │   │ Agent C  │   ...     │
│  │ TG Bot A │   │ TG Bot B │   │ TG Bot C │          │
│  │ MCP Srv  │   │ MCP Srv  │   │ MCP Srv  │          │
│  │ (Bun)    │   │ (Bun)    │   │ (Bun)    │          │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘          │
│       │               │               │                │
└───────┼───────────────┼───────────────┼────────────────┘
        │               │               │
   MCP Client A    MCP Client B    MCP Client C
(Claude Code)   (Gemini CLI)    (Cursor, etc)
```

每個 Agent container 是單一 Bun process，同時運行：
- 一個 Telegram Bot（獨立 bot token，獨立身份）
- 一個 MCP Server（獨立 port，push 訊息給 Claude Code）
- 共用同一個 Redis instance

## 訊息流

### 流程 1：用戶對單一 agent 下指令（@mention）

```
你 (TG group) ──@frontend_bot 跑 build──▶ frontend bot
     │                                       │
     │                             pairing middleware ✓
     │                             must_reply: true
     │                                       │
     │                             XADD stream:agent:frontend-agent:inbox
     │                                       │
     │                             MCP push loop 收到
     │                                       │
     │                             push → Claude Code A（標記必須回覆）
     │                                       │
     │                             Claude Code 執行 build
     │                                       │
     │                             呼叫 MCP tool: reply("build 成功")
     │                                       │
     ◀──── bot.sendMessage ◀─────────────────┘
```

### 流程 2：一般 group 訊息（AI 自主判斷）

```
你 (TG group) ──"各位回報一下進度"──▶ 所有 bot 收到
                                        │
                          每個 bot 寫入自己的 Redis inbox
                          must_reply: false
                                        │
                          各自 MCP push → 各自 Claude Code
                                        │
                          各自根據角色判斷要不要回覆
                                        │
                        ┌───────────┬────┴────┐
                       回覆       回覆      不回覆
```

### 流程 3：agent 間跨專案通訊

```
Claude Code B ──publish("api-updates", "新增 avatar 欄位")
     │
MCP tool → XADD stream:channel:api-updates
     │
Frontend MCP push loop 訂閱了此 channel → push → Claude Code A
     │
Claude Code A 自主判斷是否需要處理
```

### 流程 4：新 agent 加入團隊

```
docker compose up -d reviewer-agent
     │
Container 啟動 → 讀取 / 建立 profile in Redis
     │
XADD stream:system:introductions { event: agent_online, profile: ... }
     │
所有在線 agent 的 MCP push → Claude Code: "reviewer-agent 已加入團隊"
```

## Redis Streams 設計

### Stream 結構

```
stream:agent:{agent_id}:inbox    # 用戶指令 + 其他 agent 的直接訊息
stream:channel:{channel_name}    # 跨 agent 主題通訊
stream:system:introductions      # agent 上下線事件
stream:group:{group_id}          # Telegram group 對話紀錄（供 context）
```

### Consumer Group 策略

Fan-out 模式：每個 agent 對每個 stream 建立自己的 consumer group（`agent:{agent_id}`），確保每則訊息每個訂閱者都收到。

### 訊息 Schema

```typescript
interface StreamMessage {
  id: string;              // Redis 自動產生
  from: string;            // "user" | agent_id
  from_name: string;       // "Paul" | "backend-agent"
  type: "command" | "text" | "code" | "result" | "status" | "system";
  content: string;
  channel?: string;
  chat_id?: string;
  chat_type?: string;
  message_id?: string;
  must_reply?: "true" | "false";
  context?: string;
  reply_to?: string;
  timestamp: string;
}
```

### 保留策略

```
stream:agent:*:inbox       MAXLEN ~1000
stream:channel:*           MAXLEN ~5000
stream:system:*            MAXLEN ~500
stream:group:*             MAXLEN ~2000
```

## Agent Identity 持久化

### Redis 中的 Profile（永久，無 TTL）

```
agent:{agent_id}:profile        # Hash: name, role, description, capabilities, project, bot_username
agent:{agent_id}:alive          # Key with TTL 90s, heartbeat 刷新
agent:{agent_id}:paired_user    # 已配對的 Telegram user ID
agent:{agent_id}:subscriptions  # Set: 訂閱的 channel 列表
idx:agents:registry             # Set: 所有註冊過的 agent_id
idx:agents:online               # Set: 目前在線的 agent_id
```

### 啟動流程

1. 從 Redis 載入或建立 profile
2. 設定 alive key（TTL 90s）
3. 加入 `idx:agents:online`
4. 拉取所有其他 agent 的 profile
5. 廣播自我介紹到 `stream:system:introductions`

### 自我介紹訊息

```typescript
{
  event: "agent_online",
  agent_id: "frontend-agent",
  is_new: false,  // true = 首次加入, false = 重啟恢復
  profile: {
    name: "frontend-agent",
    role: "前端開發",
    description: "負責 React 前端專案，擅長 UI/UX 實作和效能優化",
    capabilities: ["react", "typescript", "css", "testing"],
    project: "/Users/paul/project/frontend-app",
  },
}
```

## MCP Server 設計

### 推送機制

兩段式推送：
1. **Redis → MCP server**：XREADGROUP BLOCK long-poll，有訊息立即返回
2. **MCP server → Claude Code**：SSE notification 主動推送

```typescript
// 固定監聽：自己的 inbox + system events
// 動態監聽：subscribe tool 加入的 channel

async function listenRedisStreams() {
  const results = await redis.xreadgroup(
    `agent:${agentId}`, agentId,
    streamEntries,
    { COUNT: 10, BLOCK: 5000 }  // 阻塞等待，有訊息立即返回
  );
  if (results) {
    for (const msg of results) {
      // 透過 SSE 推送給 Claude Code
      mcpServer.sendNotification("messages/received", msg);
      await redis.xack(msg.streamKey, `agent:${agentId}`, msg.id);
    }
  }
  listenRedisStreams(); // 持續循環
}
```

### Heartbeat

主 process 每 30 秒刷新 Redis alive key：

```typescript
setInterval(async () => {
  await redis.set(`agent:${agentId}:alive`, "1", "EX", 90);
}, 30_000);
```

過期偵測：使用 Redis keyspace notifications（`__keyevent@0__:expired`）。每個 agent 的 MCP server 監聽 expired 事件，當偵測到 `agent:*:alive` key 過期時：從 `idx:agents:online` 移除、廣播 `agent_offline`。

### Graceful Shutdown

```typescript
process.on("SIGTERM", async () => {
  await redis.srem("idx:agents:online", agentId);
  await redis.xadd("stream:system:introductions", "*", {
    event: "agent_offline",
    agent_id: agentId,
    reason: "shutdown",
    timestamp: Date.now().toString(),
  });
  await redis.del(`agent:${agentId}:alive`);
  process.exit(0);
});
```

### MCP Tools

| Tool | 用途 | 說明 |
|------|------|------|
| `agent_pair` | 配對驗證 | agent 啟動後第一個該呼叫的 tool。輸入配對碼，驗證後綁定 Telegram user（見 Pairing 流程） |
| `reply` | 回覆用戶 | 透過 TG bot 發 Telegram 訊息。使用原始訊息的 `chat_id` 回覆到正確的 chat，可選 `reply_to_message_id` 做 threaded reply |
| `publish` | 跨 agent 通訊 | 寫入 Redis channel stream |
| `subscribe` | 訂閱 channel | 開始監聽 + 回傳最近歷史 |
| `unsubscribe` | 取消訂閱 | 停止監聽 |
| `list_agents` | 查看團隊 | 讀取 registry 中所有 agent profile |
| `get_history` | 查看歷史 | XRANGE 讀取 channel 或 group stream 歷史訊息 |
| `send_direct` | 點對點通訊 | 寫入目標 agent 的 inbox |

## Telegram Bot 設計

### Pairing 流程

**雙向握手**：Telegram 端發起，MCP client 端確認。證明用戶同時掌控 Telegram 帳號和 AI agent session。每個 bot 只能綁定一個用戶。

```
用戶 (Telegram)               Bot / Redis                MCP Client (任何 AI agent CLI)
     │                            │                              │
     │  私訊 /start                │                              │
     │───────────────────────────▶│                              │
     │                            │                              │
     │                     已配對？─ YES → 回覆「已配對」          │
     │                            │                              │
     │                            NO                             │
     │                            │                              │
     │                     產生配對碼，存入 Redis                  │
     │                     pairing:{agent_id}:pending            │
     │                     = { code: 482901,                     │
     │                       user_id: TG_USER_ID,                │
     │                       TTL: 120s }                         │
     │                            │                              │
     │  "配對碼: 482901"           │                              │
     │◀───────────────────────────│                              │
     │                            │                              │
     │                            │   MCP tool: agent_pair       │
     │                            │   { code: "482901" }         │
     │                            │◀─────────────────────────────│
     │                            │                              │
     │                     驗證碼 → 取出 user_id                  │
     │                     存入 agent:{id}:paired_user            │
     │                            │                              │
     │  "配對成功 ✓"               │   { status: "paired" }       │
     │◀───────────────────────────│──────────────────────────────▶│
     │                            │                              │
     │                     碼過期？→ 回傳 error                   │
     │                            │  「配對碼已過期，請重新 /start」│
```

之後所有訊息經 pairing middleware 驗證 `ctx.from.id`，非配對用戶靜默忽略。

### Group 行為

- 所有 bot 關閉 privacy mode，收到所有 group 訊息
- 被 @mention → `must_reply: true`，AI agent 必須回覆
- 一般訊息 → `must_reply: false`，AI agent 自主判斷是否回覆
- 所有 group 訊息寫入 `stream:group:{group_id}` 供 context

### Commands

| Command | 用途 |
|---------|------|
| `/start` | 觸發配對流程 |
| `/status` | 顯示 agent 狀態、訂閱的 channel |
| `/channels` | 管理 channel 訂閱 |

### Message Handler

```typescript
bot.on("message", async (ctx) => {
  const text = ctx.message.text || "";
  const isGroup = ctx.chat.type === "group" || ctx.chat.type === "supergroup";
  const isPairedUser = ctx.from?.id.toString() === pairedUserId;

  // Group: 所有訊息都寫入 group stream（供 context，不論發送者）
  if (isGroup) {
    await redis.xadd(`stream:group:${ctx.chat.id}`, "*", {
      from_name: ctx.from?.first_name || "unknown",
      content: text,
      timestamp: Date.now().toString(),
    });
  }

  // 只有配對用戶的訊息才推給 Claude Code
  if (!isPairedUser) return;

  // 檢查 ALLOWED_CHAT_IDS 白名單
  if (allowedChatIds.length > 0 && !allowedChatIds.includes(ctx.chat.id.toString())) return;

  // 推給 Claude Code
  await redis.xadd(`stream:agent:${agentId}:inbox`, "*", {
    from: "user",
    content: text,
    must_reply: text.includes(`@${botUsername}`) ? "true" : "false",
    chat_id: ctx.chat.id.toString(),
    chat_type: ctx.chat.type,
    message_id: ctx.message.message_id.toString(),
    timestamp: Date.now().toString(),
  });
});
```

## 專案結構

此為**全新架構**，取代原有的 Grammy bot template。原有的 auto-loader pattern（`Commands/`, `Actions/`, `Conversations/`）不再適用，因為每個 agent 的 bot 行為統一由環境變數驅動，不需要 glob-scan 載入不同的 command 檔案。

```
self-agents-communication/
├── docker-compose.yml
├── Dockerfile
├── .env / .env.example
├── package.json
├── tsconfig.json
├── CLAUDE.md
├── README.md                   # 含 Claude Code CLI MCP 設定說明
├── config/
│   └── index.ts
├── src/
│   ├── index.ts                # 入口：啟動 bot + mcp server
│   ├── bot/
│   │   ├── index.ts
│   │   ├── middleware/
│   │   │   └── pairing.ts
│   │   ├── Commands/
│   │   │   ├── start.ts
│   │   │   ├── status.ts
│   │   │   └── channels.ts
│   │   └── handlers/
│   │       └── message.ts
│   ├── mcp/
│   │   ├── index.ts
│   │   ├── push.ts
│   │   └── tools/
│   │       ├── agent-pair.ts
│   │       ├── reply.ts
│   │       ├── publish.ts
│   │       ├── subscribe.ts
│   │       ├── unsubscribe.ts
│   │       ├── list-agents.ts
│   │       ├── get-history.ts
│   │       └── send-direct.ts
│   ├── services/
│   │   ├── redis.ts
│   │   ├── pairing.ts
│   │   └── agent-registry.ts
│   └── types.ts
└── docs/
    └── superpowers/
        └── specs/
```

## Docker 部署

### Dockerfile

```dockerfile
FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY . .
EXPOSE ${MCP_PORT:-3100}
CMD ["bun", "run", "src/index.ts"]
```

### docker-compose.yml

```yaml
services:
  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
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
      AGENT_PROJECT: /Users/paul/project/frontend-app
      BOT_TOKEN: ${FRONTEND_BOT_TOKEN}
      MCP_PORT: 3101
      REDIS_URI: redis://redis:6379
      ALLOWED_CHAT_IDS: ${ALLOWED_CHAT_IDS}
    ports:
      - "3101:3101"

  # 新增 agent：複製 service block + 改環境變數

volumes:
  redis-data:
```

### MCP Client 設定

標準 MCP SSE transport，任何支援 MCP 的 AI agent CLI 都能連接：

```bash
# Claude Code
claude mcp add agent-comm --transport sse http://localhost:3101/mcp

# Gemini CLI — 在 .gemini/settings.json 中設定
# Cursor — 在 MCP 設定中加入 SSE server URL
# 其他 MCP client — 依各 client 文件，指向 http://localhost:{MCP_PORT}/mcp
```

連線後，agent 第一步應呼叫 `agent_pair` tool 完成配對。

## 錯誤處理

| 場景 | 處理 |
|------|------|
| Redis 斷線 | MCP push loop 自動重連（exponential backoff），重連後從上次 ACK 繼續 |
| Redis 寫入失敗 | Bot 回覆用戶「系統暫時無法處理」 |
| MCP SSE 斷線 | 訊息留在 Redis（未 ACK），MCP client 重連後補推 |
| Agent crash | Docker restart policy，重啟後恢復 profile + 未讀訊息 |
| Heartbeat 過期 | 從 online 移除，廣播 agent_offline 通知其他 agent |

## 功能開關（環境變數控制）

共用同一份 code，靠環境變數控制差異：

```bash
AGENT_ID          # 唯一識別
AGENT_ROLE        # 角色描述
AGENT_CAPS        # 能力標籤
BOT_TOKEN         # 各自的 Telegram bot
MCP_PORT          # 各自的 MCP port
ALLOWED_CHAT_IDS  # 安全白名單：允許的 Telegram chat ID（逗號分隔）
                  # message handler 中檢查，非白名單 chat 的訊息不推給 Claude Code
                  # 留空 = 不限制（僅靠 pairing 驗證）
```
