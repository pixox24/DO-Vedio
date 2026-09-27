#!/usr/bin/env bash
set -euo pipefail

PORT=3000
LOG=/tmp/dovedio-dev.log
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if lsof -ti tcp:"$PORT" >/dev/null 2>&1; then
  echo "Stopping process on port $PORT..."
  lsof -ti tcp:"$PORT" | xargs kill
  sleep 1
fi

if lsof -ti tcp:"$PORT" >/dev/null 2>&1; then
  echo "Port $PORT still busy, forcing kill..."
  lsof -ti tcp:"$PORT" | xargs kill -9
  sleep 1
fi

cd "$DIR"
nohup npm run dev > "$LOG" 2>&1 &
echo "Started dev server (PID $!)"
echo "Logs: tail -f $LOG"
echo "Open http://localhost:$PORT"
