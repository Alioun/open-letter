#!/bin/sh
# Updates a server checkout to the latest main on GitHub and rebuilds the app.
# Run it on the server from anywhere inside the checkout:
#
#   scripts/deploy.sh
#
# It stops without changing anything if the checkout has local edits that the
# update would touch, so edits made by hand on the server are never lost.
# Compose reads COMPOSE_FILE from .env, so a server that runs the Caddy proxy
# from docker-compose.proxy.yml keeps it.
set -eu
cd "$(dirname "$0")/.."

git fetch --quiet origin main
git merge --ff-only FETCH_HEAD

# The merge also says "Already up to date" when this checkout has commits that
# main on GitHub lacks, on main or on another branch. Building then would
# deploy something other than main.
if [ "$(git rev-parse HEAD)" != "$(git rev-parse FETCH_HEAD)" ]; then
  echo "Not deployed: this checkout is at $(git rev-parse --short HEAD), but main on GitHub is at $(git rev-parse --short FETCH_HEAD)." >&2
  echo "It has commits that main on GitHub lacks, or another branch is checked out. Nothing was built." >&2
  exit 1
fi

# Always builds: the layer cache makes an unchanged build quick, and Compose
# only restarts the app when the image changed.
docker compose build --build-arg GIT_COMMIT="$(git rev-parse HEAD)" app
docker compose up -d --wait app

echo "Deployed $(git rev-parse --short HEAD): $(git log -1 --format=%s)"
