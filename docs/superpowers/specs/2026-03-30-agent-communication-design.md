# Agent Communication System — Design Spec

## 問題

Claude Code 的內建 channel 會漏訊息且不同 agent session 之間無法互相溝通。需要一個可靠的通訊基礎設施讓多個 Claude Code agent 能透過 Telegram 接收用戶指令、互相通訊、自主判斷是否回應。

## 核心設計決策

| 決策 | 選擇 | 原因 |
|------|------|------|
| 訊息匯流排 | Redis Streams（非 Pub/Sub） | 持久化、consumer group、ACK、離線重放，解決漏訊息問題 |
| 架構 | 每個 agent 獨立 container（TG bot + MCP server） | 徹底隔離，每個 agent 不同專案不同角色 |
| 訊息推送 | Push-based（MCP server → Claude Code） | Claude Code `server:` 設定可接收推送，不需 polling |
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
   Claude Code A   Claude Code B   Claude Code C
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

MCP server 使用 XREADGROUP BLOCK 持續監聽 Redis streams，有訊息立即 push 給 Claude Code：

```typescript
// 固定監聽：自己的 inbox + system events
// 動態監聽：subscribe tool 加入的 channel

async function poll() {
  const results = await redis.xreadgroup(
    `agent:${agentId}`, agentId,
    streamEntries,
    { COUNT: 10, BLOCK: 5000 }
  );
  if (results) {
    for (const msg of results) {
      mcpServer.sendNotification("messages/received", msg);
      await redis.xack(...);
    }
  }
  poll(); // 持續循環
}
```

### MCP Tools

| Tool | 用途 | 說明 |
|------|------|------|
| `reply` | 回覆用戶 | 透過 TG bot 發 Telegram 訊息 |
| `publish` | 跨 agent 通訊 | 寫入 Redis channel stream |
| `subscribe` | 訂閱 channel | 開始監聽 + 回傳最近歷史 |
| `unsubscribe` | 取消訂閱 | 停止監聯 |
| `list_agents` | 查看團隊 | 讀取 registry 中所有 agent profile |
| `get_history` | 查看歷史 | XRANGE 讀取 channel 歷史訊息 |
| `send_direct` | 點對點通訊 | 寫入目標 agent 的 inbox |

## Telegram Bot 設計

### Pairing 流程

```
/start → 產生 6 位配對碼 (TTL 60s) → 用戶點擊確認 → 綁定 user_id
之後所有訊息經 pairing middleware 驗證，非配對用戶靜默忽略
```

### Group 行為

- 所有 bot 關閉 privacy mode，收到所有 group 訊息
- 被 @mention → `must_reply: true`，Claude Code 必須回覆
- 一般訊息 → `must_reply: false`，Claude Code 自主判斷是否回覆
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
  if (ctx.from?.id.toString() !== pairedUserId) return;

  // 寫入 group stream（供 context）
  if (isGroup(ctx)) {
    await redis.xadd(`stream:group:${ctx.chat.id}`, ...);
  }

  // 推給 Claude Code
  await redis.xadd(`stream:agent:${agentId}:inbox`, "*", {
    from: "user",
    content: ctx.message.text,
    must_reply: isMentioned(ctx) ? "true" : "false",
    chat_id: ctx.chat.id.toString(),
    chat_type: ctx.chat.type,
    ...
  });
});
```

## 專案結構

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
│   │       ├── reply.ts
│   │       ├── publish.ts
│   │       ├── subscribe.ts
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

### Claude Code 設定

```bash
# 在對應專案目錄中執行
claude mcp add agent-comm --transport sse http://localhost:3101/mcp
```

## 錯誤處理

| 場景 | 處理 |
|------|------|
| Redis 斷線 | MCP push loop 自動重連（exponential backoff），重連後從上次 ACK 繼續 |
| Redis 寫入失敗 | Bot 回覆用戶「系統暫時無法處理」 |
| MCP SSE 斷線 | 訊息留在 Redis（未 ACK），Claude Code 重連後補推 |
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
ALLOWED_CHAT_IDS  # 安全白名單
```
