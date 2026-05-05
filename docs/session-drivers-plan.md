# Agent Channel Session Drivers Plan

This is the implementation checkpoint for turning `agent-channel` from a
passive stdio MCP channel server into an optional runtime launcher that can
own Claude Code / Codex session lifecycle.

## Current Baseline

As of `main` commit `564beb0`:

- Focus mode and Telegram `/force` are implemented.
- Controller online/offline presence is tied to active MCP sessions, not only
  the Docker/bot process.
- Claude channel notifications are batched so reconnect backlog can be
  delivered as one channel event.
- `agent-comm` Telegram tools include:
  - `reply` with text, MarkdownV2, chunking, and file attachments
  - `react`
  - `edit_message`
  - `read_media`
  - existing inter-agent tools such as `publish`, `send_direct`, `subscribe`,
    `get_history`, and `focus_mode`

The remaining pain point is session management: Claude/Codex sessions still
need to be manually started or resumed before channel messages can be handled.

## Desired End State

Keep existing behavior intact:

```bash
agent-channel
```

still starts the current stdio MCP channel server that Claude Code can spawn
through `--channels`.

Add launcher modes:

```bash
agent-channel --claude
agent-channel --codex
```

Launcher modes should manage child process lifecycle, presence, restart, and
backlog delivery.

Non-goals for the first implementation:

- Do not replace the Docker agent process, Telegram bot, Redis Streams, or the
  SSE `agent-comm` tools server.
- Do not make `agent-channel-generic` push-capable. It remains the portable
  polling fallback for MCP clients without a launcher driver.
- Do not build a Cursor/ACP integration until Claude and Codex launcher modes
  are stable.
- Do not introduce a second channel consumer group. Launcher modes should use
  the same reader semantics as the existing channel servers.

## CLI Contract

`src/channel.ts` remains the binary entrypoint, but the top-level CLI branches
before constructing the stdio MCP server:

```text
agent-channel [default stdio MCP mode]
agent-channel --mcp-setup [existing Claude MCP setup]
agent-channel --mcp-remove [existing Claude MCP removal]
agent-channel --claude [launcher mode]
agent-channel --codex [launcher mode]
```

Shared launcher options:

| Option | Default | Notes |
|---|---|---|
| `--agent-id` | `AGENT_ID` or `default-agent` | Used for Redis state and channel reader identity. |
| `--redis-uri` | `REDIS_URI` or `redis://localhost:6379` | Used by `ChannelStreamReader` and launcher state. |
| `--cwd` | current process cwd | Child session working directory. |
| `--restart` | false | Restart child after unexpected exit. |
| `--restart-delay-ms` | `2000` | Backoff floor for restart loops. |
| `--max-restarts` | unlimited with `--restart` | Optional safety cap for local debugging. |
| `--once` | false | Process currently available backlog/one turn, then exit. Useful for tests. |
| `--log-json` | false | Emit machine-readable launcher events to stderr. |

Claude-only options:

| Option | Default | Notes |
|---|---|---|
| `--sse-url` | unset | Passed through to existing `--mcp-setup` behavior when setup is requested by the launcher. |
| `--skip-mcp-setup` | false | Skip Claude MCP config setup and just spawn Claude. |

Codex-only options:

| Option | Default | Notes |
|---|---|---|
| `--model` | Codex config default | Forwarded to `thread/start` or `thread/resume` when provided. |
| `--approval-policy` | Codex config default | Forwarded to Codex; recommended local unattended value is `never` only in trusted sandboxes. |
| `--sandbox` | Codex config default | Forwarded to Codex thread creation/resume. |

## SessionDriver Interface

Use a small driver abstraction so Claude, Codex, and future Cursor support can
share the same channel reader and lifecycle loop.

```ts
interface SessionDriver {
  start(): Promise<void>;
  send(messages: ChannelMessage[]): Promise<void>;
  interrupt(): Promise<void>;
  status(): Promise<DriverStatus>;
  stop(): Promise<void>;
}
```

Suggested supporting types:

```ts
type DriverKind = "claude" | "codex" | "cursor";

interface DriverStatus {
  kind: DriverKind;
  state: "starting" | "ready" | "turn_active" | "stopping" | "stopped" | "failed";
  pid?: number;
  threadId?: string;
  lastError?: string;
}

interface LauncherConfig {
  agentId: string;
  redisUri: string;
  cwd: string;
  restart: boolean;
  restartDelayMs: number;
  maxRestarts?: number;
  once: boolean;
}
```

`send()` receives an already-read batch from `ChannelStreamReader`. Drivers must
not read Redis directly.

