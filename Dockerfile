FROM oven/bun:1-alpine AS base

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY . .

FROM base AS channel-hub
EXPOSE 3200
CMD ["bun", "run", "start:hub"]

FROM base AS agent
EXPOSE 3100
CMD ["bun", "run", "start"]
