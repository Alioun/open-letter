FROM postgres:18 AS pg

FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install --production --no-frozen-lockfile

FROM base AS runner
WORKDIR /app

COPY --from=pg /usr/lib/postgresql/18/bin/pg_dump /usr/local/bin/pg_dump
COPY --from=pg /usr/lib/postgresql/18/lib/libpq.so.5 /usr/lib/
RUN ldconfig

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["sh", "-c", "bun db/setup.js && bun server/index.js"]
