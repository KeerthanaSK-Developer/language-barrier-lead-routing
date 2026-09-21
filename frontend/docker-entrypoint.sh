#!/bin/sh
set -e

API_URL="${API_URL:-http://localhost:8000/api}"
PORT="${PORT:-3000}"

echo "Starting frontend on 0.0.0.0:${PORT}"
echo "API_URL=${API_URL}"

cat > /app/dist/config.js <<EOF
window.__APP_CONFIG__ = { API_URL: "${API_URL}" };
EOF

exec serve -s /app/dist -l "tcp://0.0.0.0:${PORT}"
