#!/usr/bin/env bun
import { $ } from "bun";
import { existsSync, mkdirSync, copyFileSync, chmodSync, accessSync, constants } from "node:fs";
import { homedir, platform } from "node:os";
import { join, delimiter } from "node:path";

const BINARY_NAME = "agent-channel";
const isWindows = platform() === "win32";
const exeSuffix = isWindows ? ".exe" : "";
const binaryFile = `${BINARY_NAME}${exeSuffix}`;
const distPath = join("dist", binaryFile);

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
    return join(base, "Programs", BINARY_NAME, "bin");
  }

  if (isWritable("/usr/local/bin")) return "/usr/local/bin";
  return join(homedir(), ".local", "bin");
}

console.log(`Building ${BINARY_NAME}...`);
await $`bun build src/channel.ts --compile --outfile ${distPath}`;

const binDir = resolveBinDir();
const target = join(binDir, binaryFile);

console.log(`Installing to ${target}...`);
mkdirSync(binDir, { recursive: true });
copyFileSync(distPath, target);
if (!isWindows) chmodSync(target, 0o755);

console.log(`Installed: ${target}`);

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
  ${BINARY_NAME}                          # Run with default config
  AGENT_ID=my-agent ${BINARY_NAME}        # Run with custom agent ID

Claude Code MCP setup:
  claude mcp add ${BINARY_NAME} -e AGENT_ID=frontend-agent -e REDIS_URI=redis://localhost:6379 -- ${BINARY_NAME}
  claude --channels server:${BINARY_NAME}`);
