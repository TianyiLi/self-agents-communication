# Self-Agents Communication

A Docker-based multi-agent communication system where each agent runs an independent Telegram bot + MCP server, connected via Redis Streams. Any MCP-compatible AI client (Claude Code, Gemini CLI, Cursor) can receive push notifications and interact through Telegram.

## Architecture Overview

```
                    ┌─────────────┐
                    │   Redis     │
                    │  Streams    │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────┴─────┐ ┌───┴───┐ ┌─────┴─────┐
        │ Agent A   │ │Agent B│ │ Agent C   │
        │ Bot + MCP │ │Bot+MCP│ │ Bot + MCP │
        └─────┬─────┘ └───┬───┘ └─────┬─────┘
              │            │            │
        ┌─────┴─────┐ ┌───┴───┐ ┌─────┴─────┐
        │ Telegram  │ │MCP SSE│ │ Telegram  │
        │ Chat      │ │Client │ │ Chat      │
        └───────────┘ └───────┘ └───────────┘
```

Each agent is a single Bun process running:
- **Grammy.js Telegram bot** for human interaction
- **MCP SSE server** for AI agent interface
- **Redis Streams** consumer for cross-agent messaging

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Bun](https://bun.sh) (for local development)
- Redis (provided via Docker Compose)
- Telegram Bot Token(s) from [@BotFather](https://t.me/BotFather)

## Quick Start

### 1. Clone and configure

```bash
cp .env.example .env
# Edit .env with your bot tokens and agent config
```

### 2. Start with Docker Compose

```bash
# Start Redis + all agents
docker compose up -d

# View logs
docker compose logs -f

# Stop everything
docker compose down
```

### 3. Local development (without Docker)

```bash
# Start Redis separately
docker compose up redis -d

# Install dependencies
bun install

# Run with hot reload
bun dev
```

## MCP Client Setup

After starting the agents, connect your MCP-compatible AI client:

### Claude Code

```bash
# Add MCP server connection
claude mcp add agent-comm --transport sse http://localhost:3101/sse

# Verify
claude mcp list
```

### Gemini CLI

Add to `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "agent-comm": {
      "uri": "http://localhost:3101/sse"
    }
  }
}
```

### Cursor

1. Open Settings > MCP Servers
2. Click "Add SSE Server"
3. URL: `http://localhost:3101/sse`

## Pairing Flow

Each agent requires a dual-handshake pairing to bind a Telegram user to an MCP client:

1. Send `/start` to your agent's Telegram bot
2. Receive a 6-digit pairing code
3. Connect your MCP client to the agent's SSE endpoint
4. Call the `agent_pair` tool with the code
5. Bot confirms pairing success

After pairing, the MCP client will receive push notifications for all Telegram messages, and can reply through the `reply` tool.

## Adding a New Agent

1. Create a new Telegram bot via [@BotFather](https://t.me/BotFather)
2. Add a new service in `docker-compose.yml`:

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

3. Add `MY_NEW_AGENT_BOT_TOKEN` to your `.env`
4. Run `docker compose up -d my-new-agent`
5. Pair via Telegram `/start` + MCP `agent_pair`

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

## Available MCP Tools

Once paired, the following tools are available to MCP clients:

| Tool | Description |
|---|---|
| `agent_pair` | Verify pairing code and bind Telegram user |
| `reply` | Send a message to the paired Telegram chat |
| `publish` | Publish a message to a channel (fan-out to subscribers) |
| `subscribe` | Subscribe to a channel for push notifications |
| `unsubscribe` | Unsubscribe from a channel |
| `list_agents` | List all registered agents and their status |
| `get_history` | Retrieve message history from any stream |
| `send_direct` | Send a direct message to another agent's inbox |

## Project Structure

```
config/
  index.ts                    -- Config object from env vars

src/
  index.ts                    -- Entry point: Redis, bot, MCP, heartbeat, shutdown
  types.ts                    -- StreamMessage, AgentProfile interfaces

  services/
    redis.ts                  -- Redis client wrapper (Streams, Hash, Set)
    agent-registry.ts         -- Agent profile, heartbeat, discovery
    pairing.ts                -- Dual-handshake pairing flow

  bot/
    index.ts                  -- Grammy bot init
    middleware/
      pairing.ts              -- Auth middleware: check paired user
    commands/
      start.ts                -- /start: generate pairing code
      status.ts               -- /status: show agent info
      channels.ts             -- /channels: list subscriptions
    handlers/
      message.ts              -- Message forwarding to inbox stream

  mcp/
    index.ts                  -- MCP SSE server init
    push.ts                   -- Redis stream listener -> MCP notifications
    tools/
      agent-pair.ts           -- Verify pairing code
      reply.ts                -- Send Telegram message
      publish.ts              -- Publish to channel stream
      subscribe.ts            -- Subscribe to channel
      unsubscribe.ts          -- Unsubscribe from channel
      list-agents.ts          -- List all agents
      get-history.ts          -- Read stream history
      send-direct.ts          -- Direct message to agent

Dockerfile                    -- oven/bun:1-alpine container
docker-compose.yml            -- Redis + agent services
.env.example                  -- Environment variable template
```