## Launcher Loop

The launcher is responsible for orchestration around a driver:

1. Parse CLI flags and load runtime config from flags/env.
2. Create one `ChannelStreamReader` with `mediaDirPrefix: "agent-channel-media"`.
3. Start the selected driver.
4. Mark controller presence online only when the driver is ready to receive
   work.
5. Read channel batches with the same batching limits used by current Claude
   push mode: first blocking read, then short drain reads up to a bounded max.
6. Pass each batch to `driver.send(messages)`.
7. Keep `agent:{id}:controller_alive` refreshed while the driver is healthy.
8. On driver failure:
   - mark controller offline with the failure reason;
   - restart only when `--restart` is set and the restart budget is not
     exhausted;
   - otherwise stop the reader and exit non-zero.
9. On `SIGINT`/`SIGTERM`, stop the driver, mark controller offline, disconnect
   Redis, and exit.

Presence can reuse `AgentRegistry` methods if the launcher can construct an
`AgentProfile` from Redis. If that is awkward, add a small presence helper in
`src/channel/launcher-presence.ts` that writes the same keys/events:

```text
agent:{id}:controller_alive
idx:agents:online
stream:system:introductions
```

The launcher must not touch `agent:{id}:alive`; that key belongs to the Docker
agent process heartbeat.

## Claude Driver

First version can be launcher-only. Do not replace Claude Channels protocol.

Responsibilities:

- Ensure MCP config exists using the existing `--mcp-setup` behavior.
- Spawn:

```bash
claude --channels server:agent-channel
```

- Support `--cwd`.
- Support `--restart`.
- Mark presence online/offline based on child lifecycle.
- Preserve the current channel MCP server implementation.

Runtime model:

- `ClaudeDriver.start()` optionally runs the same setup flow as
  `agent-channel --mcp-setup`, then spawns `claude --channels server:agent-channel`
  in the configured cwd.
- `ClaudeDriver.send()` is a no-op because the Claude child receives messages
  through the existing `agent-channel` stdio MCP server configured in Claude.
- `ClaudeDriver.status()` reports healthy while the child process is running.
- `ClaudeDriver.interrupt()` sends `SIGINT` to the child first, then escalates
  to `SIGTERM` from `stop()` if needed.

This mode mainly solves lifecycle and restart. It does not solve all unattended
operation concerns because the Claude Code UI/session still owns turn handling.

Target CLI:

```bash
agent-channel --claude \
  --agent-id frontend-agent \
  --redis-uri redis://localhost:6379 \
  --sse-url http://localhost:3101/sse \
  --cwd /path/to/project \
  --restart
```

## Codex Driver

Prefer a real driver using Codex app-server, not terminal injection.

Use:

```bash
codex app-server --listen stdio://
```

Codex app-server exposes a JSON-RPC protocol used by rich clients. The local
CLI can generate matching TypeScript types:

```bash
codex app-server generate-ts --out /tmp/codex-app-schema
```

The local CLI generated on 2026-05-06 exposes the expected v2 JSON-RPC methods
and notifications:

- requests: `initialize`, `thread/start`, `thread/resume`, `turn/start`,
  `turn/steer`, `turn/interrupt`, `mcpServer/tool/call`
- notifications: `thread/started`, `turn/started`, `turn/completed`,
  `item/agentMessage/delta`, `item/completed`, `item/mcpToolCall/progress`,
  approval and user-input related events

Core flow:

- Spawn `codex app-server --listen stdio://`.
- Send `initialize`, then the `initialized` client notification if the protocol
  requires it for the generated schema version.
- Create or resume a thread:
  - `thread/start` for first run.
  - `thread/resume` when a persisted thread id exists.
- Persist thread id per agent:

```text
agent:{id}:codex_thread
```

- Convert inbound Telegram/channel batches into one user input and call
  `turn/start`.
- If a turn is already active, evaluate whether to use `turn/steer` or queue
  until `turn/completed`.
- Support `turn/interrupt` for future `/stop` or forced interruption.
- Listen to app-server notifications:
  - `item/agentMessage/delta`
  - `turn/completed`
  - approval / user-input request notifications
  - command/tool progress notifications

Thread start/resume parameters:

- `cwd`: from `--cwd`
- `model`: from `--model` when provided
- `approvalPolicy`: from `--approval-policy` when provided
- `sandbox`: from `--sandbox` when provided
- `baseInstructions` or `developerInstructions`: include the same role,
  response rules, source semantics, and media-path instructions currently
  produced by `buildChannelInstructions(..., delivery: "polling")`, amended to
  say that messages are injected by the launcher rather than polled manually.

