#!/bin/sh
# Writes loadtest/.env.loadtest with freshly generated throwaway secrets.
# Prints nothing secret. Re-run to rotate; existing file is kept unless --force.
set -eu
cd "$(dirname "$0")"

if [ -f .env.loadtest ] && [ "${1:-}" != "--force" ]; then
  if ! awk 'BEGIN { found=0 } /^SMTP_PASS=./ { found=1 } END { exit !found }' .env.loadtest ||
     [ ! -f .tls/cert.pem ] || [ ! -f .tls/key.pem ] || [ ! -f .tls/smtp-auth ]; then
    echo "Old or incomplete load-test setup. Run ./loadtest/gen-env.sh --force to replace it." >&2
    exit 1
  fi
  openssl x509 -checkend 0 -noout -in .tls/cert.pem >/dev/null || {
    echo "Load-test certificate expired. Run ./loadtest/gen-env.sh --force." >&2
    exit 1
  }
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
  echo "SMTP_USER=loadtest"
  echo "SMTP_PASS=$(rand 24)"
} > .env.loadtest
mkdir -p .tls
openssl req -x509 -newkey rsa:2048 -nodes -keyout .tls/key.pem \
  -out .tls/cert.pem -days 30 -subj /CN=mailpit \
  -addext subjectAltName=DNS:mailpit >/dev/null 2>&1
sed -n 's/^SMTP_PASS=/loadtest:/p' .env.loadtest > .tls/smtp-auth
echo "wrote loadtest/.env.loadtest"
