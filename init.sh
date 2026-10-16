#!/usr/bin/env bash
# One command for a fresh session: install, migrate, test, then start the dev server.
#   ./init.sh            install + migrate + checks + `shopify app dev`
#   ./init.sh --no-dev   everything except starting the dev server (CI / agents)
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "No .env found. Copy .env.example to .env and fill it in (see README.md)." >&2
  exit 1
fi
set -a; . ./.env; set +a

echo "==> Installing dependencies"
npm install --no-audit --no-fund

echo "==> Applying database migrations"
npx prisma generate >/dev/null
npx prisma migrate deploy

echo "==> Typecheck, lint, tests"
npm run check

if [ "${1:-}" != "--no-dev" ]; then
  echo "==> Starting the dev server (Shopify CLI; log in when asked)"
  npm run dev
fi
