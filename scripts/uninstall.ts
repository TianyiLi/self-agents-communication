#!/usr/bin/env bun
import { existsSync, unlinkSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const BINARY_NAMES = ["agent-channel", "agent-channel-generic"];
const isWindows = platform() === "win32";

function candidates(): string[] {
  if (process.env.PREFIX) return [join(process.env.PREFIX, "bin")];

  if (isWindows) {
    const base = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return [join(base, "Programs", "agent-channel", "bin")];
  }

  return ["/usr/local/bin", join(homedir(), ".local", "bin")];
}

let removed = 0;
for (const dir of candidates()) {
  for (const binaryName of BINARY_NAMES) {
    const target = join(dir, `${binaryName}${isWindows ? ".exe" : ""}`);
    if (existsSync(target)) {
      console.log(`Removing ${target}...`);
      unlinkSync(target);
      removed++;
    }
  }
}

if (removed === 0) {
  console.log(`agent channel binaries not found in: ${candidates().join(", ")}`);
} else {
  console.log("Uninstalled.");
}

console.log(`
To also remove MCP config:
  claude mcp remove agent-channel`);
