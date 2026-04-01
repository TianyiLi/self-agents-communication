#!/bin/bash
set -e

PREFIX="${PREFIX:-/usr/local}"
BIN_DIR="${PREFIX}/bin"
BINARY_NAME="agent-channel"

echo "Building ${BINARY_NAME}..."
bun build src/channel.ts --compile --outfile "dist/${BINARY_NAME}"

echo "Installing to ${BIN_DIR}/${BINARY_NAME}..."
mkdir -p "${BIN_DIR}"
cp "dist/${BINARY_NAME}" "${BIN_DIR}/${BINARY_NAME}"
chmod +x "${BIN_DIR}/${BINARY_NAME}"

echo "Installed: $(which ${BINARY_NAME})"
echo ""
echo "Usage:"
echo "  agent-channel                          # Run with default config"
echo "  AGENT_ID=my-agent agent-channel        # Run with custom agent ID"
echo ""
echo "Claude Code MCP setup:"
echo "  claude mcp add agent-channel -e AGENT_ID=frontend-agent -e REDIS_URI=redis://localhost:6379 -- agent-channel"
echo "  claude --channels server:agent-channel"
