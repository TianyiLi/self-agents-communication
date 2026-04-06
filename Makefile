PREFIX ?= /usr/local
BINARY_NAME = agent-channel

PLATFORMS = linux-x64 linux-arm64 darwin-x64 darwin-arm64 windows-x64

.PHONY: build build-all $(addprefix build-,$(PLATFORMS)) install uninstall mcp-setup mcp-remove docker-up docker-down test clean

# === Build ===

build:
	@mkdir -p dist
	bun build src/channel.ts --compile --outfile dist/$(BINARY_NAME)
	@echo "Built: dist/$(BINARY_NAME)"

build-all: $(addprefix build-,$(PLATFORMS))
	@echo "Built all platforms in dist/"

define BUILD_PLATFORM
build-$(1):
	@mkdir -p dist
	bun build src/channel.ts --compile --target=bun-$(1) --outfile dist/$(BINARY_NAME)-$(1)$(if $(findstring windows,$(1)),.exe)
	@echo "Built: dist/$(BINARY_NAME)-$(1)$(if $(findstring windows,$(1)),.exe)"
endef

$(foreach p,$(PLATFORMS),$(eval $(call BUILD_PLATFORM,$(p))))

# === Install / Uninstall ===

install: build
	@bash scripts/install.sh

uninstall:
	@bash scripts/uninstall.sh

# === Claude Code MCP (delegated to binary) ===

mcp-setup: install
	$(BINARY_NAME) --mcp-setup \
		--agent-id $(or $(AGENT_ID),frontend-agent) \
		--redis-uri $(or $(REDIS_URI),redis://localhost:6379) \
		$(if $(SSE_URL),--sse-url $(SSE_URL))

mcp-remove:
	$(BINARY_NAME) --mcp-remove

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
