# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Docker-based multi-agent communication system built with **Bun**, **Grammy.js**, **MCP SDK**, and **Redis Streams**. Each agent runs an independent Telegram bot + MCP SSE server. Agents communicate via Redis Streams fan-out delivery. Telegram provides the human interface; MCP provides the AI agent interface.

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

Requires a `.env` file (see `.env.example`) with:
- `AGENT_ID` — Unique agent identifier
- `AGENT_NAME` — Display name
- `AGENT_ROLE` — Agent's role description
- `AGENT_DESC` — Detailed description of the agent
- `AGENT_CAPS` — Comma-separated capabilities
- `AGENT_PROJECT` — Project path the agent works on
- `BOT_TOKEN` — Telegram bot token
- `REDIS_URI` — Redis connection string (default: `redis://localhost:6379`)
- `MCP_PORT` — MCP SSE server port (default: `3100`)
- `ALLOWED_CHAT_IDS` — Comma-separated allowed Telegram chat IDs

## Architecture

The system uses a **Docker Compose** setup with Redis as the message bus:

1. **Entry point** (`src/index.ts`) — Starts Redis connection, Grammy bot, MCP SSE server, heartbeat loop, and graceful shutdown handler.
2. **Services** (`src/services/`) — Core business logic:
   - `redis.ts` — Redis client wrapper for Streams (xadd, xreadgroup, xack, xrange), Hash, and Set operations
   - `agent-registry.ts` — Agent profile registration, heartbeat, online/offline status, agent discovery
   - `pairing.ts` — Dual-handshake pairing: Telegram `/start` generates a code, MCP `agent_pair` tool verifies it
3. **Bot** (`src/bot/`) — Grammy.js Telegram bot:
   - `middleware/pairing.ts` — Auth check: only paired user can interact (except `/start`)
   - `commands/start.ts` — Generate pairing code
   - `commands/status.ts` — Show agent profile and status
   - `commands/channels.ts` — List subscribed channels
   - `handlers/message.ts` — Forward messages to agent inbox stream with `must_reply` flag
4. **MCP** (`src/mcp/`) — MCP SSE server:
   - `push.ts` — Redis stream listener loop that sends MCP notifications
   - `tools/` — MCP tools: `agent_pair`, `reply`, `publish`, `subscribe`, `unsubscribe`, `list_agents`, `get_history`, `send_direct`

## Key Types

Defined in `src/types.ts`:
- `StreamMessage` — Redis stream message format (from, type, content, channel, chat_id, must_reply, etc.)
- `AgentProfile` — Agent identity (agent_id, name, role, description, capabilities, project, bot_username)

## Config

`config/index.ts` exports a `Config` object reading all environment variables with sensible defaults.

## Path Aliases (tsconfig)

- `@config/*` -> `./config/*`
- `@src/*` -> `./src/*`

## Redis Key Schema

- `agent:{id}:profile` — Hash: agent profile
- `agent:{id}:alive` — String with TTL: heartbeat
- `agent:{id}:paired_user` — String: paired Telegram user ID
- `agent:{id}:subscriptions` — Set: subscribed channels
- `idx:agents:registry` — Set: all registered agent IDs
- `idx:agents:online` — Set: online agent IDs
- `stream:agent:{id}:inbox` — Stream: agent inbox messages
- `stream:channel:{name}` — Stream: channel messages
- `stream:system:introductions` — Stream: agent online/offline events
- `pairing:{id}:pending` — String with TTL: pending pairing code
