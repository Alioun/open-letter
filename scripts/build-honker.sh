#!/usr/bin/env bash
# Build the Honker SQLite loadable extension for local development.
#
# The extension (durable job queue + scheduler) is NOT committed to git — it is
# a compiled binary. Run this once after cloning to produce
# vendor/libhonker_ext.dylib (macOS) or vendor/libhonker_ext.so (Linux), which
# db/jobs.js loads via HONKER_EXTENSION_PATH. The production Docker image builds
# the Linux .so itself (see Dockerfile), so this script is for local dev.
#
# Requires: git, Rust toolchain (cargo).
#   HONKER_REF=<branch|tag>  override the source ref (default: main)
set -euo pipefail

REF="${HONKER_REF:-main}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

case "$(uname -s)" in
  Darwin) EXT="dylib" ;;
  *)      EXT="so" ;;
esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "[honker] cloning russellromney/honker@${REF}"
git clone --depth 1 --branch "$REF" https://github.com/russellromney/honker.git "$TMP"

echo "[honker] building honker-extension (release)"
( cd "$TMP" && cargo build --release -p honker-extension )

LIB="$(find "$TMP/target/release" -maxdepth 1 -name "libhonker_ext.${EXT}" | head -1)"
if [ -z "$LIB" ]; then
  echo "[honker] ERROR: libhonker_ext.${EXT} not found after build" >&2
  exit 1
fi

mkdir -p "$ROOT/vendor"
cp "$LIB" "$ROOT/vendor/libhonker_ext.${EXT}"
echo "[honker] installed vendor/libhonker_ext.${EXT}"
