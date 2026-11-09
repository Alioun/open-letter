#!/usr/bin/env bash
# Build the local Honker queue and scheduler extension. Requires Git and Cargo.
# Creates vendor/libhonker_ext.dylib on macOS or vendor/libhonker_ext.so on Linux.
# The compiled library is not committed. Docker builds its own Linux library.
# HONKER_REF selects a branch or tag and defaults to main.
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
