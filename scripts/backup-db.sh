#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
COMPOSE_ARGS=()

if [[ "${1:-}" == "--dev" ]]; then
  COMPOSE_ARGS=(-p lukia-rank-dev -f docker-compose.dev.yml)
  shift
fi

if [[ $# -gt 0 ]]; then
  echo "Usage: $0 [--dev]" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT_DIR/.env"
  set +a
fi

DB_NAME="${POSTGRES_DB:-postgres}"
TIMESTAMP="$(date +%Y-%m-%d_%H-%M-%S)"
FILE_NAME="${DB_NAME}_${TIMESTAMP}.dump"
HOST_FILE="$BACKUP_DIR/$FILE_NAME"
CONTAINER_FILE="/backups/$FILE_NAME"

cd "$ROOT_DIR"

docker compose "${COMPOSE_ARGS[@]}" exec -T db bash -lc '
  set -euo pipefail
  mkdir -p /backups
  pg_dump \
    --format=custom \
    --no-owner \
    --no-privileges \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    --file "'"$CONTAINER_FILE"'"
'

docker compose "${COMPOSE_ARGS[@]}" cp "db:$CONTAINER_FILE" "$HOST_FILE" >/dev/null
docker compose "${COMPOSE_ARGS[@]}" exec -T db rm -f "$CONTAINER_FILE" >/dev/null

find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.dump' -mtime +"$RETENTION_DAYS" -delete

echo "Backup written to $HOST_FILE"
