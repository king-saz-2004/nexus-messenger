#!/usr/bin/env bash
set -euo pipefail

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${APP_DB_USER:?APP_DB_USER is required}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "nexus" \
  -v APP_DB_USER="$APP_DB_USER" \
  -v APP_DB_PASSWORD="$APP_DB_PASSWORD" <<'SQL'
SELECT set_config('app.db_user', :'APP_DB_USER', false);
SELECT set_config('app.db_password', :'APP_DB_PASSWORD', false);
\i /sql/init.sql
SQL
