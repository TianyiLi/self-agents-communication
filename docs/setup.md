# Setup — single agent, end to end

Walks through bringing up one agent (`frontend-agent`) from a fresh clone all the way to a working Telegram ⇄ Claude Code round-trip.

For multiple agents collaborating in one Telegram group, see [multi-agent-group.md](./multi-agent-group.md).

## 0. Prerequisites

- Docker + Docker Compose
- [Bun](https://bun.sh)
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
  - After creating the bot, run `/setprivacy` → **Disable** so the bot can read group messages (important for multi-agent group flows)

## 1. Clone & configure

```bash
git clone <this-repo> && cd self-agents-communication
cp .env.example .env
```

Edit `.env`:

```bash
FRONTEND_BOT_TOKEN=123456:ABC-...
BACKEND_BOT_TOKEN=789012:GHI-...   # delete if not using a second agent
ALLOWED_CHAT_IDS=                  # leave empty — manage with /allow_here at runtime
```

## 2. Start Docker services (Redis + agents)

```bash
docker compose up -d
docker compose logs -f frontend-agent
```

Look for:

```
Telegram bot ready: @your_bot
MCP server listening on port 3101
Bot polling started
```

## 3. Install the channel binaries locally

```bash
bun run install:bin
```

The binaries land in `~/.local/bin/` (or `/usr/local/bin/` if writable, or `%LOCALAPPDATA%\Programs\agent-channel\bin` on Windows). The script tells you to extend `$PATH` if needed.

Verify:

```bash
agent-channel --help
agent-channel-generic --help
```

## 4. Register the two MCP servers in Claude Code

```bash
agent-channel --mcp-setup \
  --agent-id frontend-agent \
  --redis-uri redis://localhost:6379 \
  --sse-url http://localhost:3101/sse
```

This registers both MCP servers in one shot:

| Server name | Transport | Purpose |
|---|---|---|
| `agent-comm` | SSE → `http://localhost:3101/sse` | Tools: `reply`, `publish`, `subscribe`, `send_direct`, … |
| `agent-channel` | stdio → spawns the binary with `AGENT_ID` + `REDIS_URI` | Push notifications (`<channel>` tags) |

Verify:

```bash
claude mcp list
```

## 5. Launch Claude Code with channel push enabled

```bash
claude --channels server:agent-channel
```

The MCP server's `instructions` (set in `src/mcp/index.ts`) are surfaced into Claude's system prompt, so the AI is aware of the pairing protocol on connection.

## 5b. Alternative: Codex with generic channel polling

Codex agents should use `agent-channel-generic`, because Claude's `<channel>` push notification is a Claude Code extension.

```bash
codex mcp add agent-channel-generic \
  --env AGENT_ID=frontend-agent \
  --env REDIS_URI=redis://localhost:6379 \
  -- agent-channel-generic
```

If your Codex build can connect to the agent MCP URL, also add the action tools server:

```bash
codex mcp add agent-comm --url http://localhost:3101/sse
```

Then tell the Codex agent to call `poll_channel_messages` when idle. Messages with `meta.must_reply="true"` should be answered with `reply`, `publish`, or `send_direct` from `agent-comm`.

More detail: [Channel Clients](./channel-clients.md).

## 6. Pair the Telegram user with the agent

**On Telegram**, find the bot and DM:

```
/start
```

The bot replies with a 6-digit code, valid for 2 minutes:

```
Pairing code: 482901

Go back to your AI assistant (Claude Code, Cursor, etc.) and paste this
code into the chat. It will claim this Telegram session automatically —
you don't need to type any special command.

⏱ Expires in 2 minutes.
```

**On Claude Code**, just paste the digits into the chat:

```
482901
```

Claude will call `agent_pair("482901")` itself. On success it returns `status: "paired"` and the pairing is persisted in Redis.

After restart, Claude reclaims the session with `agent_pair("")` automatically — no need to `/start` again.

## 7. (Optional) Authorize groups

The group allowlist is empty by default, which preserves the legacy "allow all" behaviour. To scope which groups the agent listens to, the **paired user** runs in each group:

```
/allow_here          # add this group to the agent's allowlist
/disallow_here       # remove it
/allowed             # (DM only) list authorized groups
```

The list lives in Redis Set `agent:<id>:allowed_chats` and survives restarts.

## 8. Smoke test

DM the bot:

```
@frontend_xxx_bot hello
```

Claude Code should receive:

```xml
<channel source="inbox" from="user" must_reply="true" chat_id="...">hello</channel>
```

Claude calls the `reply` tool to send a response back to Telegram — if it appears, the full loop works.

## Restart / rebuild / cleanup

```bash
# After code changes (rebuild image + binary)
docker compose up -d --build --force-recreate && bun run install:bin

# Stop containers, keep pairing state
docker compose down

# Wipe everything including Redis volume — pairing must be redone
docker compose down -v

# Remove MCP registration and the binary
agent-channel --mcp-remove
bun run uninstall:bin
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `agent-channel: command not found` | Add the install dir to `$PATH` (the install script prints the line to add) |
| Bot silent in groups | Run `/allow_here` in the group as the paired user |
| `Invalid or expired pairing code` | Code expired (120 s) or 5 wrong attempts hit — `/start` again |
| `Session already claimed` | Two clients connected to the same agent. Run `agent_pair("")` to take over, or close the old client |
| Claude doesn't know to call `agent_pair` | Old container — rebuild so server `instructions` are loaded (commit `f6ca5ce` or later) |
| Want to repair to a different Telegram account | `docker exec <redis-container> redis-cli del agent:<id>:paired_user`, then `/start` from the new account |
