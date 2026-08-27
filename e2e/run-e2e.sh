#!/usr/bin/env bash
# Bring up the whole stack, run the Selenium suite against it, tear down
# whatever this script started (anything already running is left alone).
#
#   ./run-e2e.sh                     headed Chrome, whole suite
#   ./run-e2e.sh -m smoke            only the smoke-marked tests
#   ./run-e2e.sh --headless          no window (CI)
#   ./run-e2e.sh --slow 0.3          pause between actions so it can be watched
#   ./run-e2e.sh tests/test_login.py one file
#
# Everything after the script's own flags is passed straight to pytest.

set -euo pipefail

E2E_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$E2E_DIR/.." && pwd)"
PGBIN="/usr/local/opt/postgresql@17/bin"
export PATH="$PGBIN:$PATH"

DATABASE_URL="${DATABASE_URL:-postgres://devmgmt:devmgmt@localhost:5432/devmgmt}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
API_PORT="${API_PORT:-8080}"
WEB_PORT="${WEB_PORT:-5173}"
API_HEALTH="http://localhost:${API_PORT}/api/v1/health"
WEB_URL="http://localhost:${WEB_PORT}"

STARTED_API=0
STARTED_WEB=0
API_PID=""
WEB_PID=""
LOG_DIR="$E2E_DIR/.logs"
mkdir -p "$LOG_DIR"

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mxxx\033[0m %s\n' "$*" >&2; exit 1; }

cleanup() {
  local code=$?
  if [ "$STARTED_WEB" = 1 ] && [ -n "$WEB_PID" ]; then
    say "stopping web (pid $WEB_PID)"
    kill "$WEB_PID" 2>/dev/null || true
  fi
  if [ "$STARTED_API" = 1 ] && [ -n "$API_PID" ]; then
    say "stopping api (pid $API_PID)"
    kill "$API_PID" 2>/dev/null || true
  fi
  exit $code
}
trap cleanup EXIT INT TERM

wait_for() {  # wait_for <url> <label> <seconds>
  local url=$1 label=$2 timeout=${3:-60} i=0
  while [ $i -lt "$timeout" ]; do
    if curl -sf -o /dev/null "$url"; then return 0; fi
    i=$((i + 1)); sleep 1
  done
  return 1
}

# ---------------------------------------------------------------- datastores

say "checking Postgres and Redis"
brew services list 2>/dev/null | grep -qE '^postgresql@17\s+started' || brew services start postgresql@17 >/dev/null
brew services list 2>/dev/null | grep -qE '^redis\s+started' || brew services start redis >/dev/null

for _ in $(seq 1 30); do pg_isready -h localhost -p 5432 -q && break; sleep 1; done
pg_isready -h localhost -p 5432 -q || die "Postgres never came up on :5432"
redis-cli ping >/dev/null 2>&1 || die "Redis is not answering on :6379"

psql -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='devmgmt'" | grep -q 1 \
  || psql -d postgres -qc "CREATE ROLE devmgmt LOGIN PASSWORD 'devmgmt' SUPERUSER"
psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='devmgmt'" | grep -q 1 \
  || createdb -O devmgmt devmgmt

# ---------------------------------------------------------------------- api

# A reused API is only safe if it is running the code that is on disk. An API
# started before the newest build artifact silently tests the previous build —
# which is exactly the trap that made a set of fixes look like they had failed.
API_STALE=0
if curl -sf -o /dev/null "$API_HEALTH"; then
  API_PID_RUNNING=$(pgrep -f "node dist/main.js" | head -1 || true)
  if [ -n "$API_PID_RUNNING" ] && [ -d "$ROOT/apps/api/dist" ]; then
    NEWEST=$(find "$ROOT/apps/api/dist" -name '*.js' -newer /proc/$API_PID_RUNNING 2>/dev/null | head -1 || true)
    if [ -z "$NEWEST" ]; then
      # macOS has no /proc — compare process start time to the newest artifact.
      started=$(ps -o lstart= -p "$API_PID_RUNNING" 2>/dev/null || echo "")
      if [ -n "$started" ]; then
        started_epoch=$(date -j -f "%a %b %d %T %Y" "$started" +%s 2>/dev/null || echo 0)
        newest_epoch=$(find "$ROOT/apps/api/dist" -name '*.js' -exec stat -f '%m' {} \; 2>/dev/null | sort -rn | head -1 || echo 0)
        [ "$newest_epoch" -gt "$started_epoch" ] && API_STALE=1
      fi
    else
      API_STALE=1
    fi
  fi
fi

if [ "$API_STALE" = 1 ]; then
  say "api on :$API_PORT is older than the build on disk — restarting it"
  kill "$API_PID_RUNNING" 2>/dev/null || true
  for _ in $(seq 1 15); do curl -sf -o /dev/null "$API_HEALTH" || break; sleep 1; done
fi

if curl -sf -o /dev/null "$API_HEALTH"; then
  say "api already running on :$API_PORT and current — reusing it"
else
  say "building the api"
  (cd "$ROOT" && corepack pnpm --filter api build >"$LOG_DIR/api-build.log" 2>&1) \
    || { cat "$LOG_DIR/api-build.log"; die "api build failed"; }
  say "starting the api on :$API_PORT (migrations run on boot)"
  (
    cd "$ROOT/apps/api"
    DATABASE_URL="$DATABASE_URL" REDIS_URL="$REDIS_URL" PORT="$API_PORT" \
    NODE_ENV=development JWT_SECRET="${JWT_SECRET:-e2e-dev-secret}" \
    node dist/main.js
  ) >"$LOG_DIR/api.log" 2>&1 &
  API_PID=$!
  STARTED_API=1
  wait_for "$API_HEALTH" api 90 || { tail -40 "$LOG_DIR/api.log"; die "api never became healthy"; }
fi

# ---------------------------------------------------------------------- web

if curl -sf -o /dev/null "$WEB_URL"; then
  say "web already running on :$WEB_PORT — reusing it"
else
  say "starting vite on :$WEB_PORT"
  (cd "$ROOT" && corepack pnpm dev:web) >"$LOG_DIR/web.log" 2>&1 &
  WEB_PID=$!
  STARTED_WEB=1
  wait_for "$WEB_URL" web 90 || { tail -40 "$LOG_DIR/web.log"; die "vite never came up"; }
fi

# ------------------------------------------------------------------- python

VENV="$E2E_DIR/.venv"
if [ ! -x "$VENV/bin/python" ]; then
  say "creating the python venv"
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install --quiet --upgrade pip
  "$VENV/bin/pip" install --quiet -r "$E2E_DIR/requirements.txt"
fi

# ---------------------------------------------------------------------- run

say "running the suite against $WEB_URL"
cd "$E2E_DIR"
BASE_URL="$WEB_URL" API_URL="http://localhost:${API_PORT}/api/v1" \
  "$VENV/bin/python" -m pytest "$@"
