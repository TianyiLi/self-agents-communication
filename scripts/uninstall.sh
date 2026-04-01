#!/bin/bash
set -e

PREFIX="${PREFIX:-/usr/local}"
BIN_DIR="${PREFIX}/bin"
BINARY_NAME="agent-channel"

if [ -f "${BIN_DIR}/${BINARY_NAME}" ]; then
  echo "Removing ${BIN_DIR}/${BINARY_NAME}..."
  rm "${BIN_DIR}/${BINARY_NAME}"
  echo "Uninstalled."
else
  echo "${BINARY_NAME} not found in ${BIN_DIR}."
fi

# Remove Claude Code MCP config if exists
echo ""
echo "To also remove MCP config:"
echo "  claude mcp remove agent-channel"