Message injection format:

```text
You received a batch of N agent-channel messages.

Message 1
- id: ...
- source: inbox
- from: ...
- must_reply: true
- chat_id: ...
- message_id: ...
- media_paths: ...

Content:
...
```

For multi-message batches, preserve per-message metadata. A batch with any
`must_reply=true` message should state clearly that at least one response is
mandatory.

Turn policy:

- If no turn is active, call `turn/start`.
- If a turn is active and a new batch contains `must_reply=true`, call
  `turn/steer` with a concise interruption note and the new message batch.
- If a turn is active and the batch is optional (`must_reply=false`), queue it
  locally until `turn/completed` and coalesce queued optional messages.
- If `/force` or a future stop signal is represented in stream metadata, call
  `turn/interrupt` before starting the forced turn.

Output handling:

- Accumulate `item/agentMessage/delta` text for logging and diagnostics.
- Treat `turn/completed` as the authoritative turn boundary.
- Do not scrape assistant text and send Telegram replies from the launcher.
  The Codex agent should call `agent-comm.reply`, `publish`, or `send_direct`
  through MCP tools as part of the turn. The launcher can verify after
  `turn/completed` whether mandatory input produced an observed tool call, but
  it should only warn initially.
- Surface approval, user-input, and MCP elicitation requests to stderr and leave
  the turn active. A later iteration can bridge these requests to Telegram.

Target CLI:

```bash
agent-channel --codex \
  --agent-id frontend-agent \
  --redis-uri redis://localhost:6379 \
  --cwd /path/to/project \
  --restart
```

Completion target:

`agent-channel --codex --restart` can run continuously, receive Telegram or
channel backlog, send it into a Codex app-server thread, observe the final
assistant output, and use `agent-comm` tools to reply back to Telegram without
requiring a manually opened Codex session.

## Redis State

New keys:

```text
agent:{id}:codex_thread              String: active Codex app-server thread id
agent:{id}:launcher_driver           String with TTL: claude | codex | cursor
agent:{id}:launcher_status           Hash with TTL: driver, state, pid, thread_id, updated_at, error
agent:{id}:launcher_lock             String with TTL: process-unique launcher id
```

Locking:

- Acquire `agent:{id}:launcher_lock` before starting a launcher driver.
- Use a short TTL refreshed by the launcher heartbeat.
- If the lock exists, exit with a clear error unless `--takeover` is added in a
  later implementation.
- Release the lock on graceful shutdown.

Do not store secrets in Redis. Bot tokens stay in `.env`/Docker environment.

## File Layout

Suggested files:

```text
src/channel.ts
src/channel/cli.ts
src/channel/launcher.ts
src/channel/launcher-presence.ts
src/channel/drivers/types.ts
src/channel/drivers/claude.ts
src/channel/drivers/codex-app-server.ts
src/channel/drivers/json-rpc.ts
src/channel/format.ts
```

Responsibilities:

- `src/channel.ts`: thin entrypoint. If no launcher flag is present, start the
  existing stdio MCP channel server.
- `src/channel/cli.ts`: parse flags without adding a large CLI dependency.
- `src/channel/launcher.ts`: shared read/restart/signal loop.
- `src/channel/launcher-presence.ts`: controller online/offline heartbeat
  writes, isolated from Docker process heartbeat.
- `src/channel/drivers/json-rpc.ts`: framed stdio JSON-RPC client for Codex
  app-server.
- `src/channel/format.ts`: convert `ChannelMessage[]` into injected prompt
  text and Claude channel notification payloads.

Avoid renaming `src/channel/shared.ts` in the first pass unless TypeScript
imports become confusing.

## Cursor Driver

Cursor support is lower confidence than Codex.

Public docs show `cursor-agent` supports CLI sessions, resume/list commands,
and MCP management, but public reports indicate Cursor background/ACP agent
support for MCP and dynamic session loading has been inconsistent.

Initial Cursor support should therefore be a conservative CLI wrapper:

- Spawn `cursor-agent` or resume via CLI.
- Avoid depending on ACP/session APIs until verified.
- Treat Cursor as a later driver after Claude and Codex are stable.

## Implementation Notes

- Refactor `src/channel.ts` so default no-arg behavior remains the stdio MCP
  channel server.
- Move reusable batch reader logic out of `src/channel.ts` if needed.
- Keep `src/channel-generic.ts` unchanged unless shared types need moving.
- Do not break existing Claude MCP setup.
- Keep media download behavior centralized in `ChannelStreamReader`; drivers
  should only see local `media_paths`.
