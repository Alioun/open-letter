#!/bin/sh
# Writes loadtest/.env.loadtest with freshly generated throwaway secrets.
# Prints nothing secret. Re-run to rotate; existing file is kept unless --force.
set -eu
cd "$(dirname "$0")"

if [ -f .env.loadtest ] && [ "${1:-}" != "--force" ]; then
  echo "loadtest/.env.loadtest exists (use --force to regenerate)"
  exit 0
fi

umask 077
rand() { openssl rand -hex "$1"; }
{
  echo "DATABASE_ENCRYPTION_KEY=$(rand 32)"
  echo "BACKUP_ENCRYPTION_KEY=$(rand 32)"
  echo "ADMIN_PATH=admin-$(rand 4)"
  echo "ADMIN_PASSWORD=$(rand 16)"
  echo "ADMIN_JWT_SECRET=$(rand 32)"
  echo "API_TOKEN_SECRET=$(rand 32)"
} > .env.loadtest
echo "wrote loadtest/.env.loadtest"
