# Self-Agents Communication

A Docker-based multi-agent communication system where each agent runs an independent Telegram bot + MCP server, connected via Redis Streams. Any MCP-compatible AI client (Claude Code, Codex, Cursor, Gemini CLI) can interact through Telegram. Claude Code additionally supports real-time push notifications via Channels; other clients can use the portable polling channel server.

## Architecture Overview

```
┌─────────── Docker Compose ───────────┐
│                                      │
│  ┌─────────┐    ┌────────────────┐   │
│  │  Redis   │    │  Agent A       │   │
│  │ Streams  │◄──▶│  TG Bot + MCP  │   │
│  └────┬─────┘    └───────┬────────┘   │
│       │                  │ SSE :3101  │
└───────┼──────────────────┼────────────┘
        │                  │
        │   ┌──────────────┼──────────────┐
        │   │     MCP Client (any)        │
        │   │     Tools: reply, publish,  │
        │   │     subscribe, list_agents  │
        │   └─────────────────────────────┘
        │
        │   ┌─────────────────────────────┐
        └──▶│   stdio channel servers     │
            │   Claude: push <channel>    │
            │   Codex/Cursor: poll tool   │
            └─────────────────────────────┘
```

**Two MCP servers per agent:**

| MCP server name | Transport | Purpose | Where it runs | Needs `REDIS_URI`? |
|---|---|---|---|---|
| `agent-comm` | SSE (HTTP) | Provides tools (`reply`, `publish`, `subscribe`, `send_direct`, …) for any MCP client to call | Inside the agent's Docker container, exposed at `http://localhost:<MCP_PORT>/sse` | No — Redis is configured inside the container |
| `agent-channel` | stdio | Pushes `<channel>` notifications (Telegram & inter-agent messages) into the AI session, triggering automatic responses | Locally as a binary, spawned by the MCP client | Yes — reads Redis Streams directly |
| `agent-channel-generic` | stdio | Portable channel reader with `poll_channel_messages` and `channel_status` tools for clients without Claude Channels | Locally as a binary, spawned by the MCP client | Yes — reads Redis Streams directly |

`agent-comm` is enough for any MCP client to send replies and communicate with agents.
`agent-channel` is Claude Code-only and adds real-time push on top.
`agent-channel-generic` is for Codex, Cursor, Gemini, and other MCP clients that can call tools but do not implement Claude's channel notification extension.

## Documentation

- **[docs/setup.md](./docs/setup.md)** — full single-agent setup walkthrough, from clone to working Telegram round-trip
- **[docs/multi-agent-group.md](./docs/multi-agent-group.md)** — multiple agents in one Telegram group, including inter-agent dialogue
- **[docs/channel-clients.md](./docs/channel-clients.md)** — how Claude Code, Codex, Cursor, and other agents use channel servers

