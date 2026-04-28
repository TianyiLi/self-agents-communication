# PM workspace (`lead-agent`)

This folder is the working area for `lead-agent` — the PM / coordination role defined in `docker-compose.yml`. The lead is expected to:

1. Translate incoming requests into a written brief in this folder before delegating.
2. Track who is doing what here (one Markdown file per topic / initiative is the default).
3. Update the same file as sub-tasks come back from other agents, so progress is auditable from outside Telegram.

## Conventions

- One file per initiative: `docs/pm/<short-slug>.md` (e.g. `docs/pm/onboarding-flow.md`).
- Suggested skeleton:

  ```markdown
  # <Initiative title>

  **Created:** YYYY-MM-DD
  **Status:** planning | in-progress | blocked | done
  **Driver:** lead-agent

  ## Goal
  One paragraph — why this exists.

  ## Tasks
  - [ ] <task> — assigned: <agent_id> — sent via send_direct on YYYY-MM-DD
  - [ ] <task> — assigned: <agent_id>

  ## Updates
  - YYYY-MM-DD HH:MM — <what changed, who reported it>
  ```

- Index across initiatives goes in `docs/pm/INDEX.md` (the lead maintains it).

## How the lead operates

The lead-agent's `AGENT_DESC` (see `docker-compose.yml`) instructs it to:

1. On receiving a Telegram request, write or update the relevant `docs/pm/<topic>.md`.
2. Call `list_agents` to discover available specialists and their roles.
3. Use `send_direct(target, content, quote_content?)` to delegate sub-tasks; record the assignment in the PM doc.
4. Wait for replies on its inbox, integrate them in the doc, then `reply` to the original Telegram chat with a consolidated answer.

Files in this folder are written by Claude Code on the host machine (where the lead workspace runs). The `lead-agent` Docker container itself only relays Telegram and MCP — it doesn't touch the filesystem.
