# Multi-agent in a Telegram group

How to set up a group chat where multiple AI agents live alongside you and can both answer your questions and talk to each other.

Prereq: read [setup.md](./setup.md) first — this doc assumes you already understand the single-agent flow.

## Mental model

- **One agent = one Telegram bot = one Claude Code workspace.** That mapping never bends.
- A Telegram group can host several bots. Each bot is independent: its own paired user, its own inbox stream, its own MCP session.
- Group messages are delivered by Telegram to **every bot in the group simultaneously** (provided each bot has privacy mode disabled). Every bot then independently decides whether to act.
- Routing inside a group is by `@bot_username` mention:
  - `@frontend_bot please rebuild` → only frontend-agent gets `must_reply="true"`.
  - A bare message with no `@mention` reaches every paired bot's inbox with `must_reply="false"`; each agent decides whether to chime in based on its role.
- Agents can additionally talk to each other directly via the `send_direct` tool, or broadcast to the auto-subscribed `team` channel via `publish` — these don't depend on Telegram.

## Step-by-step

### 1. Define each agent in `docker-compose.yml`

`frontend-agent` and `backend-agent` already ship in the default file. Add more by copying a service block and bumping `MCP_PORT`:

```yaml
  qa-agent:
    build: .
    depends_on: { redis: { condition: service_healthy } }
    restart: unless-stopped
    volumes:
      - ./src:/app/src
      - ./config:/app/config
      - ./package.json:/app/package.json
    command: ["bun", "run", "--watch", "src/index.ts"]
    environment:
      AGENT_ID: qa-agent
      AGENT_NAME: qa-agent
      AGENT_ROLE: QA
      AGENT_DESC: Owns regression coverage and release sign-off
      AGENT_CAPS: testing,playwright,ci
      AGENT_PROJECT: /project/qa
      BOT_TOKEN: ${QA_BOT_TOKEN}
      MCP_PORT: 3103
      REDIS_URI: redis://redis:6379
    ports:
      - "3103:3103"
```

Add the matching token to `.env`:

```bash
QA_BOT_TOKEN=...
```

Then:

```bash
docker compose up -d --build
```

### 2. Create one Telegram bot per agent

For **each** agent, in [@BotFather](https://t.me/BotFather):

1. `/newbot` — create the bot, copy its token into `.env`.
2. `/setprivacy` → **Disable** — required so the bot can read group messages addressed to other members.
3. (Optional) `/setjoingroups` → **Enable** if you disabled it earlier.

### 3. Pair each agent (one-time, from your Telegram account in DMs)

For each bot, separately:

1. Open a DM with that bot, send `/start`, copy the 6-digit code.
2. Open the Claude Code workspace dedicated to that agent, paste the code — Claude calls `agent_pair` and locks in the pairing.

You now have multiple `agent:<id>:paired_user` keys in Redis, all pointing at your same Telegram user id. That's expected — one human can drive many agents.

### 4. Create the group and add all the bots

1. In Telegram, create a group (or use an existing one).
2. Add every agent's bot as a group member.
3. (Optional but recommended) Promote each bot to admin if you want it to do anything beyond reading and replying. For pure chat the default member role is enough.

### 5. Authorize the group for each agent

In the group, **as the paired user**, run for each bot you want active here:

```
/allow_here@frontend_bot
/allow_here@backend_bot
/allow_here@qa_bot
```

The `@<bot>` suffix isn't strictly required — every paired bot will process the bare `/allow_here` — but being explicit avoids confusion when several bots share a chat. Each bot replies with its own confirmation listing the chat id it just authorized.

Verify any time in DM: `/allowed` (per-bot, lists that agent's authorized chats).

### 6. Daily flow

Once everything is paired and authorized:

| You type in the group | What happens |
|---|---|
| `@backend_bot why did the migration fail?` | Only backend-agent's inbox gets `must_reply="true"`; backend Claude responds via `reply` tool. Other agents see it as `must_reply="false"` and stay quiet unless their role makes the question relevant. |
| `release is going out at 5pm — heads up` (no mention) | Every authorized agent's inbox sees this with `must_reply="false"`. Each agent decides independently whether the topic touches its role. By default they ignore unless directly addressed. |
| `@frontend_bot can you ask backend-agent to confirm the API contract?` | Frontend-agent receives `must_reply="true"`, calls `list_agents` to find backend-agent, then `send_direct` to ask. Backend's reply lands in frontend's inbox; frontend then `reply`s back to the group with the answer. |
| Cross-agent broadcast | Any agent can call `publish` to channel `team` — every other agent (auto-subscribed) sees it as `<channel source="channel:team">…</channel>`. Useful for status announcements that don't need a human in the loop. |

### 7. The `lead-agent` pattern

The default `docker-compose.yml` ships with a `lead-agent` (port 3100) whose role is precisely this kind of orchestration:

- It owns `docs/pm/` (see [docs/pm/README.md](./pm/README.md)) — every incoming Telegram request becomes (or updates) a Markdown brief there before any delegation happens.
- It uses `list_agents` + `send_direct` to fan tasks out to `frontend-agent`, `backend-agent`, etc., and records the assignments in the same PM doc.
- When sub-results come back, it integrates them, updates the doc, then `reply`s to the originating Telegram chat with a consolidated answer.

Recommended use: `@lead_bot <high-level request>` in the group; let the lead decompose and dispatch. You see one Q→A in Telegram while the lead orchestrates everything else.

### 8. Inter-agent dialogue (without humans)

Agents can hold conversations on their own using:

- **`send_direct(target_agent_id, content, quote_content?)`** — direct message to one agent. The target receives it as `<channel source="inbox" from="<agent_id>" is_bot="true">…</channel>`. The system prompt (`src/channel.ts:114`) instructs agents to keep these exchanges focused and to stop on acknowledgments — no infinite-loop pleasantries.
- **`publish(channel, content)`** — broadcast on a channel any agent can subscribe to. The `team` channel is subscribed automatically by every agent; you can create custom ones with `subscribe(channel)`.

A common pattern: you ping `frontend-agent` in the group; it gathers context, calls `send_direct` to `backend-agent` for a missing piece, awaits the reply, then `reply`s to the group. From the human's perspective it's one Q→A; under the hood two agents collaborated.

## Gotchas

| Issue | Cause / fix |
|---|---|
| One bot replies in the group, others see nothing | Privacy mode still on for the silent bots — fix via `@BotFather → /setprivacy → Disable`, then kick + re-add the bot to the group. |
| Bot sees the group but ignores everything | Allowlist non-empty and missing this group. Run `/allow_here` once. |
| `/allow_here` in group does nothing | The user running it isn't paired with that agent. Pair via DM `/start` first. |
| Agents reply on top of each other when no one is `@`-mentioned | Each agent decides independently based on its role. Tighten roles in `docker-compose.yml` (`AGENT_ROLE`, `AGENT_DESC`) so off-topic questions get filtered out. |
| Two agents end up looping on each other after `send_direct` | Already guarded by the system prompt rule "do not respond to pleasantries", plus `from=<self> ⇒ skip` filter (`src/channel.ts:255`). If it still happens, sharpen role descriptions; loops are usually a symptom of vague responsibilities. |
| Want to add a fourth agent later | Repeat steps 1–5 for the new agent (new compose service, new bot, new pairing, `/allow_here` in the group). No restart of existing agents needed. |
