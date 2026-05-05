import { execSync } from "node:child_process";
import { channelHelpText, parseChannelCli } from "./channel/cli";
import { startChannelServer } from "./channel/server";
import { startLauncher } from "./channel/launcher";

const mode = parseChannelCli(process.argv.slice(2));

if (mode.kind === "help") {
  console.log(channelHelpText());
  process.exit(0);
}

if (mode.kind === "mcp-setup") {
  const bin = process.execPath;

  if (mode.sseUrl) {
    console.log(`Adding agent-comm (SSE tools) -> ${mode.sseUrl}`);
    try {
      execSync(`claude mcp add agent-comm --transport sse ${mode.sseUrl}`, { stdio: "inherit" });
    } catch {
      console.error("Failed to add agent-comm. Is Claude Code installed?");
    }
    console.log("");
  }

  console.log(`Adding agent-channel (stdio push) -> ${bin}`);
  console.log(`  AGENT_ID=${mode.agentId}`);
  console.log(`  REDIS_URI=${mode.redisUri}`);
  try {
    execSync(
      `claude mcp add agent-channel -e AGENT_ID=${mode.agentId} -e REDIS_URI=${mode.redisUri} -- ${bin}`,
      { stdio: "inherit" }
    );
  } catch {
    console.error("Failed to add agent-channel. Is Claude Code installed?");
    process.exit(1);
  }

  console.log("");
  console.log("Done. Start Claude Code with:");
  console.log("  claude --channels server:agent-channel");
  process.exit(0);
}

if (mode.kind === "mcp-remove") {
  console.log("Removing MCP servers...");
  try { execSync("claude mcp remove agent-comm", { stdio: "inherit" }); } catch {}
  try { execSync("claude mcp remove agent-channel", { stdio: "inherit" }); } catch {}
  console.log("Done.");
  process.exit(0);
}

const start = mode.kind === "launcher"
  ? () => startLauncher(mode.driver, mode.config)
  : () => startChannelServer();

start().catch((err) => {
  process.stderr.write(`agent-channel fatal: ${err}\n`);
  process.exit(1);
});