The Quick Start below covers the happy path; the docs go deeper on troubleshooting and group flows.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Bun](https://bun.sh) (for local development and channel server)
- Telegram Bot Token(s) from [@BotFather](https://t.me/BotFather)

## Quick Start

### 1. Configure

```bash
cp .env.example .env
# Edit .env — add your bot tokens
```

### 2. Start services

```bash
# Start Redis + all agents
docker compose up -d

# View logs
docker compose logs -f frontend-agent

# Stop everything
docker compose down
```

### 3. Connect MCP client

See [MCP Client Setup](#mcp-client-setup) below.

## MCP Client Setup

### Any MCP Client (Tools only)

Connect to the SSE endpoint for tools (reply, publish, subscribe, etc.):

**Claude Code:**
```bash
claude mcp add agent-comm --transport sse http://localhost:3101/sse
```

**Gemini CLI** — add to `~/.gemini/settings.json`:
```json
{
  "mcpServers": {
    "agent-comm": { "uri": "http://localhost:3101/sse" }
  }
}
```

**Cursor:**
1. Settings > MCP Servers > Add SSE Server
2. URL: `http://localhost:3101/sse`

### Codex/Cursor with Portable Channel Polling

For clients that do not support Claude Code Channels, add the SSE tools server plus `agent-channel-generic` as a stdio MCP server:

```bash
# Build both local channel binaries
bun run build

# Codex CLI: add the generic channel server
codex mcp add agent-channel-generic \
  --env AGENT_ID=frontend-agent \
  --env REDIS_URI=redis://localhost:6379 \
  -- bun /absolute/path/to/src/channel-generic.ts

# Codex CLI: add agent action tools when supported by your Codex build
codex mcp add agent-comm --url http://localhost:3101/sse
```

For Cursor or other JSON-configured MCP clients:

```json
{
  "mcpServers": {
    "agent-comm": {
      "url": "http://localhost:3101/sse"
    },
    "agent-channel-generic": {
      "command": "bun",
      "args": ["/absolute/path/to/src/channel-generic.ts"],
      "env": {
        "AGENT_ID": "frontend-agent",
        "REDIS_URI": "redis://localhost:6379"
      }
    }
  }
}
```

The generic server exposes:

| Tool | Purpose |
|------|---------|
| `poll_channel_messages` | Wait for Telegram or inter-agent messages; returns an empty list on timeout |
| `channel_status` | Show subscriptions and inbox stream details |

See [docs/channel-clients.md](./docs/channel-clients.md) for the Codex agent loop and response rules.

### Claude Code with Channel Push (Recommended)

For real-time push notifications that trigger automatic AI responses, add both the SSE tools server **and** the stdio channel server:

```bash
# 1. Add SSE tools server (provides reply, publish, subscribe, etc.)
claude mcp add agent-comm --transport sse http://localhost:3101/sse

# 2. Add stdio channel server (provides push notifications)
claude mcp add agent-channel \
  -e AGENT_ID=frontend-agent \
  -e REDIS_URI=redis://localhost:6379 \
  -- bun /absolute/path/to/src/channel.ts

# 3. Start Claude Code with channels enabled
claude --channels server:agent-channel
```

When a Telegram message arrives, Claude receives it as:

```xml
<channel source="inbox" from="user" from_name="Paul" must_reply="true" chat_id="963665490">
@frontend_bot run the build
</channel>
```

Claude automatically decides whether to respond based on `must_reply` and its role, then uses the `reply` tool (from the SSE server) to send the response back to Telegram.

#### Channel sources

| Source | Meaning |
|--------|---------|
| `inbox` | Direct Telegram message or @mention |
| `channel:{name}` | Cross-agent broadcast (e.g. `channel:api-updates`) |
| `system` | Agent online/offline events |

#### Channel meta fields

| Field | Description |
|-------|-------------|
| `from` | Sender: `"user"` or agent ID |
| `from_name` | Display name (e.g. `"Paul"`, `"backend-agent"`) |
| `type` | Message type: `command`, `text`, `code`, `result`, `status`, `system` |
| `must_reply` | `"true"` if @mentioned, `"false"` for general messages |
| `chat_id` | Telegram chat ID (use with `reply` tool) |
| `message_id` | Telegram message ID (for threaded replies) |

## Pairing Flow

Each agent requires a dual-handshake pairing to bind a Telegram user to an MCP session:

```
You (Telegram)              Bot / Redis              MCP Client
     │                          │                        │
     │  /start                  │                        │
     │─────────────────────────▶│                        │
     │                          │                        │
     │  "Pairing code: 482901"  │                        │
     │◀─────────────────────────│                        │
     │                          │                        │
     │                          │  agent_pair("482901")  │
     │                          │◀───────────────────────│
     │                          │                        │
     │  "Paired ✓"              │  { status: "paired" }  │
     │◀─────────────────────────│───────────────────────▶│
```

- Code expires in 120 seconds
- Already paired? Call `agent_pair("")` (empty string) to resume the session
- Only one MCP session active per agent at a time

## Adding a New Agent

1. Create a new Telegram bot via [@BotFather](https://t.me/BotFather)
2. Disable privacy mode: BotFather > `/setprivacy` > Disable (required for group messages)
3. Add the bot token to `.env`:
   ```bash
   MY_NEW_AGENT_BOT_TOKEN=123456:ABC-DEF
   ```
4. Add a service in `docker-compose.yml`:
   ```yaml
   my-new-agent:
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
       AGENT_ID: my-new-agent
       AGENT_NAME: my-new-agent
       AGENT_ROLE: Your role description
       AGENT_DESC: What this agent does
       AGENT_CAPS: capability1,capability2
       AGENT_PROJECT: /project/path
       BOT_TOKEN: ${MY_NEW_AGENT_BOT_TOKEN}
       MCP_PORT: 3103
       REDIS_URI: redis://redis:6379
     ports:
       - "3103:3103"
   ```
5. Start it:
   ```bash
   docker compose up -d my-new-agent
   ```
6. Connect your MCP client and pair via Telegram `/start` + `agent_pair`

## Telegram Group Setup

Add multiple agent bots to a Telegram group for team collaboration:

1. Create a group, add all agent bots
2. Disable privacy mode for each bot (BotFather > `/setprivacy` > Disable)
3. All bots receive all group messages:
   - **@mention a bot** → `must_reply: true` — that agent must respond
   - **General message** → `must_reply: false` — each agent decides based on its role

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `AGENT_ID` | Unique agent identifier | `default-agent` |
| `AGENT_NAME` | Display name | `default-agent` |
| `AGENT_ROLE` | Agent's role description | `general` |
| `AGENT_DESC` | Detailed description | (empty) |
| `AGENT_CAPS` | Comma-separated capabilities | (empty) |
| `AGENT_PROJECT` | Project path the agent works on | (empty) |
| `BOT_TOKEN` | Telegram bot token | (required) |
| `REDIS_URI` | Redis connection string | `redis://localhost:6379` |
| `MCP_PORT` | MCP SSE server port | `3100` |
| `ALLOWED_CHAT_IDS` | Comma-separated allowed Telegram chat IDs | (empty = all) |
| `NOTIFIER_MODE` | SSE push mode: `logging`, `channel`, `auto` | `logging` |

## Available MCP Tools

Once paired, the following tools are available via the SSE server:

| Tool | Description |
|---|---|
| `agent_pair` | Verify pairing code or resume existing pairing (empty string) |
| `reply` | Send a message to the paired Telegram chat |
| `publish` | Publish a message to a channel (fan-out to subscribers) |
| `subscribe` | Subscribe to a channel for real-time notifications |
| `unsubscribe` | Unsubscribe from a channel |
| `list_agents` | List all registered agents and their status |
| `get_history` | Retrieve message history from any stream |
| `send_direct` | Send a direct message to another agent's inbox |

## Project Structure

```
config/
  index.ts                    — Config from env vars

src/
  index.ts                    — Entry: Redis + Bot + MCP SSE + heartbeat + shutdown
  channel.ts                  — Stdio channel server for Claude Code push notifications
  channel-generic.ts          — Portable stdio channel reader for Codex/Cursor/etc.
  channel/
    shared.ts                 — Shared Redis stream reader + prompt text for channel servers
  types.ts                    — StreamMessage, AgentProfile interfaces

  services/
    redis.ts                  — Redis client (Streams, Hash, Set)
    agent-registry.ts         — Agent profile, heartbeat, discovery
    pairing.ts                — Dual-handshake pairing

  bot/
    index.ts                  — Grammy bot init + middleware chain
    middleware/
      pairing.ts              — Auth: only paired user can interact
    commands/
      start.ts                — /start: generate pairing code
      status.ts               — /status: agent info
      channels.ts             — /channels: list subscriptions
    handlers/
      message.ts              — Forward to inbox stream with must_reply flag

  mcp/
    index.ts                  — MCP SSE server (node:http + SSEServerTransport)
    push.ts                   — Redis → SSE push loop
    session.ts                — Single-session access control
    notifier.ts               — Abstract notifier (TransportNotifier / ChannelNotifier)
    tools/
      guard.ts                — Session guard for tool access
      agent-pair.ts           — Pairing + session claim
      reply.ts                — Send Telegram message
      publish.ts              — Publish to channel stream
      subscribe.ts            — Subscribe to channel
      unsubscribe.ts          — Unsubscribe
      list-agents.ts          — List agents
      get-history.ts          — Read stream history
      send-direct.ts          — Direct message to agent

Dockerfile                    — oven/bun:1-alpine
docker-compose.yml            — Redis + agent services
.env.example                  — Template
```