- Keep Redis acknowledgements in the reader. Once the launcher has read a
  message, delivery is at-most-once, matching the existing channel behavior.
- Log every batch with message count, stream sources, max queue latency, media
  latency, driver latency, and active thread id when available.
- Prefer generated Codex app-server TypeScript types during implementation, but
  do not commit a full generated schema unless it is small enough to maintain.

## Implementation Phases

### Phase 1: Safe Refactor

- Extract existing `agent-channel` stdio MCP server startup into a function.
- Extract existing batch read and channel notification formatting helpers.
- Add tests for batch formatting and CLI mode selection.
- Confirm `agent-channel`, `--mcp-setup`, and `--mcp-remove` behavior is
  unchanged.

### Phase 2: Launcher Skeleton

- Add CLI parsing for `--claude`, `--codex`, shared launcher flags, and help
  text.
- Add launcher loop with lock, presence heartbeat, restart handling, and signal
  shutdown.
- Add a fake in-memory driver test to verify read/send/restart behavior without
  launching Claude or Codex.

### Phase 3: Claude Launcher

- Implement `ClaudeDriver` as process lifecycle wrapper.
- Reuse existing MCP setup commands.
- Validate restart and shutdown behavior manually.

### Phase 4: Codex App-Server Driver

- Implement stdio JSON-RPC request/response framing.
- Generate app-server TypeScript bindings locally during development and copy
  only the minimal stable types needed by the driver.
- Implement initialize, thread start/resume, turn start, turn steer, interrupt,
  and notification handling.
- Persist and reuse `agent:{id}:codex_thread`.
- Add integration tests around the JSON-RPC client with a fixture process or
  mocked stdio streams.

### Phase 5: Operational Hardening

- Add structured logs.
- Add launcher status Redis hash.
- Add backoff and restart-budget tests.
- Add manual docs to `docs/channel-clients.md` after the behavior is working.

## Failure Handling

- Child exits before ready: mark launcher failed, release online presence, then
  restart only if allowed.
- Redis disconnect: stop driver, mark offline if possible, reconnect through the
  top-level restart path.
- Codex thread resume fails because the thread id is stale: clear
  `agent:{id}:codex_thread`, create a new thread, and log the replacement.
- Codex turn fails: keep the thread id, mark status failed for that turn, and
  continue reading only after the driver returns to ready or restarts.
- Mandatory message finishes without an `agent-comm` response tool call: log a
  warning in v1. Later versions can re-inject a corrective prompt.

## Security And Safety

- Launcher mode can cause autonomous model work. Default approval and sandbox
  settings should come from the user/client configuration unless explicitly
  overridden by CLI flags.
- Document that `--approval-policy never` is only appropriate for trusted local
  workspaces.
- Do not forward Telegram-originated text into shell commands or process args.
  It only becomes model input through Codex/Claude.
- Do not expose bot tokens or Redis credentials in JSON logs.
- Preserve `ALLOWED_CHAT_IDS` enforcement in the Telegram bot; launcher mode is
  downstream of already-authorized stream writes.

## Validation

Required checks:

```bash
bun run typecheck
bun test
```

Manual smoke tests:

- `agent-channel` still works as a stdio MCP channel server.
- `agent-channel --claude --restart` starts Claude Code and restarts it after
  exit.
- `agent-channel --codex --restart` starts Codex app-server, creates or resumes
  a thread, sends a test message, and receives final output.
- Restarting the launcher resumes the prior Codex thread from
  `agent:{id}:codex_thread`.

Automated tests to add:

- CLI parser selects default, setup/remove, Claude launcher, and Codex launcher
  modes correctly.
- Launcher lock prevents two launcher instances for the same agent id.
- Presence heartbeat writes `controller_alive` without touching `alive`.
- Restart loop respects `--restart`, `--restart-delay-ms`, and `--max-restarts`.
- Codex driver starts a thread when no Redis thread id exists.
- Codex driver resumes when `agent:{id}:codex_thread` exists.
- Codex driver clears stale thread id and starts a new thread when resume fails.
- Active-turn policy steers mandatory messages and queues optional messages.

## Open Questions

- Should the launcher bridge Codex approval and `request_user_input` prompts to
  Telegram in v1, or is stderr/operator intervention acceptable for the first
  cut?
- Should `--once` acknowledge only messages that reached the driver, or should
  it use a separate non-acking preview mode for dry runs?
- Should `agent-channel --claude` be documented as lifecycle-only until Claude
  Code exposes a richer controllable session API?
- Should launcher status be visible through a new MCP tool or only through
  Redis/logs?
