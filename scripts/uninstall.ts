#!/usr/bin/env bun
import { existsSync, unlinkSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const BINARY_NAME = "agent-channel";
const isWindows = platform() === "win32";
const binaryFile = `${BINARY_NAME}${isWindows ? ".exe" : ""}`;

function candidates(): string[] {
  if (process.env.PREFIX) return [join(process.env.PREFIX, "bin")];

  if (isWindows) {
    const base = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return [join(base, "Programs", BINARY_NAME, "bin")];
  }

  return ["/usr/local/bin", join(homedir(), ".local", "bin")];
}

let removed = 0;
for (const dir of candidates()) {
  const target = join(dir, binaryFile);
  if (existsSync(target)) {
    console.log(`Removing ${target}...`);
    unlinkSync(target);
    removed++;
  }
}

if (removed === 0) {
  console.log(`${BINARY_NAME} not found in: ${candidates().join(", ")}`);
} else {
  console.log("Uninstalled.");
}

console.log(`
To also remove MCP config:
  claude mcp remove ${BINARY_NAME}`);
