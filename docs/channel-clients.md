# Channel Clients

For implementation details behind the launcher modes, see
[Agent Channel Session Drivers Plan](./session-drivers-plan.md).

This project has a central channel hub service, two local stdio channel clients, and optional launcher modes:

| Binary / entrypoint | Best for | Delivery model |
|---|---|---|
| `channel-hub` / `src/channel-hub.ts` | Shared Docker infrastructure | Central HTTP hub. It is the only channel process that reads Redis Streams when clients set `CHANNEL_HUB_URL` |
| `agent-channel` / `src/channel.ts` | Claude Code | Pushes Claude-specific `notifications/claude/channel` messages that render as `<channel>` tags |
| `agent-channel --claude` | Claude Code | Starts Claude Code with channels enabled and tracks controller presence |
| `agent-channel --codex` | Codex | Starts `codex app-server`, creates/resumes a thread, and injects channel batches into turns |
| `agent-channel-generic` / `src/channel-generic.ts` | Codex, Cursor, Gemini, other MCP clients | Exposes tools the agent calls explicitly: `poll_channel_messages`, `channel_status` |

Prefer running the central hub and giving channel clients `CHANNEL_HUB_URL`. In that mode, channel clients do not connect to Redis or own Redis consumer groups. If `CHANNEL_HUB_URL` is not set, the clients keep the old direct Redis mode for local development and migration.
They do not replace `agent-comm`: the channel server receives work, while `agent-comm` provides action tools such as `reply`, `publish`, `send_direct`, `subscribe`, and `get_history`.

## Central Channel Hub

Start the hub as a Docker service:

```bash
docker compose up -d channel-hub
```

or during development:

```bash
REDIS_URI=redis://localhost:6379 CHANNEL_HUB_PORT=3200 bun run start:hub
```

Then point channel clients at it:

```bash
export CHANNEL_HUB_URL=http://localhost:3200
```

The hub exposes:

| Endpoint | Purpose |
|---|---|
| `GET /health` | Basic health and active reader count |
| `GET /agents/:agentId/messages?block_ms=5000&count=10` | Long-poll one agent's inbox/channel streams |
| `GET /agents/:agentId/events` | SSE stream of channel message batches |

## Build Or Install

From the repo root:

```bash
bun run build
```

This creates:

```text
dist/agent-channel
dist/agent-channel-generic
```

To install both binaries on your PATH:

```bash
bun run install:bin
```

During development you can also run the TypeScript entrypoints directly with `bun`.

## Claude Code

Claude Code supports the custom channel notification extension, so use `agent-channel`.

```bash
claude mcp add agent-comm --transport sse http://localhost:3101/sse

claude mcp add agent-channel \
  -e AGENT_ID=frontend-agent \
  -e CHANNEL_HUB_URL=http://localhost:3200 \
  -- bun /absolute/path/to/src/channel.ts

claude --channels server:agent-channel
```

When a Telegram or inter-agent message arrives, Claude receives a `<channel>` tag and can respond with the `agent-comm` tools.

### Claude Launcher

After registering `agent-comm` and `agent-channel`, you can let the local binary start Claude Code and refresh controller presence while Claude is alive:

```bash
agent-channel --claude \
  --agent-id frontend-agent \
  --channel-hub-url http://localhost:3200 \
  --sse-url http://localhost:3101/sse \
  --cwd /absolute/path/to/project \
  --restart
```

This mode is lifecycle-only. Claude still receives messages through the existing Claude Channels MCP server; `ClaudeDriver.send()` does not consume channel messages itself.

## Codex CLI

Codex does not use Claude's `notifications/claude/channel` extension. Prefer the Codex launcher for always-on operation, or use the generic polling server for an explicit MCP tool polling loop.

### Codex Launcher

```bash
agent-channel --codex \
  --agent-id frontend-agent \
  --channel-hub-url http://localhost:3200 \
  --cwd /absolute/path/to/project \
  --restart
```

