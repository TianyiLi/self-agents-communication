# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Docker-based multi-agent communication system built with **Bun**, **Grammy.js**, **MCP SDK**, and **Redis Streams**. Each agent runs an independent Telegram bot + MCP SSE server. Agents communicate via Redis Streams fan-out delivery. Telegram provides the human interface; MCP provides the AI agent interface. Claude Code additionally supports real-time push via a stdio channel server.

## Commands

```bash
bun install        # Install dependencies
bun start          # Run the agent (bun ./src/index.ts)
bun dev            # Run with hot reload (bun --watch ./src/index.ts)
bun test           # Run tests (bun test)
```

### Docker

```bash
docker compose up -d          # Start Redis + all agents
docker compose up redis -d    # Start Redis only (for local dev)
docker compose logs -f        # View logs
docker compose down           # Stop everything
```

## Environment

`.env` contains secrets only (bot tokens, allowed chat IDs). Agent identity is defined per service in `docker-compose.yml`.

Key variables (set in docker-compose.yml per agent):
- `AGENT_ID` — Unique agent identifier
- `AGENT_NAME` — Display name
- `AGENT_ROLE` — Agent's role description
- `AGENT_DESC` — Detailed description
- `AGENT_CAPS` — Comma-separated capabilities
- `BOT_TOKEN` — Telegram bot token
- `REDIS_URI` — Redis connection string (default: `redis://localhost:6379`)
- `MCP_PORT` — MCP SSE server port (default: `3100`)
- `ALLOWED_CHAT_IDS` — Allowed Telegram chat IDs (empty = all)
- `NOTIFIER_MODE` — SSE push mode: `logging` (default), `channel`, `auto`

## Architecture

Two MCP connection modes:

1. **SSE server** (`src/index.ts`, runs in Docker) — Provides tools (reply, publish, subscribe, etc.) to any MCP client via HTTP SSE.
2. **stdio channel server** (`src/channel.ts`, Claude Code subprocess) — Pushes Redis messages as `<channel>` XML tags to Claude Code, triggering automatic AI responses.

### Components

- **Entry point** (`src/index.ts`) — Redis + Grammy bot + MCP SSE server + heartbeat + graceful shutdown
- **Channel server** (`src/channel.ts`) — Lightweight Redis listener for Claude Code channel push (stdio transport)
- **Services** (`src/services/`):
  - `redis.ts` — Redis client wrapper (Streams, Hash, Set)
  - `agent-registry.ts` — Profile registration, heartbeat, discovery
  - `pairing.ts` — Dual-handshake pairing (Telegram `/start` → MCP `agent_pair`)
- **Bot** (`src/bot/`):
  - `middleware/pairing.ts` — Auth: only paired user can interact (except `/start`)
  - `commands/` — `/start`, `/status`, `/channels`
  - `handlers/message.ts` — Forward to inbox stream with `must_reply` flag
- **MCP SSE** (`src/mcp/`):
  - `session.ts` — Single-session access control (one active MCP client per agent)
  - `notifier.ts` — Abstract notifier (TransportNotifier for all clients, ChannelNotifier for Claude)
  - `push.ts` — Redis stream → SSE notification loop
  - `tools/guard.ts` — Session guard for tool access
  - `tools/` — 8 tools: `agent_pair`, `reply`, `publish`, `subscribe`, `unsubscribe`, `list_agents`, `get_history`, `send_direct`

### Message Flow

```
Telegram → Bot → Redis stream:agent:{id}:inbox
  ├── SSE push loop → MCP SSE client (notifications/message)
  └── channel.ts → Claude Code (<channel> XML, triggers auto-response)
```

### Group Behavior

- All bots receive all group messages (privacy mode off)
- @mention → `must_reply: true` (agent must respond)
- General message → `must_reply: false` (agent decides based on role)
- All group messages logged to `stream:group:{id}` for context

## MCP Client Setup

```bash
# SSE tools (any MCP client)
claude mcp add agent-comm --transport sse http://localhost:3101/sse

# Channel push (Claude Code only)
claude mcp add agent-channel \
  -e AGENT_ID=frontend-agent \
  -e REDIS_URI=redis://localhost:6379 \
  -- bun /absolute/path/to/src/channel.ts

# Start with channels enabled
claude --channels server:agent-channel
```

## Key Types

Defined in `src/types.ts`:
- `StreamMessage` — Redis stream message format (from, type, content, channel, chat_id, must_reply, etc.)
- `AgentProfile` — Agent identity (agent_id, name, role, description, capabilities, project, bot_username)

## Path Aliases (tsconfig)

- `@config/*` → `./config/*`
- `@src/*` → `./src/*`

## Redis Key Schema

- `agent:{id}:profile` — Hash: agent profile
- `agent:{id}:alive` — String with TTL 90s: heartbeat
- `agent:{id}:paired_user` — String: paired Telegram user ID
- `agent:{id}:subscriptions` — Set: subscribed channels
- `idx:agents:registry` — Set: all registered agent IDs
- `idx:agents:online` — Set: online agent IDs
- `stream:agent:{id}:inbox` — Stream: agent inbox (MAXLEN ~1000)
- `stream:channel:{name}` — Stream: channel messages (MAXLEN ~5000)
- `stream:system:introductions` — Stream: agent online/offline events (MAXLEN ~500)
- `stream:group:{id}` — Stream: Telegram group context (MAXLEN ~2000)
- `pairing:{id}:pending` — String with TTL 120s: pending pairing code
