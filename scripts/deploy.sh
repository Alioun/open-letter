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

# Always builds: the layer cache makes an unchanged build quick, and Compose
# only restarts the app when the image changed.
docker compose build --build-arg GIT_COMMIT="$(git rev-parse HEAD)" app
docker compose up -d --wait app

echo "Deployed $(git rev-parse --short HEAD): $(git log -1 --format=%s)"
