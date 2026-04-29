#!/usr/bin/env bun
import { $ } from "bun";
import { existsSync, mkdirSync, copyFileSync, chmodSync, accessSync, constants } from "node:fs";
import { homedir, platform } from "node:os";
import { join, delimiter } from "node:path";

const BINARY_NAMES = ["agent-channel", "agent-channel-generic"];
const isWindows = platform() === "win32";
const exeSuffix = isWindows ? ".exe" : "";

function isWritable(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveBinDir(): string {
  if (process.env.PREFIX) return join(process.env.PREFIX, "bin");

  if (isWindows) {
    const base = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(base, "Programs", "agent-channel", "bin");
  }

  if (isWritable("/usr/local/bin")) return "/usr/local/bin";
  return join(homedir(), ".local", "bin");
}

const binDir = resolveBinDir();
mkdirSync(binDir, { recursive: true });

for (const binaryName of BINARY_NAMES) {
  const binaryFile = `${binaryName}${exeSuffix}`;
  const source = binaryName === "agent-channel"
    ? "src/channel.ts"
    : "src/channel-generic.ts";
  const distPath = join("dist", binaryFile);
  const target = join(binDir, binaryFile);

  console.log(`Building ${binaryName}...`);
  await $`bun build ${source} --compile --outfile ${distPath}`;

  console.log(`Installing to ${target}...`);
  copyFileSync(distPath, target);
  if (!isWindows) chmodSync(target, 0o755);
  console.log(`Installed: ${target}`);
}

const pathEntries = (process.env.PATH ?? "").split(delimiter);
if (!pathEntries.includes(binDir)) {
  console.log(`\nWarning: ${binDir} is not on your PATH.`);
  if (isWindows) {
    console.log(`  Add it via PowerShell:`);
    console.log(`    [Environment]::SetEnvironmentVariable("Path", "$env:Path;${binDir}", "User")`);
  } else {
    console.log(`  Add this to your shell profile:`);
    console.log(`    export PATH="${binDir}:$PATH"`);
  }
}

console.log(`
Usage:
  agent-channel                          # Claude Code channel push
  agent-channel-generic                  # Portable MCP polling for Codex/Cursor
  AGENT_ID=my-agent agent-channel        # Run with custom agent ID

Claude Code MCP setup:
  claude mcp add agent-channel -e AGENT_ID=frontend-agent -e REDIS_URI=redis://localhost:6379 -- agent-channel
  claude --channels server:agent-channel

Codex/Cursor MCP setup:
  Add agent-channel-generic as a stdio MCP server with AGENT_ID and REDIS_URI env vars.
  Also add the agent-comm SSE server for reply/publish/send_direct tools.`);
