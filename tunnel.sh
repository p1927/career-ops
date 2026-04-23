#!/usr/bin/env bash
# tunnel.sh — Expose career-ops setup UI via Cloudflare trycloudflare
# Usage: bash tunnel.sh [PORT]   (default: 4737)
set -e

PORT="${1:-4737}"
TUNNEL_LOG="/tmp/career-ops-tunnel.log"
TUNNEL_PID_FILE="/tmp/career-ops-tunnel.pid"
URL_FILE="/tmp/career-ops-tunnel-url.txt"

# Kill any existing career-ops tunnel
if [ -f "$TUNNEL_PID_FILE" ]; then
  OLD_PID=$(cat "$TUNNEL_PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "⏹  Stopping old tunnel (PID $OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$TUNNEL_PID_FILE"
fi

echo "🌐  Starting cloudflared tunnel → localhost:${PORT}"

cloudflared tunnel --url "http://localhost:${PORT}" \
  --logfile "$TUNNEL_LOG" \
  > /dev/null 2>&1 &
TUNNEL_PID=$!
echo "$TUNNEL_PID" > "$TUNNEL_PID_FILE"

# Wait up to 15 s for the trycloudflare URL to appear in the log
echo -n "⏳  Waiting for tunnel URL"
TUNNEL_URL=""
for i in $(seq 1 15); do
  sleep 1
  echo -n "."
  TUNNEL_URL=$(grep -oh 'https://[^ "]*trycloudflare\.com[^ "]*' "$TUNNEL_LOG" 2>/dev/null | head -1)
  [ -n "$TUNNEL_URL" ] && break
done
echo ""

if [ -z "$TUNNEL_URL" ]; then
  echo "❌  Tunnel URL not received. Log:"
  tail -20 "$TUNNEL_LOG"
  kill "$TUNNEL_PID" 2>/dev/null || true
  rm -f "$TUNNEL_PID_FILE"
  exit 1
fi

TUNNEL_URL=$(echo "$TUNNEL_URL" | tr -d ' |')
echo "$TUNNEL_URL" > "$URL_FILE"

echo ""
echo "✅  Career-Ops Setup UI is live!"
echo ""
echo "   🔗  $TUNNEL_URL"
echo ""
echo "   Tunnel PID : $TUNNEL_PID  (kill to stop)"
echo "   URL saved  : $URL_FILE"
echo "   Log        : $TUNNEL_LOG"
echo ""
