PREFIX ?= /usr/local
BINARY_NAME = agent-channel

.PHONY: build install uninstall mcp-setup mcp-remove docker-up docker-down test clean

# === Build ===

build:
	@mkdir -p dist
	bun build src/channel.ts --compile --outfile dist/$(BINARY_NAME)
	@echo "Built: dist/$(BINARY_NAME)"

# === Install / Uninstall ===

install: build
	@bash scripts/install.sh

uninstall:
	@bash scripts/uninstall.sh

# === Claude Code MCP ===

mcp-setup:
	@echo "Adding agent-comm (SSE tools)..."
	claude mcp add agent-comm --transport sse http://localhost:3101/sse || true
	@echo ""
	@echo "Adding agent-channel (stdio push)..."
	claude mcp add agent-channel \
		-e AGENT_ID=$(or $(AGENT_ID),frontend-agent) \
		-e REDIS_URI=$(or $(REDIS_URI),redis://localhost:6379) \
		-- $(BINARY_NAME)
	@echo ""
	@echo "Done. Start Claude Code with:"
	@echo "  claude --channels server:agent-channel"

mcp-remove:
	claude mcp remove agent-comm || true
	claude mcp remove agent-channel || true
	@echo "MCP servers removed."

# === Docker ===

docker-up:
	docker compose up -d

docker-down:
	docker compose down

docker-rebuild:
	docker compose up -d --build --force-recreate

docker-logs:
	docker compose logs -f

# === Dev ===

dev:
	bun --watch src/index.ts

test:
	bun test

typecheck:
	bunx tsc --noEmit

# === Clean ===

clean:
	rm -rf dist
