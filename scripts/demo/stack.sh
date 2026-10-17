#!/usr/bin/env bash
# Starts or stops the local stack that record.ts films: `stack.sh up|down`.
#
#   db        Postgres in Docker (container noted-demo-db, tmpfs: every `up` starts empty)
#   backend   uvicorn with real migrations
#   frontend  a production build (`vite build`), served by Node, so no page waits for Vite
#
# Ports: DEMO_DB_PORT (57732), DEMO_BACKEND_PORT (57195), DEMO_FRONTEND_PORT (57400).
# DEMO_DB_IMAGE overrides the Postgres image (default: the db image in docker-compose.yml).
# `down` stops only what `up` started: the container by its name, the servers by
# the PIDs kept in scripts/demo/.run/, and only while each still runs the same command.
# A failed `up` stops what it already started.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
run_dir="$here/.run"

DB_PORT="${DEMO_DB_PORT:-57732}"
BACKEND_PORT="${DEMO_BACKEND_PORT:-57195}"
FRONTEND_PORT="${DEMO_FRONTEND_PORT:-57400}"
DB_CONTAINER=noted-demo-db
BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}"
FRONTEND_URL="http://127.0.0.1:${FRONTEND_PORT}"
DB_IMAGE="${DEMO_DB_IMAGE:-$(sed -n '/^  db:/,/image:/s/^ *image: *//p' "$root/docker-compose.yml")}"

port_is_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

# Polls a command every 0.5 s for up to 2 minutes.
wait_for() {
  local what=$1
  shift
  for _ in $(seq 1 240); do
    "$@" >/dev/null 2>&1 && return 0
    sleep 0.5
  done
  echo "demo: $what was not ready after 2 minutes (logs: $run_dir/)" >&2
  exit 1
}

start_server() {
  local name=$1
  shift
  nohup "$@" >"$run_dir/$name.log" 2>&1 &
  echo $! >"$run_dir/$name.pid"
  echo "$*" >"$run_dir/$name.cmd"
}

up() {
  if [ -z "$DB_IMAGE" ]; then
    echo "demo: no db image found in docker-compose.yml (set DEMO_DB_IMAGE)" >&2
    exit 1
  fi
  mkdir -p "$run_dir"
  for port in "$DB_PORT" "$BACKEND_PORT" "$FRONTEND_PORT"; do
    if port_is_open "$port"; then
      echo "demo: port $port is in use. Run 'stack.sh down' or set DEMO_*_PORT." >&2
      exit 1
    fi
  done

  # From here on, a failed step stops whatever this run already started.
  trap 'status=$?; [ "$status" -eq 0 ] || down; exit "$status"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  docker run --detach --rm --name "$DB_CONTAINER" \
    --env POSTGRES_USER=app --env POSTGRES_PASSWORD=app --env POSTGRES_DB=app \
    --publish "127.0.0.1:${DB_PORT}:5432" --tmpfs /var/lib/postgresql \
    "$DB_IMAGE" -c fsync=off -c synchronous_commit=off >/dev/null
  wait_for db docker exec "$DB_CONTAINER" pg_isready --quiet --host 127.0.0.1 --username app --dbname app
  echo "demo: db ready on 127.0.0.1:${DB_PORT}"

  export DB_URL="postgresql://app:app@127.0.0.1:${DB_PORT}/app" FRONTEND_URL
  export ENVIRONMENT=local LOG_LEVEL=WARNING SENTRY_DSN='' GOOGLE_CLIENT_ID='' GOOGLE_CLIENT_SECRET=''
  (cd "$root/backend" && uv run --frozen alembic upgrade head >"$run_dir/migrate.log" 2>&1)
  (cd "$root/backend" && start_server backend uv run --frozen uvicorn --no-access-log \
    --factory app.main:create_app --host 127.0.0.1 --port "$BACKEND_PORT")
  wait_for backend curl -fsS --max-time 2 "$BACKEND_URL/health"
  echo "demo: backend ready on $BACKEND_URL"

  (cd "$root/frontend" && VITE_API_BASE_URL="$BACKEND_URL" ./node_modules/.bin/vite build \
    >"$run_dir/build.log" 2>&1)
  (cd "$root/frontend" && HOST=127.0.0.1 PORT="$FRONTEND_PORT" start_server frontend \
    node .output/server/index.mjs)
  wait_for frontend curl -fsS --max-time 2 "$FRONTEND_URL"
  echo "demo: frontend ready on $FRONTEND_URL"
}

down() {
  for name in frontend backend; do
    local pid_file="$run_dir/$name.pid"
    [ -f "$pid_file" ] || continue
    local pid
    pid="$(cat "$pid_file")"
    # A stale pid file can name a process that is not ours any more.
    if [ "$(ps -ww -o args= -p "$pid" 2>/dev/null)" = "$(cat "$run_dir/$name.cmd")" ]; then
      # uv runs uvicorn as its child process: stop the children too.
      pkill -TERM -P "$pid" 2>/dev/null || true
      kill -TERM "$pid" 2>/dev/null || true
    fi
    rm -f "$pid_file" "$run_dir/$name.cmd"
  done
  docker rm -f "$DB_CONTAINER" >/dev/null 2>&1 || true
  echo "demo: stack stopped"
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  *)
    echo "usage: $0 up|down" >&2
    exit 2
    ;;
esac
