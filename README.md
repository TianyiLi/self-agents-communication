# Grammy.js Telegram Bot Template (Bun + TypeScript)

A minimal, structured template for building Telegram bots with grammy.js on Bun, using TypeScript. Includes modular commands, actions, and conversations out of the box.

[![Fiverr](https://img.shields.io/badge/Hire%20me%20on-Fiverr-1DBF73?logo=fiverr&logoColor=white)](https://fiverr.com/aryanali945)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.uoaio.xyz)
[![GitHub](https://img.shields.io/badge/GitHub-uo1428-181717?logo=github&logoColor=white)](https://github.com/uo1428)
[![Patreon](https://img.shields.io/badge/Support-Patreon-F96854?logo=patreon&logoColor=white)](https://patreon.com/uoaio)
[![YouTube](https://img.shields.io/badge/YouTube-Subscribe-FF0000?logo=youtube&logoColor=white)](https://youtube.com/@uoaio)

---

## Features
- **TypeScript + Bun**: Fast runtime with type safety.
- **Modular structure**: Commands, Actions, Conversations.
- **Useful middlewares**: hydrate, emoji, parse-mode, sessions.
- **Ready to run**: Single `bun start` script.

---

## Quick Start
1. **Install Bun**: https://bun.sh
2. **Install deps**:
   ```bash
   bun install
   ```
3. **Configure env**: Create a `.env` in the project root
   ```env
   BOT_TOKEN=your_telegram_bot_token
   ```
4. **Run**:
   ```bash
   bun start
   ```

---

## Project Structure
```txt
.
├── config/                # Env/config management
├── src/
│  ├── Actions/            # Callback query handlers
│  ├── Commands/           # Bot commands (e.g. /start)
│  ├── Conversations/      # Multi-step flows
│  ├── Database/           # DB entry (placeholder)
│  ├── utils/              # Client loaders, helpers, types
│  └── index.ts            # App entry
├── package.json           # Scripts & deps
└── tsconfig.json          # TS config
```

---

## Credit
- Coded by: https://github.com/uo1428

<div align="center">
  <p>If this template helps, please leave a star ⭐</p>
</div>