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

# Build SQLCipher from source. The Debian libsqlcipher0 package applies ELF
# symbol versioning (sqlite3_open@@SQLCIPHER_…) so Bun's dlsym("sqlite3_open")
# returns NULL and setCustomSQLite silently falls back to built-in SQLite.
# A from-source build without a version script exports plain sqlite3_* symbols
# that dlsym can resolve correctly on all architectures.
FROM debian:bookworm-slim AS sqlcipher
ARG SQLCIPHER_VERSION=4.6.1
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libssl-dev ca-certificates wget tcl \
    && wget -qO /tmp/sqlcipher.tar.gz \
        "https://github.com/sqlcipher/sqlcipher/archive/refs/tags/v${SQLCIPHER_VERSION}.tar.gz" \
    && tar -xf /tmp/sqlcipher.tar.gz -C /tmp \
    && cd "/tmp/sqlcipher-${SQLCIPHER_VERSION}" \
    && ./configure --enable-tempstore=yes --disable-tcl \
        CFLAGS="-DSQLITE_HAS_CODEC" \
        LDFLAGS="-lcrypto" \
    && make \
    && cp "$(find .libs -name 'libsqlcipher.so.0.*.*' | head -1)" /libsqlcipher.so

FROM base AS runner
WORKDIR /app

# OpenSSL runtime required by the from-source SQLCipher build.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libssl3 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=honker /libhonker_ext.so /app/vendor/libhonker_ext.so
COPY --from=sqlcipher /libsqlcipher.so /usr/lib/libsqlcipher.so
COPY . .

RUN mkdir -p /app/data /app/backups

ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/diaetendeckel.db
ENV HONKER_EXTENSION_PATH=/app/vendor/libhonker_ext.so
EXPOSE 3000

CMD ["sh", "-c", "bun db/setup.js && bun server/index.js"]