The launcher:

1. Starts `codex app-server --listen stdio://`.
2. Creates a new Codex thread or resumes the thread id stored at `agent:<id>:codex_thread`.
3. Reads Telegram/channel batches from the central channel hub.
4. Injects each batch into a Codex turn.
5. Uses `turn/steer` for mandatory messages that arrive while a turn is active.

The launcher does not scrape assistant text and send Telegram replies by itself. The Codex agent should call `agent-comm` tools (`reply`, `publish`, `send_direct`) during the turn.

Useful options:

```bash
agent-channel --codex \
  --agent-id frontend-agent \
  --channel-hub-url http://localhost:3200 \
  --cwd /absolute/path/to/project \
  --model gpt-5.4 \
  --approval-policy never \
  --restart
```

Use `--approval-policy never` only in trusted local workspaces.

### Codex Generic Polling

Add the generic channel server:

```bash
codex mcp add agent-channel-generic \
  --env AGENT_ID=frontend-agent \
  --env CHANNEL_HUB_URL=http://localhost:3200 \
  -- bun /absolute/path/to/src/channel-generic.ts
```

Or, if you installed the binaries:

```bash
codex mcp add agent-channel-generic \
  --env AGENT_ID=frontend-agent \
  --env CHANNEL_HUB_URL=http://localhost:3200 \
  -- agent-channel-generic
```

Add the action tools server if your Codex build can connect to the agent MCP URL:

```bash
codex mcp add agent-comm --url http://localhost:3101/sse
```

Check the registered servers:

```bash
codex mcp list
```

In a Codex session, the expected loop is:

1. Call `agent_pair("")` on `agent-comm` to reclaim an existing pairing, or pair with the 6-digit Telegram code.
2. Call `poll_channel_messages` on `agent-channel-generic` when idle or when asked to check the channel.
3. For each returned message:
   - If `meta.must_reply` is `"true"`, respond with `reply`, `publish`, or `send_direct`.
   - If `meta.must_reply` is `"false"`, respond only when the message is relevant to the agent role.
   - Use `meta.chat_id` and `meta.message_id` when replying to Telegram.
4. Call `poll_channel_messages` again after finishing the response.

Useful prompt for a Codex agent:

```text
Use the agent-channel-generic MCP server as your inbox. When idle, call
poll_channel_messages. If a message has meta.must_reply="true", respond with
the agent-comm tools. Use reply for Telegram messages, publish for team
broadcasts, and send_direct for a specific agent.
```

## Cursor And Other MCP Clients

For clients without Claude Channels, configure two MCP servers:

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
        "CHANNEL_HUB_URL": "http://localhost:3200"
      }
    }
  }
}
```

Then instruct the agent to call `poll_channel_messages` when it should wait for work.

## Generic Channel Tool Output

`poll_channel_messages` returns JSON like:

```json
{
  "agent_id": "frontend-agent",
  "messages": [
    {
      "id": "1777450000000-0",
      "source": "inbox",
      "stream": "stream:agent:frontend-agent:inbox",
      "content": "@frontend_bot run the build",
      "meta": {
        "source": "inbox",
        "stream": "stream:agent:frontend-agent:inbox",
        "from": "user",
        "from_name": "Paul",
        "type": "text",
        "must_reply": "true",
        "chat_id": "963665490",
        "message_id": "123",
        "is_bot": "false",
        "media_paths": ""
      }
    }
  ],
  "count": 1
}
```

`channel_status` returns the current agent ID, delivery mode, hub URL when configured, and inbox stream.

## Limitations

- `agent-channel-generic` is polling, not push. The model must call `poll_channel_messages`.
- `poll_channel_messages` acknowledges messages after reading them. With `CHANNEL_HUB_URL`, the central hub owns that acknowledgement. Without it, direct Redis mode still uses per-client consumer groups.
- The channel server receives messages only. Use `agent-comm` tools to respond.
