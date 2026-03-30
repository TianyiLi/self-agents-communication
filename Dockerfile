FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY . .

EXPOSE ${MCP_PORT:-3100}

CMD ["bun", "run", "src/index.ts"]
