#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
COMPOSE_ARGS=()

if [[ "${1:-}" == "--dev" ]]; then
  COMPOSE_ARGS=(-p lukia-rank-dev -f docker-compose.dev.yml)
  shift
fi

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 [--dev] <backup-file-or-name>" >&2
  exit 1
fi

INPUT_PATH="$1"
if [[ "$INPUT_PATH" != /* ]]; then
  INPUT_PATH="$BACKUP_DIR/$INPUT_PATH"
fi

if [[ ! -f "$INPUT_PATH" ]]; then
  echo "Backup file not found: $INPUT_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
BACKUP_FILE_NAME="$(basename "$INPUT_PATH")"
HOST_BACKUP_PATH="$BACKUP_DIR/$BACKUP_FILE_NAME"
CONTAINER_FILE="/backups/$BACKUP_FILE_NAME"

if [[ "$INPUT_PATH" != "$HOST_BACKUP_PATH" ]]; then
  cp "$INPUT_PATH" "$HOST_BACKUP_PATH"
fi

cd "$ROOT_DIR"

docker compose "${COMPOSE_ARGS[@]}" stop app >/dev/null 2>&1 || true
trap 'docker compose "${COMPOSE_ARGS[@]}" start app >/dev/null 2>&1 || true' EXIT

docker compose "${COMPOSE_ARGS[@]}" exec -T db mkdir -p /backups >/dev/null
docker compose "${COMPOSE_ARGS[@]}" cp "$HOST_BACKUP_PATH" "db:$CONTAINER_FILE" >/dev/null

docker compose "${COMPOSE_ARGS[@]}" exec -T db bash -lc '
  set -euo pipefail
  test -f "'"$CONTAINER_FILE"'"
  pg_restore \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    "'"$CONTAINER_FILE"'"
'

docker compose "${COMPOSE_ARGS[@]}" exec -T db rm -f "$CONTAINER_FILE" >/dev/null

echo "Restored database from $INPUT_PATH"
