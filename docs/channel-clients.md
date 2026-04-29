# Channel Clients

This project has two local stdio channel servers:

| Binary / entrypoint | Best for | Delivery model |
|---|---|---|
| `agent-channel` / `src/channel.ts` | Claude Code | Pushes Claude-specific `notifications/claude/channel` messages that render as `<channel>` tags |
| `agent-channel-generic` / `src/channel-generic.ts` | Codex, Cursor, Gemini, other MCP clients | Exposes tools the agent calls explicitly: `poll_channel_messages`, `channel_status` |

Both channel servers read Redis Streams directly, so they need `AGENT_ID` and `REDIS_URI`.
They do not replace `agent-comm`: the channel server receives work, while `agent-comm` provides action tools such as `reply`, `publish`, `send_direct`, `subscribe`, and `get_history`.

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
  -e REDIS_URI=redis://localhost:6379 \
  -- bun /absolute/path/to/src/channel.ts

claude --channels server:agent-channel
```

When a Telegram or inter-agent message arrives, Claude receives a `<channel>` tag and can respond with the `agent-comm` tools.

## Codex CLI

Codex does not use Claude's `notifications/claude/channel` extension. Use the generic polling server instead.

Add the generic channel server:

```bash
codex mcp add agent-channel-generic \
  --env AGENT_ID=frontend-agent \
  --env REDIS_URI=redis://localhost:6379 \
  -- bun /absolute/path/to/src/channel-generic.ts
```

Or, if you installed the binaries:

```bash
codex mcp add agent-channel-generic \
  --env AGENT_ID=frontend-agent \
  --env REDIS_URI=redis://localhost:6379 \
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
        "REDIS_URI": "redis://localhost:6379"
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

`channel_status` returns the current agent ID, Redis URI, inbox stream, and subscribed channels.

## Limitations

- `agent-channel-generic` is polling, not push. The model must call `poll_channel_messages`.
- `poll_channel_messages` acknowledges messages after reading them. Do not run multiple generic channel readers for the same `AGENT_ID` unless you intentionally want competing consumers.
- The channel server receives messages only. Use `agent-comm` tools to respond.
