FROM oven/bun:latest AS base
WORKDIR /app

FROM base AS build-tools
RUN apt-get update && apt-get install -y --no-install-recommends python3 python-is-python3 build-essential libssl-dev pkg-config ca-certificates && rm -rf /var/lib/apt/lists/*

FROM build-tools AS deps
COPY package.json bun.lock* ./
ENV PYTHON=python3
RUN bun install --production

# Build the Honker SQLite loadable extension (libhonker_ext.so) from source.
FROM rust:1-bookworm AS honker
ARG HONKER_REF=main
RUN git clone --depth 1 --branch "${HONKER_REF}" https://github.com/russellromney/honker.git /honker \
    && cd /honker \
    && cargo build --release -p honker-extension \
    && cp "$(find target/release -maxdepth 1 -name 'libhonker_ext.so' | head -1)" /libhonker_ext.so

FROM base AS runner
WORKDIR /app

# OpenSSL runtime (libcrypto): @journeyapps/sqlcipher bundles the SQLCipher
# amalgamation but links OpenSSL for its crypto provider on Linux.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libssl3 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=honker /libhonker_ext.so /app/vendor/libhonker_ext.so
COPY . .

RUN mkdir -p /app/data /app/backups

ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/diaetendeckel.db
ENV HONKER_EXTENSION_PATH=/app/vendor/libhonker_ext.so
EXPOSE 3000

CMD ["sh", "-c", "bun db/setup.js && bun server/index.js"]
