#!/usr/bin/env bash
# setup-start.sh — Start career-ops Setup UI server + Cloudflare tunnel in one step
# Usage: bash setup-start.sh [PORT]
set -e

PORT="${1:-4737}"
SERVER_LOG="/tmp/career-ops-server.log"
SERVER_PID_FILE="/tmp/career-ops-server.pid"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── 1. Kill any old server ─────────────────────────────────────────────────
if [ -f "$SERVER_PID_FILE" ]; then
  OLD_PID=$(cat "$SERVER_PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "⏹  Stopping old server (PID $OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$SERVER_PID_FILE"
fi

# ── 2. Start Express server ────────────────────────────────────────────────
echo "🚀  Starting career-ops setup server on port ${PORT}..."
SETUP_PORT="$PORT" node "$SCRIPT_DIR/setup-server.mjs" >> "$SERVER_LOG" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > "$SERVER_PID_FILE"

# Wait for server to be ready (up to 5 s)
READY=0
for i in $(seq 1 10); do
  sleep 0.5
  if curl -sf "http://localhost:${PORT}/api/status" > /dev/null 2>&1; then
    READY=1
    break
  fi
done

if [ "$READY" -eq 0 ]; then
  echo "❌  Server did not start. Log:"
  tail -20 "$SERVER_LOG"
  kill "$SERVER_PID" 2>/dev/null || true
  exit 1
fi

echo "✅  Server running (PID $SERVER_PID)"
echo ""

# ── 3. Start tunnel ────────────────────────────────────────────────────────
bash "$SCRIPT_DIR/tunnel.sh" "$PORT"

echo ""
echo "   Server log : $SERVER_LOG"
echo "   Stop server: kill $SERVER_PID"
echo ""
echo "   To stop everything:"
echo "   kill \$(cat /tmp/career-ops-server.pid) \$(cat /tmp/career-ops-tunnel.pid) 2>/dev/null"
echo ""
