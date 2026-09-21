#!/bin/sh
set -e

API_URL="${API_URL:-http://localhost:8000/api}"
PORT="${PORT:-8080}"

echo "Starting frontend on 0.0.0.0:${PORT}"
echo "API_URL=${API_URL}"

# Create config file with API URL for frontend
printf 'window.__APP_CONFIG__ = { API_URL: "%s" };\n' "$API_URL" > /app/dist/config.js

exec serve -s /app/dist -l "$PORT" --no-port-switching
